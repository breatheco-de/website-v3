import { forwardRef } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PageStatsResponse } from "@shared/page-stats";

type Props = {
  /** Public path of the page (no host). */
  path: string;
  pageErrorCount?: number;
  onExpand: () => void;
};

type Tone = "bad" | "good" | null;

/**
 * Kept free of drawer imports so the drawer bundle stays lazy.
 * Portaled to body: the Dev Tools bubble container is its own z-50 stacking context.
 */
export const PageStatsEdgeTab = forwardRef<HTMLButtonElement, Props>(function PageStatsEdgeTab(
  { path, pageErrorCount = 0, onExpand },
  ref,
) {
  const queryClient = useQueryClient();
  const cached = queryClient
    .getQueriesData<PageStatsResponse>({ queryKey: ["/api/analytics/page-stats", path] })
    .find(([, d]) => d)?.[1];
  const status = cached?.objective?.primary.status;
  const tone: Tone = pageErrorCount > 0 || status === "behind" ? "bad" : status === "on_track" ? "good" : null;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed right-0 top-1/2 z-[9998] -translate-y-1/2 rounded-l-md border border-r-0 border-border bg-card shadow-lg"
      data-testid="page-stats-edge-tab"
    >
      <button
        ref={ref}
        type="button"
        onClick={onExpand}
        aria-label="Expand page stats"
        aria-expanded={false}
        title="Page stats, minimized. Click to expand."
        className="relative flex flex-col items-center gap-2 rounded-l-md px-1.5 py-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="button-page-stats-expand"
      >
        <BarChart3 className="h-4 w-4" />
        <span className="rotate-180 text-[10px] font-medium [writing-mode:vertical-rl]">Stats</span>
        {tone && (
          <span
            className={cn(
              "absolute left-1 top-1 h-2 w-2 rounded-full",
              tone === "bad" ? "bg-status-busy" : "bg-status-online",
            )}
            data-testid={`indicator-page-stats-${tone}`}
          />
        )}
      </button>
    </div>,
    document.body,
  );
});
