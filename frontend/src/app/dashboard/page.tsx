"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pin } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth-provider";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { Dashboard } from "@/lib/types";
import { AppSidebar } from "@/components/app-sidebar";
import { ChartRenderer } from "@/components/chart-renderer";
import { Button } from "@/components/ui/button";

/**
 * The authenticated user's personal dashboard of pinned analysis answers -
 * a grid of chart + narrative cards, each with an unpin action, for
 * recurring monitoring outside the chat flow.
 */
export default function DashboardPage() {
  const router = useRouter();
  const { user, token, logout, isLoading } = useAuth();

  const [dashboard, setDashboard] = React.useState<Dashboard | null>(null);
  const [isLoadingDashboard, setIsLoadingDashboard] = React.useState(true);

  const refreshDashboard = React.useCallback(() => {
    if (!token) return;
    Promise.resolve()
      .then(() => {
        setIsLoadingDashboard(true);
        return api.getDashboard(token);
      })
      .then(setDashboard)
      .catch((error) => {
        const message =
          error instanceof ApiError ? error.message : "Failed to load dashboard.";
        toast.error(message);
      })
      .finally(() => setIsLoadingDashboard(false));
  }, [token]);

  React.useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);

  async function handleUnpin(itemId: string) {
    if (!token || !dashboard) return;
    try {
      const updated = await api.unpinFromDashboard(token, dashboard.id, itemId);
      setDashboard(updated);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Failed to unpin item.";
      toast.error(message);
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
          <h1 className="font-heading text-2xl font-semibold text-foreground">
            {dashboard?.title ?? "My Dashboard"}
          </h1>

          {isLoadingDashboard ? (
            <p className="text-sm text-muted-foreground">Loading pinned items...</p>
          ) : !dashboard || dashboard.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing pinned yet. Ask a question in the chat, then use &quot;Pin to
              dashboard&quot; on an answer to track it here.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {dashboard.items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    {item.question && (
                      <p className="font-mono text-xs text-muted-foreground">{item.question}</p>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="flex-shrink-0"
                      title="Unpin"
                      aria-label="Unpin from dashboard"
                      onClick={() => handleUnpin(item.id)}
                    >
                      <Pin className="size-4" />
                    </Button>
                  </div>

                  {item.chartSpec && <ChartRenderer spec={item.chartSpec} />}

                  {item.narrative && (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.narrative}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
