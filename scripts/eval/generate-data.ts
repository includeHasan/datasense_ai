/**
 * Generates a synthetic e-commerce retail sales dataset (CSV) with a known,
 * independently-computable ground truth, used by run-eval.ts to measure how
 * accurately the agent answers questions about data it has never seen before.
 */

export interface SalesRecord {
  orderId: string;
  orderDate: string; // YYYY-MM-DD
  region: string;
  category: string;
  product: string;
  customerId: string;
  quantity: number;
  unitPrice: number;
}

interface Product {
  name: string;
  category: string;
  unitPrice: number;
}

const REGIONS = ["North", "South", "East", "West"];

const PRODUCTS: Product[] = [
  { name: "Wireless Earbuds", category: "Electronics", unitPrice: 59.99 },
  { name: "Bluetooth Speaker", category: "Electronics", unitPrice: 39.99 },
  { name: "Smartwatch", category: "Electronics", unitPrice: 129.99 },
  { name: "T-Shirt", category: "Apparel", unitPrice: 19.99 },
  { name: "Jeans", category: "Apparel", unitPrice: 49.99 },
  { name: "Jacket", category: "Apparel", unitPrice: 89.99 },
  { name: "Coffee Maker", category: "Home", unitPrice: 44.99 },
  { name: "Blender", category: "Home", unitPrice: 34.99 },
  { name: "Desk Lamp", category: "Home", unitPrice: 24.99 },
  { name: "Face Cream", category: "Beauty", unitPrice: 29.99 },
  { name: "Shampoo", category: "Beauty", unitPrice: 14.99 },
  { name: "Yoga Mat", category: "Sports", unitPrice: 24.99 },
  { name: "Dumbbell Set", category: "Sports", unitPrice: 59.99 },
  { name: "Running Shoes", category: "Sports", unitPrice: 79.99 },
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(items: T[]): T {
  return items[randomInt(0, items.length - 1)];
}

function randomDateWithinLastYear(): string {
  const now = Date.now();
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  const timestamp = now - randomInt(0, oneYearMs);
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function generateSalesRecords(rowCount: number): SalesRecord[] {
  const records: SalesRecord[] = [];
  for (let i = 0; i < rowCount; i++) {
    const product = pick(PRODUCTS);
    records.push({
      orderId: `ORD-${String(i + 1).padStart(6, "0")}`,
      orderDate: randomDateWithinLastYear(),
      region: pick(REGIONS),
      category: product.category,
      product: product.name,
      customerId: `CUST-${randomInt(1, Math.max(50, Math.floor(rowCount / 4)))}`,
      quantity: randomInt(1, 5),
      unitPrice: product.unitPrice,
    });
  }
  return records.sort((a, b) => a.orderDate.localeCompare(b.orderDate));
}

function csvEscape(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function recordsToCsv(records: SalesRecord[]): string {
  const headers = [
    "order_id",
    "order_date",
    "region",
    "category",
    "product",
    "customer_id",
    "quantity",
    "unit_price",
  ];
  const lines = [headers.join(",")];
  for (const r of records) {
    lines.push(
      [r.orderId, r.orderDate, r.region, r.category, r.product, r.customerId, r.quantity, r.unitPrice]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}
