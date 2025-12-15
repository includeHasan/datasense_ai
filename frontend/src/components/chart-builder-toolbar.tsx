"use client";

import * as React from "react";
import {
  BarChart3,
  LineChart,
  AreaChart,
  PieChart,
  type LucideIcon,
} from "lucide-react";

import type { ChartSpec } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_ICON: Partial<Record<ChartSpec["kind"], LucideIcon>> = {
  bar: BarChart3,
  line: LineChart,
  area: AreaChart,
  pie: PieChart,
};

const KIND_LABEL: Partial<Record<ChartSpec["kind"], string>> = {
  bar: "Bar",
  line: "Line",
  area: "Area",
  pie: "Pie",
};

/**
 * Small segmented control letting the user switch an already-rendered chart
 * between compatible kinds without another backend call. Purely client-side
 * UI state - the caller owns which spec is active and re-renders on change.
 */
export function ChartBuilderToolbar({
  kinds,
  activeKind,
  onSelect,
}: {
  /** Candidate kinds to offer, including the current one. */
  kinds: ChartSpec["kind"][];
  activeKind: ChartSpec["kind"];
  onSelect: (kind: ChartSpec["kind"]) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Chart type"
      className="flex w-fit gap-0.5 rounded-lg border border-border bg-background p-0.5"
    >
      {kinds.map((kind) => {
        const Icon = KIND_ICON[kind];
        const isActive = kind === activeKind;
        return (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={`Show as ${KIND_LABEL[kind] ?? kind} chart`}
            title={KIND_LABEL[kind] ?? kind}
            onClick={() => onSelect(kind)}
            className={cn(
              "flex items-center justify-center rounded-md p-1.5 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              isActive && "bg-muted text-foreground"
            )}
          >
            {Icon ? <Icon className="size-4" /> : <span className="text-xs">{kind}</span>}
          </button>
        );
      })}
    </div>
  );
}
