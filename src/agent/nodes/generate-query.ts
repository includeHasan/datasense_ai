import { z } from "zod";
import { getChatModel } from "../llm.js";
import * as prompts from "../prompts.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

const generateQueryOutputSchema = z.object({ sql: z.string() });

/**
 * Query-generation node: asks the model to produce a single query (SQL or
 * MongoDB aggregation pipeline, depending on dialect) that answers the
 * question, given the plan produced by the previous step.
 */
export async function generateQuery(state: AgentStateType): Promise<AgentStateUpdate> {
  const model = getChatModel().withStructuredOutput(generateQueryOutputSchema);
  const prompt = prompts.buildGenerateQueryPrompt(
    state.question,
    state.plan,
    state.profile,
    "sql",
  );
  const result = await model.invoke(prompt);
  return { sql: result.sql };
}
