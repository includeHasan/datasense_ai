import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

// Mirrors test/conversations.test.ts: the report routes read conversations
// and messages via Mongoose, so spin up an in-memory MongoDB instance.
let mongoServer: MongoMemoryServer;

process.env.MONGOMS_VERSION ??= "4.4.29";
process.env.JWT_SECRET = "test-secret";

let app: FastifyInstance;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  const mod = await import("../src/server.js");
  app = mod.default;

  const { connectMongo } = await import("../src/db/mongo.js");
  await connectMongo();

  await app.ready();
}, 600_000);

afterAll(async () => {
  await app?.close();
  await mongoose.disconnect();
  await mongoServer?.stop();
}, 60_000);

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

async function registerUser(): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email: uniqueEmail(), password: "correct-horse-battery-staple" },
  });
  return response.json().token as string;
}

/** Parses a raw SSE response body into its named/unnamed frames. */
function parseSseFrames(body: string): { event?: string; data: unknown }[] {
  return body
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter(Boolean)
    .map((frame) => {
      let event: string | undefined;
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice("event:".length).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
      }
      return { event, data: JSON.parse(dataLines.join("\n")) };
    });
}

describe("POST /reports", () => {
  it("rejects a body with neither conversationId nor sourceId", async () => {
    const token = await registerUser();
    const response = await app.inject({
      method: "POST",
      url: "/reports",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a body with both conversationId and sourceId", async () => {
    const token = await registerUser();
    const response = await app.inject({
      method: "POST",
      url: "/reports",
      headers: { authorization: `Bearer ${token}` },
      payload: { conversationId: "x", sourceId: "y" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 404 for a conversation that does not exist", async () => {
    const token = await registerUser();
    const response = await app.inject({
      method: "POST",
      url: "/reports",
      headers: { authorization: `Bearer ${token}` },
      payload: { conversationId: new mongoose.Types.ObjectId().toString() },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 for a conversation that exists but is owned by a different user", async () => {
    const ownerToken = await registerUser();
    const createResponse = await app.inject({
      method: "POST",
      url: "/conversations",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { title: "Owner's chat" },
    });
    const conversation = createResponse.json();

    const otherToken = await registerUser();
    const response = await app.inject({
      method: "POST",
      url: "/reports",
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { conversationId: conversation.id },
    });
    expect(response.statusCode).toBe(404);
  });

  it(
    "exports an existing conversation's analysis messages to a JSON report payload",
    async () => {
      const token = await registerUser();

      const createResponse = await app.inject({
        method: "POST",
        url: "/conversations",
        headers: { authorization: `Bearer ${token}` },
        payload: { title: "Revenue chat" },
      });
      const conversation = createResponse.json();

      const { Message } = await import("../src/models/message.js");
      await Message.create({
        conversationId: conversation.id,
        role: "user",
        question: "How is revenue trending?",
      });
      await Message.create({
        conversationId: conversation.id,
        role: "assistant",
        answer: {
          narrative: "Revenue grew steadily across both regions this quarter.",
          chartSpec: {
            kind: "bar",
            title: "Revenue by region",
            xKey: "region",
            series: [{ key: "revenue", label: "Revenue" }],
            data: [
              { region: "East", revenue: 100 },
              { region: "West", revenue: 200 },
            ],
          },
          sql: "SELECT region, SUM(revenue) AS revenue FROM sales GROUP BY region",
          sampleRows: [
            { region: "East", revenue: 100 },
            { region: "West", revenue: 200 },
          ],
          caveats: [],
          answerType: "analysis",
          suggestedFollowups: [],
        },
      });

      const reportResponse = await app.inject({
        method: "POST",
        url: "/reports",
        headers: { authorization: `Bearer ${token}` },
        payload: { conversationId: conversation.id },
      });
      expect(reportResponse.statusCode).toBe(200);

      const frames = parseSseFrames(reportResponse.payload);
      const finalFrame = frames.find((f) => f.event === "final");
      expect(finalFrame).toBeDefined();

      const report = finalFrame!.data as {
        title: string;
        sections: {
          title: string;
          narrative: string;
          chartSpec: unknown;
          sampleRows: Record<string, unknown>[];
        }[];
      };

      expect(report.title).toBe("Revenue chat");
      expect(Array.isArray(report.sections)).toBe(true);
      expect(report.sections).toHaveLength(1);

      const [section] = report.sections;
      expect(section.title).toBe("How is revenue trending?");
      expect(section.narrative).toContain("Revenue grew steadily");
      expect(section.chartSpec).toMatchObject({ kind: "bar", title: "Revenue by region" });
      expect(section.sampleRows).toEqual([
        { region: "East", revenue: 100 },
        { region: "West", revenue: 200 },
      ]);
    },
    60_000,
  );
});
