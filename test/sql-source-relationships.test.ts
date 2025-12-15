import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type pg from "pg";
import type mysql from "mysql2/promise";
import {
  declaredForeignKeysMysql,
  declaredForeignKeysPostgres,
  declaredForeignKeysSqlite,
  profileSqlite,
  withHeuristicFallback,
} from "../src/sources/sql-source.js";
import type { SchemaProfile } from "../src/sources/types.js";

describe("declaredForeignKeysSqlite", () => {
  it("reads declared FK constraints via PRAGMA foreign_key_list", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        customer_id INTEGER,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      );
    `);

    const relationships = declaredForeignKeysSqlite(db, ["customers", "orders"]);
    db.close();

    expect(relationships).toEqual([
      {
        fromTable: "orders",
        fromColumn: "customer_id",
        toTable: "customers",
        toColumn: "id",
        confidence: "declared",
      },
    ]);
  });

  it("profileSqlite populates relationships end-to-end for a declared FK schema", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        customer_id INTEGER,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      );
      INSERT INTO customers (id, name) VALUES (1, 'Alice');
      INSERT INTO orders (id, customer_id) VALUES (10, 1);
    `);

    const profile = profileSqlite(db);
    db.close();

    expect(profile.relationships).toEqual([
      {
        fromTable: "orders",
        fromColumn: "customer_id",
        toTable: "customers",
        toColumn: "id",
        confidence: "declared",
      },
    ]);
  });
});

describe("declaredForeignKeysPostgres", () => {
  it("maps information_schema join rows into declared relationships", async () => {
    const fakePool = {
      query: async () => ({
        rows: [
          {
            from_table: "orders",
            from_column: "customer_id",
            to_table: "customers",
            to_column: "id",
          },
        ],
      }),
    } as unknown as pg.Pool;

    const relationships = await declaredForeignKeysPostgres(fakePool);

    expect(relationships).toEqual([
      {
        fromTable: "orders",
        fromColumn: "customer_id",
        toTable: "customers",
        toColumn: "id",
        confidence: "declared",
      },
    ]);
  });
});

describe("declaredForeignKeysMysql", () => {
  it("maps KEY_COLUMN_USAGE rows into declared relationships", async () => {
    const fakePool = {
      query: async () => [
        [
          {
            from_table: "orders",
            from_column: "customer_id",
            to_table: "customers",
            to_column: "id",
          },
        ],
        [],
      ],
    } as unknown as mysql.Pool;

    const relationships = await declaredForeignKeysMysql(fakePool);

    expect(relationships).toEqual([
      {
        fromTable: "orders",
        fromColumn: "customer_id",
        toTable: "customers",
        toColumn: "id",
        confidence: "declared",
      },
    ]);
  });
});

describe("withHeuristicFallback", () => {
  const tables: SchemaProfile["tables"] = [
    {
      name: "customers",
      columns: [{ name: "id", type: "BIGINT", nullable: false }],
      rowCount: 1,
      sampleRows: [{ id: 1 }],
    },
    {
      name: "orders",
      columns: [{ name: "customer_id", type: "BIGINT", nullable: false }],
      rowCount: 1,
      sampleRows: [{ customer_id: 1 }],
    },
  ];

  it("only heuristically infers relationships for tables lacking a declared FK", () => {
    const relationships = withHeuristicFallback(tables, []);
    expect(relationships).toContainEqual({
      fromTable: "orders",
      fromColumn: "customer_id",
      toTable: "customers",
      toColumn: "id",
      confidence: "inferred",
    });
  });

  it("does not duplicate/override a table that already has a declared FK", () => {
    const declared = [
      {
        fromTable: "orders",
        fromColumn: "customer_id",
        toTable: "customers",
        toColumn: "id",
        confidence: "declared" as const,
      },
    ];

    const relationships = withHeuristicFallback(tables, declared);

    expect(relationships).toEqual(declared);
  });
});
