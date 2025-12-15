"use client";

import * as React from "react";
import { Pin } from "lucide-react";

import type { AgentEvent, ChartSpec, FinalAnswer } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartRenderer } from "@/components/chart-renderer";
import { ChartBuilderToolbar } from "@/components/chart-builder-toolbar";
import { AgentActivityTrace } from "@/components/agent-activity-trace";
import { compatibleKinds, recastChartSpec } from "@/lib/chart-transform";
import { formatCellValue } from "@/lib/utils";

/**
 * Manages the client-only "recast" state for an analysis answer's chart:
 * starts at the backend-provided spec/kind, and lets the user switch to any
 * compatible kind without a backend round-trip.
 */
function useChartBuilder(chartSpec: ChartSpec | null) {
  const [activeSpec, setActiveSpec] = React.useState<ChartSpec | null>(chartSpec);
  const [lastSeenSpec, setLastSeenSpec] = React.useState<ChartSpec | null>(chartSpec);

  // Reset the recast state whenever a new answer's chart spec arrives, per
  // the React-recommended "adjust state during render" pattern (avoids the
  // extra render + cascading setState that a useEffect-based sync causes).
  if (chartSpec !== lastSeenSpec) {
    setLastSeenSpec(chartSpec);
    setActiveSpec(chartSpec);
  }

  const kinds = React.useMemo(() => {
    if (!activeSpec) return [];
    return [activeSpec.kind, ...compatibleKinds(activeSpec)];
  }, [activeSpec]);

  const selectKind = React.useCallback(
    (kind: ChartSpec["kind"]) => {
      if (!activeSpec) return;
      setActiveSpec(recastChartSpec(activeSpec, kind));
    },
    [activeSpec]
  );

  return { activeSpec, kinds, selectKind };
}

/**
 * Renders one assistant turn as plain flowing content (no card border) —
 * the chat-app convention where only the user's side gets a bubble and the
 * assistant's response reads like part of the page. The receipt panel below
 * keeps its own bounded, torn-edge treatment since it's a distinct artifact
 * (the query "receipt"), not part of the narrative prose.
 */
export function AssistantMessage({
  answer,
  entryNumber,
  onFollowup,
  trace,
  question,
  sourceId,
  onPin,
}: {
  answer: FinalAnswer;
  entryNumber?: number;
  onFollowup?: (question: string) => void;
  /** Completed agent activity trace captured while this turn was streaming. */
  trace?: AgentEvent[];
  /** The user's question for this turn, forwarded to onPin so the pinned item can show it. */
  question?: string;
  /** The connected source this turn's answer came from, forwarded to onPin. */
  sourceId?: string | null;
  /**
   * Pins this turn to the user's dashboard. Only offered for analysis-type
   * answers, and only in the authenticated workspace (the demo page has no
   * account to pin to, so it omits this prop entirely).
   */
  onPin?: (pin: {
    chartSpec: ChartSpec | null;
    narrative: string;
    sourceId?: string;
    question?: string;
  }) => void;
}) {
  const [showDetails, setShowDetails] = React.useState(false);
  const [showTrace, setShowTrace] = React.useState(false);
  const sampleColumns =
    answer.sampleRows.length > 0 ? Object.keys(answer.sampleRows[0]) : [];
  const hasReceipt = answer.answerType !== "conversation" && Boolean(answer.sql);
  const hasTrace = Boolean(trace && trace.length > 0);
  const { activeSpec, kinds, selectKind } = useChartBuilder(answer.chartSpec);
  const isAnalysis = answer.answerType === "analysis" || Boolean(activeSpec);
  const showChartBuilder = isAnalysis && Boolean(activeSpec) && kinds.length > 1;
  const showPin = isAnalysis && Boolean(onPin);

  function handlePin() {
    onPin?.({
      // Pin whatever chart variant the user currently has selected via the
      // chart-builder toolbar, not necessarily the backend's original kind.
      chartSpec: activeSpec,
      narrative: answer.narrative,
      sourceId: sourceId ?? undefined,
      question,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {typeof entryNumber === "number" && (
        <p className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          ENTRY {String(entryNumber).padStart(3, "0")}
        </p>
      )}
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.narrative}</p>

      {activeSpec && (
        <div className="flex flex-col gap-3">
          {showChartBuilder && (
            <ChartBuilderToolbar
              kinds={kinds}
              activeKind={activeSpec.kind}
              onSelect={selectKind}
            />
          )}
          <ChartRenderer spec={activeSpec} />
        </div>
      )}

      {showPin && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit gap-2"
          onClick={handlePin}
        >
          <Pin className="size-4" />
          Pin to dashboard
        </Button>
      )}

      {answer.caveats && answer.caveats.length > 0 && (
        <ul className="list-inside list-disc text-sm text-muted-foreground">
          {answer.caveats.map((caveat, index) => (
            <li key={index}>{caveat}</li>
          ))}
        </ul>
      )}

      {answer.suggestedFollowups && answer.suggestedFollowups.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {answer.suggestedFollowups.map((followup) => (
            <button
              key={followup}
              type="button"
              onClick={() => onFollowup?.(followup)}
              className="rounded-full border border-border px-3 py-1.5 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {followup}
            </button>
          ))}
        </div>
      )}

      {hasTrace && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setShowTrace((prev) => !prev)}
            aria-expanded={showTrace}
          >
            {showTrace ? "Hide agent trace" : "Show agent trace"}
          </Button>

          {showTrace && (
            <div className="receipt-tear receipt-unfurl bg-greenbar p-4">
              <AgentActivityTrace events={trace ?? []} />
            </div>
          )}
        </div>
      )}

      {hasReceipt && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setShowDetails((prev) => !prev)}
            aria-expanded={showDetails}
          >
            {showDetails ? "Hide the receipt" : "Show the receipt"}
          </Button>

          {showDetails && (
            <div className="receipt-tear receipt-unfurl flex flex-col gap-3 bg-greenbar p-4">
              <pre className="overflow-x-auto rounded-sm bg-background p-3 font-mono text-xs">
                {answer.sql}
              </pre>
              {sampleColumns.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {sampleColumns.map((column) => (
                        <TableHead key={column} className="font-mono">
                          {column}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {answer.sampleRows.map((row, index) => (
                      <TableRow key={index}>
                        {sampleColumns.map((column) => (
                          <TableCell key={column} className="font-mono">
                            {formatCellValue(row[column])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
