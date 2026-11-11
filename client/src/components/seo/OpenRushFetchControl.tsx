import React, { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatOpenRushFetchedAge } from "@/components/seo/openrushFetchAge";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { cn } from "@/lib/utils";

/** Mirror server OPENRUSH_INSPECT_*_CREDITS for staff copy. */
export const OPENRUSH_FETCH_CREDITS = {
  keyword: 5,
  serp: 2,
} as const;

export type OpenRushFetchKind = keyof typeof OPENRUSH_FETCH_CREDITS;

/** Keyword metrics provider (server keyword_metrics.keyword_provider). */
export type KeywordMetricsProvider = "openrush" | "dataforseo";

/** Mirror server DataForSEO keyword_overview estimate for one keyword (task + keyword). */
export const DATAFORSEO_KEYWORD_USD = 0.0101;

export function keywordProviderLabel(provider: KeywordMetricsProvider | null | undefined): string {
  return provider === "dataforseo" ? "DataForSEO" : "OpenRush";
}

export function DataForSeoBalanceLine({
  cost,
  balance,
  loading,
  error,
}: {
  cost: number;
  balance: number | null;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5" data-testid="text-dataforseo-balance-loading">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading DataForSEO balance…
      </p>
    );
  }
  if (error || balance == null) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="text-dataforseo-balance-unavailable">
        DataForSEO balance could not be loaded.
      </p>
    );
  }
  const after = balance - cost;
  return (
    <p className="text-xs text-muted-foreground" data-testid="text-dataforseo-balance-line">
      Account balance:{" "}
      <span className="font-medium text-foreground tabular-nums">${balance.toFixed(2)}</span>
      {" → "}
      <span className={cn("font-medium tabular-nums", after < 0 ? "text-destructive" : "text-foreground")}>
        ${after.toFixed(2)}
      </span>{" "}
      after this request.
    </p>
  );
}

const KIND_COPY: Record<
  OpenRushFetchKind,
  {
    confirmTitle: string;
    inactiveBody: string;
    confirmBody: (queryLabel: string, credits: number, fetchedAge: string) => ReactNode;
    confirmAction: string;
  }
> = {
  keyword: {
    confirmTitle: "Refresh keyword metrics?",
    inactiveBody:
      "Turn on DataForSEO or OpenRush in Settings → SEO/GEO to refresh keyword volume and difficulty automatically. Until then, saved YAML estimates may not be recent.",
    confirmBody: (queryLabel, credits, fetchedAge) => (
      <>
        This fetches volume and difficulty for{" "}
        <span className="font-medium text-foreground">{queryLabel}</span> from OpenRush and updates
        the shared keyword cache (not the page YAML). It will cost{" "}
        <span className="font-medium text-foreground">{credits} OpenRush credits</span>.
        {fetchedAge ? (
          <>
            {" "}
            Current cache age: <span className="font-medium text-foreground">{fetchedAge}</span>.
          </>
        ) : null}
      </>
    ),
    confirmAction: "Refresh",
  },
  serp: {
    confirmTitle: "Request SERP from OpenRush?",
    inactiveBody:
      "Turn on OpenRush in Settings to load live SERP features for this page’s main keyword. Until then, no OpenRush SERP snapshot is available.",
    confirmBody: (queryLabel, credits, fetchedAge) => (
      <>
        This fetches a live SERP snapshot for{" "}
        <span className="font-medium text-foreground">{queryLabel}</span> from OpenRush and updates
        the shared SERP cache (not the page YAML). It will cost{" "}
        <span className="font-medium text-foreground">{credits} OpenRush credits</span>.
        {fetchedAge ? (
          <>
            {" "}
            Current cache age: <span className="font-medium text-foreground">{fetchedAge}</span>.
          </>
        ) : null}
      </>
    ),
    confirmAction: "Request",
  },
};

export type OpenRushFetchControlProps = {
  kind: OpenRushFetchKind;
  /** Keyword / SERP query shown in the confirm dialog. */
  queryLabel?: string;
  openrushConfigured: boolean;
  fetchedAt?: string | null;
  stale?: boolean;
  disabled?: boolean;
  loading?: boolean;
  /** Called after staff confirms when OpenRush is active. Parent runs the API call. */
  onConfirm: () => void | Promise<void>;
  /**
   * Optional gate before opening the confirm dialog (e.g. missing keyword).
   * Return false to abort; parent should show its own error toast.
   * May be async (e.g. refetch entry before checking keyword).
   */
  onBeforeOpen?: () => boolean | Promise<boolean>;
  className?: string;
  "data-testid"?: string;
  dialogTestId?: string;
  title?: string;
  /** keyword kind only: which provider a refresh calls (default OpenRush). */
  provider?: KeywordMetricsProvider | null;
  /** keyword kind only: market label the refresh uses (e.g. "Spain"). */
  marketLabel?: string | null;
};

export function OpenRushCreditsLine({
  cost,
  balance,
  loading,
  error,
}: {
  cost: number;
  balance: number | null;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5" data-testid="text-openrush-credits-loading">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading remaining OpenRush credits…
      </p>
    );
  }
  if (error || balance == null) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="text-openrush-credits-unavailable">
        Remaining OpenRush credits could not be loaded.
      </p>
    );
  }
  const after = balance - cost;
  return (
    <p className="text-xs text-muted-foreground" data-testid="text-openrush-credits-balance">
      Remaining balance:{" "}
      <span className="font-medium text-foreground tabular-nums">{balance.toLocaleString()}</span>
      {" → "}
      <span
        className={cn(
          "font-medium tabular-nums",
          after < 0 ? "text-destructive" : "text-foreground",
        )}
      >
        {after.toLocaleString()}
      </span>{" "}
      after this request.
    </p>
  );
}

