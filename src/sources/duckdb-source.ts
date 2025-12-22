import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import * as XLSX from "xlsx";
import { config } from "../config.js";
import { inferRelationships } from "./relationships.js";
import type { DataSource, QueryResult, SchemaProfile } from "./types.js";

export type DeclaredFileType = "csv" | "json" | "xlsx" | "xls";

/**
 * DataSource implementation backed by an in-memory DuckDB instance.
 *
 * Uploaded files are staged to short-lived temp files so DuckDB's native
 * readers (`read_csv_auto` / `read_json_auto`) can ingest them directly.
 * Excel workbooks are parsed with SheetJS into row objects, serialized to a
 * temp JSON file per sheet, and loaded the same way so every file type flows
 * through a single ingestion code path.
 */
export class DuckDBSource implements DataSource {
  readonly id: string;
  readonly kind = "file" as const;
  readonly dialect = "sql" as const;

  private readonly instance: DuckDBInstance;
  private readonly connection: DuckDBConnection;
  private readonly tableNames: string[];
  private closed = false;

  private constructor(instance: DuckDBInstance, connection: DuckDBConnection, tableNames: string[]) {
    this.id = randomUUID();
    this.instance = instance;
    this.connection = connection;
    this.tableNames = tableNames;
  }

  /**
   * Factory that spins up a fresh in-memory DuckDB instance, stages the
   * uploaded buffer to a temp directory, loads it into one or more tables,
   * and cleans up the temp directory before returning.
   */
  static async create(
    buffer: Buffer,
    originalFilename: string,
    declaredType: DeclaredFileType,
  ): Promise<DuckDBSource> {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await DuckDBConnection.create(instance);

    const tmpDir = await mkdtemp(join(tmpdir(), "datasense-"));
    try {
      const tableNames =
        declaredType === "xlsx" || declaredType === "xls"
          ? await DuckDBSource.loadExcel(connection, buffer, tmpDir)
          : await DuckDBSource.loadCsvOrJson(connection, buffer, originalFilename, declaredType, tmpDir);

      await DuckDBSource.lockDownExternalAccess(connection);
      return new DuckDBSource(instance, connection, tableNames);
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Factory that loads several independent files as separate tables in the
   * same in-memory DuckDB instance (e.g. a set of related CSVs such as
   * customers/orders/products for the demo dataset). Each file is loaded
   * the same way as a single-file upload; table names are derived from each
   * file's name.
   */
  static async createFromFiles(
    files: Array<{ buffer: Buffer; originalFilename: string; declaredType: DeclaredFileType }>,
  ): Promise<DuckDBSource> {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await DuckDBConnection.create(instance);

    const tmpDir = await mkdtemp(join(tmpdir(), "datasense-"));
    try {
      const tableNames: string[] = [];
      for (const file of files) {
        const loaded =
          file.declaredType === "xlsx" || file.declaredType === "xls"
            ? await DuckDBSource.loadExcel(connection, file.buffer, tmpDir)
            : await DuckDBSource.loadCsvOrJson(
                connection,
                file.buffer,
                file.originalFilename,
                file.declaredType,
                tmpDir,
              );
        tableNames.push(...loaded);
      }

      await DuckDBSource.lockDownExternalAccess(connection);
      return new DuckDBSource(instance, connection, tableNames);
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Disables DuckDB's own filesystem/network access once all ingestion is
   * done, so a hallucinated or prompt-injected agent-generated SELECT can't
   * read arbitrary server files via table functions like read_csv_auto or
   * read_text (e.g. `SELECT * FROM read_csv_auto('/etc/passwd')`) — the
   * assertReadOnlySelect guard only checks statement *type*, not what a
   * SELECT's table functions can reach. Already-loaded tables stay queryable;
   * DuckDB does not allow re-enabling external access once disabled.
   */
  private static async lockDownExternalAccess(connection: DuckDBConnection): Promise<void> {
    await connection.run("SET enable_external_access=false;");
  }

  private static async loadCsvOrJson(
    connection: DuckDBConnection,
    buffer: Buffer,
    originalFilename: string,
    declaredType: "csv" | "json",
    tmpDir: string,
  ): Promise<string[]> {
    const extension = declaredType === "csv" ? "csv" : "json";
    const tmpPath = join(tmpDir, `upload.${extension}`);
    await writeFile(tmpPath, buffer);

    const tableName = sanitizeIdentifier(baseName(originalFilename)) || "data";
    const escapedPath = escapeSqlLiteral(tmpPath);
    const reader = declaredType === "csv" ? "read_csv_auto" : "read_json_auto";

    await connection.run(
      `CREATE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM ${reader}('${escapedPath}')`,
    );

    return [tableName];
  }

  private static async loadExcel(connection: DuckDBConnection, buffer: Buffer, tmpDir: string): Promise<string[]> {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const tableNames: string[] = [];
    const usedNames = new Set<string>();

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      if (rows.length === 0) {
        // Skip empty sheets rather than creating a schema-less table.
        continue;
      }

      const tableName = uniqueIdentifier(sanitizeIdentifier(sheetName) || "sheet", usedNames);
      const tmpPath = join(tmpDir, `${tableName}.json`);
      await writeFile(tmpPath, JSON.stringify(rows));

      const escapedPath = escapeSqlLiteral(tmpPath);
      await connection.run(
        `CREATE TABLE ${quoteIdentifier(tableName)} AS SELECT * FROM read_json_auto('${escapedPath}')`,
      );

      tableNames.push(tableName);
    }

    if (tableNames.length === 0) {
      throw new Error("Workbook contains no non-empty sheets to load.");
    }

    return tableNames;
  }

  async profile(): Promise<SchemaProfile> {
    this.assertOpen();
    const tables: SchemaProfile["tables"] = [];

    for (const tableName of this.tableNames) {
      const quoted = quoteIdentifier(tableName);
      const escaped = escapeSqlLiteral(tableName);

      const columnsReader = await this.connection.runAndReadAll(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = '${escaped}'
         ORDER BY ordinal_position`,
      );
      const columnRows = columnsReader.getRowObjectsJson() as Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>;

      const rowCountReader = await this.connection.runAndReadAll(`SELECT COUNT(*) AS row_count FROM ${quoted}`);
      const rowCountRows = rowCountReader.getRowObjectsJson() as Array<{ row_count: number }>;
      const rowCount = Number(rowCountRows[0]?.row_count ?? 0);

      const columns: SchemaProfile["tables"][number]["columns"] = [];
      for (const column of columnRows) {
        const quotedColumn = quoteIdentifier(column.column_name);
        let nullRate = 0;
        if (rowCount > 0) {
          const nullCountReader = await this.connection.runAndReadAll(
            `SELECT COUNT(*) - COUNT(${quotedColumn}) AS null_count FROM ${quoted}`,
          );
          const nullCountRows = nullCountReader.getRowObjectsJson() as Array<{ null_count: number }>;
          const nullCount = Number(nullCountRows[0]?.null_count ?? 0);
          nullRate = nullCount / rowCount;
        }

        columns.push({
          name: column.column_name,
          type: column.data_type,
          nullable: column.is_nullable === "YES",
          nullRate,
        });
      }

      const sampleReader = await this.connection.runAndReadAll(
        `SELECT * FROM ${quoted} LIMIT ${config.maxSampleRows}`,
      );
      const sampleRows = sampleReader.getRowObjectsJson() as Record<string, unknown>[];

      tables.push({
        name: tableName,
        columns,
        rowCount,
        sampleRows,
      });
    }

    // DuckDB tables created from an uploaded flat file (CSV/JSON/XLSX) have
    // no declared FK constraints at all - there is no catalog to query - so
    // relationships here always come from the naming-based heuristic.
    const relationships = inferRelationships(tables);

    return { tables, relationships };
  }

  async execute(query: string): Promise<QueryResult> {
    this.assertOpen();
    const reader = await this.connection.runAndReadAll(query);
    const columns = reader.columnNames();
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];

    return {
      columns,
      rows,
      rowCount: rows.length,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.connection.closeSync();
    this.instance.closeSync();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error(`DuckDBSource ${this.id} is closed`);
    }
  }
}

function baseName(filename: string): string {
  const withoutPath = filename.split(/[/\\]/).pop() ?? filename;
  const dotIndex = withoutPath.lastIndexOf(".");
  return dotIndex > 0 ? withoutPath.slice(0, dotIndex) : withoutPath;
}

function sanitizeIdentifier(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
  const normalized = /^[0-9]/.test(cleaned) ? `t_${cleaned}` : cleaned;
  return normalized.toLowerCase();
}

function uniqueIdentifier(base: string, used: Set<string>): string {
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate) || candidate === "") {
    candidate = `${base || "sheet"}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function escapeSqlLiteral(value: string): string {
  // DuckDB string literals only need single quotes doubled; backslashes are
  // not escape characters by default, so Windows paths pass through as-is.
  return value.replace(/'/g, "''");
}
