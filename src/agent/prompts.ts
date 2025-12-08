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
  return profile.tables
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
 * Builds the prompt for the planning step: given a question and the schema
 * profile, ask the model to produce a short natural-language plan describing
 * which tables/columns to use and how to answer the question.
 */
export function buildPlanPrompt(question: string, profile: SchemaProfile): string {
  return [
    "You are a data analyst planning how to answer a question using a database.",
    "Use ONLY the tables and columns listed below. Do not invent columns or tables.",
    "",
    "## Schema",
    formatSchemaProfile(profile),
    "",
    "## Question",
    question,
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
): string {
  return [
    `You are a data analyst writing a single ${dialect === "mongodb" ? "MongoDB aggregation pipeline" : "SQL"} query to answer a question.`,
    "Use ONLY the tables and columns listed below. Do not invent columns or tables.",
    "",
    "## Schema",
    formatSchemaProfile(profile),
    "",
    "## Question",
    question,
    "",
    "## Plan",
    plan,
    "",
    dialect === "mongodb"
      ? "Respond with ONLY the MongoDB aggregation pipeline (as JSON), no explanation, no markdown fences."
      : "Respond with ONLY the SQL query, no explanation, no markdown fences.",
  ].join("\n");
}

/**
 * Builds the prompt for the repair step: given a previously generated query
 * that failed to execute, the error message, and the schema profile, ask the
 * model to produce a corrected query.
 */
export function buildRepairPrompt(sql: string, errorMessage: string, profile: SchemaProfile): string {
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
    "Respond with ONLY the corrected query, no explanation, no markdown fences.",
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
  ].join("\n");
}

/**
 * Builds the prompt for the synthesis step: given the question, the executed
 * query, and its result set, ask the model to produce a narrative answer.
 */
export function buildSynthesizePrompt(question: string, sql: string, queryResult: QueryResult): string {
  return [
    "You are a data analyst summarizing query results for a business user.",
    "",
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
  ].join("\n");
}
