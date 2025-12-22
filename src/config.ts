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
  // Max uploaded-file size in MB. Defaults to 128 to comfortably cover the
  // product's ~100MB file target; @fastify/multipart otherwise caps uploads
  // at 1MB, which rejects any real-world dataset with "request file too large".
  MAX_UPLOAD_MB: numericString(128),
  JWT_SECRET: z.string().optional().default("dev-insecure-secret-change-me"),
  // Dedicated secret used to encrypt user-provided third-party LLM API keys at
  // rest (AES-256-GCM). Optional: if empty, the encryption key is derived from
  // JWT_SECRET so the feature works out of the box in dev. Set a dedicated
  // value in production so rotating the JWT signing secret doesn't invalidate
  // every stored credential.
  CREDENTIALS_SECRET: z.string().optional().default(""),
  // Number of free LLM-backed queries each user gets per calendar month (using
  // the app's own OPENAI_API_KEY). Once exhausted the user must supply their
  // own OpenAI-compatible credentials to continue.
  FREE_QUERIES_PER_MONTH: numericString(5),
  FRONTEND_ORIGIN: z.string().optional().default("http://localhost:3000"),
  MONGODB_URI: z.string().optional().default("mongodb://localhost:27017/datasense"),
  ALLOW_FILE_DB_SOURCES: z
    .string()
    .optional()
    .transform((value) => value === "true")
    .pipe(z.boolean()),
  ALLOWED_INTERNAL_DB_HOSTS: z.string().optional().default(""),
});

const parsedEnv = envSchema.parse(process.env);

export const config = {
  openaiApiKey: parsedEnv.OPENAI_API_KEY,
  openaiModel: parsedEnv.OPENAI_MODEL_GENERATION,
  port: parsedEnv.PORT,
  sourceTtlMinutes: parsedEnv.SOURCE_TTL_MINUTES,
  repairMaxAttempts: parsedEnv.REPAIR_MAX_ATTEMPTS,
  maxSampleRows: parsedEnv.MAX_SAMPLE_ROWS,
  maxUploadBytes: parsedEnv.MAX_UPLOAD_MB * 1024 * 1024,
  jwtSecret: parsedEnv.JWT_SECRET,
  credentialsSecret: parsedEnv.CREDENTIALS_SECRET,
  freeQueriesPerMonth: parsedEnv.FREE_QUERIES_PER_MONTH,
  frontendOrigin: parsedEnv.FRONTEND_ORIGIN,
  mongoDbUri: parsedEnv.MONGODB_URI,
  allowFileDbSources: parsedEnv.ALLOW_FILE_DB_SOURCES,
  allowedInternalDbHosts: parsedEnv.ALLOWED_INTERNAL_DB_HOSTS.split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0),
};

export type Config = typeof config;

export default config;
