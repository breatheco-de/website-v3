import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconRefresh } from "@tabler/icons-react";
import { Loader2 } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ToastAction } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { apiFetch } from "@/lib/queryClient";

export type PublicCacheTarget = { contentType: string; slug: string; locale: string };

type PublicCacheState = "fresh" | "stale" | "rebuilding" | "not_cached";

type PublicCacheStatus = {
  state: PublicCacheState;
  contentChangedAt: number | null;
  livePath: string | null;
};

type PublicCacheRefreshResult = {
  refreshed: Array<{ pathname: string; variantKey: string }>;
  failed: Array<{ pathname: string; variantKey: string; reason: string }>;
  livePath: string | null;
  error?: string;
};

function authHeaders(): Record<string, string> {
  const token = getDebugToken();
  return token ? { Authorization: `Token ${token}` } : {};
}

function endpoint(target: PublicCacheTarget): string {
  return `/api/public-cache/${encodeURIComponent(target.contentType)}/${encodeURIComponent(target.slug)}/${encodeURIComponent(target.locale)}`;
}

function statusQueryKey(target: PublicCacheTarget) {
  return ["/api/public-cache", target.contentType, target.slug, target.locale] as const;
}

function openFresh(livePath: string) {
  const sep = livePath.includes("?") ? "&" : "?";
  window.open(`${livePath}${sep}_fresh=${Date.now()}`, "_blank", "noopener");
}

const ITEM_TOOLTIP =
  "Rebuilds the copy visitors get for this language. Saving already does this; use it if the live page looks out of date.";

function stateTooltip(state: PublicCacheState | undefined): string {
  if (state === "stale") return "This language was edited after visitors' copy was built.";
  if (state === "rebuilding") return "A rebuild from a recent save is still running.";
  return "Based on this page's own content. Refresh anyway if something looks wrong.";
}

/** Status is only fetched while the menu is open. */
export function PublicCacheMenuItem({ target, open }: { target: PublicCacheTarget; open: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: statusQueryKey(target),
    enabled: open,
    staleTime: 10_000,
    refetchInterval: (query) => (open && query.state.data?.state === "rebuilding" ? 3000 : false),
    queryFn: async (): Promise<PublicCacheStatus> => {
      const res = await apiFetch(endpoint(target), { headers: authHeaders() });
      if (!res.ok) throw new Error("Could not check the public page");
      return (await res.json()) as PublicCacheStatus;
    },
  });

  const refresh = useMutation({
    mutationFn: async (): Promise<PublicCacheRefreshResult> => {
      const res = await apiFetch(`${endpoint(target)}/refresh`, { method: "POST", headers: authHeaders() });
      const data = (await res.json().catch(() => ({}))) as Partial<PublicCacheRefreshResult>;
      if (!res.ok && !Array.isArray(data.failed)) {
        throw new Error(data.error || "Could not refresh the public page");
      }
      return { refreshed: data.refreshed ?? [], failed: data.failed ?? [], livePath: data.livePath ?? null };
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: statusQueryKey(target) });
      if (result.failed.length > 0) {
        const paths = [...new Set(result.failed.map((f) => f.pathname))].join(", ");
        toast({
          title: result.refreshed.length > 0 ? "Public page partly updated" : "Public page not updated",
          description: `Could not rebuild ${paths}. The previous version is still live for these.`,
          variant: "destructive",
        });
        return;
      }
      if (result.refreshed.length === 0) {
        toast({ title: "Nothing to refresh", description: "This language has no public page yet." });
        return;
      }
      const livePath = result.livePath;
      toast({
        title: "Public page updated",
        description: "Visitors now get the latest version of this language.",
        action: livePath ? (
          <ToastAction altText="View live page" onClick={() => openFresh(livePath)}>
            View live page
          </ToastAction>
        ) : undefined,
      });
    },
    onError: (err) => {
      toast({
        title: "Public page not updated",
        description: `${err instanceof Error ? err.message : "Network error"}. The previous version is still live.`,
        variant: "destructive",
      });
    },
  });

  const state = status.data?.state;
  const checking = open && status.isFetching && !status.data;
  const busy = refresh.isPending;

  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              if (!busy) refresh.mutate();
            }}
            disabled={busy}
            className="text-[13px]"
            data-testid={`menu-refresh-public-${target.locale}`}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            ) : (
              <IconRefresh className="h-3.5 w-3.5 mr-2" />
            )}
            <span className="flex-1">{busy ? "Refreshing..." : "Refresh public page"}</span>
            {!busy && checking && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            {!busy && state === "stale" && (
              <span
                className="rounded-full border border-status-away/40 bg-status-away/15 px-1.5 text-[10px] font-medium text-status-away"
                data-testid={`badge-public-stale-${target.locale}`}
              >
                Out of date
              </span>
            )}
            {!busy && state === "rebuilding" && (
              <span
                className="flex items-center gap-1 text-[10px] text-muted-foreground"
                data-testid={`badge-public-rebuilding-${target.locale}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-status-away animate-pulse" />
                Rebuilding...
              </span>
            )}
          </DropdownMenuItem>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-[240px] text-xs">
          <p>{ITEM_TOOLTIP}</p>
          <p className="mt-1 text-muted-foreground">{stateTooltip(state)}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
