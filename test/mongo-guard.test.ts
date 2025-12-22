import { describe, expect, it } from "vitest";
import { assertReadOnlyAggregation, UnsafeAggregationError } from "../src/safety/mongo-guard.js";

describe("assertReadOnlyAggregation", () => {
  it("allows a well-formed read-only aggregation query", () => {
    const query = JSON.stringify({
      collection: "orders",
      pipeline: [{ $match: { status: "paid" } }, { $group: { _id: "$category", total: { $sum: "$amount" } } }],
    });

    const result = assertReadOnlyAggregation(query);
    expect(result.collection).toBe("orders");
    expect(result.pipeline).toHaveLength(2);
  });

  it("allows an empty pipeline (returns all documents)", () => {
    const query = JSON.stringify({ collection: "orders", pipeline: [] });
    expect(() => assertReadOnlyAggregation(query)).not.toThrow();
  });

  it("throws for an empty string", () => {
    expect(() => assertReadOnlyAggregation("")).toThrow(UnsafeAggregationError);
  });

  it("throws for invalid JSON", () => {
    expect(() => assertReadOnlyAggregation("{ not valid json")).toThrow(UnsafeAggregationError);
  });

  it("throws when the top-level value is a JSON array instead of an object", () => {
    expect(() => assertReadOnlyAggregation("[]")).toThrow(UnsafeAggregationError);
  });

  it("throws when collection is missing", () => {
    const query = JSON.stringify({ pipeline: [] });
    expect(() => assertReadOnlyAggregation(query)).toThrow(UnsafeAggregationError);
  });

  it("throws when collection is not a string", () => {
    const query = JSON.stringify({ collection: 123, pipeline: [] });
    expect(() => assertReadOnlyAggregation(query)).toThrow(UnsafeAggregationError);
  });

  it("throws when pipeline is missing", () => {
    const query = JSON.stringify({ collection: "orders" });
    expect(() => assertReadOnlyAggregation(query)).toThrow(UnsafeAggregationError);
  });

  it("throws when pipeline is not an array", () => {
    const query = JSON.stringify({ collection: "orders", pipeline: { $match: {} } });
    expect(() => assertReadOnlyAggregation(query)).toThrow(UnsafeAggregationError);
  });

  it.each([
    ["$out", { collection: "orders", pipeline: [{ $out: "backup_orders" }] }],
    ["$merge", { collection: "orders", pipeline: [{ $merge: { into: "backup_orders" } }] }],
    ["$function", { collection: "orders", pipeline: [{ $function: { body: "function(){}", args: [], lang: "js" } }] }],
    ["$where", { collection: "orders", pipeline: [{ $match: { $where: "this.amount > 0" } }] }],
    [
      "$accumulator",
      {
        collection: "orders",
        pipeline: [
          {
            $group: {
              _id: "$category",
              total: { $accumulator: { init: "function(){}", accumulate: "function(){}", accumulateArgs: [], merge: "function(){}", lang: "js" } },
            },
          },
        ],
      },
    ],
  ])("rejects a pipeline containing %s, even nested inside another stage", (_label, query) => {
    expect(() => assertReadOnlyAggregation(JSON.stringify(query))).toThrow(UnsafeAggregationError);
  });

  it("throws when a pipeline stage is not a JSON object", () => {
    const query = JSON.stringify({ collection: "orders", pipeline: ["not an object"] });
    expect(() => assertReadOnlyAggregation(query)).toThrow(UnsafeAggregationError);
  });
});
