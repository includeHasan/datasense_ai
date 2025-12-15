import pg from "pg";
import mysql from "mysql2/promise";
import Database from "better-sqlite3";

import { config } from "../config.js";
import { assertReadOnlySelect } from "../safety/sql-guard.js";
import { inferRelationships } from "./relationships.js";
import type { DataSource, QueryResult, SchemaProfile, SchemaRelationship } from "./types.js";

export type SqlSourceKind = "postgres" | "mysql" | "sqlite";

type SqlClient =
  | { kind: "postgres"; pool: pg.Pool }
  | { kind: "mysql"; pool: mysql.Pool }
  | { kind: "sqlite"; db: Database.Database };

/**
 * Creates the underlying, dialect-specific client used to talk to a SQL
 * database. Postgres and MySQL use connection-pooled clients; SQLite is
 * opened as a read-only file handle so writes are rejected at the driver
 * level regardless of what query is executed.
 */
function createSqlClient(kind: SqlSourceKind, connectionString: string): SqlClient {
  switch (kind) {
    case "postgres":
      return { kind, pool: new pg.Pool({ connectionString }) };
    case "mysql":
      return { kind, pool: mysql.createPool(connectionString) };
    case "sqlite":
      return { kind, db: new Database(connectionString, { readonly: true }) };
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported SQL source kind: ${String(exhaustive)}`);
    }
  }
}

/** Public factory re-exported for callers that only need the raw client. */
export function createSqlSource(kind: SqlSourceKind, connectionString: string): SqlSource {
  return new SqlSource(kind, connectionString);
}

interface TableColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
}

/**
 * Queries Postgres's information_schema for declared foreign-key constraints
 * (table_constraints joined against key_column_usage/constraint_column_usage
 * via the shared constraint_name), producing "declared" relationships
 * grounded in real schema metadata rather than column-name guessing.
 */
export async function declaredForeignKeysPostgres(pool: pg.Pool): Promise<SchemaRelationship[]> {
  const result = await pool.query<{
    from_table: string;
    from_column: string;
    to_table: string;
    to_column: string;
  }>(
    `SELECT
        kcu.table_name AS from_table,
        kcu.column_name AS from_column,
        ccu.table_name AS to_table,
        ccu.column_name AS to_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'`,
  );

  return result.rows.map((row) => ({
    fromTable: row.from_table,
    fromColumn: row.from_column,
    toTable: row.to_table,
    toColumn: row.to_column,
    confidence: "declared" as const,
  }));
}

/**
 * Queries MySQL's information_schema.KEY_COLUMN_USAGE for declared foreign
 * keys (rows where REFERENCED_TABLE_NAME is populated already scope the
 * result to FK columns), producing "declared" relationships.
 */
