"use client";

import type { Ref } from "react";
import ReactECharts from "echarts-for-react";

import type { ChartSpec } from "@/lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatCellValue } from "@/lib/utils";

const CHART_PALETTE = [
  "#2F6B4F", // pine
  "#B8863A", // amber
  "#B23B2E", // rust
  "#5B7A99", // slate
  "#6FA085", // light pine
];

const CHART_INK = "#1B2420";
const CHART_RULE = "#D8E0D3";

const axisTextStyle = { color: CHART_INK };
const axisLineStyle = { lineStyle: { color: CHART_RULE } };
const splitLineStyle = { lineStyle: { color: CHART_RULE } };

/** Shortens a label to `max` chars with an ellipsis; full text still shows in tooltips/legend hover. */
function truncateLabel(value: unknown, max: number): string {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * A legend that scrolls when crowded and visually truncates long series names
 * (the full name still shows on hover), so datasets with long labels don't
 * overflow the chart area.
 */
function scrollingLegend(names: string[]) {
  return {
    type: "scroll" as const,
    data: names,
    textStyle: axisTextStyle,
    formatter: (name: string) => truncateLabel(name, 26),
    tooltip: { show: true },
  };
}

/**
 * A category axis whose tick labels are hard-capped in width (ECharts
 * truncates with an ellipsis) so long category values — e.g. full product
 * names or hierarchical category paths — don't blow out the chart. Vertical
 * layouts also rotate the labels since horizontal x-axis room is tight.
 */
function categoryAxisConfig(data: unknown[], horizontal: boolean) {
  return {
    type: "category" as const,
    data,
    axisLine: axisLineStyle,
    axisTick: axisLineStyle,
    splitLine: splitLineStyle,
    axisLabel: horizontal
      ? { ...axisTextStyle, width: 150, overflow: "truncate" as const }
      : { ...axisTextStyle, width: 80, overflow: "truncate" as const, interval: 0, rotate: 30 },
  };
}

// Reserve room for truncated axis labels via containLabel so nothing is clipped.
const truncatingGrid = { containLabel: true, left: 12, right: 16, top: 44, bottom: 12 };

function ChartTitle({ title }: { title: string }) {
  return <h3 className="font-heading text-base font-medium">{title}</h3>;
}

/** Inline oldest-first trend line, drawn as plain SVG (no ECharts instance needed). */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const width = 96;
  const height = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke={CHART_PALETTE[0]} strokeWidth={1.5} />
    </svg>
  );
}

/** Bullet-style progress bar: filled to `value`, with a tick marking `target`. */
function BulletBar({ value, target }: { value: number; target: number }) {
  const scaleMax = Math.max(value, target, 1) * 1.15;
  const valuePct = Math.min(100, Math.max(0, (value / scaleMax) * 100));
  const targetPct = Math.min(100, Math.max(0, (target / scaleMax) * 100));

  return (
    <div className="relative h-2 w-full max-w-40 rounded-full bg-muted">
      <div
        className="h-2 rounded-full"
        style={{ width: `${valuePct}%`, backgroundColor: CHART_PALETTE[0] }}
      />
      <div
        className="absolute top-[-3px] h-3.5 w-0.5 bg-foreground"
        style={{ left: `${targetPct}%` }}
        title={`Target: ${target}`}
      />
    </div>
  );
}

function CategoryChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "bar" | "line" | "area" }>;
  ref?: Ref<ReactECharts>;
}) {
  const horizontal = spec.orientation === "horizontal";
  const normalized = Boolean(spec.normalized && spec.stacked);

  // 100%-stacked mode: rescale each row's series values to sum to 100 so the
  // stack shows proportion/mix rather than absolute volume.
  const rowData = normalized
    ? spec.data.map((row) => {
        const total = spec.series.reduce((sum, s) => sum + (Number(row[s.key]) || 0), 0);
        if (total === 0) return row;
        return Object.fromEntries(
          Object.entries(row).map(([key, value]) => {
            const isSeriesKey = spec.series.some((s) => s.key === key);
            return [key, isSeriesKey ? ((Number(value) || 0) / total) * 100 : value];
          }),
        );
      })
    : spec.data;

  const categoryAxis = categoryAxisConfig(
    rowData.map((row) => row[spec.xKey]),
    horizontal,
  );
  const valueAxis = {
    type: "value" as const,
    max: normalized ? 100 : undefined,
    axisLine: axisLineStyle,
    axisTick: axisLineStyle,
    axisLabel: normalized ? { ...axisTextStyle, formatter: "{value}%" } : axisTextStyle,
    splitLine: splitLineStyle,
  };

  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    grid: truncatingGrid,
    tooltip: {
      trigger: "axis",
      valueFormatter: normalized ? (value: number) => `${value.toFixed(1)}%` : undefined,
    },
    legend: scrollingLegend(spec.series.map((s) => s.label)),
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: spec.series.map((s) => ({
      name: s.label,
      type: spec.kind === "area" ? "line" : spec.kind,
      areaStyle: spec.kind === "area" ? {} : undefined,
      stack: spec.stacked ? "total" : undefined,
      data: rowData.map((row) => row[s.key]),
    })),
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 320, width: "100%" }} />
    </div>
  );
}

function PieChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "pie" }>;
  ref?: Ref<ReactECharts>;
}) {
  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    // Full category name + value + share on hover, so the slices themselves
    // only need to show a compact percentage.
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: {
      type: "scroll" as const,
      orient: "vertical" as const,
      left: "left",
      top: "middle",
      textStyle: axisTextStyle,
      formatter: (name: string) => truncateLabel(name, 22),
      tooltip: { show: true },
    },
    series: [
      {
        type: "pie",
        // Shift right of the vertical legend and shrink slightly so long
        // category names don't collide with it.
        center: ["62%", "52%"],
        radius: spec.donut ? ["38%", "62%"] : "58%",
        // Slice labels show only the percentage; full names live in the legend
        // and tooltip, avoiding the overlap you get when long names are drawn
        // around every slice.
        label: { formatter: "{d}%", color: CHART_INK },
        labelLine: { length: 6, length2: 6 },
        data: spec.data.map((row) => ({
          name: row[spec.categoryKey],
          value: row[spec.valueKey],
        })),
      },
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 320, width: "100%" }} />
    </div>
  );
}

function ScatterChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "scatter" }>;
  ref?: Ref<ReactECharts>;
}) {
  const groups = spec.seriesKey
    ? Array.from(new Set(spec.data.map((row) => String(row[spec.seriesKey as string]))))
    : [null];

  const sizeKey = spec.sizeKey;
  const sizeValues = sizeKey ? spec.data.map((row) => Number(row[sizeKey]) || 0) : [];
  const maxSize = sizeValues.length > 0 ? Math.max(...sizeValues) : 0;
  // Scale marker radius into a legible 8-40px range rather than plotting the
  // raw metric (which could be a handful or a few million) as pixel size.
  const symbolSizeFor = (row: Record<string, unknown>) => {
    if (!sizeKey || maxSize <= 0) return 10;
    const value = Number(row[sizeKey]) || 0;
    return 8 + (value / maxSize) * 32;
  };

  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    tooltip: { trigger: "item" },
    legend: spec.seriesKey
      ? { data: groups.map((g) => g ?? ""), textStyle: axisTextStyle }
      : undefined,
    xAxis: {
      type: "value",
      name: spec.xKey,
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      axisLabel: axisTextStyle,
      splitLine: splitLineStyle,
    },
    yAxis: {
      type: "value",
      name: spec.yKey,
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      axisLabel: axisTextStyle,
      splitLine: splitLineStyle,
    },
    series: groups.map((group) => {
      const rows = spec.data.filter(
        (row) => !spec.seriesKey || String(row[spec.seriesKey]) === group,
      );
      return {
        name: group ?? spec.title,
        type: "scatter",
        symbolSize: sizeKey ? (_value: unknown, params: { dataIndex: number }) =>
          symbolSizeFor(rows[params.dataIndex]) : undefined,
        data: rows.map((row) => [row[spec.xKey], row[spec.yKey]]),
      };
    }),
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 320, width: "100%" }} />
    </div>
  );
}

function ComboChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "combo" }>;
  ref?: Ref<ReactECharts>;
}) {
  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    grid: truncatingGrid,
    tooltip: { trigger: "axis" },
    legend: scrollingLegend([...spec.barSeries, ...spec.lineSeries].map((s) => s.label)),
    xAxis: categoryAxisConfig(
      spec.data.map((row) => row[spec.xKey]),
      false,
    ),
    yAxis: [
      {
        type: "value",
        axisLine: axisLineStyle,
        axisTick: axisLineStyle,
        axisLabel: axisTextStyle,
        splitLine: splitLineStyle,
      },
      {
        type: "value",
        axisLine: axisLineStyle,
        axisTick: axisLineStyle,
        axisLabel: axisTextStyle,
        splitLine: { show: false },
      },
    ],
    series: [
      ...spec.barSeries.map((s) => ({
        name: s.label,
        type: "bar",
        yAxisIndex: 0,
        data: spec.data.map((row) => row[s.key]),
      })),
      ...spec.lineSeries.map((s) => ({
        name: s.label,
        type: "line",
        yAxisIndex: 1,
        data: spec.data.map((row) => row[s.key]),
      })),
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 320, width: "100%" }} />
    </div>
  );
}

function FunnelChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "funnel" }>;
  ref?: Ref<ReactECharts>;
}) {
  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    tooltip: { trigger: "item" },
    series: [
      {
        type: "funnel",
        left: "10%",
        width: "80%",
        label: { color: CHART_INK },
        data: spec.data.map((row) => ({
          name: row[spec.stageKey],
          value: row[spec.valueKey],
        })),
      },
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 320, width: "100%" }} />
    </div>
  );
}

function RadarChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "radar" }>;
  ref?: Ref<ReactECharts>;
}) {
  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    tooltip: { trigger: "item" },
    legend: {
      data: spec.series.map((s) => s.name),
      textStyle: axisTextStyle,
    },
    radar: {
      indicator: spec.indicators.map((i) => ({ name: i.name, max: i.max })),
      axisName: { color: CHART_INK },
      splitLine: splitLineStyle,
      axisLine: axisLineStyle,
    },
    series: [
      {
        type: "radar",
        data: spec.series.map((s) => ({ name: s.name, value: s.values })),
      },
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 320, width: "100%" }} />
    </div>
  );
}

function GaugeChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "gauge" }>;
  ref?: Ref<ReactECharts>;
}) {
  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    series: [
      {
        type: "gauge",
        max: spec.max,
        min: 0,
        detail: { formatter: "{value}", color: CHART_INK },
        axisLine: { lineStyle: { color: [[1, CHART_RULE]] } },
        pointer: { itemStyle: { color: CHART_PALETTE[0] } },
        progress: { show: true, itemStyle: { color: CHART_PALETTE[0] } },
        data: [{ value: spec.value, name: spec.label }],
        title: { color: CHART_INK },
      },
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 320, width: "100%" }} />
    </div>
  );
}

function HeatmapChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "heatmap" }>;
  ref?: Ref<ReactECharts>;
}) {
  const xCategories = Array.from(new Set(spec.data.map((row) => String(row[spec.xKey]))));
  const yCategories = Array.from(new Set(spec.data.map((row) => String(row[spec.yKey]))));
  const values = spec.data.map((row) => Number(row[spec.valueKey]) || 0);
  const maxValue = values.length > 0 ? Math.max(...values) : 0;

  const option = {
    backgroundColor: "transparent",
    tooltip: { position: "top" },
    grid: { top: 20, bottom: 70, left: 90, right: 20 },
    xAxis: {
      type: "category",
      data: xCategories,
      axisLine: axisLineStyle,
      axisLabel: axisTextStyle,
      splitArea: { show: true },
    },
    yAxis: {
      type: "category",
      data: yCategories,
      axisLine: axisLineStyle,
      axisLabel: axisTextStyle,
      splitArea: { show: true },
    },
    visualMap: {
      min: 0,
      max: maxValue,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      inRange: { color: [CHART_RULE, CHART_PALETTE[0]] },
      textStyle: axisTextStyle,
    },
    series: [
      {
        type: "heatmap",
        data: spec.data.map((row) => [
          xCategories.indexOf(String(row[spec.xKey])),
          yCategories.indexOf(String(row[spec.yKey])),
          Number(row[spec.valueKey]) || 0,
        ]),
        label: { show: true, color: CHART_INK },
      },
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 360, width: "100%" }} />
    </div>
  );
}

function BoxplotChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "boxplot" }>;
  ref?: Ref<ReactECharts>;
}) {
  const categories = spec.data.map((row) => row[spec.categoryKey]);
  const values = spec.data.map((row) => [
    Number(row[spec.minKey]) || 0,
    Number(row[spec.q1Key]) || 0,
    Number(row[spec.medianKey]) || 0,
    Number(row[spec.q3Key]) || 0,
    Number(row[spec.maxKey]) || 0,
  ]);

  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    tooltip: { trigger: "item" },
    xAxis: {
      type: "category",
      data: categories,
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      axisLabel: axisTextStyle,
      splitLine: splitLineStyle,
    },
    yAxis: {
      type: "value",
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      axisLabel: axisTextStyle,
      splitLine: splitLineStyle,
    },
    series: [
      {
        type: "boxplot",
        data: values,
        itemStyle: { borderColor: CHART_PALETTE[0] },
      },
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 320, width: "100%" }} />
    </div>
  );
}

function HistogramChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "histogram" }>;
  ref?: Ref<ReactECharts>;
}) {
  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: spec.data.map((row) => row[spec.binKey]),
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      axisLabel: axisTextStyle,
      splitLine: splitLineStyle,
    },
    yAxis: {
      type: "value",
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      axisLabel: axisTextStyle,
      splitLine: splitLineStyle,
    },
    series: [
      {
        type: "bar",
        // Bins are contiguous ranges, so bars should touch (unlike a regular
        // categorical bar chart, which needs visual gaps between categories).
        barCategoryGap: "0%",
        data: spec.data.map((row) => row[spec.countKey]),
      },
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 320, width: "100%" }} />
    </div>
  );
}

function WaterfallChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "waterfall" }>;
  ref?: Ref<ReactECharts>;
}) {
  const totalKey = spec.totalKey;
  let runningTotal = 0;
  const categories: unknown[] = [];
  const bases: number[] = [];
  const displays: Array<{ value: number; itemStyle: { color: string } }> = [];

  for (const row of spec.data) {
    const rawValue = Number(row[spec.valueKey]) || 0;
    const isTotalRow = Boolean(totalKey && row[totalKey]);
    categories.push(row[spec.categoryKey]);

    if (isTotalRow) {
      bases.push(0);
      displays.push({ value: rawValue, itemStyle: { color: CHART_PALETTE[0] } });
      runningTotal = rawValue;
    } else {
      const base = rawValue >= 0 ? runningTotal : runningTotal + rawValue;
      bases.push(base);
      displays.push({
        value: Math.abs(rawValue),
        itemStyle: { color: rawValue >= 0 ? CHART_PALETTE[0] : CHART_PALETTE[2] },
      });
      runningTotal += rawValue;
    }
  }

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: Array<{ dataIndex: number }>) => {
        const row = spec.data[params[0]?.dataIndex ?? 0];
        return `${row?.[spec.categoryKey]}: ${row?.[spec.valueKey]}`;
      },
    },
    xAxis: {
      type: "category",
      data: categories,
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      axisLabel: axisTextStyle,
      splitLine: splitLineStyle,
    },
    yAxis: {
      type: "value",
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      axisLabel: axisTextStyle,
      splitLine: splitLineStyle,
    },
    series: [
      {
        // Invisible spacer series that lifts the visible bar to its correct
        // floating height - the classic ECharts waterfall technique.
        type: "bar",
        stack: "waterfall",
        itemStyle: { color: "transparent" },
        emphasis: { itemStyle: { color: "transparent" } },
        silent: true,
        data: bases,
      },
      {
        type: "bar",
        stack: "waterfall",
        data: displays,
      },
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 320, width: "100%" }} />
    </div>
  );
}

