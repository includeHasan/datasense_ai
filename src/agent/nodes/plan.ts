import { getChatModel } from "../llm.js";
import * as prompts from "../prompts.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

/**
 * Planning node: asks the model to produce a short natural-language plan
 * describing which tables/columns to use and how to answer the question.
 */
export async function plan(state: AgentStateType): Promise<AgentStateUpdate> {
  const model = getChatModel();
  const prompt = prompts.buildPlanPrompt(state.question, state.profile, state.history);
  const result = await model.invoke(prompt);
  const text = typeof result.content === "string" ? result.content : String(result.content);
  return { plan: text };
}
