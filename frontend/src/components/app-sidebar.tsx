"use client";

import * as React from "react";
import { SquarePen, Eye } from "lucide-react";

import type { SchemaProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SchemaSummary } from "@/components/schema-summary";
import { cn } from "@/lib/utils";

function summarizeProfile(profile: SchemaProfile): string {
  if (profile.tables.length === 0) return "No tables found";
  if (profile.tables.length === 1) {
    const [table] = profile.tables;
    return `${table.name} · ${table.rowCount.toLocaleString()} rows`;
  }
  return `${profile.tables.length} tables connected`;
}

interface AppSidebarProps {
  profile: SchemaProfile | null;
  onNewChat: () => void;
  newChatDisabled?: boolean;
  badge?: string;
  tagline?: string;
  footer: React.ReactNode;
}

/**
 * A persistent left-rail navigation (chat-app convention: new conversation,
 * quick access to connected-source info) rather than the ask/answer flow
 * living entirely in the main column. Keeps the ledger identity (mono
 * wordmark, pine accent, hairline rules) rather than reskinning to match
 * any specific reference product.
 */
export function AppSidebar({
  profile,
  onNewChat,
  newChatDisabled,
  badge,
  tagline,
  footer,
}: AppSidebarProps) {
  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col gap-4 border-r border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-base font-bold tracking-[0.2em] uppercase text-foreground">
            DataSense<span className="text-primary">·</span>AI
          </span>
          {badge && (
            <span className="rounded-sm bg-greenbar px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
              {badge}
            </span>
          )}
        </div>
        {tagline && <p className="text-xs text-muted-foreground">{tagline}</p>}
      </div>

      <nav className="flex flex-col gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={newChatDisabled}
          onClick={onNewChat}
          className="justify-start gap-2"
        >
          <SquarePen />
          New chat
        </Button>

        {profile && (
          <Dialog>
            <DialogTrigger
              render={<Button variant="ghost" size="sm" className="justify-start gap-2" />}
            >
              <Eye />
              View schema
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Data schema</DialogTitle>
                <DialogDescription>
                  Tables, columns, and a sample of the connected data.
                </DialogDescription>
              </DialogHeader>
              <SchemaSummary profile={profile} />
            </DialogContent>
          </Dialog>
        )}
      </nav>

      {profile && (
        <p
          className={cn(
            "truncate rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs text-muted-foreground",
          )}
          title={summarizeProfile(profile)}
        >
          {summarizeProfile(profile)}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">{footer}</div>
    </aside>
  );
}
