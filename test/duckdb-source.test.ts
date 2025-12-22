import { describe, expect, it } from "vitest";
import { assertReadOnlySelect } from "../src/safety/sql-guard.js";
import { DuckDBSource } from "../src/sources/duckdb-source.js";

describe("DuckDBSource", () => {
  it("profiles a CSV buffer and executes a guarded aggregate query", async () => {
    const csv = "name,amount\nAlice,10\nBob,20\n";
    const buffer = Buffer.from(csv, "utf-8");

    const source = await DuckDBSource.create(buffer, "people.csv", "csv");
    try {
      const profile = await source.profile();
      expect(profile.tables).toHaveLength(1);

      const table = profile.tables[0];
      expect(table.columns).toHaveLength(2);
      expect(table.rowCount).toBe(2);

      const query = `SELECT SUM(amount) as total FROM ${table.name}`;
      assertReadOnlySelect(query);

      const result = await source.execute(query);
      expect(Number(result.rows[0]?.total)).toBe(30);
    } finally {
      await source.close();
    }
  });

  it("blocks file-reading table functions after ingestion (no server file exfiltration)", async () => {
    const csv = "name,amount\nAlice,10\nBob,20\n";
    const buffer = Buffer.from(csv, "utf-8");

    const source = await DuckDBSource.create(buffer, "people.csv", "csv");
    try {
      const profile = await source.profile();
      const table = profile.tables[0];

      // The existing loaded table is still queryable...
      const safeQuery = `SELECT COUNT(*) as n FROM ${table.name}`;
      assertReadOnlySelect(safeQuery);
      const safeResult = await source.execute(safeQuery);
      expect(Number(safeResult.rows[0]?.n)).toBe(2);

      // ...but a syntactically-valid read-only SELECT that reaches outside
      // the loaded data via a table function must be rejected by DuckDB
      // itself, since assertReadOnlySelect only checks statement type.
      const exfiltrationAttempt = `SELECT * FROM read_csv_auto('${table.name}.csv')`;
      assertReadOnlySelect(exfiltrationAttempt); // passes the type-only guard...
      await expect(source.execute(exfiltrationAttempt)).rejects.toThrow(/disabled by configuration/i);
    } finally {
      await source.close();
    }
  });
});
