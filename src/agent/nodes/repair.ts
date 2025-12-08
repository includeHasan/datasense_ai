import { z } from "zod";
import { getChatModel } from "../llm.js";
import * as prompts from "../prompts.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

const repairOutputSchema = z.object({ sql: z.string() });

/**
 * Repair node: given the query that failed and the error message it raised,
 * asks the model to produce a corrected query.
 */
export async function repair(state: AgentStateType): Promise<AgentStateUpdate> {
  const model = getChatModel().withStructuredOutput(repairOutputSchema);
  const prompt = prompts.buildRepairPrompt(state.sql, state.error ?? "", state.profile);
  const result = await model.invoke(prompt);
  return { sql: result.sql, error: null };
}
