import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

// Spin up an in-memory MongoDB and point config.mongoDbUri at it before
// anything under test is imported (mirrors test/conversations.test.ts).
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

describe("account LLM credentials + quota", () => {
  it("returns free-tier defaults for a new user", async () => {
    const token = await registerUser();

    const response = await app.inject({
      method: "GET",
      url: "/account/llm",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.hasOwnKey).toBe(false);
    expect(body.baseUrl).toBeNull();
    expect(body.model).toBeNull();
    expect(body.freeQueriesLimit).toBe(5);
    expect(body.freeQueriesUsed).toBe(0);
    expect(body.freeQueriesRemaining).toBe(5);
    expect(body.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("sets a key via PUT without ever echoing the raw key", async () => {
    const token = await registerUser();
    const rawKey = "sk-my-secret-byo-key-abcdef123456";

    const putResponse = await app.inject({
      method: "PUT",
      url: "/account/llm",
      headers: { authorization: `Bearer ${token}` },
      payload: { apiKey: rawKey, baseUrl: "https://api.minimax.io/v1", model: "abab6.5s-chat" },
    });
    expect(putResponse.statusCode).toBe(200);

    // The raw key must never appear anywhere in the serialized response.
    expect(putResponse.body).not.toContain(rawKey);

    const body = putResponse.json();
    expect(body.hasOwnKey).toBe(true);
    expect(body.baseUrl).toBe("https://api.minimax.io/v1");
    expect(body.model).toBe("abab6.5s-chat");
    expect(body).not.toHaveProperty("apiKey");

    // GET reflects the same, still without the key.
    const getResponse = await app.inject({
      method: "GET",
      url: "/account/llm",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getResponse.body).not.toContain(rawKey);
    expect(getResponse.json().hasOwnKey).toBe(true);
  });

  it("rejects a bad body with 400", async () => {
    const token = await registerUser();

    const response = await app.inject({
      method: "PUT",
      url: "/account/llm",
      headers: { authorization: `Bearer ${token}` },
      payload: { apiKey: "", model: "gpt-4o-mini" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a non-URL baseUrl with 400", async () => {
    const token = await registerUser();

    const response = await app.inject({
      method: "PUT",
      url: "/account/llm",
      headers: { authorization: `Bearer ${token}` },
      payload: { apiKey: "sk-x", baseUrl: "not-a-url", model: "gpt-4o-mini" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("reverts to the free tier via DELETE", async () => {
    const token = await registerUser();

    await app.inject({
      method: "PUT",
      url: "/account/llm",
      headers: { authorization: `Bearer ${token}` },
      payload: { apiKey: "sk-x", model: "gpt-4o-mini" },
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/account/llm",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteResponse.statusCode).toBe(200);
    const body = deleteResponse.json();
    expect(body.hasOwnKey).toBe(false);
    expect(body.baseUrl).toBeNull();
    expect(body.model).toBeNull();
  });

  it("requires authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/account/llm" });
    expect(response.statusCode).toBe(401);
  });
});

describe("quota helpers (checkQuota / consumeQuota)", () => {
  it("resets on a new month, exhausts after the limit, and ignores own-key users", async () => {
    const { checkQuota, consumeQuota, currentMonth } = await import("../src/auth/llm-access.js");

    // Fresh free-tier user, no prior usage.
    const user: {
      quotaMonth?: string;
      quotaCount?: number;
      llmApiKeyEnc?: string;
      save: () => Promise<void>;
    } = { save: async () => {} };

    expect(checkQuota(user)).toMatchObject({ allowed: true, remaining: 5, limit: 5 });

    // Stored usage from a previous month is treated as a reset.
    user.quotaMonth = "2000-01";
    user.quotaCount = 99;
    expect(checkQuota(user)).toMatchObject({ allowed: true, remaining: 5 });

    // Consume all 5 in the current month.
    for (let i = 0; i < 5; i += 1) {
      await consumeQuota(user);
    }
    expect(user.quotaMonth).toBe(currentMonth());
    expect(user.quotaCount).toBe(5);
    expect(checkQuota(user)).toMatchObject({ allowed: false, remaining: 0 });

    // A user with their own key is always allowed and never consumes.
    user.llmApiKeyEnc = "enc-placeholder";
    const beforeCount = user.quotaCount;
    expect(checkQuota(user).allowed).toBe(true);
    await consumeQuota(user);
    expect(user.quotaCount).toBe(beforeCount);
  });
});
