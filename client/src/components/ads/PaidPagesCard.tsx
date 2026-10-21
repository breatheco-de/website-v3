import { useMemo, useState, type SyntheticEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, Info, Loader2, Megaphone, Route } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/queryClient";
import type { AdsIssue } from "@shared/ads-diagnostics-rules";
import type { AttributionModel } from "@shared/paid-attribution";
import { isRefreshActive } from "@shared/ads-refresh-status";
import { formatGoogleCustomerId } from "@shared/ads-settings";
import { NO_URL_DESTINATION_KINDS, type AdsCampaignGroup, type AdsMetaStatus, type AdsPageRow, type AdsReport } from "./ads-types";
import { formatMoney, formatNum, formatWhen, moneyTotal, PLATFORM_LABELS } from "./ads-format";
import { PaidPageRow, type PaidPerspective } from "./PaidPageRow";
import { AttributedOnlyDialog } from "./AttributedOnlyDialog";
import { UnknownDestinationDialog } from "./UnknownDestinationDialog";

const PERSPECTIVES: { id: PaidPerspective; label: string }[] = [
  { id: "traffic", label: "Traffic" },
  { id: "conversion", label: "Conversion" },
  { id: "engagement", label: "Engagement" },
  { id: "integrity", label: "Integrity" },
];

function accountLabel(a: Pick<AdsMetaStatus["accounts"][number], "id" | "name" | "sync_error" | "history_loaded">): string {
  const base = a.name || a.id;
  if (a.sync_error) return `${base} · can't read this account`;
  if (a.history_loaded === false) return `${base} · not synced yet`;
  return base;
}

