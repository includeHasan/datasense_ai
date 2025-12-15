import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

// The conversation/message stores persist via Mongoose, so spin up an
// in-memory MongoDB instance and point config.mongoDbUri at it before
// anything under test is imported, keeping this suite isolated from any
// real database (mirrors test/auth.test.ts).
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

describe("conversation routes", () => {
  it("creates, lists, and gets a conversation", async () => {
    const token = await registerUser();

    const createResponse = await app.inject({
      method: "POST",
      url: "/conversations",
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "My first chat" },
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json();
    expect(created.id).toBeTypeOf("string");
    expect(created.title).toBe("My first chat");

    const listResponse = await app.inject({
      method: "GET",
      url: "/conversations",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listResponse.statusCode).toBe(200);
    const list = listResponse.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((c: { id: string }) => c.id === created.id)).toBe(true);

    const getResponse = await app.inject({
      method: "GET",
      url: `/conversations/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getResponse.statusCode).toBe(200);
    const fetched = getResponse.json();
    expect(fetched.id).toBe(created.id);
    expect(fetched.messages).toEqual([]);
  });

  it("deletes a conversation the user owns", async () => {
    const token = await registerUser();

    const createResponse = await app.inject({
      method: "POST",
      url: "/conversations",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    const created = createResponse.json();

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/conversations/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteResponse.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: "GET",
      url: `/conversations/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getResponse.statusCode).toBe(404);
  });

  it("does not let user A access, or delete, a conversation created by user B (404)", async () => {
    const tokenA = await registerUser();
    const tokenB = await registerUser();

    const createResponse = await app.inject({
      method: "POST",
      url: "/conversations",
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {},
    });
    const created = createResponse.json();

    const getResponse = await app.inject({
      method: "GET",
      url: `/conversations/${created.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(getResponse.statusCode).toBe(404);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/conversations/${created.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(deleteResponse.statusCode).toBe(404);
  });

  it("returns 404 for a non-existent conversation id", async () => {
    const token = await registerUser();

    const response = await app.inject({
      method: "GET",
      url: `/conversations/${new mongoose.Types.ObjectId().toString()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects requests with no Authorization header with 401", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/conversations",
    });
    expect(response.statusCode).toBe(401);
  });
});
