export function ThinkingIndicator() {
  return (
    <div className="flex flex-col gap-2" aria-label="Waiting for an answer">
      <div className="printer-loading h-4 w-2/3 rounded-sm" />
      <div className="printer-loading h-4 w-1/2 rounded-sm" />
    </div>
  );
}
