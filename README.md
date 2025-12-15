# DataSense AI

A self-serve AI data analyst agent. Connect a data source (CSV/JSON/Excel file, or a Postgres/MySQL/SQLite connection), ask a question in plain English, and get back a narrated insight, a chart, and an exportable report — no SQL required.

Full product context lives in [`documentation/`](documentation):
- [`01-product-idea.md`](documentation/01-product-idea.md) — pitch, problem, differentiation
- [`02-prd.md`](documentation/02-prd.md) — full product requirements
- [`03-mvp.md`](documentation/03-mvp.md) — lean MVP scope
- [`04-plan.md`](documentation/04-plan.md) — week-by-week build plan

## Architecture

```
Next.js frontend  ──HTTP──▶  Fastify API  ──▶  LangGraph.js agent
   (frontend/)                (src/)                  │
                                │                       ├── LLM (SQL gen,
                                ├── DuckDB (file→SQL)   │     narrative,
                                └── pg / mysql2 driver  │     chart spec)
                                    (external DBs)      └── Zod-validated outputs
```

- **One data tool: "run SQL" via DuckDB.** Uploaded files (CSV/JSON/Excel) and external databases are all normalized to a single SQL-queryable interface.
- **Schema-first prompting.** The LLM sees schema, column types, row counts, and sample rows — never raw/bulk table data.
- **Structured outputs only.** The LLM emits Zod-validated JSON for chart specs and report structure; the frontend renders from validated specs and never executes model-written code.
- **Read-only by default.** SQL execution against user databases is guarded to SELECT-only.
- **Agent graph (LangGraph.js):** Ingest & profile → Plan → Generate SQL → Execute → Repair (loops back to Execute on error) → Synthesize (narrative + chart spec) → Assemble.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (React 19), Tailwind, ECharts |
| Backend | Node.js, Fastify |
| Agent | LangGraph.js (`@langchain/langgraph`) |
| Query engine | DuckDB (`@duckdb/node-api`) |
| DB drivers | `pg`, `mysql2`, `better-sqlite3` |
| Auth / storage | MongoDB (via `mongoose`), JWT |
| Validation | Zod |
| Export | jsPDF |

## Prerequisites

- Node.js >= 20
- MongoDB running locally (`mongod`, or `docker run -p 27017:27017 mongo`) — required for auth
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

## Project layout

```
src/
  agent/       # LangGraph nodes (plan, generate-query, execute, repair, synthesize)
  auth/        # JWT auth routes and user store (MongoDB)
  routes/      # Fastify HTTP routes (ask, sources, demo)
  safety/      # SQL guard (read-only enforcement)
  schemas/     # Zod schemas for chart specs and answers
  sources/     # Data source adapters (DuckDB, Postgres/MySQL/SQLite, Mongo)
frontend/      # Next.js app
scripts/eval/  # Evaluation dataset + grading harness
test/          # Vitest unit tests
documentation/ # Product docs (idea, PRD, MVP scope, build plan)
```
