import type { FastifyInstance } from "fastify";
import { z } from "zod";
import rateLimit from "@fastify/rate-limit";
import { getDemoState } from "../demo/seed.js";
import { buildGraph } from "../agent/graph.js";
import { buildHistory, type HistoryMessage } from "../agent/history.js";
import { runAgentStreaming } from "../agent/run.js";
import { startSse } from "../agent/sse.js";
import { FinalAnswerSchema } from "../schemas/answer.js";

const HISTORY_MAX_TURNS = 5;

const askBodySchema = z.object({
  question: z.string().min(1, "question is required"),
  // The demo route is anonymous (no database), so unlike /sources/:id/ask
  // there is no server-persisted conversation to load history from. The
  // client instead sends its own recent turns (already held in
  // localStorage/component state) so follow-ups still resolve correctly.
  priorTurns: z
    .array(z.object({ question: z.string(), answer: FinalAnswerSchema }))
    .optional(),
});

/**
 * Registers the public, unauthenticated /demo routes: a fixed, server-seeded
 * sample dataset anyone can query without an account, so the app can be
 * tried on a login-free deployment. Scoped to its own rate limit so a
 * publicly reachable route can't run up the LLM bill.
 */
export async function registerDemoRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (demoApp) => {
    await demoApp.register(rateLimit, {
      max: 10,
      timeWindow: "1 minute",
    });

    demoApp.get("/demo/profile", async (_request, reply) => {
      const { profile } = await getDemoState();
      return reply.send(profile);
    });

    demoApp.get("/demo/suggested-questions", async (_request, reply) => {
      const { suggestedQuestions } = await getDemoState();
      return reply.send({ questions: suggestedQuestions });
    });

    demoApp.post("/demo/ask", async (request, reply) => {
      const parsed = askBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const { source, profile } = await getDemoState();

      const historyMessages: HistoryMessage[] = (parsed.data.priorTurns ?? []).flatMap((turn) => [
        { role: "user" as const, question: turn.question },
        { role: "assistant" as const, answer: turn.answer },
      ]);
      const history = buildHistory(historyMessages, HISTORY_MAX_TURNS);

      reply.hijack();
      const sse = startSse(reply);

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
          },
          (event) => sse.send(event),
        );

        sse.send(finalAnswer, "final");
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
    });
  });
}

export default registerDemoRoutes;
