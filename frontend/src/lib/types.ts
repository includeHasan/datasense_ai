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
  normalized?: boolean | null;
}

export interface LineChartSpec {
  kind: "line";
  title: string;
  xKey: string;
  series: ChartSeries[];
  data: Record<string, unknown>[];
  stacked?: boolean | null;
  orientation?: ChartOrientation | null;
  normalized?: boolean | null;
}

export interface AreaChartSpec {
  kind: "area";
  title: string;
  xKey: string;
  series: ChartSeries[];
  data: Record<string, unknown>[];
  stacked?: boolean | null;
  orientation?: ChartOrientation | null;
  normalized?: boolean | null;
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
  target?: number | null;
  trend?: number[] | null;
}

export interface ScatterChartSpec {
  kind: "scatter";
  title: string;
  xKey: string;
  yKey: string;
  seriesKey?: string | null;
  sizeKey?: string | null;
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

export interface HeatmapChartSpec {
  kind: "heatmap";
  title: string;
  xKey: string;
  yKey: string;
  valueKey: string;
  data: Record<string, unknown>[];
}

export interface BoxplotChartSpec {
  kind: "boxplot";
  title: string;
  categoryKey: string;
  minKey: string;
  q1Key: string;
  medianKey: string;
  q3Key: string;
  maxKey: string;
  data: Record<string, unknown>[];
}

export interface HistogramChartSpec {
  kind: "histogram";
  title: string;
  binKey: string;
  countKey: string;
  data: Record<string, unknown>[];
}

export interface WaterfallChartSpec {
  kind: "waterfall";
  title: string;
  categoryKey: string;
  valueKey: string;
  totalKey?: string | null;
  data: Record<string, unknown>[];
}

export interface HierarchyNode {
  path: string[];
  value: number;
}

export interface TreemapChartSpec {
  kind: "treemap";
  title: string;
  data: HierarchyNode[];
}

export interface SunburstChartSpec {
  kind: "sunburst";
  title: string;
  data: HierarchyNode[];
}

export interface SankeyNode {
  name: string;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyChartSpec {
  kind: "sankey";
  title: string;
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface CalendarCell {
  date: string;
  value: number;
}

export interface CalendarChartSpec {
  kind: "calendar";
  title: string;
  data: CalendarCell[];
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
  | GaugeChartSpec
  | HeatmapChartSpec
  | BoxplotChartSpec
  | HistogramChartSpec
  | WaterfallChartSpec
  | TreemapChartSpec
  | SunburstChartSpec
  | SankeyChartSpec
  | CalendarChartSpec;

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

// --- LLM credentials + freemium quota (GET/PUT/DELETE /account/llm) ---

/**
 * The user's LLM-access status. Mirrors the backend's /account/llm response.
 * NB: the stored API key is never returned - only `hasOwnKey` reveals whether
 * one is set.
 */
export interface LlmAccount {
  hasOwnKey: boolean;
  baseUrl: string | null;
  model: string | null;
  freeQueriesLimit: number;
  freeQueriesUsed: number;
  freeQueriesRemaining: number;
  month: string;
}

/** Body for PUT /account/llm (set your own OpenAI-compatible credentials). */
export interface SaveLlmRequest {
  apiKey: string;
  baseUrl?: string;
  model: string;
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

/**
 * The terminal SSE payload of POST /reports: the full report to render, plus
 * the `reportId` of the copy the backend persisted (so the report survives a
 * refresh and shows up under /reports).
 */
export interface GenerateReportResponse {
  title: string;
  sections: ReportSection[];
  reportId: string;
}

/** Lightweight record for the saved-reports list (GET /reports). */
export interface ReportSummary {
  id: string;
  title: string;
  createdAt: string;
}

/** A single persisted report with its full sections (GET /reports/:id). */
export interface SavedReport {
  id: string;
  title: string;
  sections: ReportSection[];
  sourceId?: string;
  conversationId?: string;
  createdAt: string;
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
