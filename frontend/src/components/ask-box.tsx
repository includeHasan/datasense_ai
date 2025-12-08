"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AskBox({
  onAsk,
  loading,
  className,
}: {
  onAsk: (question: string) => Promise<void>;
  loading: boolean;
  className?: string;
}) {
  const [question, setQuestion] = React.useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    await onAsk(trimmed);
    setQuestion("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "flex items-center gap-2 rounded-full border border-border bg-card p-1.5 pl-4 shadow-sm",
        className,
      )}
    >
      <Input
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="Ask anything about your data..."
        disabled={loading}
        className="rounded-full border-none bg-transparent shadow-none focus-visible:ring-0"
      />
      <Button
        type="submit"
        size="sm"
        className="rounded-full"
        disabled={loading || question.trim().length === 0}
      >
        {loading ? "Asking…" : "Ask"}
      </Button>
    </form>
  );
}
