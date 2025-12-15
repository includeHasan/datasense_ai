"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useAuth } from "@/components/auth-provider";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import { askStream } from "@/lib/api-stream";
import type {
  AgentEvent,
  AskResponse,
  ChartSpec,
  ChatTurn,
  Conversation,
  ConversationMessage,
  SchemaProfile,
} from "@/lib/types";
import { SourceConnect } from "@/components/source-connect";
import { AppSidebar } from "@/components/app-sidebar";
import { SuggestedQuestions } from "@/components/suggested-questions";
import { AskBox } from "@/components/ask-box";
import { UserMessage } from "@/components/user-message";
import { AssistantMessage } from "@/components/assistant-message";
import { AgentActivityTrace } from "@/components/agent-activity-trace";
import { Button } from "@/components/ui/button";
import { LandingPage } from "@/components/landing-page";

function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. Please define it in your .env.local file."
    );
  }
  return url;
}

/**
 * Reconstructs ChatTurn[] from a conversation's persisted Message docs,
 * pairing up consecutive user -> assistant messages (the order they're
 * stored in). Skips any dangling/unmatched message rather than crash.
 */
function messagesToTurns(messages: ConversationMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let pendingQuestion: string | undefined;

  for (const message of messages) {
    if (message.role === "user") {
      pendingQuestion = message.question ?? "";
    } else if (message.role === "assistant" && pendingQuestion !== undefined && message.answer) {
      turns.push({ question: pendingQuestion, answer: message.answer, trace: message.trace });
      pendingQuestion = undefined;
    }
  }

  return turns;
}

export default function Home() {
  const router = useRouter();
  const { user, token, logout, isLoading } = useAuth();

  const [sourceId, setSourceId] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<SchemaProfile | null>(null);
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [isAsking, setIsAsking] = React.useState(false);
  const [activityEvents, setActivityEvents] = React.useState<AgentEvent[]>([]);
  const [suggestedQuestions, setSuggestedQuestions] = React.useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = React.useState(false);
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = React.useState<string | null>(null);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, isAsking]);

  const refreshConversations = React.useCallback(() => {
    if (!token) return;
    api
      .listConversations(token)
      .then(setConversations)
      .catch(() => {
        // Recent-chats list is a nice-to-have; silently skip on failure.
      });
  }, [token]);

  React.useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  function handleConnected(newSourceId: string, newProfile: SchemaProfile) {
    setSourceId(newSourceId);
    setProfile(newProfile);
    setTurns([]);
    setActiveConversationId(null);
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
    setActivityEvents([]);
    const trace: AgentEvent[] = [];
    try {
      const response = await askStream<AskResponse>(
        `${getApiBaseUrl()}/sources/${sourceId}/ask`,
        { question, conversationId: activeConversationId ?? undefined },
        { token },
        (event) => {
          trace.push(event);
          setActivityEvents([...trace]);
        },
      );
      const { conversationId, ...answer } = response;
      setTurns((prev) => [...prev, { question, answer, trace }]);
      setActiveConversationId(conversationId);
      refreshConversations();
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
    setActiveConversationId(null);
  }

  async function handleSelectConversation(conversationId: string) {
    if (!token) return;
    try {
      const conversation = await api.getConversation(token, conversationId);
      setTurns(messagesToTurns(conversation.messages));
      setActiveConversationId(conversationId);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Failed to load conversation.";
      toast.error(message);
    }
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
    setActiveConversationId(null);
    setSuggestedQuestions([]);
  }

  function handleLogout() {
    logout();
    router.push("/login");
  }

  async function handlePin(pin: {
    chartSpec: ChartSpec | null;
    narrative: string;
    sourceId?: string;
    question?: string;
  }) {
    if (!token) return;
    try {
      const dashboard = await api.getDashboard(token);
      await api.pinToDashboard(token, dashboard.id, pin);
      toast.success("Pinned to dashboard.");
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Failed to pin to dashboard.";
      toast.error(message);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!user || !token) {
    return <LandingPage />;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden">
      <AppSidebar
        profile={profile}
        onNewChat={handleNewChat}
        newChatDisabled={!profile}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        token={token}
        sourceId={sourceId}
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
                  <AssistantMessage
                    answer={turn.answer}
                    entryNumber={index + 1}
                    onFollowup={handleAsk}
                    trace={turn.trace}
                    question={turn.question}
                    sourceId={sourceId}
                    onPin={handlePin}
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
