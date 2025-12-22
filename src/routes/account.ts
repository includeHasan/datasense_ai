import type { FastifyInstance } from "fastify";
import { z } from "zod";
import config from "../config.js";
import { User } from "../models/user.js";
import { encryptSecret } from "../auth/crypto.js";
import { currentMonth, usedThisMonth } from "../auth/llm-access.js";
import type { QuotaUser } from "../auth/llm-access.js";

/**
 * The public shape returned by every /account/llm endpoint. Deliberately
 * NEVER includes the stored API key (not even masked beyond `hasOwnKey`) -
 * there is no way to read a stored key back.
 */
interface LlmAccountResponse {
  hasOwnKey: boolean;
  baseUrl: string | null;
  model: string | null;
  freeQueriesLimit: number;
  freeQueriesUsed: number;
  freeQueriesRemaining: number;
  month: string;
}

function toAccountResponse(user: QuotaUser): LlmAccountResponse {
  const hasOwnKey = Boolean(user.llmApiKeyEnc);
  const limit = config.freeQueriesPerMonth;
  const used = usedThisMonth(user);
  return {
    hasOwnKey,
    baseUrl: user.llmBaseUrl ?? null,
    model: user.llmModel ?? null,
    freeQueriesLimit: limit,
    freeQueriesUsed: used,
    freeQueriesRemaining: Math.max(0, limit - used),
    month: currentMonth(),
  };
}

const saveLlmBodySchema = z.object({
  apiKey: z.string().min(1, "apiKey is required"),
  baseUrl: z.string().url("baseUrl must be a valid http(s) URL").optional(),
  model: z.string().min(1, "model is required"),
});

/**
 * Registers the /account/llm routes for the freemium / bring-your-own-LLM
 * feature: viewing usage + credential status, setting your own OpenAI-
 * compatible credentials, and reverting to the free tier. All authenticated.
 * The stored API key is encrypted at rest and never returned.
 */
export function registerAccountRoutes(app: FastifyInstance): void {
  app.get("/account/llm", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await User.findById(request.user.id);
    if (!user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return reply.send(toAccountResponse(user));
  });

  app.put("/account/llm", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = saveLlmBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const user = await User.findById(request.user.id);
    if (!user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    user.llmApiKeyEnc = encryptSecret(parsed.data.apiKey);
    user.llmBaseUrl = parsed.data.baseUrl ?? undefined;
    user.llmModel = parsed.data.model;
    await user.save();

    return reply.send(toAccountResponse(user));
  });

  app.delete("/account/llm", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await User.findById(request.user.id);
    if (!user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    user.llmApiKeyEnc = undefined;
    user.llmBaseUrl = undefined;
    user.llmModel = undefined;
    await user.save();

    return reply.send(toAccountResponse(user));
  });
}

export default registerAccountRoutes;
