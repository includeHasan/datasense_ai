import { describe, expect, it } from "vitest";
import { ChartSpecSchema } from "../src/schemas/chart-spec.js";

describe("ChartSpecSchema", () => {
  it("parses a valid bar spec", () => {
    const spec = {
      kind: "bar",
      title: "Sales by region",
      xKey: "region",
      series: [{ key: "sales", label: "Sales" }],
      data: [{ region: "East", sales: 10 }],
    };

    const result = ChartSpecSchema.parse(spec);
    expect(result.kind).toBe("bar");
  });

  it("parses a valid table spec", () => {
    const spec = {
      kind: "table",
      title: "Raw data",
      columns: ["name", "amount"],
      rows: [{ name: "Alice", amount: 10 }],
    };

    const result = ChartSpecSchema.parse(spec);
    expect(result.kind).toBe("table");
  });

  it("fails to parse an object missing required fields", () => {
    const spec = {
      kind: "bar",
      title: "Sales by region",
      // missing xKey, series, data
    };

    expect(ChartSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("fails to parse an object with an unknown kind", () => {
    const spec = {
      kind: "unknown",
      title: "Mystery",
    };

    expect(ChartSpecSchema.safeParse(spec).success).toBe(false);
  });
});
