import type { Dialect, QueryResult, SchemaProfile } from "../sources/types.js";

const MAX_SAMPLE_ROWS_IN_PROMPT = 5;

function formatSampleRows(rows: Record<string, unknown>[], limit = MAX_SAMPLE_ROWS_IN_PROMPT): string {
  if (rows.length === 0) return "  (no sample rows available)";
  return rows
    .slice(0, limit)
    .map((row) => `  ${JSON.stringify(row)}`)
    .join("\n");
}

/**
 * Renders a SchemaProfile as a compact, schema-first block: table/column
 * names, types, nullability, row counts, and a handful of sample rows.
 * Never dumps full tables.
 */
function formatSchemaProfile(profile: SchemaProfile): string {
  const tablesSection = profile.tables
    .map((table) => {
      const columns = table.columns
        .map((col) => {
          const nullability = col.nullable ? "nullable" : "not null";
          const nullRate =
            col.nullRate !== undefined ? `, null_rate=${col.nullRate.toFixed(2)}` : "";
          return `  - ${col.name}: ${col.type} (${nullability}${nullRate})`;
        })
        .join("\n");

      return [
        `Table: ${table.name} (row_count=${table.rowCount})`,
        "Columns:",
        columns,
        "Sample rows:",
        formatSampleRows(table.sampleRows),
      ].join("\n");
    })
    .join("\n\n");

  return [tablesSection, "", "Known relationships:", formatRelationships(profile)].join("\n");
}

/**
 * Renders the schema profile's known relationships (declared FK constraints
 * or heuristically inferred ones) as an explicit "Known relationships"
 * section, so the model can ground joins in real schema metadata where it
 * exists rather than re-guessing from column names on every question.
 * Declared relationships are labeled as such; inferred ones carry an
 * explicit caveat to verify before relying on them.
 */
function formatRelationships(profile: SchemaProfile): string {
  const relationships = profile.relationships ?? [];
  if (relationships.length === 0) {
    return "  (no known relationships - infer joins from column names/types/samples above)";
  }

  return relationships
    .map((rel) => {
      const label =
        rel.confidence === "declared"
          ? "declared"
          : "inferred, verify before relying on it";
      return `  - ${rel.fromTable}.${rel.fromColumn} -> ${rel.toTable}.${rel.toColumn} (${label})`;
    })
    .join("\n");
}

function formatQueryResult(queryResult: QueryResult): string {
  return [
    `Columns: ${queryResult.columns.join(", ")}`,
    `Row count: ${queryResult.rowCount}`,
    "Sample rows:",
    formatSampleRows(queryResult.rows, MAX_SAMPLE_ROWS_IN_PROMPT),
  ].join("\n");
}

/**
 * Renders a conversation history block for injection into a prompt, or an
 * empty string if there is no history yet (first turn in a conversation).
 */
function formatHistorySection(history: string): string {
  if (!history) return "";
  return [
    "## Recent conversation history",
    '(most recent turn last - use it to resolve references like "those", "that", or "the previous result")',
    "",
    history,
    "",
  ].join("\n");
}

/**
 * Builds the prompt for the planning step: given a question and the schema
 * profile, ask the model to produce a short natural-language plan describing
 * which tables/columns to use and how to answer the question.
 */
export function buildPlanPrompt(question: string, profile: SchemaProfile, history = ""): string {
  return [
    "You are a data analyst planning how to answer a question using a database.",
    "Use ONLY the tables and columns listed below. Do not invent columns or tables.",
    "",
    "## Schema",
    formatSchemaProfile(profile),
    "",
    formatHistorySection(history),
    "## Question",
    question,
    "",
    'If the question refers back to a previous result (e.g. "those", "that", "the top ones"),',
    "resolve the reference using the conversation history above.",
    "",
    "Write a short, numbered plan (3-6 steps) describing which tables/columns to use,",
    "any joins or filters needed, and how to compute the answer. Do not write SQL yet.",
  ].join("\n");
}

