import { forwardRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PageStatsResponse } from "@shared/page-stats";

type Props = {
  /** Public path of the page (no host). */
  path: string;
  pageErrorCount?: number;
  onExpand: () => void;
};

type Tone = "bad" | "good" | null;

/** Kept free of drawer imports so the drawer bundle stays lazy. */
export const PageStatsBubble = forwardRef<HTMLButtonElement, Props>(function PageStatsBubble(
  { path, pageErrorCount = 0, onExpand },
  ref,
) {
  const queryClient = useQueryClient();
  const cached = queryClient
    .getQueriesData<PageStatsResponse>({ queryKey: ["/api/analytics/page-stats", path] })
    .find(([, d]) => d)?.[1];
  const status = cached?.objective?.primary.status;
  const tone: Tone = pageErrorCount > 0 || status === "behind" ? "bad" : status === "on_track" ? "good" : null;

  return (
    <div className="relative flex items-center" data-testid="page-stats-bubble">
      <Button
        ref={ref}
        type="button"
        size="icon"
        variant="default"
        className="h-10 w-10 rounded-full shadow-lg flex-shrink-0"
        onClick={onExpand}
        aria-label="Expand page stats"
        aria-expanded={false}
        title="Page stats"
        data-testid="button-page-stats-expand"
      >
        <BarChart3 className="h-4 w-4" />
      </Button>
      {tone && (
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-background pointer-events-none",
            tone === "bad" ? "bg-status-busy" : "bg-status-online",
          )}
          data-testid={`indicator-page-stats-${tone}`}
        />
      )}
    </div>
  );
});
