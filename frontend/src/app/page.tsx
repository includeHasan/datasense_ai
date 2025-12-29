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

// Persist the active source + conversation so a page reload restores the
// workspace instead of dumping the user back on the "connect a source" screen
// (sources are now durable server-side, so they survive a refresh/restart).
const ACTIVE_SOURCE_KEY = "ds_active_source";
const ACTIVE_CONVERSATION_KEY = "ds_active_conversation";

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
  const [isRestoring, setIsRestoring] = React.useState(true);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

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

  // Restore the last active conversation (and its data source) on load so a
  // refresh doesn't lose the session. Deferred into a microtask (matching the
  // auth-provider hydration pattern) so we only kick off the async reads here
  // rather than touching localStorage/state directly in the effect body.
  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;

    Promise.resolve()
      .then(async () => {
        const storedConversationId =
          typeof window !== "undefined" ? localStorage.getItem(ACTIVE_CONVERSATION_KEY) : null;
        const storedSourceId =
          typeof window !== "undefined" ? localStorage.getItem(ACTIVE_SOURCE_KEY) : null;

        // The source to restore: the active conversation's source takes
        // precedence (so a selected past chat lands on its own data), falling
        // back to a standalone stored source (a connected-but-not-yet-asked
        // session).
        let sourceToRestore = storedSourceId;

        if (storedConversationId) {
          try {
            const conversation = await api.getConversation(token, storedConversationId);
            if (cancelled) return;
            setTurns(messagesToTurns(conversation.messages));
            setActiveConversationId(storedConversationId);
            if (conversation.sourceId) sourceToRestore = conversation.sourceId;
          } catch {
            // Conversation was deleted or isn't ours; drop the stale pointer.
            localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
          }
        }

        if (sourceToRestore) {
          try {
            const restoredProfile = await api.getProfile(token, sourceToRestore);
            if (cancelled) return;
            setSourceId(sourceToRestore);
            setProfile(restoredProfile);
          } catch {
            // Source has expired (TTL) or is gone. Leave the conversation
            // viewable in read-only mode; drop the stale source pointer.
            localStorage.removeItem(ACTIVE_SOURCE_KEY);
          }
        }
      })
      .catch(() => {
        // Corrupt storage or unexpected error; start clean.
      })
      .finally(() => {
        if (!cancelled) setIsRestoring(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Persist the active source/conversation once restoration is done, so we
  // don't wipe the stored pointers before the restore effect has read them.
  React.useEffect(() => {
    if (isRestoring || typeof window === "undefined") return;
    if (sourceId) localStorage.setItem(ACTIVE_SOURCE_KEY, sourceId);
    else localStorage.removeItem(ACTIVE_SOURCE_KEY);
  }, [sourceId, isRestoring]);

  React.useEffect(() => {
    if (isRestoring || typeof window === "undefined") return;
    if (activeConversationId) localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeConversationId);
    else localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  }, [activeConversationId, isRestoring]);

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
      if (error instanceof ApiError && error.status === 402) {
        toast.error(
          "You've used your 5 free queries this month - add your own API key in Settings to continue.",
        );
        setSettingsOpen(true);
      } else {
        const message =
          error instanceof ApiError ? error.message : "Failed to get an answer.";
        toast.error(message);
      }
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

      // Re-bind the conversation's data source so the chat renders (and can be
      // continued). If the source has expired, show the conversation read-only.
      if (conversation.sourceId) {
        try {
          const restoredProfile = await api.getProfile(token, conversation.sourceId);
          setSourceId(conversation.sourceId);
          setProfile(restoredProfile);
        } catch {
          setSourceId(null);
          setProfile(null);
        }
      } else {
        setSourceId(null);
        setProfile(null);
      }
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
    if (typeof window !== "undefined") {
      localStorage.removeItem(ACTIVE_SOURCE_KEY);
      localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    }
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

  // A live source is one we can actually query; a viewed chat may outlive its
  // source (expired TTL), in which case it renders read-only.
  const hasLiveSource = Boolean(sourceId && profile);
  const isViewingChat = turns.length > 0;

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
        settingsOpen={settingsOpen}
        onSettingsOpenChange={setSettingsOpen}
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
        {isRestoring ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <p className="text-sm text-muted-foreground">Restoring your workspace...</p>
          </div>
        ) : !hasLiveSource && !isViewingChat ? (
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6">
            <SourceConnect token={token} onConnected={handleConnected} />
          </div>
        ) : !isViewingChat ? (
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
                    onFollowup={hasLiveSource ? handleAsk : undefined}
                    trace={turn.trace}
                    question={turn.question}
                    sourceId={sourceId ?? undefined}
                    onPin={hasLiveSource ? handlePin : undefined}
                  />
                </div>
              ))}
              {isAsking && (
                <div className="flex-shrink-0">
                  <AgentActivityTrace events={activityEvents} isLive />
                </div>
              )}
            </div>
            {hasLiveSource ? (
              <AskBox onAsk={handleAsk} loading={isAsking} className="mt-4 flex-shrink-0" />
            ) : (
              <div className="mt-4 flex-shrink-0 rounded-lg border border-border bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">
                This conversation&apos;s data source is no longer connected (sources expire after
                inactivity). Start a{" "}
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  new chat
                </button>{" "}
                to ask more questions.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
