import type { FastifyInstance } from "fastify";
import { z } from "zod";
import rateLimit from "@fastify/rate-limit";
import { Conversation } from "../models/conversation.js";
import { Report } from "../models/report.js";
import { User } from "../models/user.js";
import { checkQuota, consumeQuota, resolveLlm } from "../auth/llm-access.js";
import { getProfileForOwner, getSourceForOwner } from "../sources/registry.js";
import { startSse } from "../agent/sse.js";
import {
  buildGeneratedReport,
  buildReportFromConversation,
  type GeneratedReport,
} from "../reports/builder.js";

const reportBodySchema = z
  .object({
    conversationId: z.string().optional(),
    sourceId: z.string().optional(),
    preferences: z
      .object({
        freeText: z.string().optional(),
        sections: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .refine((data) => Boolean(data.conversationId) !== Boolean(data.sourceId), {
    message: 'Provide exactly one of "conversationId" (export a conversation) or "sourceId" (generate a fresh report).',
  });

/**
 * Persists a freshly-built report for its owner so it survives page
 * refreshes and shows up in the user's report history (GET /reports). Returns
 * the new document's string id, which the route echoes back in the terminal
 * `final` SSE payload so the client knows the report was saved.
 */
async function persistReport(
  report: GeneratedReport,
  ownerId: string,
  origin: { sourceId?: string; conversationId?: string },
): Promise<string> {
  const doc = await Report.create({
    ownerId,
    title: report.title,
    sections: report.sections,
    sourceId: origin.sourceId,
    conversationId: origin.conversationId,
  });
  return String(doc._id);
}

/**
 * Looks up a report by id, but only if it is owned by the given userId.
 * Returns null both when the report does not exist and when it belongs to a
 * different owner, so callers can respond with a uniform 404 instead of
 * leaking existence of other users' reports (mirrors getConversationForOwner
 * in conversations.ts).
 */
async function getReportForOwner(reportId: string, ownerId: string) {
  const report = await Report.findById(reportId).catch(() => null);
  if (!report || report.ownerId !== ownerId) return null;
  return report;
}

/**
 * Registers the /reports route:
 *
 * - POST /reports: builds a report, either from an existing conversation
 *   ({ conversationId }) or freshly from a data source ({ sourceId,
 *   preferences? }). Streams progress over SSE using the same activity-trace
 *   event shape as /sources/:id/ask (see agent/events.ts), then ends the
 *   stream with a `final` event carrying the full report JSON payload
 *   ({ title, sections }) - PDF assembly happens entirely client-side (see
 *   frontend/src/lib/build-pdf.ts), so there is no server-stored PDF
 *   artifact and no separate download route.
 *
 * The route requires authentication and is additionally rate limited more
 * strictly than the anonymous /demo routes (see routes/demo.ts) since it
 * triggers one or more full LLM + query-execution agent runs - expensive
 * even for an authenticated user.
 */
export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (reportApp) => {
    await reportApp.register(rateLimit, {
      max: 3,
      timeWindow: "5 minutes",
      // Every /reports request is authenticated, so key the limit off the
      // caller's bearer token rather than IP - otherwise multiple users
      // behind the same NAT/office network would share one throttle bucket.
      // (Falls back to IP for the rare case of a malformed/missing header,
      // which the auth preHandler will reject anyway.)
      keyGenerator: (request) => (request.headers.authorization as string | undefined) ?? request.ip,
    });

    reportApp.post("/reports", { preHandler: [app.authenticate] }, async (request, reply) => {
      const parsed = reportBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const { conversationId, sourceId, preferences } = parsed.data;

      if (conversationId) {
        const conversation = await Conversation.findById(conversationId).catch(() => null);
        if (!conversation || conversation.userId !== request.user.id) {
          return reply.code(404).send({ error: `No conversation found with id "${conversationId}".` });
        }

        reply.hijack();
        const sse = startSse(reply);
        try {
          sse.send({ phase: "load", label: "Loading conversation", status: "running" });
          const result = await buildReportFromConversation(conversationId, request.user.id);
          if (!result) {
            sse.send({ error: `No conversation found with id "${conversationId}".` }, "error");
            return;
          }
          sse.send({ phase: "load", label: "Loading conversation", status: "done" });
          const reportId = await persistReport(result, request.user.id, { conversationId });
          sse.send({ ...result, reportId }, "final");
        } catch (error) {
          sse.send(
            {
              error: "Something went wrong while generating the report.",
              detail: error instanceof Error ? error.message : String(error),
            },
            "error",
          );
        } finally {
          sse.end();
        }
        return;
      }

      // sourceId mode: generate a fresh report from a connected data source.
      // This runs one or more LLM agent passes, so it counts against the
      // freemium quota (unlike the no-LLM conversation-export mode above).
      const source = await getSourceForOwner(sourceId as string, request.user.id);
      const profile = await getProfileForOwner(sourceId as string, request.user.id);
      if (!source || !profile) {
        return reply.code(404).send({ error: `No source found with id "${sourceId}".` });
      }

      const user = await User.findById(request.user.id);
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const { overrides, usesOwnKey } = resolveLlm(user);
      if (!usesOwnKey) {
        const quota = checkQuota(user);
        if (!quota.allowed) {
          return reply.code(402).send({
            error:
              "You've used your 5 free queries this month. Add your own API key in Settings to continue.",
            code: "QUOTA_EXCEEDED",
          });
        }
      }

      reply.hijack();
      const sse = startSse(reply);
      try {
        const result = await buildGeneratedReport(
          source,
          profile,
          preferences ?? {},
          (event) => sse.send(event),
          overrides,
        );
        const reportId = await persistReport(result, request.user.id, {
          sourceId: sourceId as string,
        });
        if (!usesOwnKey) {
          await consumeQuota(user);
        }
        sse.send({ ...result, reportId }, "final");
      } catch (error) {
        sse.send(
          {
            error: "Something went wrong while generating the report.",
            detail: error instanceof Error ? error.message : String(error),
          },
          "error",
        );
      } finally {
        sse.end();
      }
    });
  });

  // The list/get routes are cheap JSON reads, so register them directly on
  // `app` (outside the encapsulated scope above) rather than behind the
  // strict 3-per-5-minute generation rate limit that guards POST /reports.
  app.get("/reports", { preHandler: [app.authenticate] }, async (request, reply) => {
    const reports = await Report.find({ ownerId: request.user.id })
      .sort({ createdAt: -1 })
      .select({ title: 1, createdAt: 1 })
      .lean();

    return reply.send(
      reports.map((report) => ({
        id: String(report._id),
        title: report.title,
        createdAt: report.createdAt,
      })),
    );
  });

  app.get<{ Params: { id: string } }>(
    "/reports/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const report = await getReportForOwner(request.params.id, request.user.id);
      if (!report) {
        return reply.code(404).send({ error: `No report found with id "${request.params.id}".` });
      }

      return reply.send({
        id: String(report._id),
        title: report.title,
        sections: report.sections,
        sourceId: report.sourceId,
        conversationId: report.conversationId,
        createdAt: report.createdAt,
      });
    },
  );
}

export default registerReportRoutes;
