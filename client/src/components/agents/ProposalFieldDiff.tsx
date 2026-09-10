/** Renders one proposed field change as a current → proposed pair. */
export function formatProposalDiffValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value.length > 0 ? value : '""';
  return JSON.stringify(value, null, 2);
}

export function ProposalFieldDiff({
  fieldPath,
  current,
  proposed,
}: {
  fieldPath: string;
  current: unknown;
  proposed: unknown;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-card-border">
      <p className="border-b border-card-border bg-muted/50 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
        {fieldPath}
      </p>
      <div className="grid gap-px bg-card-border sm:grid-cols-2">
        <div className="space-y-1 bg-card p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Current
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted-foreground">
            {formatProposalDiffValue(current)}
          </pre>
        </div>
        <div className="space-y-1 bg-card p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-primary">Proposed</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
            {formatProposalDiffValue(proposed)}
          </pre>
        </div>
      </div>
    </div>
  );
}
