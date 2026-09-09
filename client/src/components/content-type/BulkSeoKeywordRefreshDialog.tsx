import { useEffect } from "react";
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
  OPENRUSH_FETCH_CREDITS,
  OpenRushCreditsLine,
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
    ok: boolean;
    skipped?: boolean;
    aborted?: boolean;
    reason?: string;
    error?: string;
  }>;
  credits_per_call: number;
  keywords_to_fetch: number;
  keywords_fetched: number;
  credits_spent: number;
  credits_estimated: number;
  skipped_no_keyword: number;
  skipped_already_fresh: number;
  failed: number;
  aborted: number;
  aborted_remaining?: boolean;
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

  const {
    data: creditsData,
    isFetching: creditsLoading,
    isError: creditsError,
  } = useQuery<{ ok: boolean; balance: number | null }>({
    queryKey: ["/api/seo/openrush/credits"],
    enabled: open && openrushConfigured,
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

  const estimated =
    preview?.credits_estimated ??
    (preview?.keywords_to_fetch ?? 0) * OPENRUSH_FETCH_CREDITS.keyword;
  const balance = creditsData?.balance ?? null;
  const balanceKnown = !creditsLoading && !creditsError && balance != null;
  const balanceTooLow = balanceKnown && estimated > 0 && balance! < estimated;
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
    willFetch > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-bulk-seo-keyword-refresh">
        <DialogHeader>
          <DialogTitle>
            {openrushConfigured ? "Refresh keyword metrics?" : "OpenRush is not active"}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {openrushConfigured ? (
                <>
                  <p>
                    Refresh volume and difficulty for the selected pages from OpenRush. Pages without
                    a main keyword, and keywords refreshed in the last 7 days, are skipped. This
                    updates the shared research cache — it does not change page titles, descriptions,
                    or publish status.
                  </p>
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
                          {estimated} OpenRush credits
                        </span>
                      </li>
                    </ul>
                  )}
                  <OpenRushCreditsLine
                    cost={estimated}
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
                  {!previewLoading && !previewError && willFetch === 0 ? (
                    <p className="text-xs" data-testid="text-bulk-keyword-nothing-to-fetch">
                      Nothing to fetch — every selected page is missing a keyword or already has
                      fresh metrics.
                    </p>
                  ) : null}
                </>
              ) : (
                <p data-testid="text-bulk-keyword-openrush-inactive">
                  Turn on OpenRush in Settings to refresh keyword volume and difficulty automatically
                  from OpenRush. Until then, saved YAML estimates may not be recent.
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
              ) : (
                "Refresh from OpenRush"
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