function sortRows(rows: AdsPageRow[], perspective: PaidPerspective): AdsPageRow[] {
  const byRate = (get: (r: AdsPageRow) => number | null, dir: 1 | -1) =>
    [...rows].sort((a, b) => {
      if (a.low_sample !== b.low_sample) return a.low_sample ? 1 : -1;
      const av = get(a);
      const bv = get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  switch (perspective) {
    case "conversion":
      return byRate((r) => (r.unique_leads > 0 ? moneyTotal(r.cost_per_lead) || null : null), 1);
    case "engagement":
      return byRate((r) => r.bounce_rate, -1);
    default:
      return [...rows].sort((a, b) => moneyTotal(b.spend) - moneyTotal(a.spend) || b.paid_visits - a.paid_visits);
  }
}

export function useAdsReport(params: {
  days: number;
  platform: string;
  currency: string;
  account: string;
  contentType: string;
  model: AttributionModel;
  splitByVersion: boolean;
}) {
  const qs = new URLSearchParams({
    days: String(params.days),
    platform: params.platform,
    model: params.model,
    ...(params.currency !== "all" ? { currency: params.currency } : {}),
    ...(params.account !== "all" ? { account: params.account } : {}),
    ...(params.contentType !== "all" ? { content_type: params.contentType } : {}),
    ...(params.splitByVersion ? { split_by_version: "1" } : {}),
  });
  return useQuery({
    queryKey: ["/api/ads/report", qs.toString()],
    queryFn: async () => {
      const res = await apiFetch(`/api/ads/report?${qs.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load Ads report");
      return res.json() as Promise<AdsReport>;
    },
    refetchInterval: (q) => (isRefreshActive((q.state.data as AdsReport | undefined)?.refresh) ? 8000 : false),
  });
}

function InlineCopy({ text, testId }: { text: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const copy = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Copy ${text}`}
      title="Copy"
      onClick={copy}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") copy(e);
      }}
      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={testId}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </span>
  );
}

function CampaignAccordion({ group }: { group: AdsCampaignGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-border last:border-b-0">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left" data-testid={`campaign-group-${group.key}`}>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1">
              <p className="truncate text-sm font-medium text-foreground">{group.campaign_name}</p>
              <InlineCopy text={group.campaign_name} testId={`button-copy-campaign-${group.key}`} />
            </div>
            <p className="text-xs text-muted-foreground">
              {group.platform ? PLATFORM_LABELS[group.platform] ?? group.platform : "Unknown platform"} · {group.pages.length} page(s)
            </p>
          </div>
          <div className="flex items-center gap-5 text-sm tabular-nums">
            <span>{formatMoney(group.spend)}</span>
            <span className="text-muted-foreground">{formatNum(group.paid_visits)} visits</span>
            <span className="text-muted-foreground">{formatNum(group.clicks)} clicks</span>
            {group.platform === "meta" || group.meta_leads > 0 ? (
              <span className="text-muted-foreground">{formatNum(group.meta_leads)} Meta leads</span>
            ) : null}
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="bg-muted/30 px-3 pb-2">
        {group.pages.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-3 py-1 text-xs">
            <div className="min-w-0">
              <p className="truncate text-foreground">{p.title}</p>
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate text-muted-foreground">{p.path}</span>
                <InlineCopy text={p.path} testId={`button-copy-campaign-page-${p.key}`} />
              </div>
            </div>
            <span className="tabular-nums text-muted-foreground">{formatNum(p.paid_visits)} visits</span>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function PaidPagesCard({ days, issues = [], initialPlatform = "all" }: { days: number; issues?: AdsIssue[]; initialPlatform?: string }) {
  const [platform, setPlatform] = useState(initialPlatform);
  const [currency, setCurrency] = useState("all");
  const [account, setAccount] = useState("all");
  const [contentType, setContentType] = useState("all");
  const [model, setModel] = useState<AttributionModel>("last_paid");
  const [group, setGroup] = useState<"page" | "campaign">("page");
  const [splitByVersion, setSplitByVersion] = useState(false);
  const [perspective, setPerspective] = useState<PaidPerspective>("traffic");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const { data, isLoading, error } = useAdsReport({ days, platform, currency, account, contentType, model, splitByVersion });

  const issuesByKey = useMemo(() => {
    const m = new Map<string, AdsIssue[]>();
    for (const i of issues) {
      if (!i.scope.page_key) continue;
      m.set(i.scope.page_key, [...(m.get(i.scope.page_key) ?? []), i]);
    }
    return m;
  }, [issues]);

  const contentTypes = useMemo(
    () => Array.from(new Set((data?.pages ?? []).map((p) => p.content_type).filter((c): c is string => !!c))).sort(),
    [data],
  );
  const currencies = Object.keys(data?.totals.spend ?? {});
  const accountOptions = useMemo(() => {
    const meta = (data?.meta.accounts ?? []).map((a) => ({ value: a.id, label: `Meta · ${accountLabel(a)}`, title: a.sync_error }));
    const google = (data?.google?.connected ? data.google.accounts : []).map((a) => ({
      value: formatGoogleCustomerId(a.id),
      label: `Google · ${accountLabel({ ...a, name: a.name ?? formatGoogleCustomerId(a.id) })}`,
      title: a.sync_error,
    }));
    return platform === "google" ? google : platform === "meta" ? meta : [...meta, ...google];
  }, [data, platform]);
  const rows = data ? sortRows(data.pages, perspective) : [];
  const primaryHost = rows[0]?.host;

  return (
    <div className="space-y-4">
      <Card data-testid="card-paid-pages">
        <CardHeader className="pb-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="h-4 w-4" />
              Paid pages
              {isRefreshActive(data?.refresh) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </CardTitle>
            <ToggleButtonBar value={perspective} onValueChange={(v) => setPerspective(v as PaidPerspective)} listTestId="paid-perspectives" listClassName="flex">
              {PERSPECTIVES.map((p) => (
                <ToggleButtonBarTrigger key={p.id} value={p.id} data-testid={`perspective-${p.id}`}>
                  {p.label}
                </ToggleButtonBarTrigger>
              ))}
            </ToggleButtonBar>
          </div>
          <p className="text-sm text-muted-foreground">
            Every page that received paid visits, with what it cost and how visitors behaved. Leads count for the page the ad sent them to;
            repeat submissions from the same person are shown but not counted twice. Expand a page to see which campaigns paid for it. If one
            campaign is far worse than the others, the problem is the campaign, not the page.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="h-8 w-[140px]" data-testid="select-paid-platform">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all", "meta", "google", "microsoft", "tiktok", "linkedin"].map((p) => (
                  <SelectItem key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currencies.length > 1 && (
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="h-8 w-[110px]" data-testid="select-paid-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All currencies</SelectItem>
                  {currencies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {accountOptions.length > 1 && (
              <Select value={account} onValueChange={setAccount}>
                <SelectTrigger className="h-8 w-[160px]" data-testid="select-paid-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {accountOptions.map((a) => (
                    <SelectItem key={a.value} value={a.value} title={a.title} data-testid={`option-paid-account-${a.value}`}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={contentType} onValueChange={setContentType}>
              <SelectTrigger className="h-8 w-[150px]" data-testid="select-paid-content-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All content types</SelectItem>
                {contentTypes.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={model} onValueChange={(v) => setModel(v as AttributionModel)}>
              <SelectTrigger className="h-8 w-[170px]" data-testid="select-paid-credit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last_paid">Credit: last paid page</SelectItem>
                <SelectItem value="first_paid">Credit: first paid page</SelectItem>
              </SelectContent>
            </Select>
            <ToggleButtonBar value={group} onValueChange={(v) => setGroup(v as "page" | "campaign")} listTestId="paid-grouping" listClassName="flex">
              <ToggleButtonBarTrigger value="page">By page</ToggleButtonBarTrigger>
              <ToggleButtonBarTrigger value="campaign">By campaign</ToggleButtonBarTrigger>
            </ToggleButtonBar>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={splitByVersion} onCheckedChange={setSplitByVersion} data-testid="switch-paid-versions" />
              Split by version
            </label>
          </div>
          {data && currency !== "all" && (
            <p className="text-xs text-muted-foreground" data-testid="text-paid-currency-scope">
              Showing only ad traffic from {currency} accounts.
            </p>
          )}
          {data && (account !== "all" || currency !== "all") && data.totals.unassigned_visits > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="text-paid-unassigned">
              {formatNum(data.totals.unassigned_visits)} paid visits had no ad tags, so they aren't counted under{" "}
              {account !== "all" ? "this account" : "these accounts"}.
            </p>
          )}
          {data && (
            <p className="text-xs text-muted-foreground" data-testid="text-paid-sync-status">
              {data.meta.connected || !data.google?.connected ? `Meta synced ${formatWhen(data.meta.last_synced_at)} · ` : ""}
              {data.google?.connected ? `Google data through ${data.google.data_through ?? "—"} · ` : ""}
              GA4 through {data.ga4.last_export_date ?? "—"}
              {data.ga4.old_rule_days ? ` · ${data.ga4.old_rule_days} days still use the older paid-visit rule; next sync finishes them` : ""}
              {isRefreshActive(data.refresh) ? " · refreshing…" : ""}
              {data.refresh?.state === "failed" || data.refresh?.state === "worker_down" ? " · last refresh didn't run" : ""}
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading paid pages…
            </div>
          ) : error ? (
            <p className="px-4 py-6 text-sm text-destructive">{error instanceof Error ? error.message : "Failed to load"}</p>
          ) : !data ? null : !data.meta.connected && !data.google?.connected && !data.ga4.configured ? (
            <p className="px-4 py-6 text-sm text-muted-foreground" data-testid="empty-paid-not-connected">
              Connect Meta or Google Ads in Settings → Ads and the GA4 export in Tracking to see paid pages.
            </p>
          ) : !data.ga4.configured ? (
            <p className="px-4 py-6 text-sm text-muted-foreground" data-testid="empty-paid-no-ga4">
              The GA4 BigQuery export is not set up, so we cannot see paid visits yet. Spend still appears under Other destinations and campaigns.
            </p>
          ) : group === "campaign" ? (
            data.campaigns.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No paid campaigns in this window.</p>
            ) : (
              <div data-testid="paid-campaign-list">{data.campaigns.map((g) => <CampaignAccordion key={g.key} group={g} />)}</div>
            )
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground" data-testid="empty-paid-no-traffic">
              No paid visits landed on our pages in this window.
            </p>
          ) : (
            <div data-testid="paid-pages-list">
              {rows.map((r) => (
                <PaidPageRow
                  key={r.key}
                  row={r}
                  perspective={perspective}
                  issues={issuesByKey.get(r.key)}
                  coveredDays={data.covered_days}
                  metaSplitDays={data.meta_split_days}
                  askRejectPct={data.consent.ask_region_reject_pct}
                  primaryHost={primaryHost}
                />
              ))}
            </div>
          )}
          {data && (
            <div className="border-t border-border px-4 py-3">
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger asChild>
                  <button type="button" className="flex items-center gap-2 text-sm font-medium text-foreground" data-testid="button-paid-advanced">
                    Read more (advanced)
                    <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <AttributedOnlyLine report={data} />
                  <p>
                    Credit: each lead goes to one page — the {model === "first_paid" ? "first" : "most recent"} paid visit within 30 days before the
                    lead. No splitting; the form page never gets credit.
                  </p>
                  <p>Repeats (same browser, same form, 24h) are submissions, not leads. Test leads are excluded.</p>
                  <p data-testid="text-paid-campaign-breakdown-advanced">
                    Campaign breakdown: visits and site leads join a campaign by the campaign id in the ad link; anything without a known id goes to
                    "Visits without campaign tag" (never spend). Site leads per campaign follow the credit setting above. Meta leads per campaign use
                    Meta&apos;s own attribution. Organic numbers are page-level only.
                  </p>
                  <p>
                    Rates grey out under {data.thresholds.min_paid_visits_for_rates} paid visits. Site leads cover {data.covered_days.covered} of{" "}
                    {data.covered_days.total} days.
                  </p>
                  <p>
                    Meta columns use Meta's own attribution: 7 days after a click, or 1 day after someone only saw the ad. Meta conversion rate is
                    Meta leads divided by landing page views, and shows "—" when Meta saw no page loads.
                  </p>
                  <p>
                    "Saw the ad only" is Meta leads minus click-attributed leads — those people never clicked, which is why Meta leads can be higher
                    than site leads.
                  </p>
                  <p>
                    On All platforms, site visits and leads can include Google and others; Meta columns stay Meta-only (the details popover says so
                    on mixed rows).
                  </p>
                  <p>
                    Visits in ask regions include Consent Mode estimates
                    {data.consent.ask_region_reject_pct != null ? `; ${data.consent.ask_region_reject_pct}% rejected tracking` : ""}. Journeys are
                    seen per browser.
                  </p>
                  <p>
                    Sources: Meta insights (<code className="font-mono">.cache/&#123;site&#125;/meta-ads-days</code>), GA4 export (
                    <code className="font-mono">paid-landing-days</code>), lead ledger (<code className="font-mono">lead_submissions</code>).
                  </p>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </CardContent>
      </Card>

      {data && <OtherDestinationsCard rows={data.destinations} spendTotal={data.totals.spend} />}
    </div>
  );
}

function DestinationRowContent({ row: r, explainable }: { row: AdsPageRow; explainable: boolean }) {
  const metaLeads = r.meta_leads + r.instant_form_leads;
  return (
    <>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm text-foreground">
          {NO_URL_DESTINATION_KINDS.has(r.kind) ? r.title : r.url}
          {explainable && <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Why?" />}
        </p>
        <p className="text-xs text-muted-foreground">
          {r.kind_label}
          {r.platforms.length > 0 ? ` · ${r.platforms.map((p) => PLATFORM_LABELS[p] ?? p).join(", ")}` : ""}
        </p>
      </div>
      <div className="flex gap-5 text-sm tabular-nums">
        <span>{formatMoney(r.spend)}</span>
        <span className="text-muted-foreground">{formatNum(r.paid_visits)} visits</span>
        {r.platforms.includes("meta") || metaLeads > 0 ? <span className="text-muted-foreground">{formatNum(metaLeads)} Meta leads</span> : null}
        {r.platforms.includes("google") || r.google_leads ? (
          <span className="text-muted-foreground">{formatNum(r.google_leads ?? 0)} Google leads</span>
        ) : null}
      </div>
    </>
  );
}

function AttributedOnlyLine({ report }: { report: AdsReport }) {
  const attributed = report.totals.attributed_only_visits;
  if (attributed === undefined || (attributed && attributed.total === 0)) return null;
  const link = (
    <AttributedOnlyDialog data={attributed}>
      <button type="button" className="font-medium text-foreground underline underline-offset-2" data-testid="button-attributed-only">
        What does this mean?
      </button>
    </AttributedOnlyDialog>
  );
  return (
    <p data-testid="text-attributed-only">
      Paid visits need ad tags or click IDs on the landing URL.{" "}
      {attributed
        ? `${formatNum(attributed.total)} visits GA4 credits to ads were not counted. `
        : "GA4's export doesn't include the field needed to measure how many visits this leaves out. "}
      {link}
    </p>
  );
}

export function OtherDestinationsCard({ rows, spendTotal }: { rows: AdsPageRow[]; spendTotal: Record<string, number> }) {
  return (
    <Card data-testid="card-other-destinations">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Route className="h-4 w-4" />
          Other destinations
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Paid traffic that did not land on a page we manage, so the totals add up to what the ad platforms spent ({formatMoney(spendTotal)}).
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground" data-testid="empty-other-destinations">
            All paid traffic landed on managed pages.
          </p>
        ) : (
          rows.map((r) => {
            const rowClass = "flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-left last:border-b-0";
            const content = <DestinationRowContent row={r} explainable={r.kind === "unknown_destination"} />;
            return r.kind === "unknown_destination" ? (
              <UnknownDestinationDialog key={r.key} row={r}>
                <button
                  type="button"
                  className={`${rowClass} hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
                  data-testid={`other-destination-${r.key}`}
                >
                  {content}
                </button>
              </UnknownDestinationDialog>
            ) : (
              <div key={r.key} className={rowClass} data-testid={`other-destination-${r.key}`}>
                {content}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
