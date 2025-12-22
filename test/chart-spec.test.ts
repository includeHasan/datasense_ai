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

  it("parses a valid heatmap spec", () => {
    const spec = {
      kind: "heatmap",
      title: "Orders by day and hour",
      xKey: "day",
      yKey: "hour",
      valueKey: "count",
      data: [{ day: "Mon", hour: "9", count: 12 }],
    };

    expect(ChartSpecSchema.parse(spec).kind).toBe("heatmap");
  });

  it("parses a valid boxplot spec", () => {
    const spec = {
      kind: "boxplot",
      title: "Order value spread by category",
      categoryKey: "category",
      minKey: "min",
      q1Key: "q1",
      medianKey: "median",
      q3Key: "q3",
      maxKey: "max",
      data: [{ category: "Home", min: 5, q1: 20, median: 35, q3: 50, max: 90 }],
    };

    expect(ChartSpecSchema.parse(spec).kind).toBe("boxplot");
  });

  it("parses a valid histogram spec", () => {
    const spec = {
      kind: "histogram",
      title: "Order value distribution",
      binKey: "range",
      countKey: "count",
      data: [{ range: "0-100", count: 42 }],
    };

    expect(ChartSpecSchema.parse(spec).kind).toBe("histogram");
  });

  it("parses a valid waterfall spec", () => {
    const spec = {
      kind: "waterfall",
      title: "Revenue bridge",
      categoryKey: "step",
      valueKey: "amount",
      totalKey: "isTotal",
      data: [
        { step: "Starting revenue", amount: 1000, isTotal: true },
        { step: "New sales", amount: 200, isTotal: false },
        { step: "Churn", amount: -50, isTotal: false },
      ],
    };

    expect(ChartSpecSchema.parse(spec).kind).toBe("waterfall");
  });

  it("parses a valid treemap spec with nested-looking flat paths", () => {
    const spec = {
      kind: "treemap",
      title: "Revenue by category",
      data: [
        { path: ["Electronics", "Phones"], value: 120 },
        { path: ["Electronics", "Laptops"], value: 80 },
      ],
    };

    expect(ChartSpecSchema.parse(spec).kind).toBe("treemap");
  });

  it("fails to parse a treemap node with an empty path", () => {
    const spec = {
      kind: "treemap",
      title: "Revenue by category",
      data: [{ path: [], value: 120 }],
    };

    expect(ChartSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("parses a valid sankey spec", () => {
    const spec = {
      kind: "sankey",
      title: "Signup flow",
      nodes: [{ name: "Signup" }, { name: "Activated" }, { name: "Churned" }],
      links: [
        { source: "Signup", target: "Activated", value: 80 },
        { source: "Signup", target: "Churned", value: 20 },
      ],
    };

    expect(ChartSpecSchema.parse(spec).kind).toBe("sankey");
  });

  it("parses a valid calendar spec", () => {
    const spec = {
      kind: "calendar",
      title: "Daily active users",
      data: [{ date: "2026-01-01", value: 42 }],
    };

    expect(ChartSpecSchema.parse(spec).kind).toBe("calendar");
  });

  it("parses a scatter spec with a sizeKey (bubble chart)", () => {
    const spec = {
      kind: "scatter",
      title: "Price vs rating",
      xKey: "price",
      yKey: "rating",
      seriesKey: null,
      sizeKey: "unitsSold",
      data: [{ price: 10, rating: 4.2, unitsSold: 500 }],
    };

    const result = ChartSpecSchema.parse(spec);
    expect(result.kind === "scatter" && result.sizeKey).toBe("unitsSold");
  });

  it("parses a bar spec with normalized (100%-stacked) set", () => {
    const spec = {
      kind: "bar",
      title: "Category mix over time",
      xKey: "quarter",
      series: [{ key: "electronics", label: "Electronics" }],
      data: [{ quarter: "Q1", electronics: 10 }],
      stacked: true,
      normalized: true,
    };

    const result = ChartSpecSchema.parse(spec);
    expect(result.kind === "bar" && result.normalized).toBe(true);
  });

  it("parses a kpi spec with target and trend set", () => {
    const spec = {
      kind: "kpi",
      title: "Quota attainment",
      label: "Revenue",
      value: 85000,
      delta: 5,
      target: 100000,
      trend: [60000, 70000, 85000],
    };

    const result = ChartSpecSchema.parse(spec);
    expect(result.kind === "kpi" && result.target).toBe(100000);
  });
});
