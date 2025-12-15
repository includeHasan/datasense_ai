import { z } from "zod";
import { getChatModel } from "../llm.js";
import * as prompts from "../prompts.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

const routerOutputSchema = z.object({
  route: z.enum(["data_question", "conversational"]),
  reason: z.string(),
});

/**
 * Router node: classifies the incoming question as a genuine data question
 * (requires running the SQL pipeline) or a conversational message (greeting,
 * meta-question about capabilities, or a schema question) that can be
 * answered directly without querying the data.
 */
export async function router(state: AgentStateType): Promise<AgentStateUpdate> {
  const model = getChatModel().withStructuredOutput(routerOutputSchema);
  const prompt = prompts.buildRouterPrompt(state.question, state.profile, state.history);
  const result = await model.invoke(prompt);
  return { route: result.route };
}