export function OpenRushFetchControl({
  kind,
  queryLabel = "this keyword",
  openrushConfigured,
  fetchedAt,
  stale,
  disabled = false,
  loading = false,
  onConfirm,
  onBeforeOpen,
  className,
  "data-testid": dataTestId,
  dialogTestId,
  title,
  provider,
  marketLabel,
}: OpenRushFetchControlProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const copy = KIND_COPY[kind];
  const credits = OPENRUSH_FETCH_CREDITS[kind];
  const fetchedAge = formatOpenRushFetchedAge(fetchedAt, stale);
  const viaDataForSeo = kind === "keyword" && provider === "dataforseo";
  const providerName = kind === "keyword" ? keywordProviderLabel(provider) : "OpenRush";
  const defaultTitle = openrushConfigured
    ? kind === "keyword"
      ? `Refresh volume & difficulty from ${providerName}`
      : "Request SERP snapshot from OpenRush"
    : kind === "keyword"
      ? "Keyword research must be active to refresh"
      : "OpenRush must be active to refresh";

  const {
    data: balanceData,
    isFetching: balanceLoading,
    isError: balanceError,
  } = useQuery<{ ok: boolean; balance_usd: number | null }>({
    queryKey: ["/api/seo/dataforseo/balance"],
    enabled: confirmOpen && openrushConfigured && viaDataForSeo,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch("/api/seo/dataforseo/balance", {
        credentials: "include",
        headers: getSessionHeaders(),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; balance_usd?: number | null; error?: string };
      if (!res.ok || body.ok === false) {
        throw new Error(body.error || "Could not load DataForSEO balance");
      }
      return { ok: true, balance_usd: typeof body.balance_usd === "number" ? body.balance_usd : null };
    },
  });

  const {
    data: creditsData,
    isFetching: creditsLoading,
    isError: creditsError,
  } = useQuery<{ ok: boolean; balance: number | null }>({
    queryKey: ["/api/seo/openrush/credits"],
    enabled: confirmOpen && openrushConfigured && !viaDataForSeo,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch("/api/seo/openrush/credits", {
        credentials: "include",
        headers: getSessionHeaders(),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        balance?: number | null;
        error?: string;
      };
      if (!res.ok || body.ok === false) {
        throw new Error(body.error || "Could not load OpenRush credits");
      }
      return { ok: true, balance: typeof body.balance === "number" ? body.balance : null };
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "h-auto min-h-6 shrink-0 flex-col gap-0 px-1.5 py-1 text-muted-foreground hover:text-foreground",
          className,
        )}
        data-testid={dataTestId}
        disabled={disabled || loading}
        title={title ?? defaultTitle}
        onClick={() => {
          void (async () => {
            if (onBeforeOpen) {
              const ok = await onBeforeOpen();
              if (!ok) return;
            }
            setConfirmOpen(true);
          })();
        }}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        <span className="text-[9px] leading-none font-medium">{providerName}</span>
        {fetchedAge ? (
          <span className="text-[9px] leading-none tabular-nums">{fetchedAge}</span>
        ) : null}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid={dialogTestId ?? `dialog-openrush-fetch-${kind}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {openrushConfigured
                ? copy.confirmTitle
                : kind === "keyword"
                  ? "Keyword research is not active"
                  : "OpenRush is not active"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {openrushConfigured && viaDataForSeo ? (
                  <>
                    <div>
                      This fetches volume and ranking difficulty for{" "}
                      <span className="font-medium text-foreground">{queryLabel || "this keyword"}</span> from
                      DataForSEO{marketLabel ? <> in <span className="font-medium text-foreground">{marketLabel}</span></> : null}{" "}
                      and updates the shared keyword cache (not the page YAML). It costs about{" "}
                      <span className="font-medium text-foreground">${DATAFORSEO_KEYWORD_USD.toFixed(2)}</span>.
                      {fetchedAge ? (
                        <>
                          {" "}
                          Current cache age: <span className="font-medium text-foreground">{fetchedAge}</span>.
                        </>
                      ) : null}
                    </div>
                    <DataForSeoBalanceLine
                      cost={DATAFORSEO_KEYWORD_USD}
                      balance={balanceData?.balance_usd ?? null}
                      loading={balanceLoading}
                      error={balanceError}
                    />
                  </>
                ) : openrushConfigured ? (
                  <>
                    <div>{copy.confirmBody(queryLabel || "this keyword", credits, fetchedAge)}</div>
                    <OpenRushCreditsLine
                      cost={credits}
                      balance={creditsData?.balance ?? null}
                      loading={creditsLoading}
                      error={creditsError}
                    />
                  </>
                ) : (
                  <p>{copy.inactiveBody}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>
              {openrushConfigured ? "Cancel" : "Close"}
            </AlertDialogCancel>
            {openrushConfigured ? (
              <AlertDialogAction
                disabled={loading}
                onClick={(e) => {
                  e.preventDefault();
                  void (async () => {
                    try {
                      await onConfirm();
                      setConfirmOpen(false);
                    } catch {
                      /* parent toasts; keep dialog open */
                    }
                  })();
                }}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : copy.confirmAction}
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
