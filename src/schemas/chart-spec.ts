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
  // When true with stacked=true, each stack is normalized to sum to 100% -
  // shows proportion/mix over time or category rather than absolute volume.
  normalized: z.boolean().nullable().optional(),
});

const lineSchema = baseSchema.extend({
  kind: z.literal("line"),
  xKey: z.string(),
  series: z.array(seriesSchema),
  data: z.array(rowSchema),
  stacked: z.boolean().nullable().optional(),
  orientation: orientationSchema.nullable().optional(),
  normalized: z.boolean().nullable().optional(),
});

const areaSchema = baseSchema.extend({
  kind: z.literal("area"),
  xKey: z.string(),
  series: z.array(seriesSchema),
  data: z.array(rowSchema),
  stacked: z.boolean().nullable().optional(),
  orientation: orientationSchema.nullable().optional(),
  normalized: z.boolean().nullable().optional(),
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
  // Optional goal/quota to render as a bullet-style target marker against value.
  target: z.number().nullable().optional(),
  // Optional short trend history (oldest first) rendered as an inline sparkline.
  trend: z.array(z.number()).nullable().optional(),
});

const scatterSchema = baseSchema.extend({
  kind: z.literal("scatter"),
  xKey: z.string(),
  yKey: z.string(),
  seriesKey: z.string().nullable(),
  // Optional numeric column controlling per-point marker size (bubble chart).
  sizeKey: z.string().nullable().optional(),
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

/**
 * 2D density grid: xKey/yKey hold the two categorical dimensions, valueKey
 * the numeric intensity (e.g. day-of-week x hour-of-day -> order count).
 */
const heatmapSchema = baseSchema.extend({
  kind: z.literal("heatmap"),
  xKey: z.string(),
  yKey: z.string(),
  valueKey: z.string(),
  data: z.array(rowSchema),
});

/**
 * Distribution/spread per category. The five quartile columns must be
 * precomputed by the query (e.g. via percentile_cont) - the chart never
 * computes statistics from raw samples itself.
 */
const boxplotSchema = baseSchema.extend({
  kind: z.literal("boxplot"),
  categoryKey: z.string(),
  minKey: z.string(),
  q1Key: z.string(),
  medianKey: z.string(),
  q3Key: z.string(),
  maxKey: z.string(),
  data: z.array(rowSchema),
});

/** Distribution of a single numeric column, pre-binned by the query. */
const histogramSchema = baseSchema.extend({
  kind: z.literal("histogram"),
  binKey: z.string(),
  countKey: z.string(),
  data: z.array(rowSchema),
});

/**
 * Sequential contribution bridge (e.g. revenue change quarter over quarter).
 * totalKey optionally names a boolean column marking rows that are running
 * totals/subtotals (rendered as a full bar from zero) rather than deltas.
 */
const waterfallSchema = baseSchema.extend({
  kind: z.literal("waterfall"),
  categoryKey: z.string(),
  valueKey: z.string(),
  totalKey: z.string().nullable().optional(),
  data: z.array(rowSchema),
});

/**
 * Shared shape for hierarchical charts (treemap/sunburst): each row is one
 * leaf, named by its full root-to-leaf path, avoiding a recursive schema
 * (which structured-output APIs handle unreliably). The renderer builds the
 * nested tree client-side by grouping rows on shared path prefixes.
 */
const hierarchyNodeSchema = z.object({
  path: z.array(z.string()).min(1),
  value: z.number(),
});

/** Nested part-to-whole by rectangle area - better than pie with many categories. */
const treemapSchema = baseSchema.extend({
  kind: z.literal("treemap"),
  data: z.array(hierarchyNodeSchema),
});

/** Nested part-to-whole by ring depth - pairs well with treemap on the same data. */
const sunburstSchema = baseSchema.extend({
  kind: z.literal("sunburst"),
  data: z.array(hierarchyNodeSchema),
});

const sankeyNodeSchema = z.object({ name: z.string() });
const sankeyLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  value: z.number(),
});

/** Flow/volume between named stages, allowing branching (unlike funnel). */
const sankeySchema = baseSchema.extend({
  kind: z.literal("sankey"),
  nodes: z.array(sankeyNodeSchema),
  links: z.array(sankeyLinkSchema),
});

const calendarCellSchema = z.object({
  date: z.string(),
  value: z.number(),
});

/** One value per calendar day (e.g. daily active users) - reveals seasonality. */
const calendarSchema = baseSchema.extend({
  kind: z.literal("calendar"),
  data: z.array(calendarCellSchema),
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
  heatmapSchema,
  boxplotSchema,
  histogramSchema,
  waterfallSchema,
  treemapSchema,
  sunburstSchema,
  sankeySchema,
  calendarSchema,
]);

export type ChartSpec = z.infer<typeof ChartSpecSchema>;
