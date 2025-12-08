import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateSalesRecords, recordsToCsv } from "./generate-data.js";
import { computeGroundTruth } from "./ground-truth.js";
import { QUESTIONS } from "./questions.js";
import type { Row } from "./grading.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = path.join(__dirname, "output");

interface Args {
  rows: number;
  baseUrl: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const rowsArg = args.find((a) => a.startsWith("--rows="));
  const baseUrlArg = args.find((a) => a.startsWith("--base-url="));
  return {
    rows: rowsArg ? Number(rowsArg.split("=")[1]) : 500,
    baseUrl: baseUrlArg ? baseUrlArg.split("=")[1] : `http://localhost:${process.env.PORT ?? "4000"}`,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerUp(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerUp(baseUrl)) return true;
    await sleep(500);
  }
  return false;
}

async function ensureServerRunning(baseUrl: string): Promise<ChildProcess | null> {
  if (await isServerUp(baseUrl)) {
    console.log(`Server already running at ${baseUrl}, using it.`);
    return null;
  }
  console.log(`No server detected at ${baseUrl}, starting one via "npm run dev"...`);
  const child = spawn("npm", ["run", "dev"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", () => {});
  const up = await waitForServer(baseUrl, 30_000);
  if (!up) {
    child.kill();
    throw new Error(`Backend did not become healthy at ${baseUrl} within 30s.`);
  }
  console.log("Server is up.");
  return child;
}

interface ApiError {
  status: number;
  body: unknown;
}

async function register(baseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { status: res.status, body } satisfies ApiError;
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function uploadFile(baseUrl: string, token: string, csv: string, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), filename);
  const res = await fetch(`${baseUrl}/sources/file`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { status: res.status, body } satisfies ApiError;
  }
  const data = (await res.json()) as { sourceId: string };
  return data.sourceId;
}

interface FinalAnswer {
  narrative: string;
  chartSpec: { kind: string; title: string };
  sql: string;
  sampleRows: Row[];
  caveats?: string[];
}

async function ask(baseUrl: string, token: string, sourceId: string, question: string): Promise<FinalAnswer> {
  const res = await fetch(`${baseUrl}/sources/${sourceId}/ask`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw { status: res.status, body } satisfies ApiError;
  }
  return (await res.json()) as FinalAnswer;
}

interface QuestionResult {
  id: string;
  question: string;
  expectedSummary: string;
  expectedChartKindHint: string;
  actualChartKind?: string;
  narrative?: string;
  sql?: string;
  sampleRows?: Row[];
  passed: boolean;
  score: number;
  detail: string;
  durationMs: number;
  errored: boolean;
}

function buildReport(params: {
  timestamp: string;
  rowCount: number;
  model: string;
  results: QuestionResult[];
  datasetPath: string;
}): string {
  const { timestamp, rowCount, model, results, datasetPath } = params;
  const totalScore = results.reduce((sum, r) => sum + r.score, 0);
  const accuracyPct = ((totalScore / results.length) * 100).toFixed(1);
  const passedCount = results.filter((r) => r.passed).length;

  const lines: string[] = [];
  lines.push("# DataSense AI — Agent Accuracy Report");
  lines.push("");
  lines.push(`- **Run at:** ${timestamp}`);
  lines.push(`- **Model:** ${model}`);
  lines.push(`- **Dataset:** synthetic e-commerce retail sales, ${rowCount} rows (${datasetPath})`);
  lines.push(`- **Questions:** ${results.length}`);
  lines.push(`- **Passed:** ${passedCount}/${results.length}`);
  lines.push(`- **Overall accuracy score:** ${accuracyPct}% (partial credit given for multi-part questions)`);
  lines.push("");
  lines.push(
    "> Grading is fuzzy by design: the agent chooses its own SQL, column names, and chart type. " +
      "Each check scans the actual query result rows (not the narrative text) for numbers/labels that " +
      "should be present if the computed answer is correct, per an independently-computed ground truth.",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| # | Question | Chart kind | Result | Score |");
  lines.push("|---|----------|------------|--------|-------|");
  results.forEach((r, i) => {
    const status = r.errored ? "⚠️ ERROR" : r.passed ? "✅ PASS" : "❌ FAIL";
    lines.push(
      `| ${i + 1} | ${r.question} | expected: ${r.expectedChartKindHint}, got: ${r.actualChartKind ?? "n/a"} | ${status} | ${(r.score * 100).toFixed(0)}% |`,
    );
  });
  lines.push("");
  lines.push("## Details");
  lines.push("");
  results.forEach((r, i) => {
    lines.push(`### ${i + 1}. ${r.question}`);
    lines.push("");
    lines.push(`- **Expected:** ${r.expectedSummary}`);
    lines.push(`- **Result:** ${r.errored ? "⚠️ ERROR" : r.passed ? "✅ PASS" : "❌ FAIL"} (score ${(r.score * 100).toFixed(0)}%)`);
    lines.push(`- **Grading detail:** ${r.detail}`);
    lines.push(`- **Response time:** ${r.durationMs}ms`);
    if (r.narrative) {
      lines.push(`- **Agent narrative:** ${r.narrative}`);
    }
    if (r.sql) {
      lines.push("- **SQL executed:**");
      lines.push("```sql");
      lines.push(r.sql);
      lines.push("```");
    }
    if (r.sampleRows && r.sampleRows.length > 0) {
      lines.push("- **Sample rows returned:**");
      lines.push("```json");
      lines.push(JSON.stringify(r.sampleRows.slice(0, 10), null, 2));
      lines.push("```");
    }
    lines.push("");
  });

  return lines.join("\n");
}

async function main(): Promise<void> {
  const { rows, baseUrl } = parseArgs();
  const timestamp = new Date().toISOString();

  console.log(`Generating ${rows} synthetic sales records...`);
  const records = generateSalesRecords(rows);
  const csv = recordsToCsv(records);
  const groundTruth = computeGroundTruth(records);

  await mkdir(OUTPUT_DIR, { recursive: true });
  const datasetFilename = `sales-${timestamp.replace(/[:.]/g, "-")}.csv`;
  const datasetPath = path.join(OUTPUT_DIR, datasetFilename);
  await writeFile(datasetPath, csv, "utf-8");
  console.log(`Wrote dataset to ${datasetPath}`);

  let serverProcess: ChildProcess | null = null;
  let startedServer = false;
  try {
    serverProcess = await ensureServerRunning(baseUrl);
    startedServer = serverProcess !== null;

    const email = `eval-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    console.log(`Registering throwaway user ${email}...`);
    const token = await register(baseUrl, email, "eval-password-123");

    console.log("Uploading generated dataset...");
    const sourceId = await uploadFile(baseUrl, token, csv, "sales.csv");

    const results: QuestionResult[] = [];
    let model = process.env.OPENAI_MODEL_GENERATION ?? "unknown";

    for (const q of QUESTIONS) {
      console.log(`Asking: ${q.question}`);
      const start = Date.now();
      try {
        const answer = await ask(baseUrl, token, sourceId, q.question);
        const durationMs = Date.now() - start;
        const grade = q.check(groundTruth, answer.sampleRows);
        results.push({
          id: q.id,
          question: q.question,
          expectedSummary: q.expectedSummary(groundTruth),
          expectedChartKindHint: q.expectedChartKindHint,
          actualChartKind: answer.chartSpec?.kind,
          narrative: answer.narrative,
          sql: answer.sql,
          sampleRows: answer.sampleRows,
          passed: grade.passed,
          score: grade.score,
          detail: grade.detail,
          durationMs,
          errored: false,
        });
      } catch (err) {
        const durationMs = Date.now() - start;
        const message = err instanceof Error ? err.message : JSON.stringify(err);
        results.push({
          id: q.id,
          question: q.question,
          expectedSummary: q.expectedSummary(groundTruth),
          expectedChartKindHint: q.expectedChartKindHint,
          passed: false,
          score: 0,
          detail: `Request failed: ${message}`,
          durationMs,
          errored: true,
        });
      }
    }

    const report = buildReport({ timestamp, rowCount: rows, model, results, datasetPath });
    const reportPath = path.join(REPO_ROOT, "report.md");
    await writeFile(reportPath, report, "utf-8");
    console.log(`\nWrote report to ${reportPath}`);

    const passedCount = results.filter((r) => r.passed).length;
    console.log(`\n${passedCount}/${results.length} questions passed.`);
  } finally {
    if (startedServer && serverProcess) {
      console.log("Stopping the server we started...");
      serverProcess.kill();
    }
  }
}

main().catch((err) => {
  console.error("Eval run failed:", err);
  process.exit(1);
});
