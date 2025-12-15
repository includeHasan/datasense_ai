import type { AgentStateType } from "./state.js";

/**
 * A single step in the graph's live activity trace, sent to the client as it
 * happens so the UI can show real progress instead of a static spinner.
 */
export type ActivityStatus = "running" | "done";

export interface ActivityEvent {
  /** The graph node this event describes (e.g. "generateQuery"). */
  phase: string;
  /** Short, user-facing label for the phase (e.g. "Writing SQL"). */
  label: string;
  /** Optional extra context extracted from the node's state (e.g. the SQL). */
  detail?: string;
  status: ActivityStatus;
}

const PHASE_LABELS: Record<string, string> = {
  router: "Understanding your question",
  planStep: "Planning the analysis",
  generateQuery: "Writing SQL",
  execute: "Running query",
  repair: "Fixing the query",
  synthesize: "Interpreting results",
  converse: "Thinking it through",
  assemble: "Finalizing answer",
};

const MAX_DETAIL_LENGTH = 200;

function truncate(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > MAX_DETAIL_LENGTH ? `${trimmed.slice(0, MAX_DETAIL_LENGTH - 1)}…` : trimmed;
}

/**
 * Extracts a short, useful detail string for a node's activity event, if any
 * relevant field is present on the state it was given.
 *
 * `state` is the input state for "running" events (so nodes like `repair`
 * can surface the error they are about to fix) and the merged state
 * (including this node's own partial update) for "done" events (so nodes
 * like `generateQuery`/`execute` can surface what they just produced).
 */
function extractDetail(phase: string, state: Partial<AgentStateType>): string | undefined {
  switch (phase) {
    case "generateQuery":
      return state.sql ? truncate(state.sql) : undefined;
    case "execute":
      if (state.error) return truncate(state.error);
      if (state.queryResult) {
        const rowCount = state.queryResult.rows?.length ?? 0;
        return `${rowCount} row${rowCount === 1 ? "" : "s"} returned`;
      }
      return undefined;
    case "repair":
      return state.error ? truncate(state.error) : undefined;
    default:
      return undefined;
  }
}

/**
 * Maps a graph node name + a snapshot of state to a user-facing activity
 * event. `state` should be the state available at the moment of the event:
 * the pre-node state for "running" events, and the post-node (merged) state
 * for "done" events.
 */
export function toActivityEvent(
  nodeName: string,
  state: Partial<AgentStateType>,
  status: ActivityStatus = "done",
): ActivityEvent {
  const label = PHASE_LABELS[nodeName] ?? nodeName;
  const detail = extractDetail(nodeName, state);
  return { phase: nodeName, label, detail, status };
}
