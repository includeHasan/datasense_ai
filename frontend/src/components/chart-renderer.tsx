"use client";

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
}: {
  spec: Extract<ChartSpec, { kind: "bar" | "line" }>;
}) {
  const option = {
    color: CHART_PALETTE,
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    legend: {
      data: spec.series.map((s) => s.label),
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
    yAxis: {
      type: "value",
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      axisLabel: axisTextStyle,
      splitLine: splitLineStyle,
    },
    series: spec.series.map((s) => ({
      name: s.label,
      type: spec.kind,
      data: spec.data.map((row) => row[s.key]),
    })),
  };

  return (
    <div className="flex flex-col gap-3">
      <ChartTitle title={spec.title} />
      <ReactECharts option={option} style={{ height: 320, width: "100%" }} />
    </div>
  );
}

function PieChart({ spec }: { spec: Extract<ChartSpec, { kind: "pie" }> }) {
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
        radius: "60%",
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
      <ReactECharts option={option} style={{ height: 320, width: "100%" }} />
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

export function ChartRenderer({ spec }: { spec: ChartSpec }) {
  switch (spec.kind) {
    case "bar":
    case "line":
      return <CategoryChart spec={spec} />;
    case "pie":
      return <PieChart spec={spec} />;
    case "table":
      return <TableChart spec={spec} />;
    case "kpi":
      return <KpiChart spec={spec} />;
    default: {
      const exhaustiveCheck: never = spec;
      return exhaustiveCheck;
    }
  }
}
