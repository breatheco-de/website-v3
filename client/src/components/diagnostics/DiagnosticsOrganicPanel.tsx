import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ChevronDown,
  Info,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDebugAuth } from "@/hooks/useDebugAuth";

type AggRow = {
  query: string;
  url: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
};

type OrganicOpportunities = {
  bq_configured: boolean;
  openrush_configured: boolean;
  keep_rules_stale: boolean;
  keep_rules_version: number;
  days_present: number;
  days_expected: number;
  data_through: string | null;
  latest_ingested: boolean;
  serp_incomplete: boolean;
  windows: {
    d7: { start: string; end: string } | null;
    d28: { start: string; end: string } | null;
    decay_current: { start: string; end: string } | null;
    decay_prior: { start: string; end: string } | null;
  };
  cards: {
    page2: AggRow[];
    low_ctr: Array<AggRow & { expected_ctr: number; gap: number }>;
    link_gaps: Array<AggRow & { inbound: number }>;
    decay: Array<{
      url: string;
      clicks: number;
      impressions: number;
      prior_clicks: number;
      prior_impressions: number;
      click_drop: number;
    }>;
    cannibalization: Array<{
      query: string;
      impressions: number;
      urls: Array<{ url: string; clicks: number; impressions: number; position: number }>;
    }>;
    missing_serp: Array<
      AggRow & {
        our_serp_rank: number | null;
        visible_in_serp: boolean | null;
        featured_snippet_url: string | null;
        has_paa: boolean;
        serp_fetched: boolean;
        serp_stale: boolean;
        alt_urls: string[];
      }
    >;
  };
};

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}

function fmtPos(n: number): string {
  return n.toFixed(1);
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || url;
  } catch {
    return url;
  }
}

function windowLabel(w: { start: string; end: string } | null | undefined, days: number): string {
  if (!w) return `${days} complete days`;
  return `${days}d · ${w.start} → ${w.end}`;
}

