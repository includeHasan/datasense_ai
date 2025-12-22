import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

// Exercises the POST /sources/db security gating end-to-end (mirrors
// test/dashboards.test.ts's setup): sqlite file-path connections are
// disabled by default, and Postgres/MySQL connection strings pointing at
// internal/private hosts are rejected before any connection is attempted.
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

describe("POST /sources/db security gating", () => {
  it("rejects sqlite file-path connections by default", async () => {
    const token = await registerUser();

    const response = await app.inject({
      method: "POST",
      url: "/sources/db",
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: "sqlite", connectionString: "/var/lib/data/other-tenant.sqlite" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/SQLite file-path connections are disabled/i);
  });

  it("rejects a postgres connection string pointing at loopback", async () => {
    const token = await registerUser();

    const response = await app.inject({
      method: "POST",
      url: "/sources/db",
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: "postgres", connectionString: "postgres://user:pass@127.0.0.1:5432/db" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/internal\/private host/i);
  });

  it("rejects a mysql connection string pointing at the cloud metadata endpoint", async () => {
    const token = await registerUser();

    const response = await app.inject({
      method: "POST",
      url: "/sources/db",
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: "mysql", connectionString: "mysql://root@169.254.169.254:3306/db" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/internal\/private host/i);
  });

  it("rejects a postgres connection string pointing at an RFC1918 private address", async () => {
    const token = await registerUser();

    const response = await app.inject({
      method: "POST",
      url: "/sources/db",
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: "postgres", connectionString: "postgres://user:pass@10.0.0.5:5432/db" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/internal\/private host/i);
  });

  it("rejects a mongodb connection string pointing at loopback", async () => {
    const token = await registerUser();

    const response = await app.inject({
      method: "POST",
      url: "/sources/db",
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: "mongodb", connectionString: "mongodb://127.0.0.1:27017/db" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/internal\/private host/i);
  });

  it("rejects a multi-host mongodb replica-set connection string when any listed host is private", async () => {
    const token = await registerUser();

    const response = await app.inject({
      method: "POST",
      url: "/sources/db",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        kind: "mongodb",
        connectionString: "mongodb://8.8.8.8:27017,10.0.0.5:27017/db",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/internal\/private host/i);
  });
});
