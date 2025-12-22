import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildGraph } from "../agent/graph.js";
import { buildHistory } from "../agent/history.js";
import { runAgentStreaming } from "../agent/run.js";
import { startSse } from "../agent/sse.js";
import { getProfileForOwner, getSourceForOwner } from "../sources/registry.js";
import { Conversation } from "../models/conversation.js";
import { Message } from "../models/message.js";
import { User } from "../models/user.js";
import { checkQuota, consumeQuota, resolveLlm } from "../auth/llm-access.js";

const askBodySchema = z.object({
  question: z.string().min(1, "question is required"),
  conversationId: z.string().optional(),
});

const HISTORY_MAX_TURNS = 5;
// Fetch a few extra messages beyond 2*maxTurns so a stray unmatched leading
// message (e.g. if a previous write ever failed mid-turn) doesn't shrink the
// usable window below maxTurns pairs.
const HISTORY_FETCH_LIMIT = HISTORY_MAX_TURNS * 2 + 2;

/**
 * Derives a short conversation title from a first question, truncating to
 * keep sidebar listings compact.
 */
function titleFromQuestion(question: string): string {
  const trimmed = question.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed || "New conversation";
}

/**
 * Registers the /sources/:id/ask route: runs the data-sense agent graph
 * against a previously registered source and returns its final answer.
 *
 * Conversations are persisted to MongoDB. If the request supplies a
 * conversationId, it must be owned by the requesting user (404 otherwise);
 * its recent turns are loaded and threaded into the agent as history so
 * follow-up questions ("tell me about two of those") resolve correctly. If
 * no conversationId is supplied, a new conversation is auto-created for this
 * source on the first ask, and its id is returned alongside the answer so
 * the client can persist it and continue the thread.
 */
export function registerAskRoute(app: FastifyInstance): void {
  app.post<{ Params: { id: string } }>(
    "/sources/:id/ask",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
    const parsed = askBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { id } = request.params;
    const source = await getSourceForOwner(id, request.user.id);
    if (!source) {
      return reply.code(404).send({ error: `No source found with id "${id}".` });
    }

    const profile = await getProfileForOwner(id, request.user.id);

    // Freemium quota + bring-your-own-credentials: resolve which LLM this
    // user's query runs against, and (for free-tier users) reject up-front
    // with a plain JSON 402 if they've exhausted their monthly allowance -
    // before hijacking the reply for SSE.
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

    let conversation;
    if (parsed.data.conversationId) {
      conversation = await Conversation.findById(parsed.data.conversationId).catch(() => null);
      if (!conversation || conversation.userId !== request.user.id) {
        return reply.code(404).send({
          error: `No conversation found with id "${parsed.data.conversationId}".`,
        });
      }
    } else {
      conversation = await Conversation.create({
        userId: request.user.id,
        sourceId: id,
        title: titleFromQuestion(parsed.data.question),
      });
    }

    const conversationId = String(conversation._id);

    const recentMessages = await Message.find({ conversationId })
      .sort({ createdAt: -1 })
      .limit(HISTORY_FETCH_LIMIT)
      .lean();
    recentMessages.reverse();
    const history = buildHistory(recentMessages, HISTORY_MAX_TURNS);

    reply.hijack();
    const sse = startSse(reply);
    const trace: unknown[] = [];

    try {
      const graph = buildGraph(source);
      const finalAnswer = await runAgentStreaming(
        graph,
        {
          question: parsed.data.question,
          profile,
          history,
          route: "",
          plan: "",
          sql: "",
          queryResult: null,
          error: null,
          attempts: 0,
          narrative: "",
          chartSpec: null,
          caveats: [],
          suggestedFollowups: [],
          llm: overrides,
        },
        (event) => {
          trace.push(event);
          sse.send(event);
        },
      );

      await Message.create({ conversationId, role: "user", question: parsed.data.question });
      await Message.create({ conversationId, role: "assistant", answer: finalAnswer, trace });
      conversation.updatedAt = new Date();
      await conversation.save();

      // Count this successful query against the free-tier allowance (no-op for
      // users on their own key). Consume only after success so an error
      // doesn't burn a query.
      if (!usesOwnKey) {
        await consumeQuota(user);
      }

      sse.send({ ...finalAnswer, conversationId }, "final");
    } catch (error) {
      sse.send(
        {
          error: "Something went wrong while answering your question. Please try again.",
          detail: error instanceof Error ? error.message : String(error),
        },
        "error",
      );
    } finally {
      sse.end();
    }
    }
  );
}

export default registerAskRoute;
