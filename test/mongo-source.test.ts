import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";

/**
 * Exercises MongoSource against a REAL (ephemeral, in-memory) MongoDB
 * instance - not a mock - the same way test/duckdb-source.test.ts and
 * test/sql-source-relationships.test.ts exercise their respective connectors
 * against real engines. This is a completely separate MongoMemoryServer
 * instance from the one other suites use for the app's OWN persistence (see
 * test/registry.test.ts) - it stands in for a user's external MongoDB
 * database, the thing MongoSource actually connects to.
 */
process.env.MONGOMS_VERSION ??= "4.4.29";

let mongoServer: MongoMemoryServer;
let seedClient: MongoClient;
let uri: string;

let customerAId: ObjectId;
let customerBId: ObjectId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  uri = mongoServer.getUri("mongo_source_live_check");

  seedClient = new MongoClient(uri);
  await seedClient.connect();
  const db = seedClient.db();

  const customersResult = await db.collection("customers").insertMany([
    { name: "Alice", region: "East", createdAt: new Date("2026-01-01") },
    { name: "Bob", region: "West", createdAt: new Date("2026-01-02") },
  ]);
  customerAId = customersResult.insertedIds[0];
  customerBId = customersResult.insertedIds[1];

  await db.collection("orders").insertMany([
    { customerId: customerAId, amount: 42.5, status: "paid" },
    { customerId: customerAId, amount: 10, status: "paid" },
    { customerId: customerBId, amount: 99.99, status: "refunded" },
    // A document missing "amount" entirely, to exercise nullRate inference.
    { customerId: customerBId, status: "pending" },
  ]);
}, 600_000);

afterAll(async () => {
  await seedClient?.close();
  await mongoServer?.stop();
}, 60_000);

describe("MongoSource - live against a real MongoDB instance", () => {
  it("rejects a connection string with no database name before ever connecting", async () => {
    const { MongoSource } = await import("../src/sources/mongo-source.js");
    const uriWithoutDbName = uri.replace(/\/mongo_source_live_check(\?.*)?$/, "");

    await expect(MongoSource.create(uriWithoutDbName)).rejects.toThrow(/must include a database name/i);
  });

  it("profiles real collections: row counts, inferred column types, and nullRate", async () => {
    const { MongoSource } = await import("../src/sources/mongo-source.js");
    const source = await MongoSource.create(uri);

    try {
      const profile = await source.profile();
      const tableNames = profile.tables.map((t) => t.name).sort();
      expect(tableNames).toEqual(["customers", "orders"]);

      const orders = profile.tables.find((t) => t.name === "orders")!;
      expect(orders.rowCount).toBe(4);

      const amountColumn = orders.columns.find((c) => c.name === "amount")!;
      expect(amountColumn.type).toBe("number");
      expect(amountColumn.nullable).toBe(true);
      expect(amountColumn.nullRate).toBeCloseTo(0.25, 5); // 1 of 4 docs is missing "amount"

      const customerIdColumn = orders.columns.find((c) => c.name === "customerId")!;
      expect(customerIdColumn.type).toBe("objectId");
      expect(customerIdColumn.nullable).toBe(false);

      const customers = profile.tables.find((t) => t.name === "customers")!;
      expect(customers.rowCount).toBe(2);
      const createdAtColumn = customers.columns.find((c) => c.name === "createdAt")!;
      expect(createdAtColumn.type).toBe("date");
      // BSON values must already be sanitized to plain JSON in sample rows.
      const sampleCreatedAt = customers.sampleRows[0]?.createdAt;
      expect(typeof sampleCreatedAt).toBe("string");
      const sampleId = customers.sampleRows[0]?._id;
      expect(typeof sampleId).toBe("string");
    } finally {
      await source.close();
    }
  });

  it("infers the orders.customerId -> customers._id relationship via the naming heuristic", async () => {
    const { MongoSource } = await import("../src/sources/mongo-source.js");
    const source = await MongoSource.create(uri);

    try {
      const profile = await source.profile();
      expect(profile.relationships).toContainEqual({
        fromTable: "orders",
        fromColumn: "customerId",
        toTable: "customers",
        toColumn: "_id",
        confidence: "inferred",
      });
    } finally {
      await source.close();
    }
  });

  it("executes a real read-only aggregation pipeline and returns real results", async () => {
    const { MongoSource } = await import("../src/sources/mongo-source.js");
    const source = await MongoSource.create(uri);

    try {
      const query = JSON.stringify({
        collection: "orders",
        pipeline: [
          { $match: { status: "paid" } },
          { $group: { _id: "$status", total: { $sum: "$amount" }, count: { $sum: 1 } } },
        ],
      });

      const result = await source.execute(query);
      expect(result.rowCount).toBe(1);
      expect(result.rows[0]?.total).toBeCloseTo(52.5, 5);
      expect(result.rows[0]?.count).toBe(2);
    } finally {
      await source.close();
    }
  });

  it("rejects a pipeline containing $out before ever running it", async () => {
    const { MongoSource } = await import("../src/sources/mongo-source.js");
    const source = await MongoSource.create(uri);

    try {
      const query = JSON.stringify({
        collection: "orders",
        pipeline: [{ $out: "orders_backup" }],
      });

      await expect(source.execute(query)).rejects.toThrow(/forbidden/i);

      // Prove it was actually never run: the backup collection must not exist.
      const db = seedClient.db();
      const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
      expect(names).not.toContain("orders_backup");
    } finally {
      await source.close();
    }
  });

  it("rejects further use after close()", async () => {
    const { MongoSource } = await import("../src/sources/mongo-source.js");
    const source = await MongoSource.create(uri);
    await source.close();

    await expect(source.profile()).rejects.toThrow(/is closed/i);
    await expect(source.execute(JSON.stringify({ collection: "orders", pipeline: [] }))).rejects.toThrow(
      /is closed/i,
    );
  });
});
