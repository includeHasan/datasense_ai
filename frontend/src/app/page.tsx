"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useAuth } from "@/components/auth-provider";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { ChatTurn, SchemaProfile } from "@/lib/types";
import { SourceConnect } from "@/components/source-connect";
import { AppSidebar } from "@/components/app-sidebar";
import { SuggestedQuestions } from "@/components/suggested-questions";
import { AskBox } from "@/components/ask-box";
import { UserMessage } from "@/components/user-message";
import { AssistantMessage } from "@/components/assistant-message";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { Button } from "@/components/ui/button";

export default function Home() {
  const router = useRouter();
  const { user, token, logout, isLoading } = useAuth();

  const [sourceId, setSourceId] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<SchemaProfile | null>(null);
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [isAsking, setIsAsking] = React.useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = React.useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = React.useState(false);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, isAsking]);

  function handleConnected(newSourceId: string, newProfile: SchemaProfile) {
    setSourceId(newSourceId);
    setProfile(newProfile);
    setTurns([]);
    setSuggestedQuestions([]);

    if (!token) return;
    setIsLoadingSuggestions(true);
    api
      .getSuggestedQuestions(token, newSourceId)
      .then(({ questions }) => setSuggestedQuestions(questions))
      .catch(() => {
        // Suggested questions are a nice-to-have; silently skip on failure.
      })
      .finally(() => setIsLoadingSuggestions(false));
  }

  async function handleAsk(question: string) {
    if (!token || !sourceId) return;
    setIsAsking(true);
    try {
      const answer = await api.ask(token, sourceId, question);
      setTurns((prev) => [...prev, { question, answer }]);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Failed to get an answer.";
      toast.error(message);
    } finally {
      setIsAsking(false);
    }
  }

  function handleNewChat() {
    setTurns([]);
  }

  async function handleDisconnect() {
    if (!token || !sourceId) return;
    try {
      await api.deleteSource(token, sourceId);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Failed to disconnect source.";
      toast.error(message);
      return;
    }
    setSourceId(null);
    setProfile(null);
    setTurns([]);
    setSuggestedQuestions([]);
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
        profile={profile}
        onNewChat={handleNewChat}
        newChatDisabled={!profile}
        footer={
          <>
            <p className="truncate font-mono text-xs text-muted-foreground">{user.email}</p>
            {profile && (
              <Button variant="outline" size="sm" onClick={handleDisconnect}>
                Disconnect source
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          </>
        }
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!sourceId || !profile ? (
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6">
            <SourceConnect token={token} onConnected={handleConnected} />
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
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden p-6">
            <div
              ref={scrollRef}
              className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto pr-1 pb-4"
            >
              {turns.map((turn, index) => (
                <div key={index} className="flex flex-shrink-0 flex-col gap-4">
                  <UserMessage question={turn.question} />
                  <AssistantMessage answer={turn.answer} entryNumber={index + 1} />
                </div>
              ))}
              {isAsking && (
                <div className="flex-shrink-0">
                  <ThinkingIndicator />
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
