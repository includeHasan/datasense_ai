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

export type ChartOrientation = "vertical" | "horizontal";

export interface BarChartSpec {
  kind: "bar";
  title: string;
  xKey: string;
  series: ChartSeries[];
  data: Record<string, unknown>[];
  stacked?: boolean | null;
  orientation?: ChartOrientation | null;
}

export interface LineChartSpec {
  kind: "line";
  title: string;
  xKey: string;
  series: ChartSeries[];
  data: Record<string, unknown>[];
  stacked?: boolean | null;
  orientation?: ChartOrientation | null;
}

export interface AreaChartSpec {
  kind: "area";
  title: string;
  xKey: string;
  series: ChartSeries[];
  data: Record<string, unknown>[];
  stacked?: boolean | null;
  orientation?: ChartOrientation | null;
}

export interface PieChartSpec {
  kind: "pie";
  title: string;
  categoryKey: string;
  valueKey: string;
  data: Record<string, unknown>[];
  donut?: boolean | null;
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

export interface ScatterChartSpec {
  kind: "scatter";
  title: string;
  xKey: string;
  yKey: string;
  seriesKey?: string | null;
  data: Record<string, unknown>[];
}

export interface ComboChartSpec {
  kind: "combo";
  title: string;
  xKey: string;
  barSeries: ChartSeries[];
  lineSeries: ChartSeries[];
  data: Record<string, unknown>[];
}

export interface FunnelChartSpec {
  kind: "funnel";
  title: string;
  stageKey: string;
  valueKey: string;
  data: Record<string, unknown>[];
}

export interface RadarIndicator {
  name: string;
  max: number;
}

export interface RadarSeries {
  name: string;
  values: number[];
}

export interface RadarChartSpec {
  kind: "radar";
  title: string;
  indicators: RadarIndicator[];
  series: RadarSeries[];
}

export interface GaugeChartSpec {
  kind: "gauge";
  title: string;
  label: string;
  value: number;
  max: number;
}

export type ChartSpec =
  | BarChartSpec
  | LineChartSpec
  | AreaChartSpec
  | PieChartSpec
  | TableChartSpec
  | KpiChartSpec
  | ScatterChartSpec
  | ComboChartSpec
  | FunnelChartSpec
  | RadarChartSpec
  | GaugeChartSpec;

export type AnswerType = "analysis" | "conversation";

export interface FinalAnswer {
  narrative: string;
  chartSpec: ChartSpec | null;
  sql: string;
  sampleRows: Record<string, unknown>[];
  caveats?: string[];
  answerType: AnswerType;
  suggestedFollowups?: string[];
}

export interface AuthUser {
  id: string;
  email: string;
}

/** Mirrors the backend's src/agent/events.ts ActivityEvent shape. */
export type AgentEventStatus = "running" | "done";

export interface AgentEvent {
  phase: string;
  label: string;
  detail?: string;
  status: AgentEventStatus;
}

export interface ChatTurn {
  question: string;
  answer: FinalAnswer;
  /** Live activity trace captured while this turn's answer was streaming. */
  trace?: AgentEvent[];
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  question?: string;
  answer?: FinalAnswer;
  trace?: AgentEvent[];
  createdAt: string;
}

export interface ConversationDetail extends Conversation {
  sourceId?: string;
  createdAt: string;
  messages: ConversationMessage[];
}

export interface AskResponse extends FinalAnswer {
  conversationId: string;
}

// --- Report generation ---

/**
 * Default section topics offered as checkboxes when generating a fresh
 * report. Mirrors backend/src/reports/builder.ts's
 * DEFAULT_REPORT_SECTION_TOPICS - duplicated here (rather than fetched) since
 * it's a small, rarely-changing static list, not worth a network round trip.
 */
export const DEFAULT_REPORT_SECTION_TOPICS = [
  "Overview & row counts",
  "Top values in key categorical columns",
  "Trends over time",
  "Key KPIs",
];

export interface ReportPreferences {
  freeText?: string;
  sections?: string[];
}

export type GenerateReportRequest =
  | { conversationId: string }
  | { sourceId: string; preferences?: ReportPreferences };

/**
 * One section of a generated report: a heading, a plain-text narrative
 * (caveats already folded in - see backend's src/reports/builder.ts), an
 * optional chart spec, and its sample rows. Mirrors the backend's
 * ReportSection shape exactly, since this is now rendered into a PDF
 * entirely client-side (see lib/build-pdf.ts) rather than via a
 * server-rendered PDF download.
 */
export interface ReportSection {
  title: string;
  narrative: string;
  chartSpec: ChartSpec | null;
  sampleRows: Record<string, unknown>[];
}

/** The terminal SSE payload of POST /reports: the full report to render. */
export interface GenerateReportResponse {
  title: string;
  sections: ReportSection[];
}

// --- Dashboard (pinned answers) ---

export interface DashboardItem {
  id: string;
  chartSpec?: ChartSpec | null;
  narrative?: string;
  sourceId?: string;
  question?: string;
  pinnedAt: string;
}

export interface Dashboard {
  id: string;
  userId: string;
  title: string;
  items: DashboardItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PinToDashboardRequest {
  chartSpec?: ChartSpec | null;
  narrative?: string;
  sourceId?: string;
  question?: string;
}
