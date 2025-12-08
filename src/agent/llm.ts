import { ChatOpenAI } from "@langchain/openai";
import config from "../config.js";

/**
 * The single place in the codebase that constructs the LLM used by the agent.
 * Keeping model construction centralized here makes provider/model swaps cheap.
 */
export function getChatModel(): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    temperature: 0,
  });
}
