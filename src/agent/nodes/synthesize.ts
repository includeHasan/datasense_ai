import { z } from "zod";
import { getChatModel } from "../llm.js";
import * as prompts from "../prompts.js";
import {
  ChartSpecSchema,
  seriesSchema,
  cellValueSchema,
  orientationSchema,
  type ChartSpec,
} from "../../schemas/chart-spec.js";
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
  stacked: z.boolean().nullable(),
  orientation: orientationSchema.nullable(),
});

const llmLineSchema = llmBaseSchema.extend({
  kind: z.literal("line"),
  xKey: z.string(),
  series: z.array(seriesSchema),
  data: z.array(llmRowSchema),
  stacked: z.boolean().nullable(),
  orientation: orientationSchema.nullable(),
});

const llmAreaSchema = llmBaseSchema.extend({
  kind: z.literal("area"),
  xKey: z.string(),
  series: z.array(seriesSchema),
  data: z.array(llmRowSchema),
  stacked: z.boolean().nullable(),
  orientation: orientationSchema.nullable(),
});

const llmPieSchema = llmBaseSchema.extend({
  kind: z.literal("pie"),
  categoryKey: z.string(),
  valueKey: z.string(),
  data: z.array(llmRowSchema),
  donut: z.boolean().nullable(),
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

const llmScatterSchema = llmBaseSchema.extend({
  kind: z.literal("scatter"),
  xKey: z.string(),
  yKey: z.string(),
  seriesKey: z.string().nullable(),
  data: z.array(llmRowSchema),
});

const llmComboSchema = llmBaseSchema.extend({
  kind: z.literal("combo"),
  xKey: z.string(),
  barSeries: z.array(seriesSchema),
  lineSeries: z.array(seriesSchema),
  data: z.array(llmRowSchema),
});

const llmFunnelSchema = llmBaseSchema.extend({
  kind: z.literal("funnel"),
  stageKey: z.string(),
  valueKey: z.string(),
  data: z.array(llmRowSchema),
});

const llmRadarIndicatorSchema = z.object({
  name: z.string(),
  max: z.number(),
});

const llmRadarSeriesSchema = z.object({
  name: z.string(),
  values: z.array(z.number()),
});

const llmRadarSchema = llmBaseSchema.extend({
  kind: z.literal("radar"),
  indicators: z.array(llmRadarIndicatorSchema),
  series: z.array(llmRadarSeriesSchema),
});

const llmGaugeSchema = llmBaseSchema.extend({
  kind: z.literal("gauge"),
  label: z.string(),
  value: z.number(),
  max: z.number(),
});

const llmChartSpecSchema = z.discriminatedUnion("kind", [
  llmBarSchema,
  llmLineSchema,
  llmAreaSchema,
  llmPieSchema,
  llmTableSchema,
  llmKpiSchema,
  llmScatterSchema,
  llmComboSchema,
  llmFunnelSchema,
  llmRadarSchema,
  llmGaugeSchema,
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
    case "area":
      return { ...spec, data: rowsToRecords(spec.data) };
    case "pie":
      return { ...spec, data: rowsToRecords(spec.data) };
    case "table":
      return { ...spec, rows: rowsToRecords(spec.rows) };
    case "kpi":
      return spec;
    case "scatter":
      return { ...spec, data: rowsToRecords(spec.data) };
    case "combo":
      return { ...spec, data: rowsToRecords(spec.data) };
    case "funnel":
      return { ...spec, data: rowsToRecords(spec.data) };
    case "radar":
      return spec;
    case "gauge":
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
    state.history,
  );
  const result = await model.invoke(prompt);
  const chartSpec = ChartSpecSchema.parse(toPublicChartSpec(result.chartSpec));
  return {
    narrative: result.narrative,
    chartSpec,
    caveats: result.caveats ?? [],
  };
}
