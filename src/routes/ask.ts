import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildGraph } from "../agent/graph.js";
import { getProfileForOwner, getSourceForOwner } from "../sources/registry.js";

const askBodySchema = z.object({
  question: z.string().min(1, "question is required"),
});

/**
 * Registers the /sources/:id/ask route: runs the data-sense agent graph
 * against a previously registered source and returns its final answer.
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
    const source = getSourceForOwner(id, request.user.id);
    if (!source) {
      return reply.code(404).send({ error: `No source found with id "${id}".` });
    }

    const profile = getProfileForOwner(id, request.user.id);

    try {
      const graph = buildGraph(source);
      const result = await graph.invoke({
        question: parsed.data.question,
        profile,
        plan: "",
        sql: "",
        queryResult: null,
        error: null,
        attempts: 0,
        narrative: "",
        chartSpec: null,
        caveats: [],
      });

      return reply.send(result.finalAnswer);
    } catch (error) {
      return reply.code(500).send({
        error: "Something went wrong while answering your question. Please try again.",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    }
  );
}

export default registerAskRoute;
