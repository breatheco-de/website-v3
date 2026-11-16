import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { adsManagerUrl } from "@/components/diagnostics/AdsIssueEvidence";
import { apiFetch } from "@/lib/queryClient";
import { ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export type AdsCampaignPlatform = "meta" | "google";

type LandingUrlRow = {
  url: string;
  path: string;
  active: number;
  paused: number;
  ignored: number;
  matches_issue_path: boolean;
};

type CampaignDetailResponse = {
  platform: AdsCampaignPlatform;
  fetched_at: string;
  campaign: {
    id: string;
    name: string;
    status: string | null;
    account_id: string;
    effective_status: string | null;
    objective: string | null;
  };
  ads_total: number;
  ads_active: number;
  ads_paused: number;
  ads_ignored: number;
  landing_urls: LandingUrlRow[];
  path_in_campaign: boolean | null;
  issue_path: string | null;
  warnings: Array<{ code: string; message: string }>;
  metrics?: {
    days: number;
    spend: Record<string, number>;
    paid_visits: number;
    clicks: number;
    pages: Array<{ path: string; title: string; paid_visits: number }>;
  } | null;
  error?: string;
  code?: string;
  candidates?: Array<{ id: string; name: string; status: string | null; account_id: string; platform: AdsCampaignPlatform }>;
};

/** Prefer Meta for long numeric ids (Meta campaign ids); Google for shorter digit ids. */
export function guessCampaignPlatforms(
  value: string,
  hints?: { sources?: string[] },
): AdsCampaignPlatform[] {
  const v = value.trim();
  const sources = (hints?.sources ?? []).map((s) => s.toLowerCase());
  const fromSource: AdsCampaignPlatform[] = [];
  if (sources.some((s) => s === "fb" || s === "facebook" || s === "ig" || s === "instagram" || s === "meta")) {
    fromSource.push("meta");
  }
  if (sources.some((s) => s.includes("google") || s === "adwords")) {
    fromSource.push("google");
  }
  if (/^\d+$/.test(v)) {
    const byLength: AdsCampaignPlatform[] = v.length >= 14 ? ["meta", "google"] : ["google", "meta"];
    const ordered = [...fromSource, ...byLength.filter((p) => !fromSource.includes(p))];
    return ordered.length ? ordered : byLength;
  }
  return fromSource.length ? fromSource : ["meta", "google"];
}

export function isCampaignLookupValue(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^\d{6,}$/.test(v)) return true;
  // Named campaigns (utm_campaign text)
  return v.length >= 3 && !/\s{2,}/.test(v);
}

async function fetchCampaignDetail(opts: {
  platforms: AdsCampaignPlatform[];
  value: string;
  issuePath?: string;
}): Promise<CampaignDetailResponse> {
  const isId = /^\d+$/.test(opts.value.trim());
  let lastError: CampaignDetailResponse | null = null;
  for (const platform of opts.platforms) {
    const params = new URLSearchParams({ platform });
    if (isId) params.set("id", opts.value.trim());
    else params.set("name", opts.value.trim());
    if (opts.issuePath) params.set("path", opts.issuePath);
    const res = await apiFetch(`/api/ads/campaign?${params}`);
    const body = (await res.json()) as CampaignDetailResponse;
    if (res.ok) return body;
    if (res.status === 409 && body.candidates?.length) return body;
    lastError = { ...body, error: body.error || `HTTP ${res.status}` };
    if (res.status !== 404) break;
  }
  throw new Error(lastError?.error || "Campaign not found in the last ads sync.");
}

function formatMoney(spend: Record<string, number> | undefined): string {
  const entries = Object.entries(spend ?? {}).filter(([, n]) => n > 0);
  if (!entries.length) return "—";
  return entries.map(([cur, n]) => `${cur} ${n.toFixed(2)}`).join(", ");
}

