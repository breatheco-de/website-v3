import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { apiFetch } from "@/lib/queryClient";
import type { UrlRemovalAction, UrlRemovalCheck } from "@shared/url-removal";

function debugHeaders(): Record<string, string> {
  const token = getDebugToken();
  return token ? { "X-Debug-Token": token } : {};
}

export type UrlRemovalCheckParams = {
  action: UrlRemovalAction;
  contentType: string | null | undefined;
  slug: string | null | undefined;
  /** Empty = every live locale. */
  locales?: string[];
  enabled: boolean;
};

export type RefreshAdsResult = {
  refreshed: Array<{ site: string; ok: boolean; error?: string }>;
  google_note?: string;
};

/**
 * Ads that send people to the URL(s) this action removes, plus page gates. Fetched once when the
 * dialog / editor opens (never per keystroke); `refreshAds` re-reads the matched Meta ads now.
 */
export function useUrlRemovalCheck(params: UrlRemovalCheckParams) {
  const { action, contentType, slug, enabled } = params;
  const locales = (params.locales ?? []).filter(Boolean).join(",");
  const queryClient = useQueryClient();
  const queryKey = ["/api/content/url-removal-check", action, contentType, slug, locales];
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshAdsResult | null>(null);

  const query = useQuery<UrlRemovalCheck>({
    queryKey,
    enabled: enabled && !!contentType && !!slug,
    staleTime: 60_000,
    queryFn: async () => {
      const qs = new URLSearchParams({ action, contentType: contentType!, slug: slug! });
      if (locales) qs.set("locales", locales);
      const res = await apiFetch(`/api/content/url-removal-check?${qs}`, { headers: debugHeaders() });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Couldn't check ads");
      return (await res.json()) as UrlRemovalCheck;
    },
  });

  const refreshAds = useCallback(async () => {
    if (!contentType || !slug) return;
    setRefreshing(true);
    try {
      const res = await apiFetch("/api/content/url-removal-check/refresh-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...debugHeaders() },
        body: JSON.stringify({ action, contentType, slug, locales }),
      });
      const body = (await res.json().catch(() => ({}))) as { check?: UrlRemovalCheck; error?: string } & RefreshAdsResult;
      if (!res.ok || !body.check) throw new Error(body.error || "Couldn't refresh ad data");
      queryClient.setQueryData(queryKey, body.check);
      setRefreshResult({ refreshed: body.refreshed ?? [], google_note: body.google_note });
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, contentType, slug, locales, queryClient]);

  return {
    check: query.data ?? null,
    loading: query.isLoading && query.fetchStatus !== "idle",
    error: query.error instanceof Error ? query.error.message : null,
    refreshAds,
    refreshing,
    refreshResult,
  };
}
