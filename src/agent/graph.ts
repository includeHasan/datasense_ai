import { StateGraph, START, END } from "@langchain/langgraph";
import config from "../config.js";
import type { DataSource } from "../sources/types.js";
import { AgentState } from "./state.js";
import { router } from "./nodes/router.js";
import { converse } from "./nodes/converse.js";
import { plan } from "./nodes/plan.js";
import { generateQuery } from "./nodes/generate-query.js";
import { makeExecuteNode } from "./nodes/execute.js";
import { repair } from "./nodes/repair.js";
import { synthesize } from "./nodes/synthesize.js";
import { assemble } from "./nodes/assemble.js";

/**
 * Builds the data-sense agent graph for a given request's DataSource.
 *
 * Flow:
 *   START -> router
 *   router -> (route === conversational) ? converse : planStep
 *   planStep -> generateQuery -> execute
 *   execute -> (error && attempts <= REPAIR_MAX_ATTEMPTS) ? repair : synthesize
 *   repair -> execute
 *   synthesize -> assemble -> END
 *   converse -> assemble -> END
 */
export function buildGraph(source: DataSource) {
  const graph = new StateGraph(AgentState)
    .addNode("router", router)
    .addNode("converse", converse)
    .addNode("planStep", plan)
    .addNode("generateQuery", generateQuery)
    .addNode("execute", makeExecuteNode(source))
    .addNode("repair", repair)
    .addNode("synthesize", synthesize)
    .addNode("assemble", assemble)
    .addEdge(START, "router")
    .addConditionalEdges(
      "router",
      (state) => (state.route === "conversational" ? "converse" : "planStep"),
      ["converse", "planStep"],
    )
    .addEdge("converse", "assemble")
    .addEdge("planStep", "generateQuery")
    .addEdge("generateQuery", "execute")
    .addConditionalEdges(
      "execute",
      (state) => (state.error && state.attempts <= config.repairMaxAttempts ? "repair" : "synthesize"),
      ["repair", "synthesize"],
    )
    .addEdge("repair", "execute")
    .addEdge("synthesize", "assemble")
    .addEdge("assemble", END);

  return graph.compile();
}
