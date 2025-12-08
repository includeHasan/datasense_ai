import { Annotation } from "@langchain/langgraph";
import type { SchemaProfile, QueryResult } from "../sources/types.js";
import type { ChartSpec } from "../schemas/chart-spec.js";
import type { FinalAnswer } from "../schemas/answer.js";

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
 */
export const AgentState = Annotation.Root({
  question: Annotation<string>,
  profile: Annotation<SchemaProfile>,
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
});

export type AgentStateType = typeof AgentState.State;
export type AgentStateUpdate = typeof AgentState.Update;
