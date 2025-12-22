import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * SqlSource always opens sqlite connections readonly (see
 * src/sources/sql-source.ts), and better-sqlite3 refuses to open ":memory:"
 * readonly ("In-memory/temporary databases cannot be readonly"). So tests
 * that need a reconnectable sqlite source use a real (temp) file on disk,
 * seeded with a tiny table up front via a plain writable connection.
 */
function createTempSqliteDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "datasense-registry-test-"));
  const dbPath = join(dir, `${randomUUID()}.sqlite`);
  const db = new Database(dbPath);
  db.exec("CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT)");
  db.exec("INSERT INTO widgets (name) VALUES ('gizmo')");
  db.close();
  return dbPath;
}

// The registry now persists its source-of-truth to MongoDB (+ GridFS for
// file-kind sources) so it no longer requires sticky sessions across
// replicas - see src/sources/registry.ts and src/models/source.ts. Spin up
// an in-memory MongoDB instance the same way the other Mongo-backed suites
// do (test/conversations.test.ts, test/dashboards.test.ts).
let mongoServer: MongoMemoryServer;

process.env.MONGOMS_VERSION ??= "4.4.29";

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  const { connectMongo } = await import("../src/db/mongo.js");
  await connectMongo();
}, 600_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer?.stop();
}, 60_000);

