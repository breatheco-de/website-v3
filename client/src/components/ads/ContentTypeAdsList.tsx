import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowDown, ArrowUp, ExternalLink, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import { apiFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { AttributionModel } from "@shared/paid-attribution";
import { isRefreshActive } from "@shared/ads-refresh-status";
import type { AdsEntriesResponse, AdsPageRow } from "./ads-types";
import { AdsRefreshNotice } from "./AdsRefreshNotice";
import { LowSampleBadge } from "./LowSampleBadge";
import { UrlChangedBadge } from "./UrlChangedBadge";
import { formatMoney, formatNum, formatPct, formatWhen, moneyTotal, PLATFORM_LABELS } from "./ads-format";

type SortField = "paid_visits" | "spend" | "unique_leads" | "conversion_rate" | "cost_per_lead" | "bounce_rate";

const COLUMNS: { id: SortField; label: string; title: string }[] = [
  { id: "paid_visits", label: "Paid visits", title: "Visits from ads that landed on this entry" },
  { id: "spend", label: "Spend", title: "Ad spend for ads pointing here, per currency" },
  { id: "unique_leads", label: "Leads", title: "Unique leads credited to this entry (repeats shown separately)" },
  { id: "conversion_rate", label: "Conv. rate", title: "Unique leads ÷ paid visits" },
  { id: "cost_per_lead", label: "CPL", title: "Spend ÷ unique leads" },
  { id: "bounce_rate", label: "Paid bounce", title: "Share of paid visits that did not engage" },
];

function sortValue(row: AdsPageRow, field: SortField): number | null {
  switch (field) {
    case "spend":
      return moneyTotal(row.spend);
    case "cost_per_lead":
      return row.unique_leads > 0 ? moneyTotal(row.cost_per_lead) : null;
    case "conversion_rate":
    case "bounce_rate":
      return row.low_sample ? null : row[field];
    default:
      return row[field];
  }
}

export function ContentTypeAdsList({ contentType, locale, q }: { contentType: string; locale: string; q: string }) {
  const [days, setDays] = useState(28);
  const [platform, setPlatform] = useState("all");
  const [model, setModel] = useState<AttributionModel>("last_paid");
  const [sort, setSort] = useState<{ field: SortField; dir: "asc" | "desc" }>({ field: "spend", dir: "desc" });

  const qs = new URLSearchParams({ days: String(days), platform, model, ...(locale ? { locale } : {}), ...(q ? { q } : {}) }).toString();
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/content-types", contentType, "ads-entries", qs],
    queryFn: async () => {
      const res = await apiFetch(`/api/content-types/${encodeURIComponent(contentType)}/ads-entries?${qs}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load Ads entries");
      return res.json() as Promise<AdsEntriesResponse>;
    },
    refetchInterval: (query) => (isRefreshActive((query.state.data as AdsEntriesResponse | undefined)?.refresh) ? 8000 : false),
  });

  const rows = useMemo(() => {
    const list = [...(data?.entries ?? [])];
    const dir = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const av = sortValue(a, sort.field);
      const bv = sortValue(b, sort.field);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  }, [data, sort]);

  const toggleSort = (field: SortField) =>
    setSort((s) => (s.field === field ? { field, dir: s.dir === "desc" ? "asc" : "desc" } : { field, dir: field === "cost_per_lead" || field === "bounce_rate" ? "asc" : "desc" }));

  return (
    <div className="space-y-3" data-testid="ads-perspective">
      <div className="px-4 pt-2 space-y-2">
        <p className="text-xs text-muted-foreground max-w-3xl" data-testid="text-ads-perspective-edu">
          Entries of this type that received paid visits, with spend and leads. A lead counts for the entry the ad sent the visitor to; repeat
          submissions are shown but not counted twice. Rates grey out when there are too few paid visits to trust them.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleButtonBar value={String(days)} onValueChange={(v) => setDays(Number(v))} listTestId="ads-list-window" listClassName="flex">
            {[7, 28, 90].map((d) => (
              <ToggleButtonBarTrigger key={d} value={String(d)}>
                {d}d
              </ToggleButtonBarTrigger>
            ))}
          </ToggleButtonBar>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="h-8 w-[140px]" data-testid="select-ads-list-platform">
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
          <Select value={model} onValueChange={(v) => setModel(v as AttributionModel)}>
            <SelectTrigger className="h-8 w-[170px]" data-testid="select-ads-list-credit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="last_paid">Credit: last paid page</SelectItem>
              <SelectItem value="first_paid">Credit: first paid page</SelectItem>
            </SelectContent>
          </Select>
          {data && (
            <span className="text-[11px] text-muted-foreground" data-testid="text-ads-list-synced">
              Last synced {formatWhen(data.meta.last_synced_at)}
            </span>
          )}
          <Link href="/private/diagnostics/ads" className="ml-auto text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground" data-testid="link-ads-diagnostics">
            All paid pages
          </Link>
        </div>
        {isRefreshActive(data?.refresh) && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs" data-testid="banner-ads-refreshing">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Refreshing ad data in the background. Numbers update automatically when it finishes.
          </div>
        )}
        <AdsRefreshNotice refresh={data?.refresh} testId="banner-ads-refresh-failed" />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground" data-testid="loading-ads-entries">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading paid traffic…
        </div>
      ) : error ? (
        <p className="px-4 py-6 text-sm text-destructive">{error instanceof Error ? error.message : "Failed to load"}</p>
      ) : !data ? null : !data.ga4.configured ? (
        <p className="px-4 py-6 text-sm text-muted-foreground" data-testid="empty-ads-no-ga4">
          The GA4 BigQuery export is not set up, so paid visits cannot be measured yet.
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground" data-testid="empty-ads-entries">
          {data.meta.connected
            ? "No paid visits landed on this content type in this window."
            : "No paid visits found. Connect Meta in Settings → Ads to add spend and ad leads."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-ads-entries">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Entry</th>
                {COLUMNS.map((c) => (
                  <th key={c.id} className="px-3 py-2 text-right font-medium" title={c.title}>
                    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(c.id)} data-testid={`sort-ads-${c.id}`}>
                      {c.label}
                      {sort.field === c.id && (sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-b-0" data-testid={`row-ads-${r.key}`}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {r.locale && <LocaleFlag locale={r.locale} className="h-3 w-4 rounded-sm shrink-0" />}
                      <span className="truncate text-foreground">{r.title}</span>
                      {r.low_sample && <LowSampleBadge testId={`chip-low-sample-${r.key}`} />}
                      <UrlChangedBadge row={r} />
                      <a href={r.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Open page">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{r.path}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNum(r.paid_visits)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.spend)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatNum(r.unique_leads)}
                    {r.submissions > r.unique_leads && (
                      <span className="block text-[10px] text-muted-foreground">{r.submissions} submissions</span>
                    )}
                  </td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", r.low_sample && "text-muted-foreground/60")}>{formatPct(r.conversion_rate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.unique_leads > 0 ? formatMoney(r.cost_per_lead) : "—"}</td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", r.low_sample && "text-muted-foreground/60")}>{formatPct(r.bounce_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
