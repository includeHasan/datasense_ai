import { describe, expect, it } from "vitest";
import { assertReadOnlySelect, UnsafeSqlError } from "../src/safety/sql-guard.js";

describe("assertReadOnlySelect", () => {
  it("allows a plain SELECT statement", () => {
    expect(() => assertReadOnlySelect("SELECT * FROM foo")).not.toThrow();
  });

  it("allows a WITH ... SELECT CTE statement", () => {
    expect(() => assertReadOnlySelect("WITH t AS (SELECT 1) SELECT * FROM t")).not.toThrow();
  });

  it.each([
    ["UPDATE foo SET x=1"],
    ["DROP TABLE foo"],
    ["DELETE FROM foo"],
    ["SELECT * FROM foo; DELETE FROM foo"],
    ["CREATE TABLE x (id int)"],
  ])("throws for %s", (sql) => {
    expect(() => assertReadOnlySelect(sql)).toThrow(UnsafeSqlError);
  });
});
