"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileDown, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth-provider";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { buildReportPdf } from "@/lib/build-pdf";
import type { ReportSummary, SavedReport } from "@/lib/types";
import { AppSidebar } from "@/components/app-sidebar";
import { ChartRenderer } from "@/components/chart-renderer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The authenticated user's history of saved reports. Reports are persisted
 * server-side when generated (see POST /reports), so they survive refreshes.
 * Selecting one loads its full contents, renders an on-page preview of each
 * section (narrative + chart), and offers a "Download PDF" button that reuses
 * the existing client-side PDF assembly (lib/build-pdf.ts).
 */
export default function ReportsPage() {
  const router = useRouter();
  const { user, token, logout, isLoading } = useAuth();

  const [reports, setReports] = React.useState<ReportSummary[]>([]);
  const [isLoadingReports, setIsLoadingReports] = React.useState(true);
  const [selected, setSelected] = React.useState<SavedReport | null>(null);
  const [isLoadingReport, setIsLoadingReport] = React.useState(false);
  const [isBuildingPdf, setIsBuildingPdf] = React.useState(false);

  const refreshReports = React.useCallback(() => {
    if (!token) return;
    Promise.resolve()
      .then(() => {
        setIsLoadingReports(true);
        return api.listReports(token);
      })
      .then(setReports)
      .catch((error) => {
        const message =
          error instanceof ApiError ? error.message : "Failed to load reports.";
        toast.error(message);
      })
      .finally(() => setIsLoadingReports(false));
  }, [token]);

  React.useEffect(() => {
    refreshReports();
  }, [refreshReports]);

  async function handleSelect(id: string) {
    if (!token) return;
    setIsLoadingReport(true);
    try {
      const report = await api.getReport(token, id);
      setSelected(report);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Failed to load report.";
      toast.error(message);
    } finally {
      setIsLoadingReport(false);
    }
  }

  async function handleDownload() {
    if (!selected) return;
    setIsBuildingPdf(true);
    try {
      await buildReportPdf(selected);
    } catch {
      toast.error("Failed to build the PDF for this report.");
    } finally {
      setIsBuildingPdf(false);
    }
  }

  function handleLogout() {
    logout();
    router.push("/login");
  }

  if (isLoading || !user || !token) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden">
      <AppSidebar
        profile={null}
        onNewChat={() => router.push("/")}
        token={token}
        footer={
          <>
            <p className="truncate font-mono text-xs text-muted-foreground">{user.email}</p>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          </>
        }
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <h1 className="font-heading text-2xl font-semibold text-foreground">Reports</h1>

          {isLoadingReports ? (
            <p className="text-sm text-muted-foreground">Loading reports...</p>
          ) : reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reports yet. Use &quot;Generate report&quot; in the sidebar to create one - it
              will be saved here automatically.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-[18rem_1fr]">
              <nav className="flex flex-col gap-1">
                {reports.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => handleSelect(report.id)}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-md border border-border bg-card px-3 py-2 text-left outline-none hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/50",
                      selected?.id === report.id && "border-primary bg-background",
                    )}
                  >
                    <span className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                      <FileText className="size-3.5 flex-shrink-0" />
                      {report.title}
                    </span>
                    <span className="pl-5 text-xs text-muted-foreground">
                      {new Date(report.createdAt).toLocaleString()}
                    </span>
                  </button>
                ))}
              </nav>

              <div className="min-w-0">
                {isLoadingReport ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading report...
                  </p>
                ) : !selected ? (
                  <p className="text-sm text-muted-foreground">
                    Select a report to preview it and download the PDF.
                  </p>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex flex-col gap-0.5">
                        <h2 className="font-heading text-lg font-semibold text-foreground">
                          {selected.title}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {new Date(selected.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <Button onClick={handleDownload} disabled={isBuildingPdf} className="gap-2">
                        {isBuildingPdf ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <FileDown />
                        )}
                        {isBuildingPdf ? "Building PDF..." : "Download PDF"}
                      </Button>
                    </div>

                    <div className="flex flex-col gap-4">
                      {selected.sections.map((section, index) => (
                        <div
                          key={index}
                          className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
                        >
                          <p className="font-medium text-foreground">{section.title}</p>
                          {section.chartSpec && <ChartRenderer spec={section.chartSpec} />}
                          {section.narrative && (
                            <p className="whitespace-pre-wrap text-sm leading-relaxed">
                              {section.narrative}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
