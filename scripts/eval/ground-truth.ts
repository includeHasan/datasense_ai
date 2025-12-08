import type { SalesRecord } from "./generate-data.js";

export interface GroundTruth {
  orderCount: number;
  totalRevenue: number;
  avgOrderValue: number;
  revenueByRegion: Record<string, number>;
  revenueByCategory: Record<string, number>;
  topCategory: { name: string; revenue: number };
  ordersByRegion: Record<string, number>;
  topRegionByOrders: { name: string; orders: number };
  quantityByProduct: Record<string, number>;
  topProductsByQuantity: { name: string; quantity: number }[];
}

function lineRevenue(r: SalesRecord): number {
  return r.quantity * r.unitPrice;
}

function sumBy(records: SalesRecord[], keyFn: (r: SalesRecord) => string): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const r of records) {
    const key = keyFn(r);
    totals[key] = (totals[key] ?? 0) + lineRevenue(r);
  }
  for (const key of Object.keys(totals)) {
    totals[key] = Math.round(totals[key] * 100) / 100;
  }
  return totals;
}

function countBy(records: SalesRecord[], keyFn: (r: SalesRecord) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of records) {
    const key = keyFn(r);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function maxEntry(map: Record<string, number>): { name: string; value: number } {
  let bestName = "";
  let bestValue = -Infinity;
  for (const [name, value] of Object.entries(map)) {
    if (value > bestValue) {
      bestName = name;
      bestValue = value;
    }
  }
  return { name: bestName, value: bestValue };
}

export function computeGroundTruth(records: SalesRecord[]): GroundTruth {
  const totalRevenue = Math.round(records.reduce((sum, r) => sum + lineRevenue(r), 0) * 100) / 100;
  const orderCount = records.length;
  const avgOrderValue = Math.round((totalRevenue / orderCount) * 100) / 100;

  const revenueByRegion = sumBy(records, (r) => r.region);
  const revenueByCategory = sumBy(records, (r) => r.category);
  const topCategoryEntry = maxEntry(revenueByCategory);

  const ordersByRegion = countBy(records, (r) => r.region);
  const topRegionEntry = maxEntry(ordersByRegion);

  const quantityByProduct: Record<string, number> = {};
  for (const r of records) {
    quantityByProduct[r.product] = (quantityByProduct[r.product] ?? 0) + r.quantity;
  }
  const topProductsByQuantity = Object.entries(quantityByProduct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, quantity]) => ({ name, quantity }));

  return {
    orderCount,
    totalRevenue,
    avgOrderValue,
    revenueByRegion,
    revenueByCategory,
    topCategory: { name: topCategoryEntry.name, revenue: topCategoryEntry.value },
    ordersByRegion,
    topRegionByOrders: { name: topRegionEntry.name, orders: topRegionEntry.value },
    quantityByProduct,
    topProductsByQuantity,
  };
}
