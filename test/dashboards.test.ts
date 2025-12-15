import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

// The dashboard store persists via Mongoose, so spin up an in-memory
// MongoDB instance and point config.mongoDbUri at it before anything under
// test is imported, keeping this suite isolated from any real database
// (mirrors test/conversations.test.ts).
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

describe("dashboard routes", () => {
  it("lazily creates and returns the caller's single dashboard", async () => {
    const token = await registerUser();

    const first = await app.inject({
      method: "GET",
      url: "/dashboards",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.title).toBe("My Dashboard");
    expect(firstBody.items).toEqual([]);

    const second = await app.inject({
      method: "GET",
      url: "/dashboards",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(firstBody.id);
  });

  it("pins and unpins an item", async () => {
    const token = await registerUser();

    const dashboardResponse = await app.inject({
      method: "GET",
      url: "/dashboards",
      headers: { authorization: `Bearer ${token}` },
    });
    const dashboard = dashboardResponse.json();

    const pinResponse = await app.inject({
      method: "POST",
      url: `/dashboards/${dashboard.id}/pins`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        chartSpec: { kind: "bar", data: [] },
        narrative: "Sales grew 10%",
        sourceId: "source-1",
        question: "How did sales grow?",
      },
    });
    expect(pinResponse.statusCode).toBe(200);
    const pinned = pinResponse.json();
    expect(pinned.items).toHaveLength(1);
    expect(pinned.items[0].narrative).toBe("Sales grew 10%");
    const pinId = pinned.items[0].id;

    const unpinResponse = await app.inject({
      method: "DELETE",
      url: `/dashboards/${dashboard.id}/pins/${pinId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(unpinResponse.statusCode).toBe(200);
    expect(unpinResponse.json().items).toEqual([]);
  });

  it("404s when pinning to or unpinning from another user's dashboard", async () => {
    const tokenA = await registerUser();
    const tokenB = await registerUser();

    const dashboardA = (
      await app.inject({
        method: "GET",
        url: "/dashboards",
        headers: { authorization: `Bearer ${tokenA}` },
      })
    ).json();

    const pinAsB = await app.inject({
      method: "POST",
      url: `/dashboards/${dashboardA.id}/pins`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { narrative: "should not work" },
    });
    expect(pinAsB.statusCode).toBe(404);

    const unpinAsB = await app.inject({
      method: "DELETE",
      url: `/dashboards/${dashboardA.id}/pins/${new mongoose.Types.ObjectId().toString()}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(unpinAsB.statusCode).toBe(404);
  });

  it("rejects requests with no Authorization header with 401", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/dashboards",
    });
    expect(response.statusCode).toBe(401);
  });
});
