import { z } from "zod";
import { ChartSpecSchema } from "./chart-spec.js";

export const FinalAnswerSchema = z.object({
  narrative: z.string(),
  chartSpec: ChartSpecSchema,
  sql: z.string(),
  sampleRows: z.array(z.record(z.string(), z.unknown())),
  caveats: z.array(z.string()).optional(),
});

export type FinalAnswer = z.infer<typeof FinalAnswerSchema>;
