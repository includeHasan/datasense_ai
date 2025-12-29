"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";

import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { askStream } from "@/lib/api-stream";
import type { AgentEvent, ChatTurn, FinalAnswer, SchemaProfile } from "@/lib/types";
import { AppSidebar } from "@/components/app-sidebar";
import { SuggestedQuestions } from "@/components/suggested-questions";
import { AskBox } from "@/components/ask-box";
import { UserMessage } from "@/components/user-message";
import { AssistantMessage } from "@/components/assistant-message";
import { AgentActivityTrace } from "@/components/agent-activity-trace";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. Please define it in your .env.local file."
    );
  }
  return url;
}

const CHAT_STORAGE_KEY = "ds_demo_chat";
const DEMO_HISTORY_TURNS = 5;

export default function DemoPage() {
  const [profile, setProfile] = React.useState<SchemaProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = React.useState(true);
  const [suggestedQuestions, setSuggestedQuestions] = React.useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = React.useState(true);
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [isAsking, setIsAsking] = React.useState(false);
  const [activityEvents, setActivityEvents] = React.useState<AgentEvent[]>([]);
  const [isChatHydrated, setIsChatHydrated] = React.useState(false);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Restore a persisted chat session (if any) so a page reload doesn't lose
  // the conversation — this demo is meant to be a durable, no-login sandbox.
  // Deferred into a microtask (matching auth-provider.tsx's hydration
  // pattern) so the effect only kicks off the read rather than setting
  // state directly in its own body.
  React.useEffect(() => {
    Promise.resolve()
      .then(() => {
        const stored = localStorage.getItem(CHAT_STORAGE_KEY);
        if (!stored) return;
        const parsed: unknown = JSON.parse(stored);
        const isValidChatTurns =
          Array.isArray(parsed) &&
          parsed.every(
            (item) =>
              item && typeof item === "object" && "question" in item && "answer" in item,
          );
        if (isValidChatTurns) {
          setTurns(parsed as ChatTurn[]);
        } else {
          // Stored data is from an older, incompatible chat format; drop it
          // rather than crash on shapes the current UI doesn't expect.
          localStorage.removeItem(CHAT_STORAGE_KEY);
        }
      })
      .catch(() => {
        // Corrupt or inaccessible storage; start with an empty chat.
      })
      .finally(() => setIsChatHydrated(true));
  }, []);

  React.useEffect(() => {
    if (!isChatHydrated) return;
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(turns));
    } catch {
      // Storage full or unavailable; the chat just won't persist this time.
    }
  }, [turns, isChatHydrated]);

  React.useEffect(() => {
    api
      .getDemoProfile()
      .then(setProfile)
      .catch((error) => {
        const message =
          error instanceof ApiError ? error.message : "Failed to load the demo dataset.";
        toast.error(message);
      })
      .finally(() => setIsLoadingProfile(false));

    api
      .getDemoSuggestedQuestions()
      .then(({ questions }) => setSuggestedQuestions(questions))
      .catch(() => {
        // Suggested questions are a nice-to-have; silently skip on failure.
      })
      .finally(() => setIsLoadingSuggestions(false));
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, isAsking]);

  async function handleAsk(question: string) {
    setIsAsking(true);
    setActivityEvents([]);
    const trace: AgentEvent[] = [];
    try {
      // Thread the last few turns as history so follow-ups ("tell me about
      // two of those") resolve correctly even though the demo has no
      // server-persisted conversation to load them from.
      const priorTurns = turns.slice(-DEMO_HISTORY_TURNS);
      const answer = await askStream<FinalAnswer>(
        `${getApiBaseUrl()}/demo/ask`,
        { question, priorTurns },
        {},
        (event) => {
          trace.push(event);
          setActivityEvents([...trace]);
        },
      );
      setTurns((prev) => [...prev, { question, answer, trace }]);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Failed to get an answer.";
      toast.error(message);
    } finally {
      setIsAsking(false);
      setActivityEvents([]);
    }
  }

  function handleNewChat() {
    setTurns([]);
    try {
      localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      // Nothing to clean up if storage isn't available.
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden">
      <AppSidebar
        profile={profile}
        onNewChat={handleNewChat}
        newChatDisabled={!profile}
        badge="Live demo"
        tagline="Sample e-commerce data. No sign-up, no setup."
        footer={
          <Link href="/login" className="w-full">
            <Button variant="outline" size="sm" className="w-full">
              Log in to use your own data
            </Button>
          </Link>
        }
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {isLoadingProfile || !profile ? (
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 p-6">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-12 w-full rounded-full" />
          </div>
        ) : turns.length === 0 ? (
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 p-6">
            <h1 className="font-heading text-center text-2xl font-semibold text-foreground">
              What do you want to know?
            </h1>
            <AskBox onAsk={handleAsk} loading={isAsking} className="w-full" />
            <SuggestedQuestions
              questions={suggestedQuestions}
              loading={isLoadingSuggestions}
              disabled={isAsking}
              onSelect={handleAsk}
            />
          </div>
        ) : (
          <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden p-6">
            <div
              ref={scrollRef}
              className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto pr-1 pb-4"
            >
              {turns.map((turn, index) => (
                <div key={index} className="flex flex-shrink-0 flex-col gap-4">
                  <UserMessage question={turn.question} />
                  <AssistantMessage
                    answer={turn.answer}
                    entryNumber={index + 1}
                    onFollowup={handleAsk}
                    trace={turn.trace}
                  />
                </div>
              ))}
              {isAsking && (
                <div className="flex-shrink-0">
                  <AgentActivityTrace events={activityEvents} isLive />
                </div>
              )}
            </div>
            <AskBox onAsk={handleAsk} loading={isAsking} className="mt-4 flex-shrink-0" />
          </div>
        )}
      </main>
    </div>
  );
}
