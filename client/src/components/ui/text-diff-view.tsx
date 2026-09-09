import { useMemo } from "react";
import { diffLines } from "diff";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DiffRow {
  kind: "added" | "removed" | "context";
  text: string;
}

/** Build line-oriented diff rows. `before` is the older/base side (red when removed). */
export function buildDiffRows(before: string, after: string): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const part of diffLines(before, after)) {
    const kind: DiffRow["kind"] = part.added ? "added" : part.removed ? "removed" : "context";
    // Strip the single trailing newline so we don't render a phantom empty line per part
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const text of lines) {
      rows.push({ kind, text });
    }
  }
  return rows;
}

interface TextDiffViewProps {
  before: string;
  after: string;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  className?: string;
  "data-testid"?: string;
}

/** Shared +/−/context line renderer used by sync and Time Machine diffs. */
export function TextDiffView({
  before,
  after,
  loading = false,
  error = null,
  emptyMessage = "No differences.",
  className,
  "data-testid": testId = "diff-content",
}: TextDiffViewProps) {
  const rows = useMemo(() => buildDiffRows(before, after), [before, after]);
  const hasChanges = rows.some((r) => r.kind !== "context");

  return (
    <div className={cn("flex-1 min-h-0 overflow-y-auto rounded-md border bg-muted/30", className)}>
      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading diff...
        </div>
      )}
      {!loading && error && (
        <div className="py-12 text-center text-sm text-destructive" data-testid="text-diff-error">
          {error}
        </div>
      )}
      {!loading && !error && !hasChanges && (
        <div className="py-12 text-center text-sm text-muted-foreground" data-testid="text-diff-no-changes">
          {emptyMessage}
        </div>
      )}
      {!loading && !error && hasChanges && (
        <pre className="font-mono text-xs leading-5 whitespace-pre-wrap break-all" data-testid={testId}>
          {rows.map((row, i) => (
            <div
              key={i}
              className={cn(
                "px-3",
                row.kind === "added" && "bg-emerald-500/15",
                row.kind === "removed" && "bg-destructive/15 text-destructive",
                row.kind === "context" && "text-muted-foreground",
              )}
            >
              <span className="select-none inline-block w-4 flex-shrink-0">
                {row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " "}
              </span>
              {row.text}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
