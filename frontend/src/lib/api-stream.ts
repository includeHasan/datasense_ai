import { ApiError } from "./api";
import type { AgentEvent } from "./types";

/**
 * Streams a Server-Sent Events response from a POST endpoint.
 *
 * Deliberately uses `fetch` + a hand-rolled SSE frame parser rather than the
 * browser's `EventSource`, since `EventSource` can only issue GET requests
 * and cannot send an `Authorization` header or a JSON body - both of which
 * this app's authenticated `/ask` endpoint needs.
 *
 * The stream is expected to emit zero or more unnamed `data:` frames (each a
 * JSON-encoded {@link AgentEvent}, forwarded to `onEvent`), followed by
 * exactly one terminal frame: either `event: final` (JSON-encoded answer,
 * resolves the promise) or `event: error` (JSON-encoded `{ error, detail? }`,
 * rejects the promise with an {@link ApiError}).
 */
export async function askStream<TFinal>(
  url: string,
  body: unknown,
  options: { token?: string },
  onEvent: (event: AgentEvent) => void,
): Promise<TFinal> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    let message = `Request failed with status ${response.status}`;
    try {
      const errorBody = (await response.json()) as { error?: string; detail?: string };
      if (typeof errorBody.error === "string") {
        message = errorBody.detail ? `${errorBody.error}: ${errorBody.detail}` : errorBody.error;
      }
    } catch {
      // Non-JSON error body; fall back to the generic message above.
    }
    throw new ApiError(message, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  /** Parses one SSE frame (a block of lines separated by \n) into {event, data}. */
  function parseFrame(frame: string): { event?: string; data: string } {
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }
    return { event, data: dataLines.join("\n") };
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      if (!frame.trim()) continue;

      const { event, data } = parseFrame(frame);
      if (!data) continue;
      const parsed: unknown = JSON.parse(data);

      if (event === "final") {
        return parsed as TFinal;
      }
      if (event === "error") {
        const errorBody = parsed as { error?: string; detail?: string };
        const message =
          typeof errorBody.error === "string"
            ? errorBody.detail
              ? `${errorBody.error}: ${errorBody.detail}`
              : errorBody.error
            : "Something went wrong while answering your question.";
        throw new ApiError(message, 500);
      }

      onEvent(parsed as AgentEvent);
    }
  }

  throw new ApiError("The response stream ended before an answer was received.", 500);
}
