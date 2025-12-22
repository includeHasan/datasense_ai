import { z } from "zod";
import { getChatModel } from "../llm.js";
import * as prompts from "../prompts.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

const converseOutputSchema = z.object({
  narrative: z.string(),
  suggestedFollowups: z.array(z.string()),
});

/**
 * Converse node: handles conversational messages (greetings, meta-questions,
 * schema questions) with a natural response grounded in the actual dataset
 * profile, without running the SQL pipeline. Leaves sql/chartSpec untouched.
 */
export async function converse(state: AgentStateType): Promise<AgentStateUpdate> {
  const model = getChatModel(state.llm).withStructuredOutput(converseOutputSchema);
  const prompt = prompts.buildConversePrompt(state.question, state.profile, state.history);
  const result = await model.invoke(prompt);
  return {
    narrative: result.narrative,
    suggestedFollowups: result.suggestedFollowups,
  };
}