interface HierarchyTreeNode {
  name: string;
  value?: number;
  children?: HierarchyTreeNode[];
}

/**
 * Groups flat {path, value} leaves into a nested tree by shared path
 * prefixes, for ECharts' treemap/sunburst `data` shape. Duplicate full paths
 * have their values summed rather than producing duplicate leaves.
 */
function buildHierarchyTree(nodes: Array<{ path: string[]; value: number }>): HierarchyTreeNode[] {
  const roots: HierarchyTreeNode[] = [];

  for (const node of nodes) {
    let siblings = roots;
    let current: HierarchyTreeNode | undefined;

    node.path.forEach((segment, depth) => {
      current = siblings.find((child) => child.name === segment);
      if (!current) {
        current = { name: segment };
        siblings.push(current);
      }
      if (depth === node.path.length - 1) {
        current.value = (current.value ?? 0) + node.value;
      } else {
        current.children = current.children ?? [];
        siblings = current.children;
      }
    });
  }

  return roots;
}

function TreemapChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "treemap" }>;
  ref?: Ref<ReactECharts>;
}) {
  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    tooltip: { formatter: "{b}: {c}" },
    series: [
      {
        type: "treemap",
        data: buildHierarchyTree(spec.data),
        label: { color: "#fff" },
        breadcrumb: { show: false },
        itemStyle: { borderColor: CHART_RULE },
      },
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 360, width: "100%" }} />
    </div>
  );
}

function SunburstChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "sunburst" }>;
  ref?: Ref<ReactECharts>;
}) {
  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    tooltip: { formatter: "{b}: {c}" },
    series: [
      {
        type: "sunburst",
        data: buildHierarchyTree(spec.data),
        radius: [0, "90%"],
        label: { color: CHART_INK, rotate: "radial" },
        itemStyle: { borderColor: "#fff", borderWidth: 1 },
      },
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 360, width: "100%" }} />
    </div>
  );
}

function SankeyChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "sankey" }>;
  ref?: Ref<ReactECharts>;
}) {
  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    tooltip: { trigger: "item" },
    series: [
      {
        type: "sankey",
        data: spec.nodes,
        links: spec.links,
        label: { color: CHART_INK },
        lineStyle: { color: "gradient", curveness: 0.5 },
        itemStyle: { color: CHART_PALETTE[0], borderColor: CHART_RULE },
      },
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 360, width: "100%" }} />
    </div>
  );
}

function CalendarChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "calendar" }>;
  ref?: Ref<ReactECharts>;
}) {
  const dates = spec.data.map((cell) => cell.date).sort();
  const values = spec.data.map((cell) => cell.value);
  const maxValue = values.length > 0 ? Math.max(...values) : 0;

  const option = {
    backgroundColor: "transparent",
    tooltip: { trigger: "item" },
    visualMap: {
      min: 0,
      max: maxValue,
      calculable: true,
      orient: "horizontal",
      left: "center",
      top: 0,
      inRange: { color: [CHART_RULE, CHART_PALETTE[0]] },
      textStyle: axisTextStyle,
    },
    calendar: {
      top: 60,
      range: dates.length > 0 ? [dates[0], dates[dates.length - 1]] : undefined,
      cellSize: ["auto", 16],
      itemStyle: { borderWidth: 1, borderColor: CHART_RULE, color: "transparent" },
      dayLabel: { color: CHART_INK },
      monthLabel: { color: CHART_INK },
      yearLabel: { show: false },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: spec.data.map((cell) => [cell.date, cell.value]),
      },
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts ref={ref} option={option} style={{ height: 200, width: "100%" }} />
    </div>
  );
}

