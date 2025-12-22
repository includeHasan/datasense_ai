import { assertReadOnlySelect } from "../../safety/sql-guard.js";
import { assertReadOnlyAggregation } from "../../safety/mongo-guard.js";
import type { DataSource } from "../../sources/types.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

/**
 * Factory for the execute node: closes over the request's DataSource so the
 * DataSource instance itself never needs to live in graph state. Guards the
 * query with the guard matching the source's dialect before ever calling
 * source.execute() - source.execute() re-validates internally too (see
 * SqlSource/MongoSource), so this is defense in depth, not the only check.
 */
export function makeExecuteNode(source: DataSource) {
  return async function execute(state: AgentStateType): Promise<AgentStateUpdate> {
    try {
      if (source.dialect === "mongodb") {
        assertReadOnlyAggregation(state.sql);
      } else {
        assertReadOnlySelect(state.sql);
      }
      const result = await source.execute(state.sql);
      return { queryResult: result, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: message, attempts: state.attempts + 1 };
    }
  };
}
