// Types mirroring the backend's exact response shapes.

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  nullRate?: number;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
  rowCount: number;
  sampleRows: Record<string, unknown>[];
}

export interface SchemaProfile {
  tables: SchemaTable[];
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface ChartSeries {
  key: string;
  label: string;
}

export interface BarChartSpec {
  kind: "bar";
  title: string;
  xKey: string;
  series: ChartSeries[];
  data: Record<string, unknown>[];
}

export interface LineChartSpec {
  kind: "line";
  title: string;
  xKey: string;
  series: ChartSeries[];
  data: Record<string, unknown>[];
}

export interface PieChartSpec {
  kind: "pie";
  title: string;
  categoryKey: string;
  valueKey: string;
  data: Record<string, unknown>[];
}

export interface TableChartSpec {
  kind: "table";
  title: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface KpiChartSpec {
  kind: "kpi";
  title: string;
  label: string;
  value: number | string;
  delta?: number | null;
}

export type ChartSpec =
  | BarChartSpec
  | LineChartSpec
  | PieChartSpec
  | TableChartSpec
  | KpiChartSpec;

export interface FinalAnswer {
  narrative: string;
  chartSpec: ChartSpec;
  sql: string;
  sampleRows: Record<string, unknown>[];
  caveats?: string[];
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface ChatTurn {
  question: string;
  answer: FinalAnswer;
}
