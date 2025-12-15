import { z } from "zod";

const baseSchema = z.object({
  title: z.string(),
});

export const seriesSchema = z.object({
  key: z.string(),
  label: z.string(),
});

// OpenAI's structured-output mode requires every schema node to have a concrete
// type, so row/data cells are restricted to JSON primitives rather than `unknown`.
export const cellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rowSchema = z.record(z.string(), cellValueSchema);

export const orientationSchema = z.union([z.literal("vertical"), z.literal("horizontal")]);

const barSchema = baseSchema.extend({
  kind: z.literal("bar"),
  xKey: z.string(),
  series: z.array(seriesSchema),
  data: z.array(rowSchema),
  stacked: z.boolean().nullable().optional(),
  orientation: orientationSchema.nullable().optional(),
});

const lineSchema = baseSchema.extend({
  kind: z.literal("line"),
  xKey: z.string(),
  series: z.array(seriesSchema),
  data: z.array(rowSchema),
  stacked: z.boolean().nullable().optional(),
  orientation: orientationSchema.nullable().optional(),
});

const areaSchema = baseSchema.extend({
  kind: z.literal("area"),
  xKey: z.string(),
  series: z.array(seriesSchema),
  data: z.array(rowSchema),
  stacked: z.boolean().nullable().optional(),
  orientation: orientationSchema.nullable().optional(),
});

const pieSchema = baseSchema.extend({
  kind: z.literal("pie"),
  categoryKey: z.string(),
  valueKey: z.string(),
  data: z.array(rowSchema),
  donut: z.boolean().nullable().optional(),
});

const tableSchema = baseSchema.extend({
  kind: z.literal("table"),
  columns: z.array(z.string()),
  rows: z.array(rowSchema),
});

const kpiSchema = baseSchema.extend({
  kind: z.literal("kpi"),
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  delta: z.number().nullable(),
});

const scatterSchema = baseSchema.extend({
  kind: z.literal("scatter"),
  xKey: z.string(),
  yKey: z.string(),
  seriesKey: z.string().nullable(),
  data: z.array(rowSchema),
});

const comboSchema = baseSchema.extend({
  kind: z.literal("combo"),
  xKey: z.string(),
  barSeries: z.array(seriesSchema),
  lineSeries: z.array(seriesSchema),
  data: z.array(rowSchema),
});

const funnelSchema = baseSchema.extend({
  kind: z.literal("funnel"),
  stageKey: z.string(),
  valueKey: z.string(),
  data: z.array(rowSchema),
});

const radarIndicatorSchema = z.object({
  name: z.string(),
  max: z.number(),
});

const radarSeriesSchema = z.object({
  name: z.string(),
  values: z.array(z.number()),
});

const radarSchema = baseSchema.extend({
  kind: z.literal("radar"),
  indicators: z.array(radarIndicatorSchema),
  series: z.array(radarSeriesSchema),
});

const gaugeSchema = baseSchema.extend({
  kind: z.literal("gauge"),
  label: z.string(),
  value: z.number(),
  max: z.number(),
});

export const ChartSpecSchema = z.discriminatedUnion("kind", [
  barSchema,
  lineSchema,
  areaSchema,
  pieSchema,
  tableSchema,
  kpiSchema,
  scatterSchema,
  comboSchema,
  funnelSchema,
  radarSchema,
  gaugeSchema,
]);

export type ChartSpec = z.infer<typeof ChartSpecSchema>;
