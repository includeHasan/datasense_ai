export type Dialect = "sql" | "mongodb";

export type SourceKind = "file" | "postgres" | "mysql" | "sqlite" | "mongodb";

/** How a relationship between two tables/columns was discovered. */
export type RelationshipConfidence = "declared" | "inferred";

/**
 * A foreign-key-like relationship between two tables: fromTable.fromColumn
 * references toTable.toColumn. "declared" relationships come from an actual
 * schema-level FK constraint queried from the source (Postgres/MySQL/SQLite);
 * "inferred" relationships are heuristically guessed from naming conventions
 * (used for sources with no queryable FK metadata, e.g. DuckDB tables created
 * from an uploaded CSV/JSON/XLSX file with no constraints).
 */
export interface SchemaRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  confidence: RelationshipConfidence;
}

export interface SchemaProfile {
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string; nullable: boolean; nullRate?: number }>;
    rowCount: number;
    sampleRows: Record<string, unknown>[];
  }>;
  relationships?: SchemaRelationship[];
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface DataSource {
  id: string;
  kind: SourceKind;
  dialect: Dialect;
  profile(): Promise<SchemaProfile>;
  execute(query: string): Promise<QueryResult>;
  close(): Promise<void>;
}