export function DiagnosticsOrganicPanel() {
  const { toast } = useToast();
  const { hasCapability } = useDebugAuth();
  const canEdit = hasCapability("seo_settings");
  const queryClient = useQueryClient();
  const [decayWindow, setDecayWindow] = useState<"7" | "28">("7");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [backfill, setBackfill] = useState<{
    running: boolean;
    mode: "missing" | "rebuild_60";
    current: number;
    total: number;
    date?: string;
  } | null>(null);

  const { data, isLoading, error, refetch } = useQuery<OrganicOpportunities>({
    queryKey: ["/api/seo/organic/opportunities", decayWindow],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/seo/organic/opportunities?decay_window=${decayWindow}&pull_latest=1`,
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  async function runBackfill(mode: "missing" | "rebuild_60") {
    if (!canEdit) return;
    setBackfill({ running: true, mode, current: 0, total: 60 });
    let since: string | undefined = mode === "rebuild_60" ? new Date().toISOString() : undefined;
    try {
      for (;;) {
        const res = await apiFetch("/api/seo/organic/days/backfill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, since }),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          error?: string;
          remaining?: number;
          days_present?: number;
          days_expected?: number;
          date?: string;
          since?: string;
        };
        if (body.since) since = body.since;
        const total = body.days_expected || 60;
        const remaining = body.remaining ?? 0;
        setBackfill({
          running: true,
          mode,
          current: total - remaining,
          total,
          date: body.date,
        });
        if (!body.ok) {
          throw new Error(body.error || "Backfill failed");
        }
        if (remaining <= 0) break;
      }
      toast({
        title: mode === "rebuild_60" ? "Rebuilt Search Console days" : "Loaded Search Console days",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/seo/organic/opportunities"] });
    } catch (err) {
      toast({
        title: "Could not load days",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBackfill(null);
    }
  }

  const serpRefresh = useMutation({
    mutationFn: async (payload: { query: string } | { mode: "stale" }) => {
      const res = await apiRequest("POST", "/api/seo/organic/serp/refresh", payload);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Refresh failed");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/seo/organic/opportunities"] });
    },
    onError: (err: Error) => {
      toast({ title: "SERP refresh failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading organic opportunities…
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-sm text-muted-foreground text-center py-12">
        Failed to load organic opportunities
      </p>
    );
  }

  if (!data.bq_configured) {
    return (
      <Card data-testid="organic-bq-empty">
        <CardHeader>
          <CardTitle className="text-base">Connect Search Console BigQuery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Organic opportunities need the Search Console bulk export in BigQuery. That is a
            one-time setup — it does not change URL Inspection.
          </p>
          <Button asChild data-testid="link-organic-search-console-settings">
            <Link href="/private/settings/seo/search-console">Open Search Console settings</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const needsLoad = data.days_present === 0;
  const progressValue = backfill ? (backfill.current / Math.max(1, backfill.total)) * 100 : 0;

  return (
    <div className="space-y-4" data-testid="diagnostics-organic-panel">
      <p className="text-sm text-muted-foreground">
        Actions from Google Search performance, not total visits. Most cards use the last 7
        complete days; cannibalization uses 28 days; decay compares 7 or 28 days to the period
        before. Data lags about 2–3 days — use Search Console for yesterday and live queries.
      </p>
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="px-0 h-auto text-xs" data-testid="button-organic-read-more">
            Read more (advanced)
            <ChevronDown className={`h-3.5 w-3.5 ml-1 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="text-xs font-mono text-muted-foreground space-y-1">
          <p>.cache/{"{site}"}/gsc-organic-days/YYYY-MM-DD.json</p>
          <p>keep_rules_version {data.keep_rules_version}</p>
          <p>GET /api/seo/organic/opportunities</p>
          <p>POST /api/seo/organic/days/backfill</p>
          <p>Refreshing days updates the shared cache used elsewhere. It does not write content YAML or start a GSC export.</p>
        </CollapsibleContent>
      </Collapsible>

      <Alert data-testid="alert-organic-lag">
        <Info className="h-4 w-4" />
        <AlertTitle>Search Console data lags</AlertTitle>
        <AlertDescription>
          BigQuery is typically 2–3 days behind. Yesterday and live queries belong in Search Console,
          not here.
          {data.data_through ? ` Latest complete day on disk: ${data.data_through}.` : ""}
          {data.latest_ingested ? " Just pulled the latest complete day." : ""}
        </AlertDescription>
      </Alert>

      {data.keep_rules_stale && (
        <Alert data-testid="alert-keep-rules-stale">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Keep-rules changed</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Older day files used a previous keep-filter. Cards still run on those days until you
              rebuild the last 60 days.
            </span>
            {canEdit && (
              <Button
                size="sm"
                variant="secondary"
                disabled={Boolean(backfill?.running)}
                onClick={() => runBackfill("rebuild_60")}
                data-testid="button-rebuild-60-days"
              >
                Rebuild 60 days
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {data.openrush_configured && data.serp_incomplete && (
        <Alert data-testid="alert-serp-incomplete">
          <Info className="h-4 w-4" />
          <AlertTitle>SERP snapshots may be missing</AlertTitle>
          <AlertDescription>
            Loading Search Console days does not call OpenRush. Refresh individual queries (credits
            per inspect) when you need live SERP features.
          </AlertDescription>
        </Alert>
      )}

      {needsLoad && (
        <Card data-testid="organic-load-days">
          <CardHeader>
            <CardTitle className="text-base">Load Search Console days</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              First visit: pull the last 60 complete days into the local cache. This page will stay
              usable while days load.
            </p>
            {backfill?.running && (
              <div className="space-y-2">
                <Progress value={progressValue} data-testid="progress-organic-backfill" />
                <p className="text-xs text-muted-foreground" data-testid="text-organic-backfill-progress">
                  {backfill.current} / {backfill.total}
                  {backfill.date ? ` · ${backfill.date}` : ""}
                </p>
              </div>
            )}
            {canEdit ? (
              <Button
                onClick={() => runBackfill("missing")}
                disabled={Boolean(backfill?.running)}
                data-testid="button-load-gsc-days"
              >
                {backfill?.running ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading days…
                  </>
                ) : (
                  "Load Search Console days"
                )}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">You need SEO settings access to load days.</p>
            )}
          </CardContent>
        </Card>
      )}

      {!needsLoad && backfill?.running && (
        <div className="space-y-2">
          <Progress value={progressValue} />
          <p className="text-xs text-muted-foreground">
            {backfill.current} / {backfill.total}
            {backfill.date ? ` · ${backfill.date}` : ""}
          </p>
        </div>
      )}

      {!needsLoad && (
        <div className="grid gap-4 lg:grid-cols-2">
          <OpportunityCard
            title="Page 2 (positions 11–20)"
            windowLabel={windowLabel(data.windows.d7, 7)}
            testId="card-organic-page2"
            empty="No page-2 query × URL pairs in this window."
          >
            {data.cards.page2.length > 0 && (
              <SimpleTable
                headers={["Query", "URL", "Impr.", "Pos."]}
                rows={data.cards.page2.map((r) => [
                  r.query,
                  shortUrl(r.url),
                  fmtInt(r.impressions),
                  fmtPos(r.position),
                ])}
              />
            )}
          </OpportunityCard>

          <OpportunityCard
            title="High impressions, low CTR"
            windowLabel={windowLabel(data.windows.d7, 7)}
            testId="card-organic-low-ctr"
            empty="No CTR gaps vs the expected curve."
          >
            {data.cards.low_ctr.length > 0 && (
              <SimpleTable
                headers={["Query", "URL", "Impr.", "CTR", "Expected"]}
                rows={data.cards.low_ctr.map((r) => [
                  r.query,
                  shortUrl(r.url),
                  fmtInt(r.impressions),
                  fmtPct(r.ctr),
                  fmtPct(r.expected_ctr),
                ])}
              />
            )}
          </OpportunityCard>

          <SerpCard
            configured={data.openrush_configured}
            rows={data.cards.missing_serp}
            windowLabel={windowLabel(data.windows.d7, 7)}
            canEdit={canEdit}
            refreshing={serpRefresh.isPending}
            onRefreshQuery={(query) => serpRefresh.mutate({ query })}
            onRefreshStale={() => serpRefresh.mutate({ mode: "stale" })}
          />

          <OpportunityCard
            title="Internal linking gaps"
            windowLabel={windowLabel(data.windows.d7, 7)}
            testId="card-organic-link-gaps"
            empty="No ranking URLs with fewer than 3 internal links."
          >
            {data.cards.link_gaps.length > 0 && (
              <SimpleTable
                headers={["URL", "Pos.", "Impr.", "Inbound"]}
                rows={data.cards.link_gaps.map((r) => [
                  shortUrl(r.url),
                  fmtPos(r.position),
                  fmtInt(r.impressions),
                  String(r.inbound),
                ])}
              />
            )}
          </OpportunityCard>

          <Card data-testid="card-organic-decay">
            <CardHeader className="pb-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold">Content decay</CardTitle>
                <Select
                  value={decayWindow}
                  onValueChange={(v) => setDecayWindow(v === "28" ? "28" : "7")}
                >
                  <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="select-decay-window">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days vs prior</SelectItem>
                    <SelectItem value="28">28 days vs prior</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                {windowLabel(data.windows.decay_current, Number(decayWindow))} vs{" "}
                {data.windows.decay_prior
                  ? `${data.windows.decay_prior.start} → ${data.windows.decay_prior.end}`
                  : "prior window"}
                . Only URLs in both windows.
              </p>
            </CardHeader>
            <CardContent>
              {data.cards.decay.length === 0 ? (
                <p className="text-sm text-muted-foreground">No decaying URLs in both windows.</p>
              ) : (
                <SimpleTable
                  headers={["URL", "Clicks", "Prior", "Drop"]}
                  rows={data.cards.decay.map((r) => [
                    shortUrl(r.url),
                    fmtInt(r.clicks),
                    fmtInt(r.prior_clicks),
                    fmtInt(r.click_drop),
                  ])}
                />
              )}
            </CardContent>
          </Card>

          <OpportunityCard
            title="Cannibalization"
            windowLabel={windowLabel(data.windows.d28, 28)}
            testId="card-organic-cannibalization"
            empty="No queries with two or more ranking URLs in 28 days."
          >
            {data.cards.cannibalization.length > 0 && (
              <div className="space-y-3">
                {data.cards.cannibalization.map((g) => (
                  <div key={g.query} className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {g.query}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {fmtInt(g.impressions)} impr.
                      </span>
                    </p>
                    <SimpleTable
                      headers={["URL", "Impr.", "Pos."]}
                      rows={g.urls.map((u) => [shortUrl(u.url), fmtInt(u.impressions), fmtPos(u.position)])}
                    />
                  </div>
                ))}
              </div>
            )}
          </OpportunityCard>
        </div>
      )}

      {!needsLoad && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-organic-refresh">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>
      )}
    </div>
  );
}

function OpportunityCard({
  title,
  windowLabel: wLabel,
  testId,
  empty,
  children,
}: {
  title: string;
  windowLabel: string;
  testId: string;
  empty: string;
  children?: ReactNode;
}) {
  const hasBody = Boolean(children);
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-3 space-y-1">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{wLabel}</p>
      </CardHeader>
      <CardContent>
        {hasBody ? children : <p className="text-sm text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {headers.map((h) => (
            <TableHead key={h} className="h-8 px-2 text-xs">
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i}>
            {row.map((cell, j) => (
              <TableCell key={j} className="px-2 py-1.5 text-xs max-w-[220px] truncate" title={cell}>
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SerpCard({
  configured,
  rows,
  windowLabel: wLabel,
  canEdit,
  refreshing,
  onRefreshQuery,
  onRefreshStale,
}: {
  configured: boolean;
  rows: OrganicOpportunities["cards"]["missing_serp"];
  windowLabel: string;
  canEdit: boolean;
  refreshing: boolean;
  onRefreshQuery: (query: string) => void;
  onRefreshStale: () => void;
}) {
  if (!configured) {
    return (
      <Card data-testid="card-organic-missing-serp">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Missing SERP features</CardTitle>
          <p className="text-xs text-muted-foreground">{wLabel}</p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Activate OpenRush to see featured snippets and People Also Ask we do not own. This uses
            API credits and does not start a Search Console export.
          </p>
          <Button asChild variant="secondary" size="sm" data-testid="link-openrush-settings">
            <Link href="/private/settings/seo/openrush">Activate OpenRush</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-organic-missing-serp">
      <CardHeader className="pb-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">Missing SERP features</CardTitle>
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              disabled={refreshing}
              onClick={onRefreshStale}
              data-testid="button-serp-refresh-stale"
            >
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Refresh stale"}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{wLabel} · page 1 queries</p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No missing-feature opportunities in this window.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 px-2 text-xs">Query</TableHead>
                <TableHead className="h-8 px-2 text-xs">URL</TableHead>
                <TableHead className="h-8 px-2 text-xs">In SERP</TableHead>
                <TableHead className="h-8 px-2 text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.query}-${r.url}`}>
                  <TableCell className="px-2 py-1.5 text-xs max-w-[180px] truncate" title={r.query}>
                    {r.query}
                    {r.alt_urls.length > 0 && (
                      <span className="block text-[10px] text-muted-foreground">
                        Also ranks: {r.alt_urls.length} more URL{r.alt_urls.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="px-2 py-1.5 text-xs max-w-[160px] truncate" title={r.url}>
                    {shortUrl(r.url)}
                  </TableCell>
                  <TableCell className="px-2 py-1.5">
                    {r.visible_in_serp === false ? (
                      <Badge variant="destructive" className="text-[10px]">
                        not in live SERP
                      </Badge>
                    ) : r.serp_fetched ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {r.featured_snippet_url ? "snippet" : r.has_paa ? "PAA" : "fetched"}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        no snapshot
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="px-2 py-1.5 text-right">
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={refreshing}
                        onClick={() => onRefreshQuery(r.query)}
                        data-testid={`button-serp-refresh-${r.query}`}
                      >
                        Refresh
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
