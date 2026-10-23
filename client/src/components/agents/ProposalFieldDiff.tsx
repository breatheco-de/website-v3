import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { diffWordsWithSpace } from "diff";
import { GripHorizontal } from "lucide-react";
import { buildDiffRows, type DiffRow } from "@/components/ui/text-diff-view";
import { cn } from "@/lib/utils";

const OVERSIZE_CHARS = 50_000;
const DEFAULT_DIFF_HEIGHT = 160; // matches former max-h-40
const MAX_DIFF_HEIGHT = 640;

/** Renders one proposed field change as a current → proposed pair. */
export function formatProposalDiffValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value.length > 0 ? value : '""';
  return JSON.stringify(value, null, 2);
}

function newlineCount(s: string): number {
  return (s.match(/\n/g) ?? []).length;
}

export type ProposalDiffMode = "plain" | "word" | "line";

/** Pick highlight strategy from already-formatted strings. */
export function chooseProposalDiffMode(before: string, after: string): ProposalDiffMode {
  if (before.length > OVERSIZE_CHARS || after.length > OVERSIZE_CHARS) return "plain";
  if (before === after) return "plain";
  // 2+ newlines ⇒ at least 3 lines (structured / JSON-like)
  if (newlineCount(before) >= 2 && newlineCount(after) >= 2) return "line";
  return "word";
}

export type InlineDiffPart = {
  kind: "added" | "removed" | "context";
  text: string;
};

/** Word-level parts for one side of the Current | Proposed pair. */
export function buildInlineDiffParts(
  before: string,
  after: string,
  side: "current" | "proposed",
): InlineDiffPart[] {
  const parts: InlineDiffPart[] = [];
  for (const part of diffWordsWithSpace(before, after)) {
    const kind: InlineDiffPart["kind"] = part.added ? "added" : part.removed ? "removed" : "context";
    if (side === "current" && kind === "added") continue;
    if (side === "proposed" && kind === "removed") continue;
    parts.push({ kind, text: part.value });
  }
  return parts;
}

/** Line-level rows for one side of the Current | Proposed pair. */
export function buildSideDiffRows(
  before: string,
  after: string,
  side: "current" | "proposed",
): DiffRow[] {
  return buildDiffRows(before, after).filter((row) => {
    if (side === "current" && row.kind === "added") return false;
    if (side === "proposed" && row.kind === "removed") return false;
    return true;
  });
}

function highlightClass(kind: "added" | "removed" | "context", side: "current" | "proposed"): string {
  if (side === "current" && kind === "removed") return "bg-destructive/15 text-destructive rounded-sm";
  if (side === "proposed" && kind === "added") return "bg-emerald-500/15 rounded-sm";
  if (side === "current") return "text-muted-foreground";
  return "text-foreground";
}

function DiffPaneContent({
  side,
  mode,
  before,
  after,
  plainText,
}: {
  side: "current" | "proposed";
  mode: ProposalDiffMode;
  before: string;
  after: string;
  plainText: string;
}) {
  const wordParts = useMemo(
    () => (mode === "word" ? buildInlineDiffParts(before, after, side) : []),
    [mode, before, after, side],
  );
  const lineRows = useMemo(
    () => (mode === "line" ? buildSideDiffRows(before, after, side) : []),
    [mode, before, after, side],
  );

  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">
      {mode === "plain" && (
        <span className={side === "current" ? "text-muted-foreground" : "text-foreground"}>
          {plainText}
        </span>
      )}
      {mode === "word" &&
        wordParts.map((part, i) => {
          const isHighlight =
            (side === "current" && part.kind === "removed") ||
            (side === "proposed" && part.kind === "added");
          return (
            <span
              key={i}
              className={highlightClass(part.kind, side)}
              {...(isHighlight ? { "data-diff-highlight": "" } : {})}
            >
              {part.text}
            </span>
          );
        })}
      {mode === "line" &&
        lineRows.map((row, i) => {
          const isHighlight =
            (side === "current" && row.kind === "removed") ||
            (side === "proposed" && row.kind === "added");
          return (
            <div
              key={i}
              className={cn(highlightClass(row.kind, side))}
              {...(isHighlight ? { "data-diff-highlight": "" } : {})}
            >
              {row.text}
            </div>
          );
        })}
    </pre>
  );
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
  const before = formatProposalDiffValue(current);
  const after = formatProposalDiffValue(proposed);
  const mode = chooseProposalDiffMode(before, after);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState(DEFAULT_DIFF_HEIGHT);
  /** null = not measured yet; true = needs scroll + resize; false = short natural height */
  const [isLarge, setIsLarge] = useState<boolean | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    setMaxHeight(DEFAULT_DIFF_HEIGHT);

    const measure = () => {
      setIsLarge(content.offsetHeight > DEFAULT_DIFF_HEIGHT);
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => ro.disconnect();
  }, [before, after, mode]);

  useEffect(() => {
    if (mode === "plain" || isLarge !== true) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>("[data-diff-highlight]");
    target?.scrollIntoView({ block: "nearest" });
  }, [mode, before, after, isLarge]);

  const onResizePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: maxHeight };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = drag.startHeight + (ev.clientY - drag.startY);
      const cap = Math.min(MAX_DIFF_HEIGHT, Math.floor(window.innerHeight * 0.7));
      // Expand only from the default cap (no shrinking below default)
      setMaxHeight(Math.max(DEFAULT_DIFF_HEIGHT, Math.min(cap, next)));
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [maxHeight]);

  // Cap until we know the box is short (avoids a tall flash before measure)
  const capped = isLarge !== false;

  return (
    <div className="overflow-hidden rounded-md border border-card-border">
      <p className="border-b border-card-border bg-muted/50 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
        {fieldPath}
      </p>
      <div
        ref={scrollRef}
        className={capped ? "overflow-auto" : undefined}
        style={capped ? { maxHeight } : undefined}
      >
        <div ref={contentRef} className="grid @xl:grid-cols-2">
          <div className="space-y-1 px-3 py-3">
            <p className="sticky top-0 z-[1] bg-card text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Current
            </p>
            <DiffPaneContent
              side="current"
              mode={mode}
              before={before}
              after={after}
              plainText={before}
            />
          </div>
          <div className="space-y-1 border-card-border px-3 py-3 @xl:border-l">
            <p className="sticky top-0 z-[1] bg-card text-[10px] font-medium uppercase tracking-wide text-primary">
              Proposed
            </p>
            <DiffPaneContent
              side="proposed"
              mode={mode}
              before={before}
              after={after}
              plainText={after}
            />
          </div>
        </div>
      </div>
      {isLarge === true && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to expand diff height"
          title="Drag to expand"
          className="flex h-4 cursor-row-resize items-center justify-center gap-1.5 border-t border-card-border bg-muted/40 text-muted-foreground hover:bg-primary/15 hover:text-foreground active:bg-primary/25"
          onPointerDown={onResizePointerDown}
          data-testid="proposal-diff-resize-handle"
        >
          <GripHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="text-[10px] font-medium uppercase tracking-wide select-none">
            Drag to expand
          </span>
        </div>
      )}
    </div>
  );
}
