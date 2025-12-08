/**
 * One-off generator for the bundled public demo dataset (demo-data/sample-sales.csv).
 * Reuses the eval harness's synthetic data generator. Re-run manually with
 * `npx tsx scripts/generate-demo-data.ts` to refresh the committed sample file.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSalesRecords, recordsToCsv } from "./eval/generate-data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, "..", "demo-data");
const ROW_COUNT = 1200;

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const records = generateSalesRecords(ROW_COUNT);
  const csv = recordsToCsv(records);
  const outputPath = path.join(OUTPUT_DIR, "sample-sales.csv");
  await writeFile(outputPath, csv, "utf-8");
  console.log(`Wrote ${ROW_COUNT} rows to ${outputPath}`);
}

main().catch((err) => {
  console.error("Failed to generate demo data:", err);
  process.exit(1);
});
