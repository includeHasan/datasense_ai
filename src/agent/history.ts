import type { FinalAnswer } from "../schemas/answer.js";
import type { MessageShape } from "../models/message.js";

const MAX_SAMPLE_ROWS_IN_HISTORY = 3;

/**
 * Minimal shape history-building needs from a persisted Message - accepts
 * either a Mongoose MessageDocument or a plain MessageShape so callers don't
 * have to convert documents before calling buildHistory.
 */
export interface HistoryMessage {
  role: MessageShape["role"];
  question?: string | null;
  answer?: unknown;
}

function formatSampleRows(rows: Record<string, unknown>[] | undefined): string {
  if (!rows || rows.length === 0) return "";
  return rows
    .slice(0, MAX_SAMPLE_ROWS_IN_HISTORY)
    .map((row) => `    ${JSON.stringify(row)}`)
    .join("\n");
}

function isFinalAnswer(value: unknown): value is FinalAnswer {
  return Boolean(value) && typeof value === "object" && "narrative" in (value as object);
}

/**
 * Builds a compact, token-capped textual summary of the most recent turns
 * in a conversation, to give the agent enough context to resolve follow-up
 * references ("tell me about two of those") against the immediately
 * preceding result. Kept as plain text (not structured JSON) so it can be
 * dropped straight into prompts.
 *
 * For prior analysis turns: question + sql + a few sample rows + narrative.
 * For prior conversational turns: question + narrative only.
 *
 * `messages` is expected in chronological order (oldest first), as stored
 * (one "user" doc followed by one "assistant" doc per turn). `maxTurns`
 * caps how many user/assistant pairs are included, keeping only the most
 * recent ones.
 */
export function buildHistory(messages: HistoryMessage[], maxTurns = 5): string {
  // Pair up consecutive user -> assistant messages into turns.
  const turns: { question: string; answer: FinalAnswer | undefined }[] = [];
  let pendingQuestion: string | undefined;

  for (const message of messages) {
    if (message.role === "user") {
      pendingQuestion = message.question ?? "";
    } else if (message.role === "assistant") {
      turns.push({
        question: pendingQuestion ?? "",
        answer: isFinalAnswer(message.answer) ? message.answer : undefined,
      });
      pendingQuestion = undefined;
    }
  }

  const recentTurns = turns.slice(-maxTurns);
  if (recentTurns.length === 0) return "";

  const rendered = recentTurns.map((turn, index) => {
    const lines = [`Turn ${index + 1}:`, `Q: ${turn.question}`];
    const answer = turn.answer;
    if (answer) {
      if (answer.answerType === "analysis" && answer.sql) {
        lines.push(`  SQL: ${answer.sql}`);
        const sampleRows = formatSampleRows(answer.sampleRows);
        if (sampleRows) {
          lines.push("  Sample rows:", sampleRows);
        }
      }
      lines.push(`  A: ${answer.narrative}`);
    }
    return lines.join("\n");
  });

  return rendered.join("\n\n");
}

export default buildHistory;
