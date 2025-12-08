export type Dialect = "sql" | "mongodb";

export type SourceKind = "file" | "postgres" | "mysql" | "sqlite" | "mongodb";

export interface SchemaProfile {
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string; nullable: boolean; nullRate?: number }>;
    rowCount: number;
    sampleRows: Record<string, unknown>[];
  }>;
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
