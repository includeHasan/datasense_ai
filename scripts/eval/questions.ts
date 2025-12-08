import type { GroundTruth } from "./ground-truth.js";
import { closeTo, extractNumbers, labelPresent, numberPresent, pass, fail, partial, type GradeResult, type Row } from "./grading.js";

export interface EvalQuestion {
  id: string;
  question: string;
  expectedChartKindHint: "kpi" | "bar" | "line" | "pie" | "table";
  expectedSummary: (gt: GroundTruth) => string;
  check: (gt: GroundTruth, rows: Row[]) => GradeResult;
}

export const QUESTIONS: EvalQuestion[] = [
  {
    id: "total-revenue",
    question: "What is the total revenue across all orders?",
    expectedChartKindHint: "kpi",
    expectedSummary: (gt) => `$${gt.totalRevenue.toFixed(2)}`,
    check: (gt, rows) =>
      numberPresent(rows, gt.totalRevenue)
        ? pass(`Found a value close to $${gt.totalRevenue.toFixed(2)} in the result.`)
        : fail(`No value close to expected total revenue $${gt.totalRevenue.toFixed(2)} found in result rows.`),
  },
  {
    id: "order-count",
    question: "How many total orders were placed?",
    expectedChartKindHint: "kpi",
    expectedSummary: (gt) => `${gt.orderCount} orders`,
    check: (gt, rows) =>
      numberPresent(rows, gt.orderCount, 0, 0.51)
        ? pass(`Found the expected order count ${gt.orderCount} in the result.`)
        : fail(`Expected order count ${gt.orderCount} not found in result rows.`),
  },
  {
    id: "avg-order-value",
    question: "What is the average order value (quantity times unit price) across all orders?",
    expectedChartKindHint: "kpi",
    expectedSummary: (gt) => `$${gt.avgOrderValue.toFixed(2)}`,
    check: (gt, rows) =>
      numberPresent(rows, gt.avgOrderValue, 0.03, 0.75)
        ? pass(`Found a value close to $${gt.avgOrderValue.toFixed(2)} in the result.`)
        : fail(`No value close to expected average order value $${gt.avgOrderValue.toFixed(2)} found.`),
  },
  {
    id: "revenue-by-region",
    question: "What is the total revenue broken down by region?",
    expectedChartKindHint: "bar",
    expectedSummary: (gt) =>
      Object.entries(gt.revenueByRegion)
        .map(([region, revenue]) => `${region}: $${revenue.toFixed(2)}`)
        .join(", "),
    check: (gt, rows) => {
      const entries = Object.entries(gt.revenueByRegion);
      const numbers = extractNumbers(rows);
      const matched = entries.filter(
        ([region, revenue]) => labelPresent(rows, region) && numbers.some((n) => closeTo(n, revenue)),
      );
      const score = matched.length / entries.length;
      return partial(
        score,
        `${matched.length}/${entries.length} regions had both their label and a matching revenue value present ` +
          `(expected: ${entries.map(([r, v]) => `${r}=$${v.toFixed(2)}`).join(", ")}).`,
      );
    },
  },
  {
    id: "top-category",
    question: "Which product category generated the most total revenue?",
    expectedChartKindHint: "pie",
    expectedSummary: (gt) => `${gt.topCategory.name} ($${gt.topCategory.revenue.toFixed(2)})`,
    check: (gt, rows) =>
      labelPresent(rows, gt.topCategory.name)
        ? pass(`Expected top category "${gt.topCategory.name}" appears in the result.`)
        : fail(`Expected top category "${gt.topCategory.name}" not found in result rows.`),
  },
  {
    id: "region-most-orders",
    question: "Which region placed the most orders (by order count, not revenue)?",
    expectedChartKindHint: "bar",
    expectedSummary: (gt) => `${gt.topRegionByOrders.name} (${gt.topRegionByOrders.orders} orders)`,
    check: (gt, rows) =>
      labelPresent(rows, gt.topRegionByOrders.name)
        ? pass(`Expected top region "${gt.topRegionByOrders.name}" appears in the result.`)
        : fail(`Expected top region "${gt.topRegionByOrders.name}" not found in result rows.`),
  },
  {
    id: "top-products-by-quantity",
    question: "What are the top 5 best-selling products by total quantity sold?",
    expectedChartKindHint: "table",
    expectedSummary: (gt) => gt.topProductsByQuantity.map((p) => `${p.name} (${p.quantity})`).join(", "),
    check: (gt, rows) => {
      const matched = gt.topProductsByQuantity.filter((p) => labelPresent(rows, p.name));
      const score = matched.length / gt.topProductsByQuantity.length;
      return partial(
        score,
        `${matched.length}/${gt.topProductsByQuantity.length} of the expected top-5 products ` +
          `(${gt.topProductsByQuantity.map((p) => p.name).join(", ")}) appear in the result.`,
      );
    },
  },
  {
    id: "revenue-trend",
    question: "How does total revenue trend over time, broken down by month?",
    expectedChartKindHint: "line",
    expectedSummary: () => "Per-month revenue values that sum to the total revenue",
    check: (gt, rows) => {
      const sum = extractNumbers(rows).reduce((a, b) => a + b, 0);
      return closeTo(sum, gt.totalRevenue, 0.05, 5)
        ? pass(`Sum of numeric values across the monthly breakdown (~$${sum.toFixed(2)}) is close to total revenue.`)
        : fail(
            `Sum of numeric values across the monthly breakdown ($${sum.toFixed(2)}) does not match ` +
              `total revenue ($${gt.totalRevenue.toFixed(2)}).`,
          );
    },
  },
];
