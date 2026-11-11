import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DataForSeoBalanceLine,
  OPENRUSH_FETCH_CREDITS,
  OpenRushCreditsLine,
  keywordProviderLabel,
  type KeywordMetricsProvider,
} from "@/components/seo/OpenRushFetchControl";
import { apiRequest } from "@/lib/queryClient";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import type { SeoBulkPair } from "@/components/content-type/BulkSeoOgRegenerateDialog";

export type BulkKeywordRefreshResult = {
  ok: true;
  preview: boolean;
  results: Array<{
    slug: string;
    locale: string;
    keyword: string | null;
    market?: string | null;
    ok: boolean;
    skipped?: boolean;
    aborted?: boolean;
    reason?: string;
    error?: string;
  }>;
  provider?: KeywordMetricsProvider | null;
  cost_unit?: "credits" | "usd";
  mode?: "live" | "sandbox" | null;
  credits_per_call: number;
  keywords_to_fetch: number;
  keywords_fetched: number;
  credits_spent: number;
  credits_estimated: number;
  usd_estimated?: number;
  usd_spent?: number;
  budget_remaining?: number;
  skipped_no_keyword: number;
  skipped_already_fresh: number;
  failed: number;
  aborted: number;
  aborted_remaining?: boolean;
  stopped_at_cap?: boolean;
  keywords_not_refreshed?: string[];
};

