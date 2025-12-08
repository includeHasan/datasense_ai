export function UserMessage({ question }: { question: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[75%] rounded-2xl bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground">
        {question}
      </p>
    </div>
  );
}
