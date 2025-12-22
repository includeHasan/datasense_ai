import { MongoClient, ObjectId, type Db } from "mongodb";

import { config } from "../config.js";
import { assertReadOnlyAggregation } from "../safety/mongo-guard.js";
import { inferRelationships } from "./relationships.js";
import type { DataSource, QueryResult, SchemaProfile } from "./types.js";

const SAMPLE_SIZE = 100;

/**
 * True if `connectionString` has an explicit database name in its path (e.g.
 * "mongodb://host:27017/mydb"). Without one, the driver silently defaults to
 * a database named "test" (see mongodb's connection_string.ts) rather than
 * erroring - a footgun where a user forgets the db name and gets a
 * confusingly empty/wrong source instead of a clear failure. Uses the same
 * "swap the scheme, then use the WHATWG URL parser" trick as host-policy.ts;
 * falls back to a regex for multi-host authorities (comma-separated hosts),
 * which aren't valid URL authorities and make `new URL(...)` throw.
 */
function hasExplicitDatabaseName(connectionString: string): boolean {
  try {
    const rewritten = connectionString.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, "http:");
    const url = new URL(rewritten);
    return url.pathname.replace(/^\//, "").length > 0;
  } catch {
    const match = connectionString.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]+\/([^?#]*)/);
    return Boolean(match?.[1] && match[1].length > 0);
  }
}

/**
 * True for BSON wrapper types (Decimal128, Long, Int32, etc.) - anything the
 * mongodb driver tags with a `_bsontype` property - as opposed to plain JS
 * objects/documents.
 */
function isBsonWrapper(value: object): value is { _bsontype: string; toString(): string } {
  return typeof (value as { _bsontype?: unknown })._bsontype === "string";
}

/**
 * Recursively converts MongoDB/BSON-specific value types (ObjectId, Date,
 * Decimal128, Long, Binary, etc.) into plain JSON primitives, so query
 * results and sampled documents can flow through the rest of the app (LLM
 * prompts, chart specs, PDF export) exactly like any SQL source's rows -
 * everywhere else in the codebase assumes JSON primitives only (see the
 * comment on cellValueSchema in schemas/chart-spec.ts).
 */
function sanitizeBsonValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toString();
  if (Array.isArray(value)) return value.map(sanitizeBsonValue);

  if (typeof value === "object") {
    if (isBsonWrapper(value)) {
      // Decimal128/Long/etc. - prefer a real number when it round-trips
      // cleanly (so charts/aggregates can use it numerically), else keep
      // the exact string form (e.g. a Decimal128 too large for a JS number).
      const asString = value.toString();
      const asNumber = Number(asString);
      return Number.isFinite(asNumber) ? asNumber : asString;
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        sanitizeBsonValue(nested),
      ]),
    );
  }

  return value;
}

function sanitizeDocument(doc: Record<string, unknown>): Record<string, unknown> {
  return sanitizeBsonValue(doc) as Record<string, unknown>;
}

type MongoFieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "objectId"
  | "object"
  | "array"
  | "null"
  | "mixed";

function valueType(value: unknown): Exclude<MongoFieldType, "mixed"> {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return "date";
  if (value instanceof ObjectId) return "objectId";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") {
    if (isBsonWrapper(value)) return "number"; // Decimal128/Long/etc.
    return "object";
  }
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

/**
 * Infers a flat column list from a set of already-sanitized sampled
 * documents: every field seen across the sample, typed by the values that
 * carry it (falling back to "mixed" when a field's sampled values disagree),
 * with nullable/nullRate reflecting how often the field is missing or null
 * across the sample. Nested objects are reported as a single "object"-typed
 * column rather than expanded into dotted sub-columns, so the profile stays
 * a manageable size for schema-first prompting even for deeply-nested
 * documents - the agent can still reach into them with dot-path field
 * references in its aggregation pipeline.
 */
