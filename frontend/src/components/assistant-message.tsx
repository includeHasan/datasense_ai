"use client";

import * as React from "react";

import type { FinalAnswer } from "@/lib/types";
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
import { formatCellValue } from "@/lib/utils";

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
}: {
  answer: FinalAnswer;
  entryNumber?: number;
}) {
  const [showDetails, setShowDetails] = React.useState(false);
  const sampleColumns =
    answer.sampleRows.length > 0 ? Object.keys(answer.sampleRows[0]) : [];

  return (
    <div className="flex flex-col gap-4">
      {typeof entryNumber === "number" && (
        <p className="font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground">
          ENTRY {String(entryNumber).padStart(3, "0")}
        </p>
      )}
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.narrative}</p>

      <ChartRenderer spec={answer.chartSpec} />

      {answer.caveats && answer.caveats.length > 0 && (
        <ul className="list-inside list-disc text-sm text-muted-foreground">
          {answer.caveats.map((caveat, index) => (
            <li key={index}>{caveat}</li>
          ))}
        </ul>
      )}

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
    </div>
  );
}
