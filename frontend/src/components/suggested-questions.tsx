"use client";

import { MessageCircleQuestion } from "lucide-react";

interface SuggestedQuestionsProps {
  questions: string[];
  loading: boolean;
  onSelect: (question: string) => void;
  disabled?: boolean;
}

export function SuggestedQuestions({
  questions,
  loading,
  onSelect,
  disabled,
}: SuggestedQuestionsProps) {
  if (!loading && questions.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-1">
      {loading ? (
        <div className="flex flex-col gap-2" aria-label="Printing suggestions">
          <div className="printer-loading h-9 w-full rounded-md" />
          <div className="printer-loading h-9 w-full rounded-md" />
          <div className="printer-loading h-9 w-full rounded-md" />
        </div>
      ) : (
        questions.map((question) => (
          <button
            key={question}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(question)}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <MessageCircleQuestion className="size-4 flex-shrink-0" />
            {question}
          </button>
        ))
      )}
    </div>
  );
}
