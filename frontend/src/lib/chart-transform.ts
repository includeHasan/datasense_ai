import type { AreaChartSpec, BarChartSpec, ChartSpec, LineChartSpec } from "@/lib/types";

/**
 * Chart kinds whose data shape is "one x-axis key + one or more numeric
 * series over the same rows" - these are freely interchangeable client-side
 * without contacting the backend again.
 */
const CATEGORY_KINDS = ["bar", "line", "area"] as const;
type CategoryKind = (typeof CATEGORY_KINDS)[number];
type CategorySpec = BarChartSpec | LineChartSpec | AreaChartSpec;

function isCategoryKind(kind: ChartSpec["kind"]): kind is CategoryKind {
  return (CATEGORY_KINDS as readonly string[]).includes(kind);
}

function isCategorySpec(spec: ChartSpec): spec is CategorySpec {
  return isCategoryKind(spec.kind);
}

/**
 * Returns the set of chart kinds (excluding the current one) that `spec`
 * could be safely recast into, based on the shape of its data - not a
 * hardcoded universal list. Kinds requiring data the spec doesn't have
 * (e.g. scatter needs two independent numeric axes) are never suggested.
 */
export function compatibleKinds(spec: ChartSpec): ChartSpec["kind"][] {
  switch (spec.kind) {
    case "bar":
    case "line":
    case "area": {
      const kinds: ChartSpec["kind"][] = CATEGORY_KINDS.filter((k) => k !== spec.kind);
      // bar/pie are interchangeable only when there is a single series to
      // treat as the pie's value (a multi-series bar can't collapse to pie).
      if (spec.series.length === 1) {
        kinds.push("pie");
      }
      return kinds;
    }
    case "pie": {
      const kinds: ChartSpec["kind"][] = ["bar", "line", "area"];
      return kinds;
    }
    case "table":
    case "kpi":
    case "scatter":
    case "combo":
    case "funnel":
    case "radar":
    case "gauge":
      return [];
    default: {
      const exhaustiveCheck: never = spec;
      return exhaustiveCheck;
    }
  }
}

/**
 * Recasts `spec` into `targetKind`, reusing the same underlying data/keys.
 * Returns the original spec unchanged if the recast doesn't make sense for
 * the current data shape (rather than throwing).
 */
export function recastChartSpec(spec: ChartSpec, targetKind: ChartSpec["kind"]): ChartSpec {
  if (targetKind === spec.kind) {
    return spec;
  }

  if (isCategorySpec(spec) && isCategoryKind(targetKind)) {
    return {
      ...spec,
      kind: targetKind,
    } as ChartSpec;
  }

  if (isCategorySpec(spec) && targetKind === "pie") {
    if (spec.series.length !== 1) {
      return spec;
    }
    return {
      kind: "pie",
      title: spec.title,
      categoryKey: spec.xKey,
      valueKey: spec.series[0].key,
      data: spec.data,
      donut: false,
    };
  }

  if (spec.kind === "pie" && isCategoryKind(targetKind)) {
    return {
      kind: targetKind,
      title: spec.title,
      xKey: spec.categoryKey,
      series: [{ key: spec.valueKey, label: spec.valueKey }],
      data: spec.data,
      stacked: false,
      orientation: null,
    } as ChartSpec;
  }

  return spec;
}
