import config from "../../config.js";
import type { FinalAnswer } from "../../schemas/answer.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

const MAX_SAMPLE_ROWS = config.maxSampleRows;

/**
 * Assemble node: pure function that builds the final FinalAnswer object from
 * the accumulated graph state.
 */
export function assemble(state: AgentStateType): AgentStateUpdate {
  const sampleRows = (state.queryResult?.rows ?? []).slice(0, MAX_SAMPLE_ROWS);

  const finalAnswer: FinalAnswer = {
    narrative: state.narrative,
    chartSpec: state.chartSpec as FinalAnswer["chartSpec"],
    sql: state.sql,
    sampleRows,
    caveats: state.caveats,
  };

  return { finalAnswer };
}
