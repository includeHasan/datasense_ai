import { ChatOpenAI } from "@langchain/openai";
import config from "../config.js";

/**
 * Per-request overrides for the LLM, used by the bring-your-own-credentials
 * feature: when a user supplies their own OpenAI-compatible key/model/base
 * URL, these take precedence over the app defaults. An empty object (the
 * common free-tier case) falls back entirely to the app's OPENAI_API_KEY and
 * configured model.
 */
export interface LlmOverrides {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * The single place in the codebase that constructs the LLM used by the agent.
 * Keeping model construction centralized here makes provider/model swaps cheap.
 *
 * Passing `overrides` points the model at a user's own OpenAI-compatible
 * provider: `baseUrl` sets the client's baseURL (the documented way to target
 * any OpenAI-compatible endpoint - OpenAI, MiniMax, Together, Groq, local
 * vLLM, etc.), while apiKey/model override the app defaults.
 */
export function getChatModel(overrides?: LlmOverrides): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: overrides?.apiKey || config.openaiApiKey,
    model: overrides?.model || config.openaiModel,
    temperature: 0,
    ...(overrides?.baseUrl ? { configuration: { baseURL: overrides.baseUrl } } : {}),
  });
}
