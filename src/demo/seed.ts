import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBSource } from "../sources/duckdb-source.js";
import { suggestQuestions } from "../agent/suggest-questions.js";
import type { SchemaProfile } from "../sources/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_CSV_PATH = path.resolve(__dirname, "..", "..", "demo-data", "sample-sales.csv");

export interface DemoState {
  source: DuckDBSource;
  profile: SchemaProfile;
  suggestedQuestions: string[];
}

let statePromise: Promise<DemoState> | null = null;

async function loadDemoState(): Promise<DemoState> {
  const buffer = await readFile(DEMO_CSV_PATH);
  const source = await DuckDBSource.create(buffer, "sample-sales.csv", "csv");
  const profile = await source.profile();
  // Suggested questions are a nice-to-have; if generation fails, still serve the demo.
  const suggestedQuestions = await suggestQuestions(profile).catch(() => []);
  return { source, profile, suggestedQuestions };
}

/**
 * Lazily seeds a single shared, in-memory demo DataSource from the bundled
 * sample dataset on first request, then reuses it for the lifetime of the
 * process. Unlike the per-user registry, this is never evicted or scoped to
 * an owner — it's the same static dataset for every visitor to the public
 * demo, so the app can be tried without an account.
 */
export function getDemoState(): Promise<DemoState> {
  if (!statePromise) {
    statePromise = loadDemoState();
  }
  return statePromise;
}
