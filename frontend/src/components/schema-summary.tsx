"use client";

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import type { SchemaProfile, SchemaTable } from "@/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn, formatCellValue } from "@/lib/utils";

function TableSummaryCard({ table }: { table: SchemaTable }) {
  const [showSample, setShowSample] = React.useState(false);
  const sampleColumns = table.columns.map((column) => column.name);

  return (
    <Card className="rounded-none border-x-0 border-y border-border">
      <CardHeader>
        <CardTitle>{table.name}</CardTitle>
        <CardDescription className="font-mono">
          {table.rowCount.toLocaleString()} rows
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Column</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Nullable</TableHead>
              <TableHead>Null rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.columns.map((column) => (
              <TableRow key={column.name}>
                <TableCell className="font-mono font-medium">{column.name}</TableCell>
                <TableCell className="font-mono">{column.type}</TableCell>
                <TableCell className="font-mono">{column.nullable ? "Yes" : "No"}</TableCell>
                <TableCell className="font-mono">
                  {typeof column.nullRate === "number"
                    ? `${(column.nullRate * 100).toFixed(1)}%`
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {table.sampleRows.length > 0 && (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setShowSample((prev) => !prev)}
              aria-expanded={showSample}
            >
              <ChevronDownIcon
                className={cn(
                  "size-4 transition-transform",
                  showSample && "rotate-180"
                )}
              />
              {showSample ? "Hide sample rows" : "Show sample rows"}
            </Button>
            {showSample && (
              <Table>
                <TableHeader>
                  <TableRow>
                    {sampleColumns.map((column) => (
                      <TableHead key={column}>{column}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {table.sampleRows.map((row, index) => (
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
      </CardContent>
    </Card>
  );
}

export function SchemaSummary({ profile }: { profile: SchemaProfile }) {
  return (
    <div className="greenbar-bg flex flex-col gap-4 rounded-md p-4">
      {profile.tables.map((table) => (
        <TableSummaryCard key={table.name} table={table} />
      ))}
    </div>
  );
}
