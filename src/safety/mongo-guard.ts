/**
 * Read-only guard for MongoDB aggregation-pipeline "queries" produced by the
 * agent, mirroring src/safety/sql-guard.ts for the SQL dialects. The agent's
 * query-generation/repair steps (see prompts.ts's mongodb branch) emit a
 * single JSON object of the shape { collection: string, pipeline: object[] }
 * - this asserts that shape and rejects any pipeline stage/operator capable
 * of writing data or executing arbitrary server-side JavaScript, before the
 * query ever reaches MongoSource.execute().
 */

export interface MongoAggregationQuery {
  collection: string;
  pipeline: Record<string, unknown>[];
}

/**
 * Stages/operators that either write data ($out/$merge) or execute arbitrary
 * JavaScript server-side ($function/$accumulator/$where) - the MongoDB
 * equivalents of the DML/DDL statement types blocked in sql-guard.ts. This
 * set is checked recursively against every object key anywhere in the
 * pipeline (see containsForbiddenKey below), not just top-level stage names,
 * since a write/JS-execution operator can appear nested inside $addFields,
 * $project, a $group accumulator, etc.
 */
const FORBIDDEN_KEYS = new Set(["$out", "$merge", "$function", "$accumulator", "$where"]);

export class UnsafeAggregationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeAggregationError";
  }
}

function containsForbiddenKey(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = containsForbiddenKey(item);
      if (found) return found;
    }
    return undefined;
  }

  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) return key;
      const found = containsForbiddenKey(nested);
      if (found) return found;
    }
  }

  return undefined;
}

/**
 * Parses and validates a MongoDB "query" string as produced by the agent:
 * must be a single JSON object `{ collection: string, pipeline: object[] }`
 * whose pipeline contains no write or arbitrary-JS-execution operator
 * anywhere (checked recursively, not just at the top level). Throws
 * UnsafeAggregationError for anything else, and otherwise returns the
 * parsed, validated query so callers don't need to re-parse it.
 */
export function assertReadOnlyAggregation(query: string): MongoAggregationQuery {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new UnsafeAggregationError("Aggregation query is empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new UnsafeAggregationError(
      `Could not parse the query as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UnsafeAggregationError(
      'MongoDB queries must be a single JSON object of the shape { "collection": string, "pipeline": [...] }.',
    );
  }

  const { collection, pipeline } = parsed as Record<string, unknown>;

  if (typeof collection !== "string" || collection.trim() === "") {
    throw new UnsafeAggregationError(
      'Missing or invalid "collection" field (must be a non-empty string).',
    );
  }

  if (!Array.isArray(pipeline)) {
    throw new UnsafeAggregationError(
      'Missing or invalid "pipeline" field (must be an array of aggregation stages).',
    );
  }

  for (const stage of pipeline) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      throw new UnsafeAggregationError("Every pipeline stage must be a JSON object.");
    }
  }

  const forbiddenKey = containsForbiddenKey(pipeline);
  if (forbiddenKey) {
    throw new UnsafeAggregationError(
      `The "${forbiddenKey}" stage/operator is forbidden (it writes data or executes arbitrary server-side code).`,
    );
  }

  return { collection, pipeline: pipeline as Record<string, unknown>[] };
}