function TableChart({ spec }: { spec: Extract<ChartSpec, { kind: "table" }> }) {
  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <Table>
        <TableHeader>
          <TableRow>
            {spec.columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {spec.rows.map((row, index) => (
            <TableRow key={index}>
              {spec.columns.map((column) => (
                <TableCell key={column} className="font-mono">
                  {formatCellValue(row[column])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function KpiChart({ spec }: { spec: Extract<ChartSpec, { kind: "kpi" }> }) {
  const delta = spec.delta;
  const isPositive = typeof delta === "number" && delta > 0;
  const isNegative = typeof delta === "number" && delta < 0;
  const target = spec.target;
  const trend = spec.trend;

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground text-sm font-normal">
            {spec.label}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-3xl font-semibold">
              {formatCellValue(spec.value)}
            </span>
            {typeof delta === "number" && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-mono text-xs font-medium",
                  !isPositive && !isNegative && "bg-muted text-muted-foreground"
                )}
                style={
                  isPositive
                    ? { backgroundColor: "#E1EBE4", color: "#1F4A36" }
                    : isNegative
                      ? { backgroundColor: "#F3DEDA", color: "#7A2A20" }
                      : undefined
                }
              >
                {delta > 0 ? "+" : ""}
                {delta}
              </span>
            )}
            {trend && trend.length > 1 && (
              <span className="ml-auto">
                <Sparkline values={trend} />
              </span>
            )}
          </div>
          {typeof target === "number" && typeof spec.value === "number" && (
            <div className="flex flex-col gap-1">
              <BulletBar value={spec.value} target={target} />
              <span className="font-mono text-xs text-muted-foreground">
                Target: {formatCellValue(target)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Renders a ChartSpec via the appropriate ECharts-backed (or plain HTML, for
 * table/kpi) subcomponent. Accepts an optional `ref` (React 19's ref-as-prop,
 * no `forwardRef` needed) that is forwarded down to the underlying
 * `echarts-for-react` instance for chart kinds backed by ECharts - callers
 * can use `ref.current?.getEchartsInstance()` to access the live chart
 * instance, e.g. to rasterize it via `getDataURL()` for PDF export (see
 * `frontend/src/lib/build-pdf.ts`). table/kpi have no ECharts instance, so
 * the ref is simply unused for those kinds.
 */
export function ChartRenderer({ spec, ref }: { spec: ChartSpec; ref?: Ref<ReactECharts> }) {
  switch (spec.kind) {
    case "bar":
    case "line":
    case "area":
      return <CategoryChart spec={spec} ref={ref} />;
    case "pie":
      return <PieChart spec={spec} ref={ref} />;
    case "table":
      return <TableChart spec={spec} />;
    case "kpi":
      return <KpiChart spec={spec} />;
    case "scatter":
      return <ScatterChart spec={spec} ref={ref} />;
    case "combo":
      return <ComboChart spec={spec} ref={ref} />;
    case "funnel":
      return <FunnelChart spec={spec} ref={ref} />;
    case "radar":
      return <RadarChart spec={spec} ref={ref} />;
    case "gauge":
      return <GaugeChart spec={spec} ref={ref} />;
    case "heatmap":
      return <HeatmapChart spec={spec} ref={ref} />;
    case "boxplot":
      return <BoxplotChart spec={spec} ref={ref} />;
    case "histogram":
      return <HistogramChart spec={spec} ref={ref} />;
    case "waterfall":
      return <WaterfallChart spec={spec} ref={ref} />;
    case "treemap":
      return <TreemapChart spec={spec} ref={ref} />;
    case "sunburst":
      return <SunburstChart spec={spec} ref={ref} />;
    case "sankey":
      return <SankeyChart spec={spec} ref={ref} />;
    case "calendar":
      return <CalendarChart spec={spec} ref={ref} />;
    default: {
      const exhaustiveCheck: never = spec;
      return exhaustiveCheck;
    }
  }
}
