import type { FastifyInstance } from "fastify";
import { z } from "zod";
import rateLimit from "@fastify/rate-limit";
import { Conversation } from "../models/conversation.js";
import { getProfileForOwner, getSourceForOwner } from "../sources/registry.js";
import { startSse } from "../agent/sse.js";
import { buildGeneratedReport, buildReportFromConversation } from "../reports/builder.js";

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
          sse.send(result, "final");
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
      const source = getSourceForOwner(sourceId as string, request.user.id);
      const profile = getProfileForOwner(sourceId as string, request.user.id);
      if (!source || !profile) {
        return reply.code(404).send({ error: `No source found with id "${sourceId}".` });
      }

      reply.hijack();
      const sse = startSse(reply);
      try {
        const result = await buildGeneratedReport(source, profile, preferences ?? {}, (event) =>
          sse.send(event),
        );
        sse.send(result, "final");
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
}

export default registerReportRoutes;
