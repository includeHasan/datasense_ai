# Build Plan — DataSense AI (MVP)

**Scope:** the lean MVP defined in `03-mvp.md`
**Timeline:** 4–6 weeks
**Team:** solo / small

---

## 1. Architecture at a glance

```
React SPA  ──HTTP──▶  Node API (Fastify)  ──▶  LangGraph.js agent
   │                        │                        │
   │                        ├── DuckDB (file→SQL)    ├── LLM (SQL gen,
   │                        └── pg driver (Postgres) │     narrative,
   ▼                                                 │     chart spec)
charts + report                                      └── Zod-validated outputs
```

Core principle: **one data tool ("run SQL") via DuckDB**, **structured LLM outputs** (no model-written executable code), **schema-first prompting** (never dump raw tables to the LLM).

## 2. Workstreams

1. **Ingestion** — file upload + DuckDB loading + Postgres connection + profiling.
2. **Agent** — LangGraph.js graph: plan → SQL → execute → repair → synthesize.
3. **Frontend** — connect screen, data summary, ask/answer chat, charts, report export.
4. **Safety & quality** — read-only enforcement, eval set, error handling.

## 3. Milestones (week by week)

> Treat as a 5-week core with a 1-week buffer. Compress or extend per actual pace.

### Week 1 — Foundations & ingestion
- Scaffold repo: Node (Fastify) API + React (Vite) frontend, shared types.
- Integrate DuckDB; load CSV, JSON, Excel into queryable tables.
- Add Postgres connection via `pg` (read-only role / SELECT-only guard).
- Build the **profiler**: tables, columns, types, row counts, null rates, sample rows.
- **Deliverable:** point at any of the 4 sources and print a schema profile.

### Week 2 — Agent core (text → SQL → result)
- Stand up the LangGraph.js graph with nodes: Plan → GenerateSQL → Execute → Repair → Synthesize.
- Schema-first prompt: feed profile + samples + aggregates only.
- Execute queries through DuckDB / pg; capture results.
- Implement the **repair loop** (retry on error using the DB message).
- **Deliverable:** a question in → correct result rows out, in the terminal/API.

### Week 3 — Narrative + charts
- Synthesize node returns a **narrative** + a **Zod-validated chart spec**.
- Frontend renders bar / line / pie / table from the spec (Recharts or ECharts).
- Wire the end-to-end API: question → {narrative, chartSpec, sql, sample}.
- **Deliverable:** ask in the UI, see a narrated answer + chart.

### Week 4 — UX, transparency, report export
- Build the real UI: connect screen → data summary → chat ask → answer cards.
- Add the **"View SQL & data sample"** panel on each answer.
- Implement **session report export** (HTML; PDF via Puppeteer as stretch).
- Friendly, non-technical error states.
- **Deliverable:** full happy-path flow usable by a non-technical tester.

### Week 5 — Quality, safety, hardening
- Build a small **eval set** (question → expected result) and run it; fix failure modes.
- Verify and harden **read-only** enforcement on Postgres.
- Token/latency tuning: cap sample sizes, cache profiling, summarize results.
- Polish, setup docs, demo dataset.
- **Deliverable:** MVP meets success criteria; reproducible local setup.

### Week 6 — Buffer & user testing
- Real-user testing sessions; capture where the agent breaks.
- Triage Phase-2 backlog from findings.
- **Deliverable:** validated MVP + prioritized next-step list.

## 4. Task checklist

### Ingestion
- [ ] File upload endpoint (CSV/JSON/XLSX)
- [ ] DuckDB load + register tables
- [ ] Postgres connect via connection string
- [ ] Read-only / SELECT-only guard
- [ ] Schema profiler (types, counts, nulls, samples)

### Agent
- [ ] LangGraph.js graph skeleton (6 nodes)
- [ ] Schema-first prompt templates
- [ ] SQL generation node
- [ ] Execute node (DuckDB + pg)
- [ ] Error-repair conditional loop
- [ ] Synthesize node → narrative + chart spec
- [ ] Zod schemas for chart spec + report

### Frontend
- [ ] Connect screen (file drop + URL paste)
- [ ] Data summary view
- [ ] Chat-style ask/answer
- [ ] Chart renderer (bar/line/pie/table)
- [ ] SQL & data sample panel
- [ ] Report export (HTML; PDF stretch)
- [ ] Error/empty states

### Quality & safety
- [ ] Eval set (≥ 20 question→result pairs)
- [ ] Read-only enforcement test
- [ ] Token/latency limits
- [ ] Setup + run docs

## 5. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LangGraph.js immaturity slows agent work | Med | Med | Keep graph simple; thin LLM interface so backend swap to Python is cheap |
| SQL accuracy too low for trust | Med | High | Schema-first prompts + repair loop + eval set gate before demo |
| Messy files break ingestion | Med | Med | Lean on DuckDB tolerant parsers; clear error surfacing |
| LLM cost/latency on big data | Med | Med | Sample caps, aggregates, cached profiling, result summarization |
| Scope creep beyond MVP | High | High | Hold the line on `03-mvp.md`; log extras to Phase-2 backlog |
| DB security mistake | Low | High | Read-only role, SELECT-only validation, encrypted/ephemeral credentials |

## 6. Decision log / fork points

- **All-JS vs hybrid backend:** start all-JS. Trigger to move the agent to Python FastAPI = LangGraph.js blocks complex logic or stability issues appear in Week 2–3. Keep the LLM/agent layer behind a thin interface to make this swap low-cost.
- **Charting library:** Recharts for speed of build; ECharts if richer chart types are needed.
- **Persistence:** ephemeral sessions for the MVP (no accounts); revisit when sharing/scheduling is needed.

## 7. After the MVP (Phase 2 preview)

- Editable SQL re-run (analyst persona).
- MySQL + more sources.
- Saved dashboards, pinned insights, scheduled reports.
- Auth + multi-tenant.
- Developer API + embeddable React components.

## 8. Definition of done (MVP)

- Full flow works for all 4 sources (connect → ask → answer+chart → export).
- Read-only safety verified on Postgres.
- Eval set passes the accuracy threshold (≥ 80%).
- Non-technical error handling throughout.
- Documented, reproducible local setup.
