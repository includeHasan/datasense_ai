# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository currently contains **no application code** — only planning documentation in `documentation/`. There is no package.json, no build/test/lint tooling, and no source tree yet. Do not assume any framework files, scripts, or directory structure exist until you have verified them with `ls`/`Glob`. When implementation begins, this file should be updated with actual commands (install, dev server, build, test, lint) and real architecture notes once the code exists.

## What this project is

**DataSense AI** — a self-serve AI data analyst agent. A user connects a data source (CSV/JSON/Excel file, or a Postgres/MySQL connection string), asks a question in plain English, and the agent returns a narrated insight, a chart, and an exportable report — without the user writing SQL.

Full context lives in `documentation/`:
- `01-product-idea.md` — pitch, problem, differentiation
- `02-prd.md` — full product requirements (functional/non-functional reqs, personas, architecture diagram)
- `03-mvp.md` — lean MVP scope (4–6 weeks) — **the current target scope**
- `04-plan.md` — week-by-week build plan, task checklist, decision log

Read the MVP doc (`03-mvp.md`) before proposing scope — it explicitly defers auth, multi-tenant, MySQL, editable SQL re-run, saved dashboards, scheduled reports, sharing, and a developer API to later phases.

## Planned architecture (from the PRD/plan — not yet built)

```
React SPA  ──HTTP──▶  Node API (Fastify)  ──▶  LangGraph.js agent
   │                        │                        │
   │                        ├── DuckDB (file→SQL)    ├── LLM (SQL gen,
   │                        └── pg driver (Postgres) │     narrative,
   ▼                                                 │     chart spec)
charts + report                                      └── Zod-validated outputs
```

Core design principles that should govern any implementation:

- **One data tool: "run SQL" via DuckDB.** CSV/JSON/Excel files and external databases (Postgres first, MySQL later) are all normalized to a single SQL-queryable interface. The agent never has a separate "read file" vs "query DB" tool — everything goes through DuckDB or a DB driver as SQL.
- **Schema-first prompting.** The LLM only ever sees schema + column types + row counts + sample rows + aggregates — never raw/bulk table data. This is a hard constraint for cost and scale (files up to ~100MB / millions of rows).
- **Structured outputs only.** The LLM emits Zod-validated JSON for chart specs and report structure. The frontend renders from validated specs and never executes model-written code.
- **Read-only by default.** SQL execution against user databases must enforce SELECT-only (block DDL/DML). The agent never mutates source data. Any DB execution path needs a read-only guard/validator, not just a system prompt instruction.
- **Agent graph (LangGraph.js), 6 nodes:** Ingest & profile → Plan → Generate SQL → Execute → Repair (conditional, loops back to Execute on error) → Synthesize (narrative + chart spec) → Assemble.
- **Thin LLM/agent interface.** Keep the LangGraph.js layer isolated behind a thin interface — the documented fallback if LangGraph.js proves immature is a hybrid backend (Python FastAPI for the agent, Node/React for the app). Don't couple frontend or API code directly to LangGraph internals.

## Tech stack (planned)

| Layer | Choice |
|---|---|
| Frontend | React + Recharts (or ECharts if richer chart types needed) |
| Backend | Node.js, Fastify |
| Agent | LangGraph.js (`@langchain/langgraph`) |
| Query engine | DuckDB (`duckdb` / `duckdb-wasm`) |
| DB drivers | `pg` (MVP), `mysql2` (later phase) |
| Validation | Zod |
| Export | HTML → PDF (Puppeteer or similar) |

## Bundled Claude skills

`.claude/skills/` contains general-purpose LangChain/LangGraph/Deep Agents/OpenSearch reference skills (e.g. `langgraph-fundamentals`, `langchain-middleware`, `deep-agents-*`). These are framework documentation aids, not project-specific code — consult `ecosystem-primer` first when building the agent graph, then the more specific `langgraph-*`/`langchain-*` skills as needed.
