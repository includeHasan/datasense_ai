# Product Requirements Document — DataSense AI

**Status:** Draft v1
**Owner:** Oscar
**Last updated:** 2026-06-30

---

## 1. Overview

DataSense AI is a self-serve AI data analyst. Users connect a data source (JSON, CSV, Excel, or a SQL database URL), ask questions in natural language, and receive narrated insights, charts, and exportable reports. The agent handles schema understanding, query generation, analysis, and visualization autonomously.

This PRD describes the full product vision. Scope for the first release is defined separately in `03-mvp.md`.

## 2. Goals & non-goals

### Goals
- Let any user go from raw data to a decision-ready insight in under a minute.
- Support four data source types through a single unified query layer.
- Produce trustworthy output: visible queries, read-only access, verifiable samples.
- Build an engine that works standalone today and is embeddable by developers later.

### Non-goals (for now)
- Not a full BI replacement (no pixel-perfect dashboard builder).
- Not a data warehouse or ETL pipeline tool.
- Not a write-back tool — the agent never mutates source data.
- No real-time streaming data in early versions.

## 3. Personas

**Bola — Non-technical business user.** Runs ops at a 20-person company. Has spreadsheets and a Postgres app database she can't query. Wants answers and reports to share, without learning SQL.

**Daniel — Data analyst.** Drowns in ad-hoc reporting requests. Wants to offload routine questions to a tool stakeholders can self-serve, while keeping visibility into the SQL being run.

**Priya — Developer.** Building a SaaS product and wants to embed "ask your data" analytics without building the agent + charting stack from scratch.

## 4. User stories

- As a business user, I can upload a CSV/Excel/JSON file and immediately ask questions about it.
- As a business user, I can connect my SQL database via a connection string and ask questions across its tables.
- As any user, I can ask a question in plain English and get a narrated answer plus a relevant chart.
- As any user, I can see the SQL the agent ran and the data sample it used.
- As any user, I can export an insight or a collection of insights as a shareable report (PDF/HTML).
- As an analyst, I can edit the generated SQL and re-run it.
- As a developer, I can call the agent through an API and render results with provided components. *(later phase)*

## 5. Functional requirements

### 5.1 Data ingestion & connection
- **FR-1** Accept file uploads: `.json`, `.csv`, `.xlsx`/`.xls`.
- **FR-2** Accept a SQL connection string (Postgres and MySQL at minimum).
- **FR-3** Load files into an embedded analytical engine (DuckDB) that exposes them as SQL-queryable tables.
- **FR-4** Auto-profile each source: table/column names, data types, row counts, null rates, sample rows, basic distributions.
- **FR-5** Handle messy files gracefully (mixed types, missing headers, inconsistent rows) with best-effort parsing and clear error reporting.

### 5.2 Agent reasoning & querying
- **FR-6** Translate a natural-language question into a query plan against the profiled schema.
- **FR-7** Generate SQL, execute it, and capture results.
- **FR-8** Enforce **read-only** execution against user databases (SELECT-only; block DDL/DML).
- **FR-9** Never send full tables to the LLM — operate on schema + samples + aggregates only.
- **FR-10** Retry/repair on query errors (e.g., wrong column name) using the error message as feedback.
- **FR-11** Handle multi-step questions (e.g., compute, then compare, then rank) via the agent loop.

### 5.3 Insight & narrative
- **FR-12** Produce a plain-language explanation of what the result shows.
- **FR-13** Surface caveats (small sample size, nulls, ambiguous question) where relevant.

### 5.4 Visualization
- **FR-14** Emit a **structured chart specification** (validated JSON, not executable code) describing chart type, axes, series, and data.
- **FR-15** Support core chart types: bar, line, pie/donut, table, single-stat/KPI, scatter.
- **FR-16** Frontend renders charts from the spec using a React charting library.

### 5.5 Reports & sharing
- **FR-17** Assemble one or more insights (narrative + chart + query) into a report.
- **FR-18** Export reports as PDF and/or HTML.
- **FR-19** *(later)* Shareable links and scheduled report runs.

### 5.6 Transparency & safety
- **FR-20** Always display the generated SQL and the data sample used for an answer.
- **FR-21** Allow the user to edit and re-run the SQL.
- **FR-22** Scope database credentials securely; never log secrets; encrypt stored connection strings.

