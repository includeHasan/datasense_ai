# Product Idea — DataSense AI

> Working name. An AI agent that connects to your data, analyzes it, generates reports, and visualizes results so anyone can make business decisions — no SQL or analyst required.

---

## 1. One-line pitch

**DataSense AI is a self-serve AI data analyst.** Point it at a JSON, CSV, Excel file, or a SQL database URL, ask a question in plain English, and get back a narrated insight, a chart, and a shareable report.

## 2. The problem

Most organizations sit on data they can't easily use.

- **Business users** (founders, ops, marketing, sales) have the questions but can't write SQL or build dashboards. They wait on analysts, or guess.
- **Data analysts** spend a large share of their time on repetitive, low-value reporting requests instead of deep work.
- **Developers** who want to embed analytics into their own products have to stitch together a query engine, a charting library, and an LLM layer themselves.

The common thread: the distance between *"I have data"* and *"I have a decision"* is too long, too technical, and too dependent on scarce people.

## 3. The solution

A stateful AI agent that owns the full loop:

1. **Connect** — ingest data from a file (JSON / CSV / Excel) or a live SQL connection string.
2. **Understand** — profile the schema, types, row counts, and sample values automatically.
3. **Reason** — plan what analysis answers the user's question.
4. **Query** — generate and run SQL safely against the data.
5. **Explain** — produce a plain-language narrative of what the data shows.
6. **Visualize** — emit a validated chart specification the frontend renders.
7. **Report** — assemble narrative + charts into a shareable, exportable report.

The user only ever sees: *upload/connect → ask → get answer*. Everything between is the agent's job.

## 4. Why now

- LLMs are now reliable enough to translate natural language into correct SQL against a known schema.
- Embedded analytical engines (DuckDB) make files and databases queryable through one uniform SQL interface — in-browser or in-Node.
- Agent frameworks (LangGraph) make multi-step, stateful reasoning loops practical to build and debug.
- Expectations have shifted: people now expect to *ask* software questions, not *operate* it.

## 5. Target users

The product is positioned broadly, with three segments served by the same core engine:

| Segment | What they want | How DataSense serves them |
|---|---|---|
| **Non-technical business users** | Answers and reports without touching SQL | Upload a file, ask in plain English, export a report |
| **Data analysts / teams** | Offload repetitive reporting; let stakeholders self-serve | Transparent generated SQL, editable queries, faster turnaround |
| **Developers** | Embed an analytics agent into their own product | Headless agent API + drop-in React components (later phase) |

The MVP focuses on the **non-technical business user** flow because it's the sharpest pain and the clearest demo, while keeping the engine general enough to extend to the other two.

## 6. Core differentiation

- **Source-agnostic by design** — files *and* databases are normalized to one SQL-queryable layer (DuckDB), so the agent learns one interface and works everywhere.
- **Decision-oriented, not just query-oriented** — the output is a narrated insight and a report, not a raw result table.
- **Transparent and safe** — generated SQL is visible and read-only by default; the agent never mutates source data.
- **All-JS, embeddable** — built on Node + LangGraph.js + React, so the same engine can power a standalone app or be embedded by developers.

## 7. What success looks like

A non-technical user uploads a messy sales spreadsheet, types *"Which regions grew fastest last quarter and why?"*, and within seconds gets a clear paragraph, a bar chart, and a one-click report they can send to their boss — without ever knowing SQL exists.

## 8. Risks & open questions (idea stage)

- **Trust in generated SQL / insights** — how do we make users confident the numbers are right? (Show the query, show the data sample, allow verification.)
- **LangGraph.js maturity** — the JS library is younger than its Python counterpart; complex agent logic may eventually warrant a hybrid backend. Tracked as a known tradeoff.
- **Token cost & scale** — large tables can't be fed to the LLM directly; the architecture must rely on schema + samples + aggregates.
- **Differentiation vs. incumbents** — existing BI tools and "chat with your data" features are crowding in; the wedge is *source-agnostic + decision-oriented + embeddable*.

## 9. Related documents

- `02-prd.md` — full product requirements
- `03-mvp.md` — lean MVP scope (4–6 weeks)
- `04-plan.md` — build plan and milestones
