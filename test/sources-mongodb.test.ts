import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

/**
 * Exercises POST /sources/db end-to-end for kind="mongodb" against a REAL
 * (ephemeral, in-memory) MongoDB instance, over the real Fastify HTTP layer -
 * complementing test/mongo-source.test.ts (which calls MongoSource directly)
 * and test/sources-db-security.test.ts (which only covers the
 * rejected/blocked paths for this route). This is the "happy path": does the
 * production route handler itself actually connect, profile, and return a
 * usable sourceId when given a valid, allowed mongodb connection string.
 */
process.env.MONGOMS_VERSION ??= "4.4.29";
process.env.JWT_SECRET = "test-secret";
// MongoMemoryServer binds to loopback, which assertConnectionStringHostIsAllowed
// correctly rejects by default (see host-policy.test.ts/sources-db-security.test.ts) -
// this is the intended SSRF guard behavior working correctly, not something to work
// around silently. Use the same allowlist escape hatch a real deployment would use
// for a trusted internal database (see config.allowedInternalDbHosts).
process.env.ALLOWED_INTERNAL_DB_HOSTS = "127.0.0.1";

let appMongoServer: MongoMemoryServer;
let externalMongoServer: MongoMemoryServer;
let app: FastifyInstance;

beforeAll(async () => {
  appMongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = appMongoServer.getUri();

  const mod = await import("../src/server.js");
  app = mod.default;
  const { connectMongo } = await import("../src/db/mongo.js");
  await connectMongo();
  await app.ready();

  externalMongoServer = await MongoMemoryServer.create();
}, 600_000);

afterAll(async () => {
  await app?.close();
  await mongoose.disconnect();
  await appMongoServer?.stop();
  await externalMongoServer?.stop();
}, 60_000);

async function registerUser(): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email: `${randomUUID()}@example.com`, password: "correct-horse-battery-staple" },
  });
  return response.json().token as string;
}

describe("POST /sources/db (mongodb) - live happy path", () => {
  it("connects to a real external MongoDB, profiles real collections, and the source is queryable afterwards", async () => {
    const externalUri = externalMongoServer.getUri("sources_mongodb_live_check");

    const seedClient = new MongoClient(externalUri);
    await seedClient.connect();
    await seedClient
      .db()
      .collection("products")
      .insertMany([
        { name: "Widget", price: 9.99 },
        { name: "Gadget", price: 19.99 },
      ]);
    await seedClient.close();

    const token = await registerUser();

    const connectRes = await app.inject({
      method: "POST",
      url: "/sources/db",
      headers: { authorization: `Bearer ${token}` },
      payload: { kind: "mongodb", connectionString: externalUri },
    });

    expect(connectRes.statusCode).toBe(200);
    const { sourceId, profile } = connectRes.json();
    const products = profile.tables.find((t: { name: string }) => t.name === "products");
    expect(products.rowCount).toBe(2);
    expect(products.columns.map((c: { name: string }) => c.name)).toEqual(
      expect.arrayContaining(["name", "price"]),
    );

    const profileRes = await app.inject({
      method: "GET",
      url: `/sources/${sourceId}/profile`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(profileRes.statusCode).toBe(200);

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/sources/${sourceId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteRes.statusCode).toBe(204);
  }, 60_000);
});
