import { useQuery } from "@tanstack/react-query";
import { IconBrandGoogle } from "@tabler/icons-react";
import { TabCountBadge } from "./PageErrorsModal";
import { cn } from "@/lib/utils";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { type GscInspectionGetResponse } from "@/lib/gscInspection";
import { crawlerBadgeState, googleToCrawlerStatus } from "@/lib/crawlerStatus";

import type { PageErrorsTab } from "./PageErrorsModal";

interface PageHealthIndicatorsProps {
  errorCount: number;
  warningCount: number;
  loading?: boolean;
  pageUrl?: string | null;
  onOpenTab: (tab: PageErrorsTab) => void;
}

export function PageHealthIndicators({
  errorCount,
  warningCount,
  loading = false,
  pageUrl,
  onOpenTab,
}: PageHealthIndicatorsProps) {
  const inspectLookupUrl = pageUrl ?? "";

  const gscQuery = useQuery<GscInspectionGetResponse>({
    queryKey: ["/api/debug/gsc-inspection", inspectLookupUrl],
    enabled: Boolean(inspectLookupUrl),
    queryFn: async () => {
      const token = getDebugToken();
      const res = await fetch(
        `/api/debug/gsc-inspection?url=${encodeURIComponent(inspectLookupUrl)}`,
        {
          headers: {
            ...getSessionHeaders(),
            ...(token ? { Authorization: `Token ${token}` } : {}),
          },
        },
      );
      if (!res.ok) throw new Error("Failed to load Search Console cache");
      return res.json() as Promise<GscInspectionGetResponse>;
    },
  });

  const crawlerBadge = crawlerBadgeState([
    googleToCrawlerStatus({
      configured: gscQuery.data?.configured,
      record: gscQuery.data?.record,
      resolved: gscQuery.data?.resolved,
      loadError: gscQuery.isError,
      loading: gscQuery.isLoading,
    }),
  ]);

  const healthButtonClass =
    "inline-flex items-center gap-0.5 rounded-md p-0.5 hover-elevate shrink-0";

  const loadingBadge = (
    <span
      className="inline-flex items-center justify-center rounded-sm px-1.5 py-0 text-[10px] font-semibold bg-muted text-muted-foreground"
      data-testid="text-page-health-loading"
    >
      —
    </span>
  );

  return (
    <div className="flex items-center gap-0.5 shrink-0" data-testid="page-health-indicators">
      <button
        type="button"
        className={healthButtonClass}
        onClick={() => onOpenTab("errors")}
        aria-label={`${errorCount} errors`}
        data-testid="button-page-health-errors"
      >
        <span
          className={cn(
            "text-[10px] font-semibold leading-none",
            loading ? "text-muted-foreground" : errorCount > 0 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          Err
        </span>
        {loading ? loadingBadge : (
          <TabCountBadge count={errorCount} variant="error" testId="text-page-health-error-count" zeroAsCount />
        )}
      </button>
      <button
        type="button"
        className={healthButtonClass}
        onClick={() => onOpenTab("warnings")}
        aria-label={`${warningCount} warnings`}
        data-testid="button-page-health-warnings"
      >
        <span
          className={cn(
            "text-[10px] font-semibold leading-none",
            loading ? "text-muted-foreground" : warningCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
          )}
        >
          Warn
        </span>
        {loading ? loadingBadge : (
          <TabCountBadge count={warningCount} variant="warning" testId="text-page-health-warning-count" zeroAsCount />
        )}
      </button>
      <button
        type="button"
        className={healthButtonClass}
        onClick={() => onOpenTab("crawlers")}
        aria-label="Search index status"
        data-testid="button-page-health-crawlers"
      >
        <IconBrandGoogle
          className={cn(
            "h-3.5 w-3.5",
            crawlerBadge.kind === "ok"
              ? "text-emerald-600 dark:text-emerald-400"
              : crawlerBadge.kind === "problems"
                ? "text-destructive"
                : "text-muted-foreground",
          )}
          aria-hidden
        />
        <TabCountBadge crawlerState={crawlerBadge} testId="text-page-health-crawler-count" />
      </button>
    </div>
  );
}
