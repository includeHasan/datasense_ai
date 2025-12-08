# MVP Scope — DataSense AI

**Target timeline:** 4–6 weeks, solo or small team
**Goal:** Prove the core loop — *connect data → ask in plain English → get a correct, narrated, visualized answer* — with the smallest build that's genuinely useful.

---

## 1. MVP thesis

If a non-technical user can upload a file, ask a real business question, and get a trustworthy answer with a chart in seconds, the idea is validated. Everything not required to prove that is deferred.

We focus the MVP on the **non-technical business user** persona and the **file-based** path first, because it's the sharpest pain, the fastest to demo, and needs no credential security to ship.

## 2. In scope

### Data sources
- ✅ **CSV** upload
- ✅ **Excel** (`.xlsx`) upload
- ✅ **JSON** upload
- ✅ **One SQL source** (Postgres) via connection string — *read-only*

> DuckDB ingests all three file types natively, so supporting CSV/Excel/JSON is mostly one path. Postgres is added because the unified SQL layer makes it cheap, and it proves the "database too" story.

### Agent capability
- ✅ Auto-profile the source (tables, columns, types, row counts, sample rows).
- ✅ Natural-language question → generated SQL → execute → result.
- ✅ Error repair loop (one or two retries using the DB error message).
- ✅ Schema-first prompting (never dump full tables to the LLM).
- ✅ Plain-language narrative of the result.
- ✅ Structured, Zod-validated chart spec.

### Visualization
- ✅ Four chart types: **bar, line, pie, table** (+ single-stat KPI if time permits).
- ✅ Rendered in React from the chart spec.

### Transparency
- ✅ "View SQL & data sample" panel on every answer.
- ✅ Read-only enforcement (SELECT-only) on the SQL source.

### Output
- ✅ Single-report export (HTML, with PDF as a stretch) bundling the answers from a session.

### Interface
- ✅ Minimal single-page app: connect → data summary → chat-style ask → answer + chart.

## 3. Out of scope (deferred)

- ❌ Authentication / multi-tenant / user accounts.
- ❌ MySQL and other databases (Postgres only for now).
- ❌ Editable SQL re-run (analyst feature — Phase 2).
- ❌ Saved dashboards, pinning across sessions, persistence beyond the session.
- ❌ Scheduled / recurring reports.
- ❌ Sharing links, collaboration.
- ❌ Developer API + embeddable components.
- ❌ Broad chart library, custom styling, drill-down.
- ❌ Real-time / streaming data.
- ❌ Large-scale (>100 MB) optimization beyond DuckDB defaults.

## 4. MVP success criteria

The MVP is a success if, in user testing:

1. A non-technical user connects a source and gets a **first correct answer within their first session**, unaided.
2. **≥ 80%** of generated queries on a curated test set execute successfully and return the right result.
3. Users say the **narrative + chart** is clear enough to act on without needing an analyst.
4. At least one user exports a report and says they'd send it to a colleague.

## 5. MVP user flow

1. **Connect** — drag in a file *or* paste a Postgres URL.
2. **Summary** — see auto-generated overview of the data.
3. **Ask** — type a plain-English question.
4. **Answer** — read the narrative, see the chart, optionally expand the SQL/data panel.
5. **Repeat** — ask follow-ups.
6. **Export** — download an HTML report of the session's answers.

## 6. Key technical risks for the MVP

| Risk | Mitigation |
|---|---|
| Generated SQL is wrong/unreliable | Schema-first prompts, error-repair loop, a small eval set of question→expected-result pairs run before demo |
| LangGraph.js rough edges | Keep the graph simple (6 nodes); isolate LLM calls behind a thin interface so a backend swap is cheap |
| Messy/malformed files break ingestion | Lean on DuckDB's tolerant parsers; surface clear errors instead of failing silently |
| LLM cost/latency | Cap rows in samples; summarize results; cache profiling |
| DB safety | Enforce SELECT-only, validate/parse queries, run with a read-only DB role where possible |

## 7. Definition of done

- A user can complete the full flow (connect → ask → answer+chart → export) for all four source types.
- Read-only safety is enforced and verified on the Postgres path.
- The eval set passes at the target accuracy threshold.
- Errors are handled with clear, non-technical messaging.
- The app runs locally end-to-end with setup docs.

## 8. What we learn from the MVP

- Do non-technical users actually trust and act on AI-generated insights?
- Which question types break the agent most often (to prioritize Phase 2)?
- Is all-JS / LangGraph.js sufficient, or do we need the hybrid backend sooner?
- Files vs. database — which path drives more real usage?

See `04-plan.md` for the week-by-week build plan.
