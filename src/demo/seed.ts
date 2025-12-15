import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBSource } from "../sources/duckdb-source.js";
import { suggestQuestions } from "../agent/suggest-questions.js";
import type { SchemaProfile } from "../sources/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DATA_DIR = path.resolve(__dirname, "..", "..", "demo-data");

// Related tables (customers -> orders -> order_items -> products) so the
// demo actually exercises schema-grounded relationship detection: since
// these are plain CSVs with no declared constraints, DuckDBSource picks them
// up via the naming-based heuristic (see src/sources/relationships.ts).
const DEMO_CSV_FILENAMES = ["customers.csv", "products.csv", "orders.csv", "order_items.csv"];

export interface DemoState {
  source: DuckDBSource;
  profile: SchemaProfile;
  suggestedQuestions: string[];
}

let statePromise: Promise<DemoState> | null = null;

async function loadDemoState(): Promise<DemoState> {
  const files = await Promise.all(
    DEMO_CSV_FILENAMES.map(async (filename) => ({
      buffer: await readFile(path.join(DEMO_DATA_DIR, filename)),
      originalFilename: filename,
      declaredType: "csv" as const,
    })),
  );
  const source = await DuckDBSource.createFromFiles(files);
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
