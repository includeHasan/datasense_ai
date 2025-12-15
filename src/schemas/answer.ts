import { z } from "zod";
import { ChartSpecSchema } from "./chart-spec.js";

export const AnswerTypeSchema = z.enum(["analysis", "conversation"]);

export const FinalAnswerSchema = z.object({
  narrative: z.string(),
  chartSpec: ChartSpecSchema.nullable(),
  sql: z.string(),
  sampleRows: z.array(z.record(z.string(), z.unknown())),
  caveats: z.array(z.string()).optional(),
  answerType: AnswerTypeSchema,
  suggestedFollowups: z.array(z.string()).optional(),
});

export type FinalAnswer = z.infer<typeof FinalAnswerSchema>;
