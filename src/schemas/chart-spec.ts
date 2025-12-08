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

const barSchema = baseSchema.extend({
  kind: z.literal("bar"),
  xKey: z.string(),
  series: z.array(seriesSchema),
  data: z.array(rowSchema),
});

const lineSchema = baseSchema.extend({
  kind: z.literal("line"),
  xKey: z.string(),
  series: z.array(seriesSchema),
  data: z.array(rowSchema),
});

const pieSchema = baseSchema.extend({
  kind: z.literal("pie"),
  categoryKey: z.string(),
  valueKey: z.string(),
  data: z.array(rowSchema),
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

export const ChartSpecSchema = z.discriminatedUnion("kind", [
  barSchema,
  lineSchema,
  pieSchema,
  tableSchema,
  kpiSchema,
]);

export type ChartSpec = z.infer<typeof ChartSpecSchema>;