/**
 * Builds the prompt for the query-generation step: given the question, the
 * plan from the previous step, and the schema profile, ask the model to
 * produce a single query in the target dialect.
 */
export function buildGenerateQueryPrompt(
  question: string,
  plan: string,
  profile: SchemaProfile,
  dialect: Dialect,
  history = "",
): string {
  return [
    `You are a data analyst writing a single ${dialect === "mongodb" ? "MongoDB aggregation pipeline" : "SQL"} query to answer a question.`,
    "Use ONLY the tables and columns listed below. Do not invent columns or tables.",
    "",
    "## Schema",
    formatSchemaProfile(profile),
    "",
    formatHistorySection(history),
    "## Question",
    question,
    "",
    "## Plan",
    plan,
    "",
    dialect === "mongodb" ? MONGODB_QUERY_FORMAT_INSTRUCTIONS : "Respond with ONLY the SQL query, no explanation, no markdown fences.",
  ].join("\n");
}

/**
 * Shared instructions for the exact JSON envelope a MongoDB "query" must
 * take, reused by both the generation and repair prompts so a repaired query
 * is held to the same contract MongoSource/assertReadOnlyAggregation expect
 * (see src/safety/mongo-guard.ts).
 */
const MONGODB_QUERY_FORMAT_INSTRUCTIONS = [
  'Respond with ONLY a single JSON object of the shape {"collection": "<name>", "pipeline": [...]},',
  'where "collection" is exactly one of the collection names listed above (under "Table: <name>") and',
  '"pipeline" is a MongoDB aggregation pipeline: an array of stage objects (e.g. $match, $group, $sort,',
  "$lookup, $limit, $project). No explanation, no markdown fences, no comments. The pipeline must be",
  "read-only - never use $out, $merge, $function, $accumulator, or $where.",
].join("\n");

/**
 * Builds the prompt for the repair step: given a previously generated query
 * that failed to execute, the error message, and the schema profile, ask the
 * model to produce a corrected query. `dialect` determines whether the
 * corrected query must be SQL text or the same {collection, pipeline} JSON
 * envelope the generation step uses for MongoDB (see
 * buildGenerateQueryPrompt) - defaults to "sql" for backward compatibility
 * with any caller that hasn't threaded a dialect through yet.
 */
export function buildRepairPrompt(
  sql: string,
  errorMessage: string,
  profile: SchemaProfile,
  dialect: Dialect = "sql",
): string {
  return [
    "The following query failed to execute against the database.",
    "Use ONLY the tables and columns listed below. Do not invent columns or tables.",
    "",
    "## Schema",
    formatSchemaProfile(profile),
    "",
    "## Query that failed",
    sql,
    "",
    "## Error message",
    errorMessage,
    "",
    "Fix the query so it executes successfully and still answers the original intent.",
    dialect === "mongodb"
      ? MONGODB_QUERY_FORMAT_INSTRUCTIONS
      : "Respond with ONLY the corrected query, no explanation, no markdown fences.",
  ].join("\n");
}

/**
 * Builds the prompt for the suggested-questions step: given a schema profile
 * (no question yet), ask the model to propose questions a business user
 * could ask this dataset, phrased the way the agent expects to be asked.
 */