## 6. Non-functional requirements

- **Performance:** typical file question answered in < 10s; DB question in < 15s.
- **Scale:** handle files up to ~100 MB / a few million rows via DuckDB without loading all rows into the LLM.
- **Security:** read-only DB access, query allowlisting, credential encryption, no source mutation, PII-aware logging.
- **Reliability:** graceful degradation and clear errors when a query or source fails.
- **Cost control:** minimize tokens via schema-first prompting and result summarization.
- **Privacy:** clear data handling policy; option for ephemeral (non-persisted) file sessions.

## 7. System architecture

```
┌──────────────┐     ┌──────────────────────────────┐     ┌─────────────────┐
│  React UI     │────▶│  Node.js API (Express/Fastify)│────▶│ LangGraph.js     │
│  upload/ask   │     │  uploads, sessions, auth      │     │ agent graph      │
│  charts/report│◀────│                               │◀────│                  │
└──────────────┘     └──────────────┬───────────────┘     └────────┬────────┘
                                     │                                │
                          ┌──────────▼──────────┐          ┌─────────▼─────────┐
                          │ DuckDB (files →SQL)  │          │ LLM (SQL gen,     │
                          │ + pg/mysql drivers   │          │ narrative, charts)│
                          └─────────────────────┘          └───────────────────┘
```

### Agent graph (LangGraph.js nodes)
1. **Ingest & profile** — detect schema, types, samples.
2. **Plan** — decide the analysis needed for the question.
3. **Generate SQL** — produce a query against the schema.
4. **Execute** — run via DuckDB / DB driver (read-only).
5. **Repair** (conditional) — on error, fix using the error message; loop back to Execute.
6. **Synthesize** — narrative insight + structured chart spec.
7. **Assemble** — package into a renderable/exportable result.

### Key design decisions
- **DuckDB as the unifier:** CSV/JSON/Excel and external DBs all become SQL-queryable, so the agent's only data tool is "run SQL."
- **Structured outputs:** the LLM emits Zod-validated JSON for chart specs and report structure — the frontend never executes model-written code.
- **Schema-first prompting:** the model sees schema + samples + aggregates, never raw bulk data.

## 8. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + a charting lib (Recharts / ECharts) |
| Backend | Node.js (Fastify or Express) |
| Agent | LangGraph.js (`@langchain/langgraph`) |
| Query engine | DuckDB (`duckdb` / `duckdb-wasm`) |
| DB drivers | `pg`, `mysql2` (optionally Knex/Drizzle) |
| Validation | Zod |
| LLM | Pluggable provider (Claude / others) |
| Export | HTML → PDF (Puppeteer or similar) |

> **Known tradeoff:** LangGraph.js is less mature than LangGraph Python. If agent logic grows complex, a hybrid backend (Python FastAPI agent + Node/React app) is the documented fallback. Tracked in `04-plan.md` risks.

## 9. UX flow (happy path)

1. User lands on a clean screen: "Connect your data."
2. Uploads a file or pastes a SQL URL.
3. Sees an auto-generated data summary (tables, columns, row counts).
4. Types a question in a chat-style box.
5. Agent thinks, then returns: a narrative answer + a chart + an expandable "view SQL & data" panel.
6. User pins useful answers and exports a report.

## 10. Success metrics

- **Activation:** % of users who get a first successful answer within their first session.
- **Trust:** % of answers where the user expands and accepts the SQL/sample without editing.
- **Value:** answers per session; reports exported.
- **Accuracy:** % of generated queries that run successfully (and pass spot-check eval set).
- **Retention:** return usage week over week.

## 11. Release phases

- **Phase 1 (MVP)** — see `03-mvp.md`. Lean, single-segment, core loop.
- **Phase 2** — full multi-source, dashboard, scheduled reports, analyst SQL editing.
- **Phase 3** — auth/multi-tenant, sharing, developer API + embeddable components.

## 12. Open questions

- Which LLM provider(s) and what fallback strategy on rate limits/cost?
- Persist user data, or default to ephemeral sessions for privacy?
- How much query verification (eval harness) is needed before users trust outputs?
- At what complexity threshold do we move the agent to a Python backend?
