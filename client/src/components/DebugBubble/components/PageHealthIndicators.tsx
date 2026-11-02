import { useQuery } from "@tanstack/react-query";
import { IconBrandGoogle, IconSend } from "@tabler/icons-react";
import {
  INDEXNOW_STATUS_KEY,
  PUBLIC_URL_CHANGES_KEY,
  fetchIndexNowStatus,
  fetchPublicUrlChanges,
  relativeTime,
  urlPath,
  type IndexNowStatus,
  type PublicUrlChangesResponse,
} from "@/lib/indexnow";
import { TabCountBadge } from "./PageErrorsModal";
import { cn } from "@/lib/utils";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { type GscInspectionGetResponse } from "@/lib/gscInspection";
import {
  crawlerBadgeState,
  googleToCrawlerStatus,
  type CrawlerBadgeState,
} from "@/lib/crawlerStatus";
import { isPrivatePreviewPath } from "@/lib/visual-edit-path";

import type { PageErrorsTab } from "./PageErrorsModal";

type IndexNowLine = { short: string; text: string; sent: boolean };

export function indexNowLineFor(
  status: IndexNowStatus | undefined,
  changes: PublicUrlChangesResponse | undefined,
  now = Date.now(),
): IndexNowLine | null {
  if (!status) return null;
  if (!status.enabled) return { short: "Off", text: "IndexNow off", sent: false };
  const latest = changes?.changes[0];
  if (!latest) return { short: "—", text: "No changes recorded for this page yet", sent: false };
  if (latest.sent) {
    const when = relativeTime(latest.detectedAt, now);
    return { short: when.replace(" ago", ""), text: `Last change sent to IndexNow ${when}`, sent: true };
  }
  if (!status.live) return { short: "Wait", text: "Waiting to send (only the live site sends notices)", sent: false };
  return { short: "Wait", text: "Waiting to send", sent: false };
}

interface PageHealthIndicatorsProps {
  errorCount: number;
  warningCount: number;
  loading?: boolean;
  /** Public page URL for GSC; omit or null when draft-only (no live URL). */
  pageUrl?: string | null;
  /** When set, skips the internal GSC fetch and uses this badge state. */
  crawlerState?: CrawlerBadgeState;
  /** Optional — omit for display-only (Cluster Map Integrity). */
  onOpenTab?: (tab: PageErrorsTab) => void;
}

export function PageHealthIndicators({
  errorCount,
  warningCount,
  loading = false,
  pageUrl,
  crawlerState: crawlerStateProp,
  onOpenTab,
}: PageHealthIndicatorsProps) {
  const rawLookup = (pageUrl ?? "").trim();
  const isDraftNoPublic = !rawLookup || isPrivatePreviewPath(rawLookup);
  const inspectLookupUrl = isDraftNoPublic ? "" : rawLookup;
  const useExternalCrawler = crawlerStateProp != null;

  const gscQuery = useQuery<GscInspectionGetResponse>({
    queryKey: ["/api/debug/gsc-inspection", inspectLookupUrl],
    enabled: !useExternalCrawler && Boolean(inspectLookupUrl),
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

  const showIndexNow = !useExternalCrawler && Boolean(inspectLookupUrl);
  const indexNowStatusQuery = useQuery({
    queryKey: INDEXNOW_STATUS_KEY,
    queryFn: fetchIndexNowStatus,
    enabled: showIndexNow,
    staleTime: 60_000,
  });
  const indexNowPath = showIndexNow ? urlPath(inspectLookupUrl) : "";
  const indexNowChangesQuery = useQuery({
    queryKey: [PUBLIC_URL_CHANGES_KEY, "page", indexNowPath],
    queryFn: () => fetchPublicUrlChanges({ limit: 1, path: indexNowPath }),
    enabled: showIndexNow && Boolean(indexNowStatusQuery.data?.enabled),
    staleTime: 60_000,
  });
  const indexNowLine = showIndexNow ? indexNowLineFor(indexNowStatusQuery.data, indexNowChangesQuery.data) : null;

  const crawlerBadge =
    crawlerStateProp ??
    crawlerBadgeState([
      googleToCrawlerStatus({
        configured: isDraftNoPublic ? true : gscQuery.data?.configured,
        record: isDraftNoPublic ? null : gscQuery.data?.record,
        resolved: isDraftNoPublic
          ? { requested: "", loc: null, inSitemap: false, isDraft: true }
          : gscQuery.data?.resolved,
        loadError: isDraftNoPublic ? false : gscQuery.isError,
        loading: isDraftNoPublic ? false : gscQuery.isLoading,
      }),
    ]);

  const interactive = typeof onOpenTab === "function";
  const chipClass = cn(
    "inline-flex items-center gap-0.5 rounded-md p-0.5 shrink-0",
    interactive && "hover-elevate",
  );

  const loadingBadge = (
    <span
      className="inline-flex items-center justify-center rounded-sm px-1.5 py-0 text-[10px] font-semibold bg-muted text-muted-foreground"
      data-testid="text-page-health-loading"
    >
      —
    </span>
  );

  const errInner = (
    <>
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
    </>
  );
  const warnInner = (
    <>
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
    </>
  );
  const crawlInner = (
    <>
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
    </>
  );

  return (
    <div className="flex items-center gap-0.5 shrink-0" data-testid="page-health-indicators">
      {interactive ? (
        <button
          type="button"
          className={chipClass}
          onClick={() => onOpenTab!("errors")}
          aria-label={`${errorCount} errors`}
          data-testid="button-page-health-errors"
        >
          {errInner}
        </button>
      ) : (
        <div className={chipClass} aria-label={`${errorCount} errors`} data-testid="button-page-health-errors">
          {errInner}
        </div>
      )}
      {interactive ? (
        <button
          type="button"
          className={chipClass}
          onClick={() => onOpenTab!("warnings")}
          aria-label={`${warningCount} warnings`}
          data-testid="button-page-health-warnings"
        >
          {warnInner}
        </button>
      ) : (
        <div className={chipClass} aria-label={`${warningCount} warnings`} data-testid="button-page-health-warnings">
          {warnInner}
        </div>
      )}
      {interactive ? (
        <button
          type="button"
          className={chipClass}
          onClick={() => onOpenTab!("crawlers")}
          aria-label="Search index status"
          data-testid="button-page-health-crawlers"
        >
          {crawlInner}
        </button>
      ) : (
        <div className={chipClass} aria-label="Search index status" data-testid="button-page-health-crawlers">
          {crawlInner}
        </div>
      )}
      {indexNowLine ? (
        <div
          className="inline-flex items-center gap-0.5 rounded-md p-0.5 shrink-0"
          title={indexNowLine.text}
          aria-label={indexNowLine.text}
          data-testid="text-page-health-indexnow"
        >
          <IconSend
            className={cn("h-3.5 w-3.5", indexNowLine.sent ? "text-chart-3" : "text-muted-foreground")}
            aria-hidden
          />
          <span className="text-[10px] font-semibold leading-none text-muted-foreground">{indexNowLine.short}</span>
        </div>
      ) : null}
    </div>
  );
}