function formatSyncTime(iso: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function AdsCampaignDetailModal({
  open,
  onOpenChange,
  value,
  issuePath,
  sourceHints,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string | null;
  issuePath?: string;
  sourceHints?: string[];
}) {
  const platforms = useMemo(
    () => (value ? guessCampaignPlatforms(value, { sources: sourceHints }) : []),
    [value, sourceHints],
  );
  const [pickedCandidateId, setPickedCandidateId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const lookupValue = pickedCandidateId || value;

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["/api/ads/campaign", lookupValue, issuePath, platforms.join(",")],
    queryFn: () =>
      fetchCampaignDetail({
        platforms: pickedCandidateId ? platforms : platforms,
        value: lookupValue!,
        issuePath,
      }),
    enabled: open && !!lookupValue && isCampaignLookupValue(lookupValue),
    retry: false,
  });

  const ambiguous = data?.code === "ambiguous" || (data?.candidates && data.candidates.length > 0 && !data.campaign);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPickedCandidateId(null);
          setAdvancedOpen(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-lg max-h-[85vh] overflow-y-auto bg-background text-foreground"
        data-testid="dialog-ads-campaign-detail"
      >
        <DialogHeader>
          <DialogTitle className="text-base">Campaign landing URLs</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            What this campaign is sending people to, as of the last ads sync.
          </DialogDescription>
        </DialogHeader>

        {!value ? null : isLoading || isFetching ? (
          <p className="text-sm text-muted-foreground" data-testid="text-campaign-loading">
            Loading campaign…
          </p>
        ) : error ? (
          <p className="text-sm text-destructive" data-testid="text-campaign-error">
            {error instanceof Error ? error.message : "Could not load campaign."}
          </p>
        ) : ambiguous && data?.candidates ? (
          <div className="space-y-2" data-testid="campaign-candidates">
            <p className="text-sm">Several campaigns match. Pick one:</p>
            <ul className="space-y-1">
              {data.candidates.map((c) => (
                <li key={`${c.platform}-${c.id}`}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-start font-mono text-xs"
                    onClick={() => setPickedCandidateId(c.id)}
                  >
                    {c.platform}: {c.name} ({c.id})
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : data?.campaign ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{data.campaign.name}</p>
                <Badge variant="outline" className="text-[10px]">
                  {data.platform === "meta" ? "Meta" : "Google"}
                </Badge>
                {data.campaign.status ? (
                  <Badge variant="outline" className="text-[10px]">
                    {data.campaign.status}
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground" data-testid="text-campaign-synced-at">
                As of {formatSyncTime(data.fetched_at)} (status is from this sync, not live)
              </p>
              <p className="text-xs text-muted-foreground font-mono break-all">{data.campaign.id}</p>
            </div>

            {data.path_in_campaign === false ? (
              <div
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
                data-testid="banner-campaign-path-mismatch"
              >
                This broken address is not in any saved ad link for this campaign. The URLs below are what
                the campaign does use — useful if you need a replacement.
              </div>
            ) : data.path_in_campaign === true ? (
              <div
                className="rounded-md border border-chart-3/40 bg-chart-3/10 px-3 py-2 text-sm"
                data-testid="banner-campaign-path-match"
              >
                This broken address is used by ads in this campaign (
                {data.ads_active} active, {data.ads_paused} paused
                {data.ads_ignored ? `, ${data.ads_ignored} ignored` : ""}).
              </div>
            ) : null}

            {data.warnings.map((w) => (
              <p key={w.code} className="text-xs text-amber-500" data-testid={`warning-${w.code}`}>
                {w.message}
              </p>
            ))}

            <div>
              <p className="text-xs font-medium mb-2">Landing URLs</p>
              {data.landing_urls.length === 0 ? (
                <p className="text-xs text-muted-foreground">No website links in the saved ad list.</p>
              ) : (
                <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                  {data.landing_urls.map((row) => (
                    <li
                      key={row.url}
                      className={cn(
                        "rounded border px-2 py-1.5 text-xs",
                        row.matches_issue_path ? "border-primary/50 bg-primary/5" : "border-border",
                      )}
                    >
                      <p className="font-mono break-all">{row.url}</p>
                      <p className="text-muted-foreground mt-0.5">
                        {row.active} active · {row.paused} paused
                        {row.matches_issue_path ? " · matches this 404" : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {data.metrics ? (
              <div className="text-xs space-y-1" data-testid="campaign-metrics">
                <p className="font-medium">Last {data.metrics.days} days (report)</p>
                <p className="text-muted-foreground">
                  Spend {formatMoney(data.metrics.spend)} · {data.metrics.paid_visits} paid visits ·{" "}
                  {data.metrics.clicks} clicks
                </p>
              </div>
            ) : null}

            {data.platform === "meta" ? (
              <Button type="button" variant="outline" size="sm" asChild>
                <a
                  href={adsManagerUrl(data.campaign.account_id, { campaign_id: data.campaign.id })}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="link-ads-manager"
                >
                  Open in Ads Manager
                  <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                </a>
              </Button>
            ) : null}

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="px-0 text-xs text-muted-foreground">
                  Read more (advanced)
                  <ChevronDown className={cn("ml-1 h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="text-xs text-muted-foreground space-y-1 pt-1">
                <p>
                  Landing URLs come from the ads-setup catalog (last full sync). Report metrics are a separate
                  rollup and may include visits that are not in the URL list.
                </p>
                <p>
                  Google’s saved ad list is capped; when the catalog is full, some campaigns show no URLs even
                  though they still spend.
                </p>
              </CollapsibleContent>
            </Collapsible>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