export function buildSuggestQuestionsPrompt(profile: SchemaProfile): string {
  return [
    "You are a data analyst helping a non-technical business user get started with a dataset.",
    "Use ONLY the tables and columns listed below. Do not invent columns or tables.",
    "",
    "## Schema",
    formatSchemaProfile(profile),
    "",
    "Propose exactly 10 diverse, concrete questions this user could ask about this data.",
    "Cover a mix of totals, breakdowns/comparisons by category, rankings/top-N, and trends over time",
    "where the schema supports them. Phrase each question in plain English, the way a business user",
    "would naturally ask it (not as SQL or column references).",
    (profile.relationships?.length ?? 0) > 0
      ? "At least one question MUST require joining across two or more related tables listed under" +
        ' "Known relationships" above (e.g. combining a parent table with a table that references it).'
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Builds the prompt for the routing step: given a question and the schema
 * profile, ask the model to classify whether it needs a real query/aggregation
 * (data_question) or is a greeting/meta/schema question (conversational).
 */
export function buildRouterPrompt(question: string, profile: SchemaProfile, history = ""): string {
  return [
    "You are the front door of a self-serve data analyst agent.",
    "Classify the user's message into exactly one route:",
    "",
    '- "conversational": greetings/small talk, questions about what the agent/dataset can do,',
    "  questions about the schema itself (e.g. what tables/columns exist), or anything that does",
    "  not require running a query or aggregation over the data.",
    '- "data_question": anything that requires computing, filtering, aggregating, or looking up',
    "  actual values from the data to answer. This includes follow-up questions that only make",
    '  sense in light of a previous result (e.g. "tell me about two of those").',
    "",
    "## Schema",
    formatSchemaProfile(profile),
    "",
    formatHistorySection(history),
    "## Message",
    question,
  ].join("\n");
}

/**
 * Builds the prompt for the conversational step: given a non-data message
 * and the schema profile, ask the model to produce a helpful, natural
 * response grounded in the actual tables/columns available.
 */
export function buildConversePrompt(question: string, profile: SchemaProfile, history = ""): string {
  return [
    "You are a friendly, capable self-serve data analyst agent chatting with a user.",
    "The user's message does not require running a query - respond naturally and helpfully.",
    "If relevant, ground your response in the actual dataset described below (real table and",
    "column names), and propose a few concrete example questions the user could ask next.",
    "",
    "## Schema",
    formatSchemaProfile(profile),
    "",
    formatHistorySection(history),
    "## Message",
    question,
    "",
    "Write a concise, warm, plain-language response. Do not invent tables or columns that",
    "aren't listed above. Also propose 2-4 concrete example questions the user could ask about",
    "this dataset, phrased in plain English using the real table/column names.",
  ].join("\n");
}

/**
 * Builds the prompt for the report-outline step: given a schema profile and
 * optional user preferences (free text and/or explicit section topics), ask
 * the model to draft an ordered list of section *questions* - each phrased
 * exactly the way a user would ask the agent, since each one is later run
 * through the same question-answering graph as a normal turn.
 */
export function buildReportOutlinePrompt(
  profile: SchemaProfile,
  preferences: { freeText?: string; sections?: string[] },
): string {
  const hasPreferences = Boolean(preferences.freeText?.trim()) || (preferences.sections?.length ?? 0) > 0;

  return [
    "You are a data analyst drafting the outline for an automated report over a dataset.",
    "Use ONLY the tables and columns listed below. Do not invent columns or tables.",
    "",
    "## Schema",
    formatSchemaProfile(profile),
    "",
    hasPreferences
      ? [
          "## User preferences",
          preferences.freeText ? `Free-text request: ${preferences.freeText}` : "",
          preferences.sections && preferences.sections.length > 0
            ? `Requested section topics: ${preferences.sections.join(", ")}`
            : "",
          "",
          "Draft sections that satisfy these preferences as closely as the schema allows.",
        ]
          .filter(Boolean)
          .join("\n")
      : [
          "The user gave no specific preferences. Draft sensible default sections covering, where the",
          "schema supports them: an overview with row counts, the top values in key categorical columns,",
          "trends over any date/time columns, and key KPIs.",
        ].join("\n"),
    "",
    "Produce an ordered list of 3-6 report sections. For each section, write:",
    "- a short section title (a few words)",
    '- a single, concrete question phrased in plain English exactly as a business user would ask it',
    "  (not as SQL or column references) - this question will be answered by a data agent to fill in",
    "  that section, so it must be fully self-contained (no reference to other sections).",
  ].join("\n");
}

/**
 * Builds the prompt for the synthesis step: given the question, the executed
 * query, and its result set, ask the model to produce a narrative answer.
 */
export function buildSynthesizePrompt(
  question: string,
  sql: string,
  queryResult: QueryResult,
  history = "",
): string {
  return [
    "You are a data analyst summarizing query results for a business user.",
    "",
    formatHistorySection(history),
    "## Question",
    question,
    "",
    "## Query executed",
    sql,
    "",
    "## Query result",
    formatQueryResult(queryResult),
    "",
    "Write a concise, plain-language narrative answering the question based ONLY on the result above.",
    "Mention any caveats (e.g. small sample size, nulls, truncated results) if relevant.",
    "",
    "## Choosing a chart kind",
    "Pick the chart kind that best fits the shape of the result, not just bar/line/pie/table/kpi:",
    "- scatter: use when showing the correlation between two numeric columns. Set sizeKey to a third",
    "  numeric column to size each point (a bubble chart) when a third metric is meaningful, else null.",
    "- funnel: use for a single-path multi-stage drop-off (e.g. signup -> activation -> purchase counts).",
    "- sankey: use instead of funnel when the flow branches or merges between named stages/categories",
    "  rather than a single strict sequence (nodes = every distinct stage name, links = flows between them).",
    "- radar: use for comparing multiple dimensions/metrics across a small number of entities.",
    "- gauge: use for a single KPI measured against a target or max (e.g. quota attainment).",
    "- combo: use when two series with different units/scales need to be shown together",
    "  (e.g. revenue as bars and growth rate as a line) - split them into barSeries/lineSeries.",
    "- area: like line, but use it to emphasize cumulative volume/magnitude over a sequence.",
    "- bar/line: set stacked=true when parts should sum to a whole, and orientation=\"horizontal\"",
    "  when category labels are long. Set normalized=true (only meaningful with stacked=true) to show",
    "  each stack as a 100% proportion/mix instead of absolute volume. Leave any of these null otherwise.",
    "- pie: set donut=true for a donut variant when appropriate, otherwise null. Prefer treemap over pie",
    "  when there are more than ~6 categories, or when categories nest into subcategories.",
    "- treemap / sunburst: use for nested part-to-whole breakdowns (e.g. category -> subcategory revenue).",
    "  Each data row is one leaf, with \"path\" as the full root-to-leaf label sequence (e.g.",
    "  [\"Electronics\", \"Phones\"]) and \"value\" as its numeric size - never nest objects directly.",
    "  Prefer treemap by default; use sunburst only when the ring/depth framing is clearly more natural.",
    "- heatmap: use for a value across two categorical dimensions at once (e.g. day-of-week x hour-of-day).",
    "- calendar: use for one value per calendar date over a period (e.g. daily active users), to reveal",
    "  day-of-week or seasonal patterns. data rows are {date: \"YYYY-MM-DD\", value}.",
    "- boxplot: use to show the distribution/spread (not just the average) of a numeric column per",
    "  category. The query MUST precompute min/q1/median/q3/max per category (e.g. with",
    "  percentile_cont) - never pass raw unaggregated samples.",
    "- histogram: use to show the distribution of a single numeric column across value ranges. The",
    "  query MUST precompute the bins (a label like \"0-100\" and a count per bin) - never pass raw rows.",
    "- waterfall: use to explain how a total changed via a sequence of additive/subtractive steps",
    "  (e.g. starting revenue, plus new sales, minus churn, equals ending revenue). Mark any row that",
    "  is a running total/subtotal (rendered as a full bar from zero, not a floating delta) by naming",
    "  its boolean column via totalKey; leave totalKey null if every row is a plain delta.",
    "- kpi: set target to render a bullet-style marker when the value has a known goal/quota, and/or",
    "  trend to a short oldest-first array of recent values to render an inline sparkline. Leave both",
    "  null when there is no target or no meaningful short history.",
  ].join("\n");
}
