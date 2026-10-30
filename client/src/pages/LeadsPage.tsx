import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Clock, Compass, FileText, FlaskConical, Info, LogIn, Package, Route, UserRound, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { PrivateHistoryBackButton } from "@/components/private/PrivateHistoryBackButton";
import { MetricsAccessGate } from "@/components/MetricsAccessGate";
import { AdsPullProductionButton } from "@/components/ads/AdsPullProductionButton";
import { LeadsKpiCards } from "@/components/leads/LeadsKpiCards";
import { LeadsTimelineChart } from "@/components/leads/LeadsTimelineChart";
import { LeadsBreakdownCard } from "@/components/leads/LeadsBreakdownCard";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { LeadsLocalCopyBanner } from "@/components/leads/LeadsLocalCopyBanner";
import { LeadsDeliveryBanners } from "@/components/leads/LeadsDeliveryBanners";
import { LeadDetailsDialog } from "@/components/leads/LeadDetailsDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/queryClient";
import { PAID_LOOKBACK_DAYS } from "@shared/paid-traffic";
import {
  LEAD_ID_PATTERN,
  LEADS_DELIVERY_FILTER_LABELS,
  LEADS_DELIVERY_FILTERS,
  LEADS_NONE,
  LEADS_RANGES,
  LEADS_RANGE_LABELS,
  LEADS_SHOW,
  LEADS_SHOW_LABELS,
  LEADS_TTL_LABELS,
  hasLeadsFilters,
  leadsQueryToSearchParams,
  parseLeadsQuery,
  type LeadsDeliveryFilter,
  type LeadsFilters,
  type LeadsListResponse,
  type LeadsQuery,
  type LeadsRange,
  type LeadsShow,
  type LeadsStatsResponse,
} from "@shared/leads-query";
import { isTrafficChannel, TRAFFIC_CHANNEL_LABELS } from "@shared/traffic-channel";

