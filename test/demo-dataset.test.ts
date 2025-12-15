import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DuckDBSource } from "../src/sources/duckdb-source.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DATA_DIR = path.resolve(__dirname, "..", "demo-data");
const DEMO_CSV_FILENAMES = ["customers.csv", "products.csv", "orders.csv", "order_items.csv"];

describe("demo dataset (related CSVs)", () => {
  it("loads all four related tables and infers the expected FK relationships", async () => {
    const files = await Promise.all(
      DEMO_CSV_FILENAMES.map(async (filename) => ({
        buffer: await readFile(path.join(DEMO_DATA_DIR, filename)),
        originalFilename: filename,
        declaredType: "csv" as const,
      })),
    );

    const source = await DuckDBSource.createFromFiles(files);
    try {
      const profile = await source.profile();

      const tableNames = profile.tables.map((t) => t.name).sort();
      expect(tableNames).toEqual(["customers", "order_items", "orders", "products"]);

      const relationships = profile.relationships ?? [];
      expect(relationships.every((rel) => rel.confidence === "inferred")).toBe(true);

      expect(relationships).toContainEqual({
        fromTable: "orders",
        fromColumn: "customer_id",
        toTable: "customers",
        toColumn: "customer_id",
        confidence: "inferred",
      });
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

      // A join across customers -> orders should actually execute and return rows.
      const joinResult = await source.execute(
        `SELECT c.name, COUNT(*) AS order_count
           FROM orders o
           JOIN customers c ON o.customer_id = c.customer_id
          GROUP BY c.name
          ORDER BY order_count DESC
          LIMIT 5`,
      );
      expect(joinResult.rows.length).toBeGreaterThan(0);
    } finally {
      await source.close();
    }
  });
});