export async function declaredForeignKeysMysql(pool: mysql.Pool): Promise<SchemaRelationship[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
        table_name AS from_table,
        column_name AS from_column,
        referenced_table_name AS to_table,
        referenced_column_name AS to_column
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE table_schema = DATABASE()
        AND referenced_table_name IS NOT NULL`,
  );

  return rows.map((row) => ({
    fromTable: String(row.from_table ?? row.FROM_TABLE ?? row.TABLE_NAME),
    fromColumn: String(row.from_column ?? row.FROM_COLUMN ?? row.COLUMN_NAME),
    toTable: String(row.to_table ?? row.TO_TABLE ?? row.REFERENCED_TABLE_NAME),
    toColumn: String(row.to_column ?? row.TO_COLUMN ?? row.REFERENCED_COLUMN_NAME),
    confidence: "declared" as const,
  }));
}

/**
 * Uses SQLite's PRAGMA foreign_key_list('<table>') per table, which returns
 * the referenced table/column directly (no join needed), producing
 * "declared" relationships. When a FK omits an explicit "to" column (SQLite
 * allows referencing the parent's implicit rowid/primary key), it is skipped
 * rather than guessed — the heuristic fallback will pick it up if possible.
 */
export function declaredForeignKeysSqlite(db: Database.Database, tableNames: string[]): SchemaRelationship[] {
  const relationships: SchemaRelationship[] = [];

  for (const tableName of tableNames) {
    const fkRows = db
      .prepare<[], { table: string; from: string; to: string | null }>(
        `PRAGMA foreign_key_list("${tableName}")`,
      )
      .all();

    for (const fk of fkRows) {
      if (!fk.to) continue;
      relationships.push({
        fromTable: tableName,
        fromColumn: fk.from,
        toTable: fk.table,
        toColumn: fk.to,
        confidence: "declared",
      });
    }
  }

  return relationships;
}

/**
 * Merges declared relationships with heuristically inferred ones as a
 * fallback: any table that has no declared outgoing FK still gets a chance
 * at heuristic detection, covering connectors where the declared-FK query
 * returned nothing (e.g. a schema genuinely has no FK constraints).
 */
export function withHeuristicFallback(
  tables: SchemaProfile["tables"],
  declared: SchemaRelationship[],
): SchemaRelationship[] {
  const tablesWithDeclaredFk = new Set(declared.map((rel) => rel.fromTable));
  const tablesNeedingHeuristics = tables.filter((table) => !tablesWithDeclaredFk.has(table.name));
  const inferred = tablesNeedingHeuristics.length > 0 ? inferRelationships(tables) : [];

  // Only keep inferred relationships that originate from tables lacking
  // declared FKs, so we never contradict/duplicate real constraint metadata.
  const filteredInferred = inferred.filter((rel) => !tablesWithDeclaredFk.has(rel.fromTable));

  return [...declared, ...filteredInferred];
}

async function profilePostgres(pool: pg.Pool): Promise<SchemaProfile> {
  const tablesResult = await pool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );

  const tables: SchemaProfile["tables"] = [];

  for (const { table_name: tableName } of tablesResult.rows) {
    const columnsResult = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
        ORDER BY ordinal_position`,
      [tableName],
    );

    const columns: TableColumnInfo[] = columnsResult.rows.map((row) => ({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === "YES",
    }));

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "${tableName}"`,
    );
    const rowCount = Number(countResult.rows[0]?.count ?? 0);

    const sampleResult = await pool.query(
      `SELECT * FROM "${tableName}" LIMIT ${config.maxSampleRows}`,
    );

    tables.push({
      name: tableName,
      columns,
      rowCount,
      sampleRows: sampleResult.rows,
    });
  }

  const declared = await declaredForeignKeysPostgres(pool).catch(() => [] as SchemaRelationship[]);
  const relationships = withHeuristicFallback(tables, declared);

  return { tables, relationships };
}

async function profileMysql(pool: mysql.Pool): Promise<SchemaProfile> {
  const [tableRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT table_name AS table_name
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );

  const tables: SchemaProfile["tables"] = [];

  for (const row of tableRows) {
    const tableName = String(row.table_name ?? row.TABLE_NAME);

    const [columnRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT column_name AS column_name, data_type AS data_type, is_nullable AS is_nullable
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
        ORDER BY ordinal_position`,
      [tableName],
    );

    const columns: TableColumnInfo[] = columnRows.map((row) => ({
      name: String(row.column_name ?? row.COLUMN_NAME),
      type: String(row.data_type ?? row.DATA_TYPE),
      nullable: String(row.is_nullable ?? row.IS_NULLABLE) === "YES",
    }));

    const [countRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM \`${tableName}\``,
    );
    const rowCount = Number(countRows[0]?.count ?? 0);

    const [sampleRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM \`${tableName}\` LIMIT ${config.maxSampleRows}`,
    );

    tables.push({
      name: tableName,
      columns,
      rowCount,
      sampleRows: sampleRows as Record<string, unknown>[],
    });
  }

  const declared = await declaredForeignKeysMysql(pool).catch(() => [] as SchemaRelationship[]);
  const relationships = withHeuristicFallback(tables, declared);

  return { tables, relationships };
}