describe("source registry - multi-instance reconstruction", () => {
  it("serves a SQL-kind source registered by 'instance A' from 'instance B' after a simulated restart", async () => {
    const { registerSource, getSourceForOwner, getProfileForOwner, clearLocalCacheForTests } = await import(
      "../src/sources/registry.js"
    );
    const { createSqlSource } = await import("../src/sources/sql-source.js");

    const ownerId = "user-1";
    const dbPath = createTempSqliteDb();

    // "Instance A": create + register a sqlite source, as routes/sources.ts does.
    const source = createSqlSource("sqlite", dbPath);
    const profile = await source.profile();
    const sourceId = await registerSource(source, profile, ownerId, {
      kind: "sqlite",
      connectionString: dbPath,
    });

    // Sanity: immediately after registering, the fast path (local cache hit)
    // returns the exact same live instance.
    expect(await getSourceForOwner(sourceId, ownerId)).toBe(source);

    // Simulate "a different instance" (or this same instance restarting) by
    // wiping the local in-memory cache without touching Mongo. A previously
    // registered source must still be discoverable, reconstructible, and
    // queryable afterwards - this is the direct proof that the registry's
    // data model no longer requires sticky sessions.
    clearLocalCacheForTests();

    const reconstructed = await getSourceForOwner(sourceId, ownerId);
    expect(reconstructed).toBeDefined();
    expect(reconstructed).not.toBe(source); // a genuinely new instance, not the old cached one

    const result = await reconstructed!.execute("SELECT name FROM widgets WHERE id = 1");
    expect(result.rows[0]?.name).toBe("gizmo");

    const reconstructedProfile = await getProfileForOwner(sourceId, ownerId);
    expect(reconstructedProfile).toEqual(profile);
  });

  it("serves a file-kind source's profile and reconstructed DataSource after a simulated restart, via GridFS", async () => {
    const { registerSource, getSourceForOwner, getProfileForOwner, clearLocalCacheForTests } = await import(
      "../src/sources/registry.js"
    );
    const { DuckDBSource } = await import("../src/sources/duckdb-source.js");

    const ownerId = "user-2";
    const csv = "name,amount\nAlice,10\nBob,20\n";
    const buffer = Buffer.from(csv, "utf-8");

    const source = await DuckDBSource.create(buffer, "people.csv", "csv");
    const profile = await source.profile();
    const sourceId = await registerSource(source, profile, ownerId, {
      kind: "file",
      buffer,
      originalFilename: "people.csv",
      declaredType: "csv",
    });

    clearLocalCacheForTests();

    // Profile lookups must not require reconstructing the DuckDB engine at
    // all - they're served straight from the persisted Mongo record.
    const reconstructedProfile = await getProfileForOwner(sourceId, ownerId);
    expect(reconstructedProfile).toEqual(profile);

    // A lookup that needs the live DataSource re-downloads the original
    // bytes from GridFS and re-ingests them into a fresh DuckDB instance.
    const reconstructed = await getSourceForOwner(sourceId, ownerId);
    expect(reconstructed).toBeDefined();
    expect(reconstructed).not.toBe(source);

    const table = profile.tables[0]!;
    const result = await reconstructed!.execute(`SELECT SUM(amount) as total FROM ${table.name}`);
    expect(Number(result.rows[0]?.total)).toBe(30);
  });

  it("never leaks another owner's source across the cache-miss Mongo fallback (404 convention preserved)", async () => {
    const { registerSource, getSourceForOwner, getProfileForOwner, clearLocalCacheForTests } = await import(
      "../src/sources/registry.js"
    );
    const { createSqlSource } = await import("../src/sources/sql-source.js");

    const dbPath = createTempSqliteDb();
    const source = createSqlSource("sqlite", dbPath);
    const profile = await source.profile();
    const sourceId = await registerSource(source, profile, "owner-a", {
      kind: "sqlite",
      connectionString: dbPath,
    });

    clearLocalCacheForTests();

    expect(await getSourceForOwner(sourceId, "owner-b")).toBeUndefined();
    expect(await getProfileForOwner(sourceId, "owner-b")).toBeUndefined();
  });

  it("serves a mongodb-kind source registered by 'instance A' from 'instance B' after a simulated restart", async () => {
    const { registerSource, getSourceForOwner, getProfileForOwner, clearLocalCacheForTests } = await import(
      "../src/sources/registry.js"
    );
    const { MongoSource } = await import("../src/sources/mongo-source.js");

    // A SEPARATE in-memory MongoDB instance stands in for the user's
    // external database being connected as a "mongodb"-kind source - this is
    // distinct from the outer suite's mongoServer, which backs the app's OWN
    // persistence (Source/Conversation/etc. records).
    const externalMongo = await MongoMemoryServer.create();
    try {
      const externalUri = externalMongo.getUri("external_registry_test_db");
      const { MongoClient } = await import("mongodb");
      const seedClient = new MongoClient(externalUri);
      await seedClient.connect();
      await seedClient.db().collection("widgets").insertOne({ name: "gizmo" });
      await seedClient.close();

      const ownerId = "user-4";
      const source = await MongoSource.create(externalUri);
      const profile = await source.profile();
      const sourceId = await registerSource(source, profile, ownerId, {
        kind: "mongodb",
        connectionString: externalUri,
      });

      expect(await getSourceForOwner(sourceId, ownerId)).toBe(source);

      clearLocalCacheForTests();

      const reconstructed = await getSourceForOwner(sourceId, ownerId);
      expect(reconstructed).toBeDefined();
      expect(reconstructed).not.toBe(source);

      const result = await reconstructed!.execute(
        JSON.stringify({ collection: "widgets", pipeline: [{ $match: { name: "gizmo" } }] }),
      );
      expect(result.rows[0]?.name).toBe("gizmo");

      const reconstructedProfile = await getProfileForOwner(sourceId, ownerId);
      expect(reconstructedProfile).toEqual(profile);
    } finally {
      await externalMongo.stop();
    }
  }, 60_000);

  it("removeSourceForOwner deletes the persisted record so it is gone even after a simulated restart", async () => {
    const { registerSource, getSourceForOwner, removeSourceForOwner, clearLocalCacheForTests } = await import(
      "../src/sources/registry.js"
    );
    const { createSqlSource } = await import("../src/sources/sql-source.js");

    const ownerId = "user-3";
    const dbPath = createTempSqliteDb();
    const source = createSqlSource("sqlite", dbPath);
    const profile = await source.profile();
    const sourceId = await registerSource(source, profile, ownerId, {
      kind: "sqlite",
      connectionString: dbPath,
    });

    expect(await removeSourceForOwner(sourceId, ownerId)).toBe(true);

    clearLocalCacheForTests();

    expect(await getSourceForOwner(sourceId, ownerId)).toBeUndefined();
  });
});