const PAGE_PATH = "/private/store/leads";
const DEFAULT_QUERY: LeadsQuery = { range: "30d", show: "real", page: 1, filters: {} };
const SHOW_TITLES: Record<LeadsShow, string> = {
  real: "Hide test and repeat leads",
  all: "Real, test and repeat leads together",
  test: "Only leads flagged as tests (staff sessions or test emails)",
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function none(v: string | undefined): string {
  return !v || v === LEADS_NONE ? "(none)" : v;
}

type Chip = { id: string; label: string; remove: (keyof LeadsFilters)[] };

function filterChips(
  f: LeadsFilters,
  productName?: string,
  funnelLabels?: LeadsStatsResponse["funnel_filter_labels"],
): Chip[] {
  const chips: Chip[] = [];
  if (f.product) {
    const label = f.product === LEADS_NONE ? "(none)" : productName ?? f.product;
    chips.push({ id: "product", label: `Product: ${label}`, remove: ["product"] });
  }
  if (f.funnel_product) {
    const label = funnelLabels?.funnel_product ?? none(f.funnel_product);
    chips.push({ id: "funnel_product", label: `Product on page: ${label}`, remove: ["funnel_product"] });
  }
  if (f.funnel_persona) {
    const label = funnelLabels?.funnel_persona ?? none(f.funnel_persona);
    chips.push({ id: "funnel_persona", label: `Persona: ${label}`, remove: ["funnel_persona"] });
  }
  if (f.source || f.medium) {
    const untagged = f.source === LEADS_NONE && f.medium === LEADS_NONE;
    chips.push({
      id: "source_medium",
      label: `Source / medium: ${untagged ? "Direct / untagged" : `${none(f.source)} / ${none(f.medium)}`}`,
      remove: ["source", "medium"],
    });
  }
  if (f.conversion_path) chips.push({ id: "conversion_path", label: `Converting page: ${f.conversion_path === LEADS_NONE ? "(unknown)" : f.conversion_path}`, remove: ["conversion_path"] });
  if (f.landing_path) chips.push({ id: "landing_path", label: `Landing page: ${f.landing_path === LEADS_NONE ? "(unknown)" : f.landing_path}`, remove: ["landing_path"] });
  if (f.experiment || f.variant) chips.push({ id: "experiment", label: `Experiment: ${none(f.experiment)} · ${none(f.variant)}`, remove: ["experiment", "variant"] });
  if (f.ttl) chips.push({ id: "ttl", label: `First ad click to lead: ${LEADS_TTL_LABELS[f.ttl]}`, remove: ["ttl"] });
  if (f.channel) {
    const label = isTrafficChannel(f.channel) ? TRAFFIC_CHANNEL_LABELS[f.channel] : "Not tracked yet";
    chips.push({ id: "channel", label: `Channel: ${label}`, remove: ["channel"] });
  }
  return chips;
}

export default function LeadsPage() {
  return (
    <MetricsAccessGate>
      <LeadsPageInner />
    </MetricsAccessGate>
  );
}

function LeadsPageInner() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const query = useMemo<LeadsQuery>(() => {
    const parsed = parseLeadsQuery(new URLSearchParams(search));
    return parsed.ok ? parsed.query : DEFAULT_QUERY;
  }, [search]);

  /** `?lead=<id>` (from a lead_delivery_failed alert) opens that lead's details. */
  const linkedLeadId = useMemo(() => {
    const id = new URLSearchParams(search).get("lead");
    return id && LEAD_ID_PATTERN.test(id) ? id : null;
  }, [search]);

  const navigate = (next: LeadsQuery) => {
    const qs = leadsQueryToSearchParams(next).toString();
    setLocation(qs ? `${PAGE_PATH}?${qs}` : PAGE_PATH, { replace: true });
  };
  const setDelivery = (delivery: LeadsDeliveryFilter | undefined) => navigate({ ...query, page: 1, delivery });
  const setRange = (range: LeadsRange) => navigate({ ...query, range, page: 1 });
  const setShow = (show: LeadsShow) => navigate({ ...query, show, page: 1 });
  const setPage = (page: number) => navigate({ ...query, page });
  const addFilter = (filter: LeadsFilters) => navigate({ ...query, page: 1, filters: { ...query.filters, ...filter } });
  const removeFilters = (keys: (keyof LeadsFilters)[]) => {
    const filters = { ...query.filters };
    for (const k of keys) delete filters[k];
    navigate({ ...query, page: 1, filters });
  };
  const clearFilters = () => navigate({ ...query, page: 1, filters: {}, delivery: undefined });

  const statsQs = leadsQueryToSearchParams({ ...query, page: 1 }).toString();
  const listQs = leadsQueryToSearchParams(query).toString();

  const stats = useQuery<LeadsStatsResponse>({
    queryKey: ["/api/ads/leads/stats", statsQs],
    queryFn: () => fetchJson(`/api/ads/leads/stats${statsQs ? `?${statsQs}` : ""}`),
  });
  const list = useQuery<LeadsListResponse>({
    queryKey: ["/api/ads/leads", listQs],
    queryFn: () => fetchJson(`/api/ads/leads${listQs ? `?${listQs}` : ""}`),
    placeholderData: (prev) => prev,
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/ads/leads"),
    });
  };

  const chips = filterChips(query.filters, stats.data?.product_name, stats.data?.funnel_filter_labels);
  if (query.delivery) {
    chips.push({ id: "delivery", label: `Delivery: ${LEADS_DELIVERY_FILTER_LABELS[query.delivery]}`, remove: [] });
  }
  const productSince = stats.data?.product_since ?? null;
  const funnelSince = stats.data?.funnel_since ?? null;
  const funnelSinceText =
    funnelSince != null
      ? new Date(funnelSince).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      : null;
  const filtersActive = hasLeadsFilters(query.filters) || !!query.delivery;
  const b = stats.data?.breakdowns;
  const ttl = b?.time_to_lead;
  const statsLoading = stats.isLoading;
  const error = (stats.error ?? list.error) as Error | null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 pt-8 pb-24 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <PrivateHistoryBackButton data-testid="button-leads-back" iconClassName="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-muted-foreground" />
                <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-leads-title">
                  Leads
                </h1>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      aria-label="Read more (advanced)"
                      data-testid="button-leads-advanced-info"
                    >
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-96 space-y-2 text-xs text-muted-foreground leading-relaxed">
                    <p className="font-medium text-foreground text-sm">Read more (advanced)</p>
                    <p>
                      <span className="text-foreground">Real leads</span> leaves out test and repeat leads; <span className="text-foreground">All</span>{" "}
                      adds them back; <span className="text-foreground">Test only</span> shows just the tests. A lead is a test when it was
                      sent from a staff session or matches a test email pattern (Settings → Ads), decided when it is submitted (
                      <code>is_test</code>, <code>test_reason</code>). A repeat is the same browser sending the same form again within 24
                      hours.
                    </p>
                    <p>
                      <span className="text-foreground">Paid</span> means the visit came from an ad platform (click ID or paid UTMs). A
                      Facebook click id alone (<code>fbclid</code>, no paid medium or Meta id) is{" "}
                      <span className="text-foreground">Meta, unclear</span>, not paid.{" "}
                      <span className="text-foreground">Tagged</span> means the lead has any UTM source, medium or campaign.
                    </p>
                    <p>
                      <span className="text-foreground">Days are UTC</span> so counts match the Ads overview. Each row in the table shows
                      your local time.
                    </p>
                    <p>
                      <span className="text-foreground">Sources</span> are grouped ignoring capitalization. &quot;Off-convention&quot; follows
                      the site&apos;s UTM convention (<code>utm_convention</code> in <code>ads-config.yml</code>): known wrong spellings are
                      flagged, not merged.
                    </p>
                    <p>
                      <span className="text-foreground">Time to lead</span> uses the first time the visitor landed from an ad.
                    </p>
                    <p>
                      <span className="text-foreground">Channel</span> is recorded in the visitor session: link tags (UTMs, click ids) first,
                      then the site the visitor came from (<code>document.referrer</code>). Links from this site never change it, and a
                      direct visit never replaces an earlier channel (last non-direct). An ad click in the {PAID_LOOKBACK_DAYS} days
                      before the lead keeps it paid; the latest non-paid channel is kept in <code>last_organic_channel</code>. Columns:{" "}
                      <code>channel</code>, <code>first_channel</code>, <code>channel_landing_path</code> (the page that visit landed
                      on), <code>referrer_host</code>, <code>country</code>, <code>traffic_status</code>. UTMs on the lead are never
                      rewritten.
                    </p>
                    <p>
                      <span className="text-foreground">Product</span> is the catalog product the lead form resolved, with the same logic
                      that sends <code>item_id</code> to analytics (paused products included). It is checked against the site&apos;s
                      product catalog and never sent to the CRM. Columns: <code>product_id</code>, <code>product_slug</code>; the
                      filter matches either. A product&apos;s &quot;Lead conversions&quot; card counts analytics events (test and repeat
                      included, last 28 days), so it will not match this page exactly.
                    </p>
                    <p>
                      <span className="text-foreground">Delivery</span> says whether the lead reached the CRM webhook. Each lead is saved
                      encrypted (<code>LEAD_OUTBOX_ENCRYPTION_KEY</code>) before the CRM is called. Outages (timeouts, 5xx, 429) retry
                      automatically on the live server after 1 min, 5 min, 30 min, 2 h and 12 h; CRM rejections and missing webhooks go
                      straight to Needs attention. Retry all failed sends at most 5 leads per site every 30 seconds. Test leads never raise
                      the <code>lead_delivery_failed</code> alert. The saved copy is erased after delivery or 30 days. Tables:{" "}
                      <code>lead_outbox</code>, <code>lead_delivery_attempts</code>.
                    </p>
                    <p>
                      Data lives in the pipeline SQLite table <code>lead_submissions</code> (<code>server/ads/lead-ledger.ts</code>). Cost per
                      lead lives in the Ads overview.
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Every lead form submission on this site, newest first.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <ToggleButtonBar value={query.show} onValueChange={(v) => setShow(v as LeadsShow)} listTestId="toggle-leads-show">
              {LEADS_SHOW.map((s) => (
                <ToggleButtonBarTrigger key={s} value={s} title={SHOW_TITLES[s]} data-testid={`toggle-leads-show-${s}`}>
                  {LEADS_SHOW_LABELS[s]}
                </ToggleButtonBarTrigger>
              ))}
            </ToggleButtonBar>
            <ToggleButtonBar value={query.range} onValueChange={(v) => setRange(v as LeadsRange)} listTestId="toggle-leads-range">
              {LEADS_RANGES.map((r) => (
                <ToggleButtonBarTrigger key={r} value={r} data-testid={`toggle-leads-range-${r}`}>
                  {LEADS_RANGE_LABELS[r]}
                </ToggleButtonBarTrigger>
              ))}
            </ToggleButtonBar>
            <Select
              value={query.delivery ?? "any"}
              onValueChange={(v) => setDelivery(v === "any" ? undefined : (v as LeadsDeliveryFilter))}
            >
              <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="Delivery" data-testid="select-leads-delivery">
                <SelectValue placeholder="Delivery" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any" className="text-xs">
                  Any delivery status
                </SelectItem>
                {LEADS_DELIVERY_FILTERS.map((d) => (
                  <SelectItem key={d} value={d} className="text-xs" data-testid={`select-leads-delivery-${d}`}>
                    {LEADS_DELIVERY_FILTER_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AdsPullProductionButton variant="icon" testIdPrefix="leads-header" onDone={refreshAll} />
          </div>
        </div>

        <LeadsLocalCopyBanner localCopy={stats.data?.local_copy} />

        <LeadsDeliveryBanners
          delivery={stats.data?.delivery}
          viewQs={statsQs}
          onChanged={refreshAll}
          onShowFailed={() => setDelivery("failed")}
        />

        <LeadDetailsDialog leadId={linkedLeadId} onClose={() => navigate(query)} />

        {error && (
          <p className="text-sm text-destructive" data-testid="text-leads-error">
            Could not load leads: {error.message}
          </p>
        )}

        {query.show === "test" && stats.data && (
          <p className="text-xs text-muted-foreground" data-testid="text-leads-test-reasons">
            {stats.data.kpis.in_range > 0
              ? `Test leads in this range: ${stats.data.kpis.test_staff.toLocaleString()} from staff sessions, ${stats.data.kpis.test_email.toLocaleString()} from test email patterns (Settings → Ads). Real leads are hidden.`
              : "No test leads in this range. A lead counts as a test when it is sent while logged in as staff or from an email that matches a test pattern (Settings → Ads)."}
          </p>
        )}

        <LeadsKpiCards stats={stats.data} loading={statsLoading} />

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-testid="leads-filter-chips">
            {chips.map((c) => (
              <Badge key={c.id} variant="secondary" className="gap-1 pr-1 font-normal max-w-full">
                <span className="truncate">{c.label}</span>
                <button
                  type="button"
                  className="rounded-sm p-0.5 hover:bg-muted"
                  aria-label={`Remove filter ${c.label}`}
                  onClick={() => (c.id === "delivery" ? setDelivery(undefined) : removeFilters(c.remove))}
                  data-testid={`button-leads-remove-filter-${c.id}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearFilters} data-testid="button-leads-clear-filters">
              Clear filters
            </Button>
          </div>
        )}

        {query.filters.product && query.filters.product !== LEADS_NONE && stats.data && (
          <p className="text-xs text-muted-foreground" data-testid="text-leads-product-since">
            {productSince != null
              ? `Product is recorded on leads from ${new Date(productSince).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}; earlier leads don't appear in this filter.`
              : "No lead has a product yet; new leads will appear here."}
          </p>
        )}

        <LeadsTimelineChart stats={stats.data} loading={statsLoading} />

        <div className="grid gap-4 md:grid-cols-2">
          <LeadsBreakdownCard
            title="Source / medium"
            icon={Route}
            description="Click a row to filter the leads below."
            rows={b?.source_medium}
            loading={statsLoading}
            emptyText="No leads in this view."
            testId="card-leads-source-medium"
            onSelect={addFilter}
          />
          <LeadsBreakdownCard
            title="Channel"
            icon={Compass}
            description="Source / medium shows the tags on the link. Channel uses those tags first and, for untagged visits, the site the visitor came from."
            rows={b?.channels}
            loading={statsLoading}
            emptyText="No leads in this view."
            testId="card-leads-channels"
            onSelect={addFilter}
          />
          <LeadsBreakdownCard
            title="First ad click to lead"
            icon={Clock}
            description={
              ttl
                ? ttl.paid_with_click > 0
                  ? `Leads that clicked an ad first (${ttl.paid_with_click.toLocaleString()}). Median: ${ttl.median_days} days.`
                  : "Leads that clicked an ad first."
                : undefined
            }
            rows={ttl?.buckets}
            loading={statsLoading}
            emptyText="No leads in this view came from an ad click."
            testId="card-leads-time-to-lead"
            onSelect={addFilter}
          />
          <LeadsBreakdownCard
            title="Converting pages"
            icon={FileText}
            description="The page where the form was sent."
            rows={b?.conversion_paths}
            loading={statsLoading}
            mono
            emptyText="No leads in this view."
            testId="card-leads-conversion-pages"
            onSelect={addFilter}
          />
          <LeadsBreakdownCard
            title="Landing pages"
            icon={LogIn}
            description="The first page of the visit that ended in a lead."
            rows={b?.landing_paths}
            loading={statsLoading}
            mono
            emptyText="No leads in this view."
            testId="card-leads-landing-pages"
            onSelect={addFilter}
          />
          <LeadsBreakdownCard
            title="Product on page"
            icon={Package}
            description={`Products on the page where the form was sent. A lead from a page with two products counts for both, so shares can add up to more than 100%.${
              funnelSinceText ? ` Recorded from ${funnelSinceText}.` : " Not recorded on any lead yet."
            }`}
            rows={b?.funnel_products}
            loading={statsLoading}
            emptyText="No leads in this view."
            testId="card-leads-funnel-products"
            onSelect={addFilter}
          />
          <LeadsBreakdownCard
            title="Persona"
            icon={UserRound}
            description={`Personas on that page, with their product. A lead counts once per persona.${
              stats.data && stats.data.funnel_persona_product_unknown > 0
                ? " Some older leads show \"product unknown\": two products share that persona and those leads didn't record which one."
                : ""
            }`}
            rows={b?.funnel_personas}
            loading={statsLoading}
            emptyText="No leads in this view."
            testId="card-leads-funnel-personas"
            onSelect={addFilter}
          />
          {b && b.experiments.length > 0 && (
            <LeadsBreakdownCard
              title="Page experiments"
              icon={FlaskConical}
              description="Leads per A/B variant. Percentages are within the experiment's leads."
              rows={b.experiments}
              loading={statsLoading}
              emptyText="No experiment leads in this view."
              testId="card-leads-experiments"
              onSelect={addFilter}
            />
          )}
        </div>

        <LeadsTable
          data={list.data}
          loading={list.isLoading}
          show={query.show}
          hasFilters={filtersActive}
          onClearFilters={clearFilters}
          onPage={setPage}
          onDownloaded={refreshAll}
        />
      </div>
    </div>
  );
}