export function BulkSeoKeywordRefreshDialog({
  open,
  onOpenChange,
  contentType,
  pairs,
  openrushConfigured,
  applying,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: string;
  pairs: SeoBulkPair[];
  /** Any keyword research provider is configured (DataForSEO or OpenRush). */
  openrushConfigured: boolean;
  applying: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const {
    data: preview,
    isFetching: previewLoading,
    isError: previewError,
    error: previewErr,
  } = useQuery<BulkKeywordRefreshResult>({
    queryKey: ["/api/seo/keyword/refresh-bulk", "preview", contentType, pairs],
    enabled: open && openrushConfigured && pairs.length > 0,
    retry: false,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/seo/keyword/refresh-bulk", {
        contentType,
        items: pairs,
        preview: true,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { error?: string }).error ||
            (body as { code?: string }).code ||
            "Could not estimate keyword refresh",
        );
      }
      return body as BulkKeywordRefreshResult;
    },
  });

  const viaDataForSeo = preview?.provider === "dataforseo";
  const providerName = keywordProviderLabel(preview?.provider);

  const {
    data: creditsData,
    isFetching: creditsLoading,
    isError: creditsError,
  } = useQuery<{ ok: boolean; balance: number | null }>({
    queryKey: ["/api/seo/openrush/credits"],
    enabled: open && openrushConfigured && !!preview && !viaDataForSeo,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch("/api/seo/openrush/credits", {
        credentials: "include",
        headers: { ...getSessionHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || "Could not load OpenRush credits");
      }
      return body as { ok: boolean; balance: number | null };
    },
  });

  const {
    data: usdBalanceData,
    isFetching: usdBalanceLoading,
    isError: usdBalanceError,
  } = useQuery<{ ok: boolean; balance_usd: number | null }>({
    queryKey: ["/api/seo/dataforseo/balance"],
    enabled: open && openrushConfigured && viaDataForSeo,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch("/api/seo/dataforseo/balance", {
        credentials: "include",
        headers: { ...getSessionHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || "Could not load DataForSEO balance");
      }
      return body as { ok: boolean; balance_usd: number | null };
    },
  });

  const estimatedCredits =
    preview?.credits_estimated ??
    (preview?.keywords_to_fetch ?? 0) * OPENRUSH_FETCH_CREDITS.keyword;
  const estimatedUsd = preview?.usd_estimated ?? 0;
  const budgetRemaining = preview?.budget_remaining ?? null;
  const balance = creditsData?.balance ?? null;
  const balanceKnown = !creditsLoading && !creditsError && balance != null;
  const balanceTooLow = !viaDataForSeo && balanceKnown && estimatedCredits > 0 && balance! < estimatedCredits;
  const usdBalance = usdBalanceData?.balance_usd ?? null;
  const usdBalanceTooLow =
    viaDataForSeo && !usdBalanceLoading && !usdBalanceError && usdBalance != null && usdBalance < estimatedUsd;
  const overDailyLimit = viaDataForSeo && budgetRemaining != null && estimatedUsd > budgetRemaining;
  const willFetch = preview?.keywords_to_fetch ?? 0;
  const skipNoKw = preview?.skipped_no_keyword ?? 0;
  const skipFresh = preview?.skipped_already_fresh ?? 0;

  const canConfirm =
    openrushConfigured &&
    !applying &&
    !previewLoading &&
    !previewError &&
    pairs.length > 0 &&
    !balanceTooLow &&
    !usdBalanceTooLow &&
    willFetch > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-bulk-seo-keyword-refresh">
        <DialogHeader>
          <DialogTitle>
            {openrushConfigured ? "Refresh keyword metrics?" : "Keyword research is not active"}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {openrushConfigured ? (
                <>
                  <p>
                    Refresh volume and difficulty for the selected pages
                    {preview ? ` from ${providerName}` : ""}, each in its language&apos;s default market.
                    Pages without a main keyword, and keywords refreshed in the last 7 days, are skipped.
                    This updates the shared research cache — it does not change page titles,
                    descriptions, or publish status.
                  </p>
                  {preview?.mode === "sandbox" ? (
                    <p className="text-xs" data-testid="text-bulk-keyword-sandbox">
                      Sandbox: this server is not the live site, so results are sample data (no charge).
                    </p>
                  ) : null}
                  {previewLoading ? (
                    <p
                      className="flex items-center gap-1.5"
                      data-testid="text-bulk-keyword-preview-loading"
                    >
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Estimating what will be fetched…
                    </p>
                  ) : previewError ? (
                    <p className="text-destructive" data-testid="text-bulk-keyword-preview-error">
                      {previewErr instanceof Error
                        ? previewErr.message
                        : "Could not estimate this refresh."}
                    </p>
                  ) : (
                    <ul
                      className="text-xs space-y-1 list-disc pl-4"
                      data-testid="list-bulk-keyword-preview-counts"
                    >
                      <li>
                        <span className="text-foreground font-medium tabular-nums">{willFetch}</span>{" "}
                        distinct keyword{willFetch === 1 ? "" : "s"} will be fetched
                      </li>
                      <li>
                        <span className="tabular-nums">{skipNoKw}</span> page
                        {skipNoKw === 1 ? "" : "s"} skipped (no main keyword)
                      </li>
                      <li>
                        <span className="tabular-nums">{skipFresh}</span> page
                        {skipFresh === 1 ? "" : "s"} skipped (already fresh)
                      </li>
                      <li>
                        Estimated cost:{" "}
                        <span className="font-medium text-foreground tabular-nums">
                          {viaDataForSeo ? `about $${estimatedUsd.toFixed(2)}` : `${estimatedCredits} OpenRush credits`}
                        </span>
                        {viaDataForSeo && budgetRemaining != null ? (
                          <>
                            {" "}
                            — you have{" "}
                            <span className="font-medium text-foreground tabular-nums">
                              ${budgetRemaining.toFixed(2)}
                            </span>{" "}
                            left today
                          </>
                        ) : null}
                      </li>
                    </ul>
                  )}
                  {viaDataForSeo ? (
                    <>
                      <DataForSeoBalanceLine
                        cost={estimatedUsd}
                        balance={usdBalance}
                        loading={usdBalanceLoading}
                        error={usdBalanceError}
                      />
                      <p className="text-xs" data-testid="text-bulk-keyword-cap-note">
                        If the daily limit is reached, the run stops and lists what was not refreshed.
                      </p>
                      {overDailyLimit ? (
                        <p className="text-xs text-status-away" data-testid="text-bulk-keyword-over-limit">
                          This selection costs more than what is left today, so only part of it will be
                          refreshed.
                        </p>
                      ) : null}
                      {usdBalanceTooLow ? (
                        <p className="text-destructive text-xs" data-testid="text-bulk-keyword-balance-low">
                          Not enough DataForSEO balance for this selection. Top up the account or reduce the
                          selection.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <OpenRushCreditsLine
                        cost={estimatedCredits}
                        balance={balance}
                        loading={creditsLoading}
                        error={creditsError}
                      />
                      {balanceTooLow ? (
                        <p className="text-destructive text-xs" data-testid="text-bulk-keyword-balance-low">
                          Not enough OpenRush credits for this selection. Reduce the selection or add
                          credits, then try again.
                        </p>
                      ) : null}
                    </>
                  )}
                  {!previewLoading && !previewError && willFetch === 0 ? (
                    <p className="text-xs" data-testid="text-bulk-keyword-nothing-to-fetch">
                      Nothing to fetch — every selected page is missing a keyword or already has
                      fresh metrics.
                    </p>
                  ) : null}
                </>
              ) : (
                <p data-testid="text-bulk-keyword-openrush-inactive">
                  Turn on DataForSEO or OpenRush in Settings → SEO/GEO to refresh keyword volume and
                  difficulty automatically. Until then, saved YAML estimates may not be recent.
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={applying}
            data-testid="button-bulk-keyword-cancel"
          >
            {openrushConfigured ? "Cancel" : "Close"}
          </Button>
          {openrushConfigured ? (
            <Button
              type="button"
              disabled={!canConfirm}
              onClick={() => void onConfirm()}
              data-testid="button-bulk-keyword-confirm"
            >
              {applying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Refreshing…
                </>
              ) : viaDataForSeo ? (
                `Refresh (~$${estimatedUsd.toFixed(2)})`
              ) : (
                `Refresh from ${providerName}`
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
