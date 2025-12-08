import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Renders a table/row cell value for display. Numbers (and numeric strings,
 * e.g. from SQL engines that return DECIMAL/BIGINT as strings) are rounded to
 * at most 2 decimal places so floating-point noise (like 180539.48000000085)
 * never reaches the screen — important for a product whose whole premise is
 * that the printed numbers can be trusted at a glance.
 */
export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  }
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    const num = Number(value)
    return Number.isInteger(num) ? value : num.toFixed(2)
  }
  return String(value)
}
