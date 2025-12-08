import { z } from "zod";
import { getChatModel } from "../llm.js";
import * as prompts from "../prompts.js";
import { ChartSpecSchema, seriesSchema, cellValueSchema, type ChartSpec } from "../../schemas/chart-spec.js";
import type { AgentStateType, AgentStateUpdate } from "../state.js";
import type { QueryResult } from "../../sources/types.js";

// OpenAI's strict structured-output mode rejects `z.record(...)` (an object
// schema with no enumerated `properties`), which the public ChartSpecSchema
// relies on for arbitrary-keyed row data. So the model is asked to emit rows
// as arrays of {key, value} cells instead, and the result is converted back
// into the Record-shaped ChartSpec the rest of the app expects.
const cellSchema = z.object({ key: z.string(), value: cellValueSchema });
const llmRowSchema = z.array(cellSchema);

const llmBaseSchema = z.object({ title: z.string() });

const llmBarSchema = llmBaseSchema.extend({
  kind: z.literal("bar"),
  xKey: z.string(),
  series: z.array(seriesSchema),
  data: z.array(llmRowSchema),
});

const llmLineSchema = llmBaseSchema.extend({
  kind: z.literal("line"),
  xKey: z.string(),
  series: z.array(seriesSchema),
  data: z.array(llmRowSchema),
});

const llmPieSchema = llmBaseSchema.extend({
  kind: z.literal("pie"),
  categoryKey: z.string(),
  valueKey: z.string(),
  data: z.array(llmRowSchema),
});

const llmTableSchema = llmBaseSchema.extend({
  kind: z.literal("table"),
  columns: z.array(z.string()),
  rows: z.array(llmRowSchema),
});

const llmKpiSchema = llmBaseSchema.extend({
  kind: z.literal("kpi"),
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  delta: z.number().nullable(),
});

const llmChartSpecSchema = z.discriminatedUnion("kind", [
  llmBarSchema,
  llmLineSchema,
  llmPieSchema,
  llmTableSchema,
  llmKpiSchema,
]);

type LlmChartSpec = z.infer<typeof llmChartSpecSchema>;

type Cell = z.infer<typeof cellValueSchema>;

function rowsToRecords(rows: z.infer<typeof llmRowSchema>[]): Record<string, Cell>[] {
  return rows.map(
    (row) => Object.fromEntries(row.map((cell) => [cell.key, cell.value])) as Record<string, Cell>,
  );
}

function toPublicChartSpec(spec: LlmChartSpec): ChartSpec {
  switch (spec.kind) {
    case "bar":
    case "line":
      return { ...spec, data: rowsToRecords(spec.data) };
    case "pie":
      return { ...spec, data: rowsToRecords(spec.data) };
    case "table":
      return { ...spec, rows: rowsToRecords(spec.rows) };
    case "kpi":
      return spec;
  }
}

const synthesizeOutputSchema = z.object({
  narrative: z.string(),
  chartSpec: llmChartSpecSchema,
  caveats: z.array(z.string()).nullable(),
});

const emptyQueryResult: QueryResult = { columns: [], rows: [], rowCount: 0 };

/**
 * Synthesis node: given the question, the executed query, and its result
 * set, asks the model to produce a narrative answer plus a chart spec.
 */
export async function synthesize(state: AgentStateType): Promise<AgentStateUpdate> {
  const model = getChatModel().withStructuredOutput(synthesizeOutputSchema);
  const prompt = prompts.buildSynthesizePrompt(
    state.question,
    state.sql,
    state.queryResult ?? emptyQueryResult,
  );
  const result = await model.invoke(prompt);
  const chartSpec = ChartSpecSchema.parse(toPublicChartSpec(result.chartSpec));
  return {
    narrative: result.narrative,
    chartSpec,
    caveats: result.caveats ?? [],
  };
}
