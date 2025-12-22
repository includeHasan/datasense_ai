import { Annotation } from "@langchain/langgraph";
import type { SchemaProfile, QueryResult } from "../sources/types.js";
import type { ChartSpec } from "../schemas/chart-spec.js";
import type { FinalAnswer } from "../schemas/answer.js";
import type { LlmOverrides } from "./llm.js";

/**
 * Graph state for the data-sense agent.
 *
 * Field list (kept verbatim for downstream consumers):
 * - question: string
 * - profile: SchemaProfile
 * - plan: string (default "")
 * - sql: string (default "")
 * - queryResult: QueryResult | null (default null)
 * - error: string | null (default null)
 * - attempts: number (default 0)
 * - narrative: string (default "")
 * - chartSpec: ChartSpec | null (default null)
 * - caveats: string[] (default [])
 * - finalAnswer: FinalAnswer | null (default null)
 * - route: "data_question" | "conversational" | "" (default "")
 * - suggestedFollowups: string[] (default [])
 * - history: string (default "") - compact rendering of recent prior turns
 *   in the conversation, used to resolve follow-up references
 */
export const AgentState = Annotation.Root({
  question: Annotation<string>,
  profile: Annotation<SchemaProfile>,
  history: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  route: Annotation<"data_question" | "conversational" | "">({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  plan: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  sql: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  queryResult: Annotation<QueryResult | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  error: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  attempts: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  narrative: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  chartSpec: Annotation<ChartSpec | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  caveats: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  finalAnswer: Annotation<FinalAnswer | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  suggestedFollowups: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  // Per-request LLM overrides (bring-your-own-credentials). Empty object means
  // "use the app's default key/model" (free tier). Threaded to every node so
  // each getChatModel(state.llm) call honours the caller's chosen provider.
  llm: Annotation<LlmOverrides>({
    reducer: (_current, update) => update,
    default: () => ({}),
  }),
});

export type AgentStateType = typeof AgentState.State;
export type AgentStateUpdate = typeof AgentState.Update;