function inferColumns(docs: Record<string, unknown>[]): SchemaProfile["tables"][number]["columns"] {
  const fieldNames = new Set<string>();
  for (const doc of docs) {
    for (const key of Object.keys(doc)) fieldNames.add(key);
  }

  const columns: SchemaProfile["tables"][number]["columns"] = [];
  for (const name of fieldNames) {
    let missingOrNullCount = 0;
    const observedTypes = new Set<Exclude<MongoFieldType, "mixed">>();

    for (const doc of docs) {
      const hasField = Object.prototype.hasOwnProperty.call(doc, name);
      const type = valueType(hasField ? doc[name] : undefined);
      if (type === "null") {
        missingOrNullCount += 1;
      } else {
        observedTypes.add(type);
      }
    }

    const type: MongoFieldType =
      observedTypes.size === 0 ? "null" : observedTypes.size === 1 ? [...observedTypes][0] : "mixed";

    columns.push({
      name,
      type,
      nullable: missingOrNullCount > 0,
      nullRate: docs.length > 0 ? missingOrNullCount / docs.length : 0,
    });
  }

  return columns;
}

/**
 * DataSource implementation for a user-supplied MongoDB connection. Unlike
 * the SQL connectors, MongoDB has no queryable catalog of column types or FK
 * constraints, so profile() infers a schema by sampling documents per
 * collection (see inferColumns) and relationships come from the same
 * naming-based heuristic used for uploaded flat files (see relationships.ts).
 * execute() only ever calls `.aggregate()` - there is no code path that can
 * reach a write operation - and both execute() and the agent's execute node
 * additionally validate the query via assertReadOnlyAggregation before it
 * runs, matching the defense-in-depth pattern SqlSource uses for SQL.
 */
export class MongoSource implements DataSource {
  readonly id: string;
  readonly kind = "mongodb" as const;
  readonly dialect = "mongodb" as const;

  private readonly client: MongoClient;
  private readonly db: Db;
  private closed = false;

  private constructor(client: MongoClient, db: Db, id: string) {
    this.client = client;
    this.db = db;
    this.id = id;
  }

  /**
   * Connects to `connectionString` and returns a ready-to-use MongoSource.
   * Connects eagerly (rather than lazily on first query) so a bad
   * credential/unreachable host/missing-database-name surfaces immediately
   * at POST /sources/db time, matching how the SQL connectors behave.
   */
  static async create(connectionString: string): Promise<MongoSource> {
    if (!hasExplicitDatabaseName(connectionString)) {
      throw new Error(
        'The connection string must include a database name, e.g. "mongodb://host:27017/mydb".',
      );
    }

    const client = new MongoClient(connectionString);
    try {
      await client.connect();
      const db = client.db();
      return new MongoSource(client, db, connectionString);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  private async collectionNames(): Promise<string[]> {
    const collections = await this.db.listCollections({}, { nameOnly: true }).toArray();
    return collections
      .map((c) => c.name)
      .filter((name) => !name.startsWith("system."))
      .sort();
  }

  async profile(): Promise<SchemaProfile> {
    this.assertOpen();
    const names = await this.collectionNames();
    const tables: SchemaProfile["tables"] = [];

    for (const name of names) {
      const collection = this.db.collection(name);
      // Exact count, matching the (accepted, pre-existing) tradeoff the SQL
      // profilers make with COUNT(*) - a real full-collection count rather
      // than a cheap-but-approximate estimate.
      const rowCount = await collection.countDocuments();
      // Type inference must run on the RAW driver output (real ObjectId/Date/
      // Decimal128 instances) - sanitizeDocument below converts those to
      // plain strings/numbers for display, which would erase the very type
      // information inferColumns needs to tell "date"/"objectId" apart from
      // "string".
      const rawSample = (await collection
        .aggregate([{ $sample: { size: SAMPLE_SIZE } }])
        .toArray()) as Record<string, unknown>[];
      const sanitizedSample = rawSample.map((doc) => sanitizeDocument(doc));

      tables.push({
        name,
        columns: inferColumns(rawSample),
        rowCount,
        sampleRows: sanitizedSample.slice(0, config.maxSampleRows),
      });
    }

    // MongoDB has no queryable FK-constraint metadata (it's schemaless), so
    // relationships always come from the same naming heuristic applied to
    // DuckDB tables created from an uploaded flat file.
    const relationships = inferRelationships(tables);
    return { tables, relationships };
  }

  async execute(query: string): Promise<QueryResult> {
    this.assertOpen();
    const { collection, pipeline } = assertReadOnlyAggregation(query);
    const docs = await this.db.collection(collection).aggregate(pipeline).toArray();
    const rows = docs.map((doc) => sanitizeDocument(doc as Record<string, unknown>));
    const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    return { columns, rows, rowCount: rows.length };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.client.close();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error(`MongoSource ${this.id} is closed`);
    }
  }
}
