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

function ChartTitle({ title }: { title: string }) {
  return <h3 className="font-heading text-base font-medium">{title}</h3>;
}

function CategoryChart({
  spec,
  ref,
}: {
  spec: Extract<ChartSpec, { kind: "bar" | "line" | "area" }>;
  ref?: Ref<ReactECharts>;
}) {
  const horizontal = spec.orientation === "horizontal";
  const categoryAxis = {
    type: "category" as const,
    data: spec.data.map((row) => row[spec.xKey]),
    axisLine: axisLineStyle,
    axisTick: axisLineStyle,
    axisLabel: axisTextStyle,
    splitLine: splitLineStyle,
  };
  const valueAxis = {
    type: "value" as const,
    axisLine: axisLineStyle,
    axisTick: axisLineStyle,
    axisLabel: axisTextStyle,
    splitLine: splitLineStyle,
  };

  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    legend: {
      data: spec.series.map((s) => s.label),
      textStyle: axisTextStyle,
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: spec.series.map((s) => ({
      name: s.label,
      type: spec.kind === "area" ? "line" : spec.kind,
      areaStyle: spec.kind === "area" ? {} : undefined,
      stack: spec.stacked ? "total" : undefined,
      data: spec.data.map((row) => row[s.key]),
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
    tooltip: { trigger: "item" },
    legend: {
      orient: "vertical",
      left: "left",
      textStyle: axisTextStyle,
    },
    series: [
      {
        type: "pie",
        radius: spec.donut ? ["40%", "70%"] : "60%",
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
    series: groups.map((group) => ({
      name: group ?? spec.title,
      type: "scatter",
      data: spec.data
        .filter((row) => !spec.seriesKey || String(row[spec.seriesKey]) === group)
        .map((row) => [row[spec.xKey], row[spec.yKey]]),
    })),
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
    tooltip: { trigger: "axis" },
    legend: {
      data: [...spec.barSeries, ...spec.lineSeries].map((s) => s.label),
      textStyle: axisTextStyle,
    },
    xAxis: {
      type: "category",
      data: spec.data.map((row) => row[spec.xKey]),
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      axisLabel: axisTextStyle,
      splitLine: splitLineStyle,
    },
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

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground text-sm font-normal">
            {spec.label}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-baseline gap-3">
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
    default: {
      const exhaustiveCheck: never = spec;
      return exhaustiveCheck;
    }
  }
}