export function profileSqlite(db: Database.Database): SchemaProfile {
  const tableRows = db
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all();

  const tables: SchemaProfile["tables"] = [];

  for (const { name: tableName } of tableRows) {
    const columnRows = db
      .prepare<[], { name: string; type: string; notnull: number }>(
        `PRAGMA table_info("${tableName}")`,
      )
      .all();

    const columns: TableColumnInfo[] = columnRows.map((row) => ({
      name: row.name,
      type: row.type || "unknown",
      nullable: row.notnull === 0,
    }));

    const countRow = db
      .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM "${tableName}"`)
      .get();
    const rowCount = Number(countRow?.count ?? 0);

    const sampleRows = db
      .prepare(`SELECT * FROM "${tableName}" LIMIT ${config.maxSampleRows}`)
      .all() as Record<string, unknown>[];

    tables.push({
      name: tableName,
      columns,
      rowCount,
      sampleRows,
    });
  }

  const tableNames = tables.map((table) => table.name);
  const declared = declaredForeignKeysSqlite(db, tableNames);
  const relationships = withHeuristicFallback(tables, declared);

  return { tables, relationships };
}

async function executePostgres(pool: pg.Pool, query: string): Promise<QueryResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    try {
      const result = await client.query(query);
      await client.query("COMMIT");
      const columns = result.fields.map((field) => field.name);
      return { columns, rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

async function executeMysql(pool: mysql.Pool, query: string): Promise<QueryResult> {
  const connection = await pool.getConnection();
  try {
    await connection.query("START TRANSACTION READ ONLY");
    try {
      const [rows, fields] = await connection.query<mysql.RowDataPacket[]>(query);
      await connection.query("COMMIT");
      const columns = (fields ?? []).map((field) => field.name);
      const dataRows = rows as Record<string, unknown>[];
      return { columns, rows: dataRows, rowCount: dataRows.length };
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    }
  } finally {
    connection.release();
  }
}

function executeSqlite(db: Database.Database, query: string): QueryResult {
  const statement = db.prepare(query);
  const rows = (statement.all() as Record<string, unknown>[]) ?? [];
  const columns = statement.columns().map((column) => column.name);
  return { columns, rows, rowCount: rows.length };
}

async function closeClient(client: SqlClient): Promise<void> {
  switch (client.kind) {
    case "postgres":
      await client.pool.end();
      return;
    case "mysql":
      await client.pool.end();
      return;
    case "sqlite":
      client.db.close();
      return;
    default: {
      const exhaustive: never = client;
      throw new Error(`Unsupported SQL client: ${String(exhaustive)}`);
    }
  }
}

export class SqlSource implements DataSource {
  readonly id: string;
  readonly kind: SqlSourceKind;
  readonly dialect = "sql" as const;

  private readonly client: SqlClient;

  constructor(kind: SqlSourceKind, connectionString: string) {
    this.id = `${kind}:${connectionString}`;
    this.kind = kind;
    this.client = createSqlClient(kind, connectionString);
  }

  async profile(): Promise<SchemaProfile> {
    switch (this.client.kind) {
      case "postgres":
        return profilePostgres(this.client.pool);
      case "mysql":
        return profileMysql(this.client.pool);
      case "sqlite":
        return profileSqlite(this.client.db);
      default: {
        const exhaustive: never = this.client;
        throw new Error(`Unsupported SQL client: ${String(exhaustive)}`);
      }
    }
  }

  async execute(query: string): Promise<QueryResult> {
    assertReadOnlySelect(query);

    switch (this.client.kind) {
      case "postgres":
        return executePostgres(this.client.pool, query);
      case "mysql":
        return executeMysql(this.client.pool, query);
      case "sqlite":
        return executeSqlite(this.client.db, query);
      default: {
        const exhaustive: never = this.client;
        throw new Error(`Unsupported SQL client: ${String(exhaustive)}`);
      }
    }
  }

  async close(): Promise<void> {
    await closeClient(this.client);
  }
}
