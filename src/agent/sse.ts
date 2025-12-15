import type { FastifyReply } from "fastify";
import config from "../config.js";

/**
 * Minimal Server-Sent Events writer around a hijacked Fastify reply's raw
 * Node response. Callers are responsible for calling `reply.hijack()` before
 * using this (so Fastify does not also try to send its own reply) and for
 * ending the stream when done.
 *
 * `reply.hijack()` takes the response out of Fastify's normal send pipeline,
 * which means the @fastify/cors plugin's onSend hook never runs for this
 * response — so the CORS header has to be written by hand here, or browsers
 * reject the streamed response as a cross-origin failure.
 */
export function startSse(reply: FastifyReply): {
  send: (data: unknown, event?: string) => void;
  end: () => void;
} {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": config.frontendOrigin,
    Vary: "Origin",
  });

  const send = (data: unknown, event?: string): void => {
    if (event) {
      reply.raw.write(`event: ${event}\n`);
    }
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const end = (): void => {
    reply.raw.end();
  };

  return { send, end };
}
