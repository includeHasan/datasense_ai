import { z } from "zod";
import { getChatModel } from "../llm.js";
import * as prompts from "../prompts.js";
import type { DataSource } from "../../sources/types.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

const repairOutputSchema = z.object({ sql: z.string() });

/**
 * Factory for the repair node: closes over the request's DataSource so the
 * repair prompt knows whether to ask for corrected SQL or a corrected
 * MongoDB {collection, pipeline} JSON envelope (see
 * prompts.buildRepairPrompt), matching the source's actual dialect.
 */
export function makeRepairNode(source: DataSource) {
  return async function repair(state: AgentStateType): Promise<AgentStateUpdate> {
    const model = getChatModel(state.llm).withStructuredOutput(repairOutputSchema);
    const prompt = prompts.buildRepairPrompt(state.sql, state.error ?? "", state.profile, source.dialect);
    const result = await model.invoke(prompt);
    return { sql: result.sql, error: null };
  };
}
