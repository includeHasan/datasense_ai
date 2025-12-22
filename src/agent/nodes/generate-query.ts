import { z } from "zod";
import { getChatModel } from "../llm.js";
import * as prompts from "../prompts.js";
import type { DataSource } from "../../sources/types.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

const generateQueryOutputSchema = z.object({ sql: z.string() });

/**
 * Factory for the query-generation node: closes over the request's
 * DataSource so the prompt is built for the source's actual dialect (SQL vs
 * a MongoDB aggregation pipeline) instead of always assuming SQL.
 */
export function makeGenerateQueryNode(source: DataSource) {
  return async function generateQuery(state: AgentStateType): Promise<AgentStateUpdate> {
    const model = getChatModel(state.llm).withStructuredOutput(generateQueryOutputSchema);
    const prompt = prompts.buildGenerateQueryPrompt(
      state.question,
      state.plan,
      state.profile,
      source.dialect,
      state.history,
    );
    const result = await model.invoke(prompt);
    return { sql: result.sql };
  };
}
