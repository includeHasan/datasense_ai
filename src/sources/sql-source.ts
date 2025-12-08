import pg from "pg";
import mysql from "mysql2/promise";
import Database from "better-sqlite3";

import { config } from "../config.js";
import { assertReadOnlySelect } from "../safety/sql-guard.js";
import type { DataSource, QueryResult, SchemaProfile } from "./types.js";

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

  return { tables };
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

  return { tables };
}

function profileSqlite(db: Database.Database): SchemaProfile {
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

  return { tables };
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
