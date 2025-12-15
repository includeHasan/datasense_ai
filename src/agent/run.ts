import type { FinalAnswer } from "../schemas/answer.js";
import { toActivityEvent, type ActivityEvent } from "./events.js";
import type { AgentStateType, AgentStateUpdate } from "./state.js";
import type { buildGraph } from "./graph.js";

type CompiledGraph = ReturnType<typeof buildGraph>;
// The graph's own `invoke` input type, rather than the strict AgentStateType,
// so this accepts exactly what `graph.invoke(...)` previously accepted
// (e.g. an optional/possibly-undefined `profile` before validation upstream
// narrows it) without changing route-level behavior.
type GraphInput = Parameters<CompiledGraph["invoke"]>[0];

/**
 * Shape of a LangGraph.js "debug" stream chunk for a node about to run.
 * (`@langchain/langgraph` 1.4.x does not export a narrow type for this, so we
 * validate the parts we rely on with a type guard instead of trusting `any`.)
 */
interface DebugTaskPayload {
  type: "task" | "task_result" | string;
  payload: {
    name: string;
    input?: unknown;
  };
}

function isDebugTaskPayload(value: unknown): value is DebugTaskPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== "string") return false;
  const payload = candidate.payload;
  return !!payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).name === "string";
}

/**
 * Runs the agent graph while emitting one {@link ActivityEvent} per node as
 * it starts and finishes, so a caller can forward live progress (e.g. over
 * SSE) instead of waiting silently for the whole graph to complete.
 *
 * Uses `graph.stream(input, { streamMode: ["updates", "debug"] })`:
 * - "debug" chunks (`["debug", { type: "task", payload: { name, input } }]`)
 *   fire the moment a node is scheduled to run, before it executes - these
 *   drive the "running" events, with `input` giving us the state the node is
 *   about to see (e.g. so `repair`'s event can surface the error it is about
 *   to fix).
 * - "updates" chunks (`["updates", { [nodeName]: partialState }]`) fire the
 *   moment a node finishes, carrying only the fields it changed - these
 *   drive the "done" events and are also folded into a running copy of the
 *   overall state, since `graph.stream` (unlike `graph.invoke`) does not
 *   return the final aggregated state directly.
 *
 * Verified against the installed `@langchain/langgraph@1.4.7` at
 * node_modules/@langchain/langgraph/dist/pregel/index.d.ts by running the
 * graph with `streamMode: ["updates", "debug"]` against a toy graph and
 * inspecting the emitted chunk shapes directly (see task description).
 */
export async function runAgentStreaming(
  graph: CompiledGraph,
  input: GraphInput,
  onEvent: (event: ActivityEvent) => void,
): Promise<FinalAnswer | null> {
  // Merging AgentStateUpdate partials with a plain spread is type-widened
  // (LangGraph's Update type allows special reducer-signaling wrapper
  // objects in general), but every field in AgentState uses a plain
  // "last write wins" reducer (see state.ts), so at runtime this always
  // holds a valid AgentStateType - hence the cast back at the read sites.
  let state: Record<string, unknown> = { ...input };

  const stream = await graph.stream(input, { streamMode: ["updates", "debug"] });

  for await (const chunk of stream) {
    const [mode, payload] = chunk as [string, unknown];

    if (mode === "debug" && isDebugTaskPayload(payload) && payload.type === "task") {
      const nodeName = payload.payload.name;
      if (PHASE_NAMES.has(nodeName)) {
        onEvent(toActivityEvent(nodeName, state as Partial<AgentStateType>, "running"));
      }
      continue;
    }

    if (mode === "updates" && payload && typeof payload === "object") {
      for (const [nodeName, partial] of Object.entries(payload as Record<string, AgentStateUpdate>)) {
        state = { ...state, ...(partial as Record<string, unknown>) };
        onEvent(toActivityEvent(nodeName, state as Partial<AgentStateType>, "done"));
      }
    }
  }

  return (state as Partial<AgentStateType>).finalAnswer ?? null;
}

const PHASE_NAMES = new Set([
  "router",
  "converse",
  "planStep",
  "generateQuery",
  "execute",
  "repair",
  "synthesize",
  "assemble",
]);
