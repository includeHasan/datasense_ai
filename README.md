# DataSense AI

A self-serve AI data analyst agent. Connect a data source — a CSV/JSON/Excel file, or a Postgres/MySQL/SQLite/MongoDB connection — ask a question in plain English, and get back a narrated insight, a chart, and an exportable PDF report. No SQL required, and the agent never writes to your data.

## Contents

- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [How it works](#how-it-works)
  - [1. Turning a data source into something queryable](#1-turning-a-data-source-into-something-queryable)
  - [2. The agent graph](#2-the-agent-graph)
  - [3. Safety: read-only enforcement](#3-safety-read-only-enforcement)
  - [4. Structured outputs](#4-structured-outputs)
  - [5. Streaming the answer to the client](#5-streaming-the-answer-to-the-client)
  - [6. Auth, bring-your-own-key, and quotas](#6-auth-bring-your-own-key-and-quotas)
  - [7. Conversations, dashboards, and reports](#7-conversations-dashboards-and-reports)
  - [8. Frontend](#8-frontend)
  - [9. Evaluation harness](#9-evaluation-harness)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Scripts (backend)](#scripts-backend)
- [Key environment variables](#key-environment-variables)
- [Project layout](#project-layout)

## Architecture

```
Next.js frontend  ──HTTP/SSE──▶  Fastify API  ──▶  LangGraph.js agent
   (frontend/)                    (src/)                  │
                                    │                       ├── LLM (routing, SQL gen,
                                    ├── DuckDB (file→SQL)   │     narrative, chart spec)
                                    ├── pg / mysql2 /        │
                                    │   better-sqlite3       │
                                    └── MongoDB driver       └── Zod-validated outputs
                                        (external sources)
```

- **One data tool: "run SQL" (or a read-only Mongo aggregation) per source.** Uploaded files (CSV/JSON/Excel) and external databases are all normalized to a single queryable interface — the agent never has a separate "read file" tool.
- **Schema-first prompting.** The LLM only ever sees a profile (column names, types, row counts, null rates, sample rows, inferred/declared relationships) — never bulk table data.
- **Structured outputs only.** The LLM emits Zod-validated JSON for chart specs and the final answer; the frontend renders from validated specs and never executes model-written code.
- **Read-only by default.** Every query path is guarded twice: once by a query-language AST/shape check before execution, and again at the connection/driver level (read-only transactions, `readonly` SQLite handle, disabled external file access in DuckDB).
- **Agent graph (LangGraph.js):** Router → (Converse | Plan → Generate query → Execute ⇄ Repair → Synthesize) → Assemble.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (React 19), Tailwind, ECharts (`echarts-for-react`) |
| Backend | Node.js, Fastify |
| Agent | LangGraph.js (`@langchain/langgraph`, `@langchain/openai`) |
| Query engine | DuckDB (`@duckdb/node-api`) |
| DB drivers | `pg`, `mysql2`, `better-sqlite3`, `mongodb` |
| Auth / storage | MongoDB (via `mongoose`), JWT (`@fastify/jwt`) |
| Validation | Zod |
| Export | `jsPDF` + `jspdf-autotable` (client-side) |

## How it works

### 1. Turning a data source into something queryable

Every source implements a common `DataSource` interface (`src/sources/types.ts`): `profile()`, `execute()`, `close()`, plus a `dialect` (`"sql"` or `"mongodb"`).

- **File uploads** (`src/sources/duckdb-source.ts`) — CSV/JSON go straight into an in-memory DuckDB instance via `read_csv_auto`/`read_json_auto`; Excel (`.xlsx`/`.xls`) is parsed with SheetJS, converted to per-sheet JSON, and loaded the same way — so every file type ends up as one or more DuckDB tables through a single ingestion path. After loading, the instance runs `SET enable_external_access=false`, which prevents any hallucinated or injected SQL from reading arbitrary files off disk (e.g. `read_csv_auto('/etc/passwd')`) while leaving the already-loaded tables queryable. `profile()` reads `information_schema`, computes row counts and per-column null rates, pulls sample rows, and infers table relationships by column-naming heuristics (flat files have no real foreign keys).
- **Postgres / MySQL / SQLite** (`src/sources/sql-source.ts`) — Postgres and MySQL use connection pools; SQLite opens the file with `better-sqlite3` in `{ readonly: true }` mode. `profile()` pulls declared foreign keys from catalog metadata first, falling back to the naming heuristic only for tables that don't declare any. Every query runs inside an explicit read-only transaction (`BEGIN READ ONLY` / `START TRANSACTION READ ONLY`, rolled back regardless of outcome).
- **MongoDB** (`src/sources/mongo-source.ts`) — requires an explicit database name in the connection string (no silent fallback to Mongo's default `test` DB). `profile()` samples 100 documents per collection via `$sample` and infers a flat column/type/null-rate list, since Mongo has no schema catalog. `execute()` only ever calls `.aggregate()`.
- **Connection-string safety** (`src/sources/host-policy.ts`) — before connecting to any user-supplied Postgres/MySQL/MongoDB connection string, `assertConnectionStringHostIsAllowed()` extracts every hostname, resolves it via DNS, and rejects the connection if it lands in a private/loopback/link-local/unique-local IP range (this blocks SSRF against internal infrastructure and the cloud metadata endpoint `169.254.169.254`). Trusted hosts (e.g. a local Docker Postgres) can be exempted via `ALLOWED_INTERNAL_DB_HOSTS`. SQLite "connection strings" are server filesystem paths, so they're rejected entirely unless `ALLOW_FILE_DB_SOURCES=true` — appropriate for a trusted self-hosted deployment, not a multi-tenant SaaS.

### 2. The agent graph

Built with LangGraph.js `StateGraph` in `src/agent/graph.ts`:

```
START → router ─┬─(conversational)──────────────────────────▶ converse ─┐
                 └─(data question)──▶ plan → generateQuery → execute ─┐  │
                                                        ▲              │  │
                                                        │  (on error,  │  │
                                                        │   attempts   │  │
                                                        │   ≤ 2)       │  │
                                                        └── repair ◀───┘  │
                                                                          ▼
                                                                    synthesize
                                                                          │
                                                                          ▼
                                                                     assemble → END
```

- **router** — a small structured-output call that classifies the question as `data_question` or `conversational`, so greetings and meta-questions ("what tables do you have?") skip the SQL pipeline entirely.
- **converse** — answers directly from the schema profile, no query executed.
- **plan** — free-text reasoning about which tables/columns are relevant.
- **generateQuery** — produces the SQL (or, for Mongo, a `{collection, pipeline}` JSON envelope) as structured output, prompted with the source's actual dialect.
- **execute** — re-validates the query with the safety guard (defense in depth, since each source already re-validates internally) and runs it. On failure, it increments an `attempts` counter and records the error instead of throwing.
- **repair** — if `attempts` is still within `REPAIR_MAX_ATTEMPTS` (default **2**), the failed query and error message are fed back to the LLM for a corrected version, and the graph loops back to `execute`. Once attempts are exhausted, execution falls through to `synthesize` regardless of whether the last attempt succeeded.
- **synthesize** — generates the narrative, caveats, and a chart spec. This node uses an LLM-facing chart schema that differs slightly from the public one (row data is emitted as `{key, value}` cell arrays rather than open-ended JSON objects, because OpenAI's strict structured-output mode rejects free-form records), then converts it back to the public shape and re-validates it.
- **assemble** — a pure function (no LLM call) that builds the final answer object: sample rows are capped at `MAX_SAMPLE_ROWS` (default 20), and `answerType` is `"conversation"` vs `"analysis"` depending on the route taken.

The whole run streams via `runAgentStreaming()` (`src/agent/run.ts`), which subscribes to LangGraph's `updates` and `debug` stream modes to emit a `"running"` event before each node starts and a `"done"` event with its partial output after it finishes — this is what powers the live step-by-step trace in the UI.

### 3. Safety: read-only enforcement

- **SQL sources** (`src/safety/sql-guard.ts`) — the generated SQL is parsed into an AST with `node-sql-parser` (trying Postgres, then MySQL, then SQLite grammar until one succeeds), and is rejected unless it's a single `SELECT` statement. A large explicit blocklist of statement types (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `ATTACH`, `COPY`, `EXEC`, …) exists as a defensive superset, but the real enforcement is the allow-only-`SELECT` check.
- **MongoDB** (`src/safety/mongo-guard.ts`) — recursively scans the aggregation pipeline for write- or code-execution stages (`$out`, `$merge`, `$function`, `$accumulator`, `$where`) anywhere in the nested structure, not just at the top level.
- Both guards run *before* the query reaches the driver, and the drivers themselves add a second layer (read-only transactions for SQL, `.aggregate()`-only for Mongo, `enable_external_access=false` for DuckDB).

### 4. Structured outputs

All LLM outputs the app relies on programmatically are Zod schemas (`src/schemas/`), not parsed free text:

- **`ChartSpecSchema`** (`chart-spec.ts`) — a discriminated union over 19 chart kinds (`bar`, `line`, `area`, `pie`, `table`, `kpi`, `scatter`, `combo`, `funnel`, `radar`, `gauge`, `heatmap`, `boxplot`, `histogram`, `waterfall`, `treemap`, `sunburst`, `sankey`, `calendar`), each with the fields that kind needs (e.g. `kpi` has `label`/`value`/`delta`/optional `target` and `trend`; `bar`/`line`/`area` support stacking, orientation, and 100%-normalization).
- **`FinalAnswerSchema`** (`answer.ts`) — the shape returned to the client: `narrative`, `chartSpec` (nullable), `sql`, `sampleRows`, `caveats`, `answerType`, `suggestedFollowups`.

### 5. Streaming the answer to the client

`POST /sources/:id/ask` hijacks the Fastify reply and streams Server-Sent Events as the graph runs — each node's `"running"`/`"done"` event goes out immediately, so the UI can render a live "thinking" trace, followed by a terminal `event: final` frame containing the validated `FinalAnswer`. The frontend can't use the browser's native `EventSource` here because it needs to `POST` a JSON body and set an `Authorization` header, so `frontend/src/lib/api-stream.ts` hand-parses the SSE stream over `fetch` instead.

### 6. Auth, bring-your-own-key, and quotas

- Standard email/password auth: `bcryptjs` password hashing, `@fastify/jwt` issuing/verifying tokens, most routes gated behind an `authenticate` preHandler.
- Users can optionally add their own OpenAI-compatible credentials (API key, base URL, model) so they're not limited by the app's shared key. The stored key is encrypted at rest with AES-256-GCM (`src/auth/crypto.ts`), keyed from `CREDENTIALS_SECRET` (or derived from `JWT_SECRET` if unset) — the key is never returned by the API, only a `hasOwnKey` boolean.
- Without an own key, each user gets `FREE_QUERIES_PER_MONTH` (default **5**) queries per calendar month against the app's shared OpenAI key, tracked per-user and reset monthly (`src/auth/llm-access.ts`). Quota is only consumed after a successful run; users with their own key are never limited by this app.

### 7. Conversations, dashboards, and reports

- **Conversations** persist question/answer turns per source (MongoDB), and recent turns are fed back into the agent as history so follow-up questions ("now break that down by region") resolve correctly.
- **Dashboards** let a user pin an individual answer (chart + narrative) from a conversation for later reference.
- **Reports** (`src/reports/builder.ts`) are built one of two ways: from an existing conversation (each analysis-type turn becomes a section, no extra LLM calls), or generated fresh from a source — the LLM drafts a short outline of sections (defaulting to things like "Overview & row counts", "Trends over time", "Key KPIs"), and the full agent graph runs once per section. The report itself is just structured JSON (title + sections); the actual PDF is assembled **client-side** with `jsPDF`, off-screen-rendering each chart to a PNG via ECharts' `getDataURL()` and laying it out on A4 pages, with generated text sanitized to the Latin-1 character set jsPDF's core fonts support.

### 8. Frontend

A Next.js App Router app (`frontend/src/app`): a main chat page for connecting a source and asking questions with a live agent-activity trace, `/demo` (a public, unauthenticated version pointed at a seeded demo dataset, rate-limited server-side), `/dashboard` (pinned answers), `/reports` (report history and PDF download), plus `/login`/`/register`. `frontend/src/lib/api.ts` wraps every REST endpoint; `api-stream.ts` handles the SSE-over-`fetch` question-asking flow described above.

### 9. Evaluation harness

`scripts/eval/run-eval.ts` generates a synthetic sales dataset with independently-computed ground truth (total revenue, order count, average order value, etc.), spins up the dev server if needed, uploads the dataset as a file source, and asks it a fixed set of questions through the real `/ask` endpoint. Because the agent is free to choose its own SQL, columns, and chart type, grading is fuzzy: it scans the actual returned sample rows (not the narrative text) for numbers/labels within tolerance of the ground truth, and produces `report.md` with per-question pass/partial/fail results and timing.

## Prerequisites

- Node.js >= 20
- MongoDB running locally (`mongod`, or `docker run -p 27017:27017 mongo`) — required for auth, conversations, dashboards, and reports
- An OpenAI API key

## Setup

**Backend** (repo root):

```bash
npm install
cp .env.example .env   # fill in OPENAI_API_KEY, JWT_SECRET, MONGODB_URI, etc.
npm run dev             # starts the Fastify API on PORT (default 4000)
```

**Frontend**:

```bash
cd frontend
npm install
npm run dev              # starts Next.js on http://localhost:3000
```

## Scripts (backend)

| Command | Description |
|---|---|
| `npm run dev` | Start the API in watch mode |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm test` | Run the Vitest suite |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Lint `src` and `test` |
| `npm run eval` | Run the agent evaluation harness |

## Key environment variables

See `.env.example` for the full, commented list. The ones most relevant to how the app behaves:

| Variable | Default | Effect |
|---|---|---|
| `REPAIR_MAX_ATTEMPTS` | 2 | Max SQL repair loops before giving up |
| `MAX_SAMPLE_ROWS` | 20 | Sample rows returned to the client / used in prompts |
| `MAX_UPLOAD_MB` | 128 | Max uploaded file size |
| `FREE_QUERIES_PER_MONTH` | 5 | Free app-key-backed queries per user per month |
| `ALLOW_FILE_DB_SOURCES` | false | Whether SQLite filesystem-path sources are permitted |
| `ALLOWED_INTERNAL_DB_HOSTS` | (empty) | Hostnames exempted from the private-IP SSRF guard |
| `CREDENTIALS_SECRET` | derived from `JWT_SECRET` | Key used to encrypt stored user LLM credentials |

## Project layout

```
src/
  agent/       # LangGraph graph, nodes (router, converse, plan, generate-query,
               # execute, repair, synthesize, assemble), streaming/SSE, prompts
  auth/        # JWT auth routes, credential encryption, quota logic
  db/          # MongoDB connection setup
  demo/        # Demo dataset/source seeding
  models/      # Mongoose models (User, Conversation, Message, Dashboard, Report)
  reports/     # Report outline generation + section assembly (PDF built client-side)
  routes/      # Fastify HTTP routes (ask, sources, account, conversations,
               # dashboards, reports, demo)
  safety/      # SQL / Mongo aggregation read-only guards
  schemas/     # Zod schemas for chart specs and final answers
  sources/     # Data source adapters (DuckDB, Postgres/MySQL/SQLite, MongoDB,
               # SSRF host-policy guard)
frontend/      # Next.js app (src/app pages, src/components, src/lib API clients)
scripts/eval/  # Synthetic dataset + ground truth + fuzzy grading harness
test/          # Vitest unit tests
```
