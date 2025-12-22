import { z } from "zod";
import { buildGraph } from "../agent/graph.js";
import { runAgentStreaming } from "../agent/run.js";
import type { ActivityEvent } from "../agent/events.js";
import { getChatModel, type LlmOverrides } from "../agent/llm.js";
import { buildReportOutlinePrompt } from "../agent/prompts.js";
import { Conversation } from "../models/conversation.js";
import { Message } from "../models/message.js";
import type { FinalAnswer } from "../schemas/answer.js";
import type { ChartSpec } from "../schemas/chart-spec.js";
import type { DataSource, SchemaProfile } from "../sources/types.js";

export interface ReportPreferences {
  /** Free-text description of what the user wants the report to cover. */
  freeText?: string;
  /** Explicit section topics the user picked (e.g. via checkboxes). */
  sections?: string[];
}

/**
 * Default section topics offered to the user (and used to seed the outline
 * prompt) when no preferences are supplied. Kept in sync with the checkbox
 * options in the frontend's report-dialog.tsx.
 */
export const DEFAULT_REPORT_SECTION_TOPICS = [
  "Overview & row counts",
  "Top values in key categorical columns",
  "Trends over time",
  "Key KPIs",
];

const outlineSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string(),
        question: z.string(),
      }),
    )
    .min(1)
    .max(8),
});

type OutlineSection = z.infer<typeof outlineSchema>["sections"][number];

/**
 * Asks the LLM to draft an ordered outline of report sections (each a
 * self-contained plain-English question) grounded in the schema and any
 * user preferences. Falls back to nothing extra - if preferences is empty,
 * the prompt itself asks for sensible defaults (overview, top categorical
 * values, trends over date columns, key KPIs).
 */
async function draftOutline(
  profile: SchemaProfile,
  preferences: ReportPreferences,
  llm?: LlmOverrides,
): Promise<OutlineSection[]> {
  const model = getChatModel(llm).withStructuredOutput(outlineSchema);
  const prompt = buildReportOutlinePrompt(profile, preferences);
  const result = await model.invoke(prompt);
  return result.sections;
}

/**
 * One section of a generated report: a heading, a plain-text narrative, an
 * optional chart spec (rendered client-side by the frontend's existing
 * ChartRenderer - see frontend/src/lib/build-pdf.ts), and its sample rows.
 * This is deliberately a plain JSON-serializable shape (no HTML, no
 * pre-rendered chart image) since PDF assembly now happens entirely in the
 * browser.
 */
export interface ReportSection {
  title: string;
  narrative: string;
  chartSpec: ChartSpec | null;
  sampleRows: Record<string, unknown>[];
}

/** A fully-built report ready for the frontend to turn into a PDF. */
export interface GeneratedReport {
  title: string;
  sections: ReportSection[];
}

/**
 * Folds any caveats onto the end of the narrative (as "Note: ..." lines)
 * rather than dropping them, since the JSON report shape has no separate
 * slot for caveats.
 */
function narrativeWithCaveats(narrative: string, caveats?: string[]): string {
  if (!caveats || caveats.length === 0) return narrative;
  const notes = caveats.map((c) => `Note: ${c}`).join("\n");
  return `${narrative}\n\n${notes}`;
}

/**
 * Converts a FinalAnswer (from either a persisted conversation Message or a
 * fresh agent run) plus a section title into a render-ready ReportSection.
 */
function finalAnswerToSection(title: string, answer: FinalAnswer): ReportSection {
  return {
    title,
    narrative: narrativeWithCaveats(answer.narrative, answer.caveats),
    chartSpec: answer.chartSpec,
    sampleRows: answer.sampleRows,
  };
}

/**
 * Builds a report from an existing conversation: every analysis-type
 * assistant Message becomes one section (its narrative, its chartSpec, and
 * its sample rows). Ownership of the conversation is checked the same way as
 * GET /conversations/:id (returns null for both "not found" and "not owned",
 * so callers can 404 uniformly without leaking existence of other users'
 * conversations).
 */
export async function buildReportFromConversation(
  conversationId: string,
  ownerId: string,
): Promise<GeneratedReport | null> {
  const conversation = await Conversation.findById(conversationId).catch(() => null);
  if (!conversation || conversation.userId !== ownerId) return null;

  const messages = await Message.find({ conversationId: String(conversation._id) })
    .sort({ createdAt: 1 })
    .lean();

  const sections: ReportSection[] = [];
  let pendingQuestion: string | undefined;

  for (const message of messages) {
    if (message.role === "user") {
      pendingQuestion = message.question;
      continue;
    }
    if (message.role !== "assistant" || !message.answer) continue;

    const answer = message.answer as FinalAnswer;
    if (answer.answerType === "analysis") {
      sections.push(finalAnswerToSection(pendingQuestion?.trim() || "Analysis", answer));
    }
    pendingQuestion = undefined;
  }

  const title = conversation.title || "Conversation report";
  return { title, sections };
}

/**
 * Builds a fresh report generated from a data source: an LLM first drafts an
 * outline of section questions grounded in the schema (respecting
 * free-text/section-topic preferences, or sensible defaults if none are
 * given), then each section's question is answered by running the existing
 * agent graph via `runAgentStreaming` so every node's activity is forwarded
 * through `onEvent` - giving the caller one continuous live trace across the
 * whole report, not just per-section silence.
 *
 * Takes the already-resolved `source`/`profile` (rather than a raw sourceId)
 * since the calling route already does the ownership-checked
 * getSourceForOwner/getProfileForOwner lookup (see routes/reports.ts),
 * mirroring how routes/ask.ts resolves these before calling into the graph.
 */
export async function buildGeneratedReport(
  source: DataSource,
  profile: SchemaProfile,
  preferences: ReportPreferences,
  onEvent: (event: ActivityEvent) => void,
  llm?: LlmOverrides,
): Promise<GeneratedReport> {
  onEvent({ phase: "outline", label: "Drafting report outline", status: "running" });
  const outline = await draftOutline(profile, preferences, llm);
  onEvent({
    phase: "outline",
    label: "Drafting report outline",
    detail: `${outline.length} section${outline.length === 1 ? "" : "s"} planned`,
    status: "done",
  });

  const graph = buildGraph(source);
  const sections: ReportSection[] = [];

  for (const [index, item] of outline.entries()) {
    const sectionLabel = `Section ${index + 1} of ${outline.length}: ${item.title}`;
    onEvent({ phase: "section", label: sectionLabel, status: "running" });

    const finalAnswer = await runAgentStreaming(
      graph,
      {
        question: item.question,
        profile,
        history: "",
        route: "",
        plan: "",
        sql: "",
        queryResult: null,
        error: null,
        attempts: 0,
        narrative: "",
        chartSpec: null,
        caveats: [],
        suggestedFollowups: [],
        llm: llm ?? {},
      },
      onEvent,
    );

    sections.push(finalAnswerToSection(item.title, finalAnswer ?? emptyAnswer()));
    onEvent({ phase: "section", label: sectionLabel, status: "done" });
  }

  return { title: "Generated report", sections };
}

function emptyAnswer(): FinalAnswer {
  return {
    narrative: "No answer was produced for this section.",
    chartSpec: null,
    sql: "",
    sampleRows: [],
    caveats: [],
    answerType: "conversation",
    suggestedFollowups: [],
  };
}
