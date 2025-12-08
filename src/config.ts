import "dotenv/config";
import { z } from "zod";

const numericString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? defaultValue : Number(value)))
    .pipe(z.number());

const envSchema = z.object({
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL_GENERATION: z.string().optional().default("gpt-5.4-mini"),
  PORT: numericString(4000),
  SOURCE_TTL_MINUTES: numericString(60),
  REPAIR_MAX_ATTEMPTS: numericString(2),
  MAX_SAMPLE_ROWS: numericString(20),
  JWT_SECRET: z.string().optional().default("dev-insecure-secret-change-me"),
  FRONTEND_ORIGIN: z.string().optional().default("http://localhost:3000"),
  USERS_DB_PATH: z.string().optional().default("data/users.db"),
});

const parsedEnv = envSchema.parse(process.env);

export const config = {
  openaiApiKey: parsedEnv.OPENAI_API_KEY,
  openaiModel: parsedEnv.OPENAI_MODEL_GENERATION,
  port: parsedEnv.PORT,
  sourceTtlMinutes: parsedEnv.SOURCE_TTL_MINUTES,
  repairMaxAttempts: parsedEnv.REPAIR_MAX_ATTEMPTS,
  maxSampleRows: parsedEnv.MAX_SAMPLE_ROWS,
  jwtSecret: parsedEnv.JWT_SECRET,
  frontendOrigin: parsedEnv.FRONTEND_ORIGIN,
  usersDbPath: parsedEnv.USERS_DB_PATH,
};

export type Config = typeof config;

export default config;
