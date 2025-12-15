import {
  Check,
  Compass,
  ListChecks,
  Code2,
  Play,
  Wrench,
  Sparkles,
  MessageCircle,
  FileCheck2,
  CircleDot,
} from "lucide-react";

import type { AgentEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const PHASE_ICONS: Record<string, typeof CircleDot> = {
  router: Compass,
  planStep: ListChecks,
  generateQuery: Code2,
  execute: Play,
  repair: Wrench,
  synthesize: Sparkles,
  converse: MessageCircle,
  assemble: FileCheck2,
};

/**
 * Live/completed vertical timeline of the agent graph's activity, driven by
 * the `AgentEvent[]` accumulated from `askStream`'s `onEvent` callback (see
 * lib/api-stream.ts). While a turn is in flight the last event renders as
 * "active" (animated, matching the app's printer-loading affordance); once
 * an answer has arrived, callers pass the finished trace back in and every
 * step renders as a completed checkmark.
 */
export function AgentActivityTrace({
  events,
  isLive = false,
}: {
  events: AgentEvent[];
  isLive?: boolean;
}) {
  if (events.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
        Agent trace
      </p>
      <ol className="flex flex-col" aria-label="Agent activity trace">
        {events.map((event, index) => {
          const Icon = PHASE_ICONS[event.phase] ?? CircleDot;
          const isLastEvent = index === events.length - 1;
          const isActive = isLive && isLastEvent && event.status === "running";

          return (
            <li
              key={`${event.phase}-${index}`}
              className="trace-step-in relative flex items-start gap-3 pb-4 last:pb-0"
            >
              {!isLastEvent && (
                <span
                  aria-hidden
                  className="absolute top-6 bottom-0 left-[11px] w-px bg-border"
                />
              )}
              <span
                className={cn(
                  "relative z-10 mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border transition-colors duration-300",
                  isActive
                    ? "printer-loading border-primary/40 text-primary ring-2 ring-greenbar"
                    : "border-border bg-background text-muted-foreground",
                )}
                aria-hidden
              >
                {isActive ? (
                  <Icon className="h-3.5 w-3.5" />
                ) : (
                  <Check className="h-3.5 w-3.5 text-foreground" />
                )}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                <span
                  className={cn(
                    "text-sm",
                    isActive ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {event.label}
                </span>
                {event.detail && (
                  <span className="truncate font-mono text-xs text-muted-foreground/80">
                    {event.detail}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
