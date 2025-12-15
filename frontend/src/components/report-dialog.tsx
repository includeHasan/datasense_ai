"use client";

import * as React from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ApiError, generateReport } from "@/lib/api";
import { buildReportPdf } from "@/lib/build-pdf";
import { DEFAULT_REPORT_SECTION_TOPICS } from "@/lib/types";
import type { AgentEvent, GenerateReportResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AgentActivityTrace } from "@/components/agent-activity-trace";
import { cn } from "@/lib/utils";

type ReportMode = "conversation" | "generate";

interface ReportDialogProps {
  token: string;
  sourceId: string | null;
  activeConversationId: string | null;
}

/**
 * Lets the user export a downloadable PDF report, either from the current
 * conversation or freshly generated from the connected source's schema
 * (optionally steered by free-text preferences and/or section checkboxes).
 * Follows the same base-nova `<DialogTrigger render={...}>` pattern already
 * used for the schema-view dialog in app-sidebar.tsx. While a report is
 * generating, reuses `AgentActivityTrace` so the user sees the same live
 * per-node progress as a normal question.
 */
export function ReportDialog({ token, sourceId, activeConversationId }: ReportDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<ReportMode>(activeConversationId ? "conversation" : "generate");
  const [freeText, setFreeText] = React.useState("");
  const [selectedSections, setSelectedSections] = React.useState<string[]>([]);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [isBuildingPdf, setIsBuildingPdf] = React.useState(false);
  const [events, setEvents] = React.useState<AgentEvent[]>([]);
  const [result, setResult] = React.useState<GenerateReportResponse | null>(null);

  const canExportConversation = Boolean(activeConversationId);
  const canGenerate = Boolean(sourceId);

  function resetState() {
    setIsGenerating(false);
    setIsBuildingPdf(false);
    setEvents([]);
    setResult(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetState();
  }

  function toggleSection(section: string) {
    setSelectedSections((prev) =>
      prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section],
    );
  }

  async function handleGenerate() {
    setIsGenerating(true);
    setEvents([]);
    setResult(null);
    const trace: AgentEvent[] = [];

    try {
      const body =
        mode === "conversation" && activeConversationId
          ? { conversationId: activeConversationId }
          : {
              sourceId: sourceId as string,
              preferences: {
                freeText: freeText.trim() || undefined,
                sections: selectedSections.length > 0 ? selectedSections : undefined,
              },
            };

      const response = await generateReport(token, body, (event) => {
        trace.push(event);
        setEvents([...trace]);
      });
      setResult(response);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Failed to generate report.";
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleDownload() {
    if (!result) return;
    setIsBuildingPdf(true);
    try {
      await buildReportPdf(result);
    } catch {
      toast.error("Failed to build the PDF for this report.");
    } finally {
      setIsBuildingPdf(false);
    }
  }

  if (!canExportConversation && !canGenerate) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<Button variant="ghost" size="sm" className="justify-start gap-2" disabled={!canGenerate} />}
      >
        <FileDown />
        Generate report
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate report</DialogTitle>
          <DialogDescription>
            Export a PDF with narrative summaries, charts, and data tables.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === "conversation" ? "default" : "outline"}
                size="sm"
                disabled={!canExportConversation || isGenerating}
                onClick={() => setMode("conversation")}
              >
                Export this chat
              </Button>
              <Button
                type="button"
                variant={mode === "generate" ? "default" : "outline"}
                size="sm"
                disabled={!canGenerate || isGenerating}
                onClick={() => setMode("generate")}
              >
                Generate new report
              </Button>
            </div>

            {mode === "conversation" && (
              <p className="text-sm text-muted-foreground">
                Exports the current conversation&apos;s analysis answers (narrative, chart, and sample
                data for each) as a PDF.
              </p>
            )}

            {mode === "generate" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="report-preferences">What should the report cover? (optional)</Label>
                  <textarea
                    id="report-preferences"
                    value={freeText}
                    disabled={isGenerating}
                    onChange={(e) => setFreeText(e.target.value)}
                    placeholder="e.g. focus on this quarter's revenue and top customers"
                    rows={3}
                    className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Or pick sections (optional)</Label>
                  <div className="flex flex-col gap-1">
                    {DEFAULT_REPORT_SECTION_TOPICS.map((section) => (
                      <label
                        key={section}
                        className={cn(
                          "flex items-center gap-2 text-sm text-muted-foreground",
                          isGenerating && "pointer-events-none opacity-50",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedSections.includes(section)}
                          onChange={() => toggleSection(section)}
                          className="size-3.5 rounded border-input"
                        />
                        {section}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {isGenerating && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Building your report...
            </p>
            <AgentActivityTrace events={events} isLive />
          </div>
        )}

        {result && !isGenerating && (
          <div className="flex flex-col gap-3">
            <AgentActivityTrace events={events} />
            <p className="text-sm text-foreground">
              <span className="font-medium">{result.title}</span> is ready.
            </p>
          </div>
        )}

        <DialogFooter showCloseButton={!isGenerating}>
          {result ? (
            <Button onClick={handleDownload} disabled={isBuildingPdf} className="gap-2">
              {isBuildingPdf ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown />}
              {isBuildingPdf ? "Building PDF..." : "Download PDF"}
            </Button>
          ) : (
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || (mode === "conversation" ? !canExportConversation : !canGenerate)}
              className="gap-2"
            >
              {isGenerating && <Loader2 className="size-3.5 animate-spin" />}
              Generate
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
