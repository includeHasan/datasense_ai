import { describe, expect, it } from "vitest";
import { inferRelationships } from "../src/sources/relationships.js";
import type { SchemaProfile } from "../src/sources/types.js";

type Tables = SchemaProfile["tables"];

describe("inferRelationships", () => {
  it("infers a relationship from an unambiguous _id naming match", () => {
    const tables: Tables = [
      {
        name: "customers",
        columns: [
          { name: "id", type: "BIGINT", nullable: false },
          { name: "name", type: "VARCHAR", nullable: false },
        ],
        rowCount: 2,
        sampleRows: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
      },
      {
        name: "orders",
        columns: [
          { name: "id", type: "BIGINT", nullable: false },
          { name: "customer_id", type: "BIGINT", nullable: false },
          { name: "total", type: "DOUBLE", nullable: false },
        ],
        rowCount: 2,
        sampleRows: [
          { id: 10, customer_id: 1, total: 20 },
          { id: 11, customer_id: 2, total: 40 },
        ],
      },
    ];

    const relationships = inferRelationships(tables);

    expect(relationships).toContainEqual({
      fromTable: "orders",
      fromColumn: "customer_id",
      toTable: "customers",
      toColumn: "id",
      confidence: "inferred",
    });
  });

  it("supports multi-hop naming matches across three related tables", () => {
    const tables: Tables = [
      {
        name: "orders",
        columns: [{ name: "order_id", type: "BIGINT", nullable: false }],
        rowCount: 1,
        sampleRows: [{ order_id: 5 }],
      },
      {
        name: "products",
        columns: [{ name: "product_id", type: "BIGINT", nullable: false }],
        rowCount: 1,
        sampleRows: [{ product_id: 7 }],
      },
      {
        name: "order_items",
        columns: [
          { name: "order_item_id", type: "BIGINT", nullable: false },
          { name: "order_id", type: "BIGINT", nullable: false },
          { name: "product_id", type: "BIGINT", nullable: false },
          { name: "quantity", type: "BIGINT", nullable: false },
        ],
        rowCount: 1,
        sampleRows: [{ order_item_id: 1, order_id: 5, product_id: 7, quantity: 2 }],
      },
    ];

    const relationships = inferRelationships(tables);

    expect(relationships).toContainEqual({
      fromTable: "order_items",
      fromColumn: "order_id",
      toTable: "orders",
      toColumn: "order_id",
      confidence: "inferred",
    });
    expect(relationships).toContainEqual({
      fromTable: "order_items",
      fromColumn: "product_id",
      toTable: "products",
      toColumn: "product_id",
      confidence: "inferred",
    });
  });

  it("recognizes MongoDB's '_id' convention as a primary-key-shaped column, not just 'id'", () => {
    const tables: Tables = [
      {
        name: "customers",
        columns: [
          { name: "_id", type: "objectId", nullable: false },
          { name: "name", type: "string", nullable: false },
        ],
        rowCount: 1,
        sampleRows: [{ _id: "abc123", name: "Alice" }],
      },
      {
        name: "orders",
        columns: [
          { name: "_id", type: "objectId", nullable: false },
          { name: "customerId", type: "objectId", nullable: false },
        ],
        rowCount: 1,
        sampleRows: [{ _id: "order1", customerId: "abc123" }],
      },
    ];

    const relationships = inferRelationships(tables);

    expect(relationships).toContainEqual({
      fromTable: "orders",
      fromColumn: "customerId",
      toTable: "customers",
      toColumn: "_id",
      confidence: "inferred",
    });
  });

  it("does not fabricate a relationship when no matching referenced table exists", () => {
    const tables: Tables = [
      {
        name: "orders",
        columns: [
          { name: "id", type: "BIGINT", nullable: false },
          // Looks like an FK but there is no "widgets" table in this profile.
          { name: "widget_id", type: "BIGINT", nullable: false },
          { name: "region", type: "VARCHAR", nullable: false },
        ],
        rowCount: 1,
        sampleRows: [{ id: 1, widget_id: 99, region: "North" }],
      },
    ];

    const relationships = inferRelationships(tables);

    expect(relationships).toHaveLength(0);
  });

  it("does not fabricate a relationship when column types are incompatible", () => {
    const tables: Tables = [
      {
        name: "customers",
        columns: [{ name: "id", type: "VARCHAR", nullable: false }],
        rowCount: 1,
        sampleRows: [{ id: "CUST-1" }],
      },
      {
        name: "orders",
        // customer_id is numeric while customers.id is a string - types
        // don't line up, so this should not be treated as a match.
        columns: [{ name: "customer_id", type: "BIGINT", nullable: false }],
        rowCount: 1,
        sampleRows: [{ customer_id: 1 }],
      },
    ];

    const relationships = inferRelationships(tables);

    expect(relationships).toHaveLength(0);
  });

  it("ignores plain 'id' columns as if they were foreign keys", () => {
    const tables: Tables = [
      {
        name: "customers",
        columns: [{ name: "id", type: "BIGINT", nullable: false }],
        rowCount: 1,
        sampleRows: [{ id: 1 }],
      },
    ];

    expect(inferRelationships(tables)).toHaveLength(0);
  });
});
