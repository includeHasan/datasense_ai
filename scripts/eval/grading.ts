/**
 * Grading is intentionally fuzzy: the agent picks its own SQL, its own column
 * names, and its own chart shape, so we don't assert an exact response shape.
 * Instead we scan the actual query result rows (FinalAnswer.sampleRows - the
 * literal output of the SQL the agent ran) for numbers/labels that should be
 * present if the answer is correct, per the independently-computed ground truth.
 */

export type Row = Record<string, unknown>;

export function extractNumbers(rows: Row[]): number[] {
  const numbers: number[] = [];
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        numbers.push(value);
      } else if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
        numbers.push(Number(value));
      }
    }
  }
  return numbers;
}

export function extractLabels(rows: Row[]): string[] {
  const labels: string[] = [];
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (typeof value === "string" && Number.isNaN(Number(value))) {
        labels.push(value.toLowerCase());
      }
    }
  }
  return labels;
}

export function closeTo(actual: number, expected: number, relTol = 0.02, absTol = 0.5): boolean {
  return Math.abs(actual - expected) <= Math.max(absTol, Math.abs(expected) * relTol);
}

export function numberPresent(rows: Row[], expected: number, relTol = 0.02, absTol = 0.5): boolean {
  return extractNumbers(rows).some((n) => closeTo(n, expected, relTol, absTol));
}

export function labelPresent(rows: Row[], expected: string): boolean {
  const needle = expected.toLowerCase();
  return extractLabels(rows).some((label) => label.includes(needle) || needle.includes(label));
}

export interface GradeResult {
  passed: boolean;
  score: number; // 0..1, for partial-credit checks (e.g. top-5 overlap)
  detail: string;
}

export function pass(detail: string): GradeResult {
  return { passed: true, score: 1, detail };
}

export function fail(detail: string): GradeResult {
  return { passed: false, score: 0, detail };
}

export function partial(score: number, detail: string): GradeResult {
  return { passed: score >= 0.6, score, detail };
}
