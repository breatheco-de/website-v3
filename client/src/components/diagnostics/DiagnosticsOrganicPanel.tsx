import { useCallback, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  Bot,
  Copy,
  ExternalLink,
  Info,
  Link as LinkIcon,
  Loader2,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useContentTypes } from "@/hooks/useContentTypes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { McpRequiredForAiModal } from "@/components/mcp/McpRequiredForAiModal";
import type { McpSetupTabId } from "@/components/mcp/mcpUrlHelpers";
import {
  SolveWithAiAgentDropdown,
  type SolveWithAiAgentSelectPayload,
} from "@/components/DebugBubble/SolveWithAiAgentDropdown";
import type { SolveWithAiAgentId } from "@/components/DebugBubble/solveWithAiPrompt";
import { detectContentInfo } from "@/components/DebugBubble/utils/debugHelpers";
import {
  ManagedSeoModal,
  type ManagedSeoModalTarget,
} from "@/components/editing/ManagedSeoModal";
import {
  SeoContextPickerDialog,
  resolveSeoContexts,
  type SeoContextChoice,
} from "@/components/editing/SeoContextPickerDialog";
import {
  buildOrganicAskAgentPrompt,
  formatOrganicSerpStatus,
} from "@/lib/organicAskAgentPrompt";
import { localeFromPath } from "@shared/runtime-issues";

type AggRow = {
  query: string;
  url: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
  cms_known?: boolean;
  entry_key?: string | null;
  write_count?: number;
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
        cms_known?: boolean;
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
  const contentTypesMap = useContentTypes();
  const queryClient = useQueryClient();
  const [decayWindow, setDecayWindow] = useState<"7" | "28">("7");
  const [backfill, setBackfill] = useState<{
    running: boolean;
    mode: "missing" | "rebuild_60";
    current: number;
    total: number;
    date?: string;
  } | null>(null);
  const [mcpRequiredForAiOpen, setMcpRequiredForAiOpen] = useState(false);
  const [mcpRequiredSetupTab, setMcpRequiredSetupTab] = useState<McpSetupTabId>("cursor");
  const [mcpRequiredAgentId, setMcpRequiredAgentId] = useState<SolveWithAiAgentId>("copy-prompt");
  const [mcpRequiredAgentLabel, setMcpRequiredAgentLabel] = useState("AI Agent");
  const [mcpRequiredPrompt, setMcpRequiredPrompt] = useState("");
  const [mcpRequiredPrefillPrefix, setMcpRequiredPrefillPrefix] = useState<string | undefined>();
  const [seoModalOpen, setSeoModalOpen] = useState(false);
  const [seoModalTarget, setSeoModalTarget] = useState<ManagedSeoModalTarget | null>(null);
  const [seoPickerOpen, setSeoPickerOpen] = useState(false);
  const [seoPickerPending, setSeoPickerPending] = useState<{
    contentType: string;
    slug: string;
    locale: string;
  } | null>(null);

  function openAskAgent(payload: SolveWithAiAgentSelectPayload) {
    setMcpRequiredAgentId(payload.agentId);
    setMcpRequiredSetupTab(payload.setupTab);
    setMcpRequiredAgentLabel(payload.label);
    setMcpRequiredPrompt(payload.prompt);
    setMcpRequiredPrefillPrefix(payload.prefillUrlPrefix);
    setMcpRequiredForAiOpen(true);
  }

  const openSeoMetaForUrl = useCallback(
    async (url: string) => {
      const path = shortUrl(url);
      const info = detectContentInfo(path, contentTypesMap);
      if (!info.type || !info.slug) {
        toast({
          title: "Cannot open SEO Meta",
          description: "This URL is not recognized as a CMS page.",
          variant: "destructive",
        });
        return;
      }
      const locale = localeFromPath(path);
      try {
        const contexts = await resolveSeoContexts(info.type, info.slug, locale);
        if (contexts.contexts.length <= 1) {
          const choice: SeoContextChoice =
            contexts.default ?? contexts.contexts[0] ?? { type: "live" };
          setSeoModalTarget({
            contentType: info.type,
            slug: info.slug,
            locale,
            variant: choice.type === "variant" ? choice.variant : undefined,
          });
          setSeoModalOpen(true);
          return;
        }
        setSeoPickerPending({ contentType: info.type, slug: info.slug, locale });
        setSeoPickerOpen(true);
      } catch (e) {
        toast({
          title: "Failed to load SEO contexts",
          description: e instanceof Error ? e.message : "Could not list LIVE/variant contexts.",
          variant: "destructive",
        });
      }
    },
    [contentTypesMap, toast],
  );

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
  const d7Label = windowLabel(data.windows.d7, 7);

  return (
    <>
    <div className="space-y-4" data-testid="diagnostics-organic-panel">
      <p className="text-sm text-muted-foreground">
        Actions from Google Search performance, not total visits. Most cards use the last 7
        complete days; cannibalization uses 28 days; decay compares 7 or 28 days to the period
        before. Data lags about 2–3 days — use Search Console for yesterday and live queries.
      </p>

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
            windowLabel={d7Label}
            testId="card-organic-page2"
            empty="No page-2 query × URL pairs in this window."
            help={
              <>
                <p>
                  These queries already show your page on Google’s second results page (about
                  positions 11–20). They are close to page 1 — small content or linking work can
                  move them up.
                </p>
                <p>
                  Start with the highest-impression rows. Improve the page for that query, or add
                  internal links from stronger related pages. This list does not include page-1 or
                  deep rankings.
                </p>
              </>
            }
          >
            {data.cards.page2.length > 0 && (
              <SimpleTable
                headers={["Query / URL", "Impr.", "Pos.", ""]}
                rows={data.cards.page2.map((r) => [
                  <QueryUrlCell
                    key={`${r.query}-${r.url}`}
                    query={r.query}
                    url={r.url}
                    onOpenSeoMeta={openSeoMetaForUrl}
                  />,
                  fmtInt(r.impressions),
                  fmtPos(r.position),
                  r.cms_known ? (
                    <AskAgentCell
                      key={`ask-${r.query}-${r.url}`}
                      testId={`ask-organic-page2-${r.query}`}
                      prompt={buildOrganicAskAgentPrompt("organic-page2", {
                        query: r.query,
                        url: shortUrl(r.url),
                        position: fmtPos(r.position),
                        impressions: fmtInt(r.impressions),
                        window_label: d7Label,
                      })}
                      onAgentSelect={openAskAgent}
                      entryKey={r.entry_key}
                      writeCount={r.write_count}
                    />
                  ) : (
                    ""
                  ),
                ])}
              />
            )}
          </OpportunityCard>

          <OpportunityCard
            title="High impressions, low CTR"
            windowLabel={d7Label}
            testId="card-organic-low-ctr"
            empty="No CTR gaps vs the expected curve."
            help={
              <>
                <p>
                  These are page-1 rankings that get shown a lot but clicked less than expected for
                  that position. People see you — they just do not choose you.
                </p>
                <p>
                  Fix the title, meta description, or how well the page matches the query. Compare
                  CTR to Expected: a large gap means the listing underperforms for its rank.
                </p>
              </>
            }
          >
            {data.cards.low_ctr.length > 0 && (
              <SimpleTable
                headers={[
                  "Query / URL",
                  "Impr.",
                  <span key="ctr-exp-head" className="inline-flex items-center gap-1">
                    CTR
                    <CardInfoPopover
                      testId="info-organic-ctr-exp"
                      className="h-4 w-4"
                      ariaLabel="What CTR and Expected mean"
                    >
                      <p>
                        <span className="font-medium text-foreground">CTR</span> is how often people
                        clicked your result when they saw it (top number).
                      </p>
                      <p>
                        <span className="font-medium text-foreground">Exp.</span> is the typical
                        click rate for that ranking position (bottom number). A large gap means the
                        listing underperforms for its rank — often fixable in the title or
                        description.
                      </p>
                    </CardInfoPopover>
                  </span>,
                  "",
                ]}
                rows={data.cards.low_ctr.map((r) => [
                  <QueryUrlCell
                    key={`${r.query}-${r.url}`}
                    query={r.query}
                    url={r.url}
                    onOpenSeoMeta={openSeoMetaForUrl}
                  />,
                  fmtInt(r.impressions),
                  <StackedMetricCell
                    key={`ctr-${r.query}-${r.url}`}
                    primary={fmtPct(r.ctr)}
                    secondary={fmtPct(r.expected_ctr)}
                  />,
                  r.cms_known ? (
                    <AskAgentCell
                      key={`ask-ctr-${r.query}-${r.url}`}
                      testId={`ask-organic-low-ctr-${r.query}`}
                      prompt={buildOrganicAskAgentPrompt("organic-low-ctr", {
                        query: r.query,
                        url: shortUrl(r.url),
                        position: fmtPos(r.position),
                        impressions: fmtInt(r.impressions),
                        ctr: fmtPct(r.ctr),
                        expected_ctr: fmtPct(r.expected_ctr),
                        window_label: d7Label,
                      })}
                      onAgentSelect={openAskAgent}
                      entryKey={r.entry_key}
                      writeCount={r.write_count}
                    />
                  ) : (
                    ""
                  ),
                ])}
              />
            )}
          </OpportunityCard>

          <SerpCard
            configured={data.openrush_configured}
            rows={data.cards.missing_serp}
            windowLabel={d7Label}
            canEdit={canEdit}
            refreshing={serpRefresh.isPending}
            onRefreshQuery={(query) => serpRefresh.mutate({ query })}
            onRefreshStale={() => serpRefresh.mutate({ mode: "stale" })}
            onAskAgent={openAskAgent}
            onOpenSeoMeta={openSeoMetaForUrl}
          />

          <OpportunityCard
            title="Internal linking gaps"
            windowLabel={d7Label}
            testId="card-organic-link-gaps"
            empty="No ranking URLs with fewer than 3 internal links."
            help={
              <>
                <p>
                  These URLs already rank (roughly positions 4–20) but fewer than three other pages
                  on the site link to them. Thin internal linking often holds rankings back.
                </p>
                <p>
                  Add contextual links from related live pages. Inbound is a count from our link
                  index — it does not change Google by itself until you publish those links.
                </p>
              </>
            }
          >
            {data.cards.link_gaps.length > 0 && (
              <SimpleTable
                headers={["URL", "Pos.", "Impr.", "Inbound", ""]}
                rows={data.cards.link_gaps.map((r) => [
                  shortUrl(r.url),
                  fmtPos(r.position),
                  fmtInt(r.impressions),
                  String(r.inbound),
                  r.cms_known ? (
                    <AskAgentCell
                      key={`ask-link-${r.url}`}
                      testId={`ask-organic-link-gaps-${shortUrl(r.url)}`}
                      prompt={buildOrganicAskAgentPrompt("organic-link-gaps", {
                        url: shortUrl(r.url),
                        position: fmtPos(r.position),
                        impressions: fmtInt(r.impressions),
                        inbound: String(r.inbound),
                        window_label: d7Label,
                      })}
                      onAgentSelect={openAskAgent}
                      entryKey={r.entry_key}
                      writeCount={r.write_count}
                    />
                  ) : (
                    ""
                  ),
                ])}
              />
            )}
          </OpportunityCard>

          <Card data-testid="card-organic-decay">
            <CardHeader className="pb-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <CardTitle className="text-sm font-semibold">Content decay</CardTitle>
                  <CardInfoPopover testId="info-organic-decay">
                    <p>
                      URLs that lost clicks or impressions versus the previous period of the same
                      length. Use this to catch pages that are cooling off before traffic drops
                      further.
                    </p>
                    <p>
                      Switch 7 or 28 days above. Only URLs present in both windows appear. Refresh
                      outdated sections, update examples, or re-promote the page when the topic is
                      still relevant.
                    </p>
                  </CardInfoPopover>
                </div>
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
            help={
              <>
                <p>
                  One search query is sending traffic to two or more of your pages. They compete
                  with each other instead of one clear winner ranking higher.
                </p>
                <p>
                  Pick a primary URL for that query. Merge or redirect the weaker page, or
                  differentiate topics so each page targets a distinct intent. This card uses 28
                  days so short spikes do not dominate.
                </p>
              </>
            }
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
    <McpRequiredForAiModal
      open={mcpRequiredForAiOpen}
      onOpenChange={setMcpRequiredForAiOpen}
      defaultTab={mcpRequiredSetupTab}
      agentId={mcpRequiredAgentId}
      agentLabel={mcpRequiredAgentLabel}
      prompt={mcpRequiredPrompt}
      prefillUrlPrefix={mcpRequiredPrefillPrefix}
      defaultRoleId="seo_specialist"
    />
    <ManagedSeoModal
      open={seoModalOpen}
      onOpenChange={(open) => {
        setSeoModalOpen(open);
        if (!open) setSeoModalTarget(null);
      }}
      target={seoModalTarget}
    />
    {seoPickerPending ? (
      <SeoContextPickerDialog
        open={seoPickerOpen}
        onOpenChange={(open) => {
          setSeoPickerOpen(open);
          if (!open) setSeoPickerPending(null);
        }}
        contentType={seoPickerPending.contentType}
        slug={seoPickerPending.slug}
        locale={seoPickerPending.locale}
        onConfirm={(choice) => {
          setSeoModalTarget({
            contentType: seoPickerPending.contentType,
            slug: seoPickerPending.slug,
            locale: seoPickerPending.locale,
            variant: choice.type === "variant" ? choice.variant : undefined,
          });
          setSeoPickerOpen(false);
          setSeoPickerPending(null);
          setSeoModalOpen(true);
        }}
      />
    ) : null}
    </>
  );
}

function CardInfoPopover({
  children,
  testId,
  className,
  ariaLabel = "What this means",
}: {
  children: ReactNode;
  testId?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center h-5 w-5 rounded-sm shrink-0",
            "text-muted-foreground hover:text-foreground transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          aria-label={ariaLabel}
          data-testid={testId}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 text-sm text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function OpportunityCard({
  title,
  windowLabel: wLabel,
  testId,
  empty,
  help,
  children,
}: {
  title: string;
  windowLabel: string;
  testId: string;
  empty: string;
  help?: ReactNode;
  children?: ReactNode;
}) {
  const hasBody = Boolean(children);
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-3 space-y-1">
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {help && <CardInfoPopover testId={`info-${testId}`}>{help}</CardInfoPopover>}
        </div>
        <p className="text-xs text-muted-foreground">{wLabel}</p>
      </CardHeader>
      <CardContent>
        {hasBody ? children : <p className="text-sm text-muted-foreground">{empty}</p>}
      </CardContent>
    </Card>
  );
}

function QueryUrlCell({
  query,
  url,
  onOpenSeoMeta,
}: {
  query: string;
  url: string;
  onOpenSeoMeta: (url: string) => void;
}) {
  const { toast } = useToast();
  const path = shortUrl(url);
  const absolute =
    /^https?:\/\//i.test(url.trim())
      ? url.trim()
      : typeof window !== "undefined"
        ? `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`
        : path;

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }

  return (
    <div className="min-w-0 max-w-[250px] space-y-0.5">
      <p className="text-sm font-medium text-foreground truncate" title={query}>
        {query}
      </p>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="block w-full min-w-0 text-left text-[11px] text-muted-foreground truncate hover:text-foreground hover:underline"
            title={path}
            data-testid={`button-organic-url-menu-${path}`}
          >
            {path}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem asChild>
            <a
              href={path.startsWith("/") ? path : `/${path}`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`menu-organic-url-open-${path}`}
            >
              <ExternalLink className="h-4 w-4" />
              Open in new tab
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void copy("Relative path", path)}
            data-testid={`menu-organic-url-copy-relative-${path}`}
          >
            <LinkIcon className="h-4 w-4" />
            Copy relative path
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void copy("Absolute path", absolute)}
            data-testid={`menu-organic-url-copy-absolute-${path}`}
          >
            <Copy className="h-4 w-4" />
            Copy absolute path
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onOpenSeoMeta(url)}
            data-testid={`menu-organic-url-seo-meta-${path}`}
          >
            <Pencil className="h-4 w-4" />
            Open SEO Meta
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function StackedMetricCell({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div className="space-y-0.5 leading-tight">
      <p className="text-xs text-foreground" title={`CTR ${primary}`}>
        {primary}
      </p>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "text-[11px] text-muted-foreground underline-offset-2 hover:underline hover:text-foreground",
              "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
            )}
            aria-label={`Expected CTR ${secondary}. What this means`}
          >
            {secondary}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-2 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Expected</span> is the typical click rate
            for this ranking position — what similar results usually get at that spot.
          </p>
          <p>
            Your real CTR is the number above. When it sits well below expected, people see your
            listing but choose someone else — often fixable in the title or description.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function AskAgentCell({
  prompt,
  onAgentSelect,
  testId,
  entryKey,
  writeCount,
}: {
  prompt: string;
  onAgentSelect: (payload: SolveWithAiAgentSelectPayload) => void;
  testId: string;
  entryKey?: string | null;
  writeCount?: number;
}) {
  const resolvedKey = entryKey?.trim() || undefined;
  return (
    <div className="flex justify-end">
      <SolveWithAiAgentDropdown
        icon={Bot}
        ariaLabel="Agent"
        prompt={prompt}
        size="sm"
        buttonVariant="ghost"
        testId={testId}
        onAgentSelect={onAgentSelect}
        entryKey={resolvedKey}
        writeCount={resolvedKey ? writeCount ?? 0 : undefined}
      />
    </div>
  );
}

const STICKY_TABLE_HEAD =
  "sticky top-0 z-10 h-8 px-2 text-xs bg-card shadow-[inset_0_-1px_0_0_hsl(var(--border))]";

function SimpleTable({ headers, rows }: { headers: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className="[&>div]:max-h-80">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((h, hi) => (
              <TableHead key={`col-${hi}`} className={STICKY_TABLE_HEAD}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {row.map((cell, j) => {
                const isPlain = typeof cell === "string" || typeof cell === "number";
                return (
                  <TableCell
                    key={j}
                    className={
                      isPlain
                        ? "px-2 py-1.5 text-xs max-w-[220px] truncate"
                        : "px-2 py-1.5 align-top"
                    }
                    title={isPlain ? String(cell) : undefined}
                  >
                    {cell}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
  onAskAgent,
  onOpenSeoMeta,
}: {
  configured: boolean;
  rows: OrganicOpportunities["cards"]["missing_serp"];
  windowLabel: string;
  canEdit: boolean;
  refreshing: boolean;
  onRefreshQuery: (query: string) => void;
  onRefreshStale: () => void;
  onAskAgent: (payload: SolveWithAiAgentSelectPayload) => void;
  onOpenSeoMeta: (url: string) => void;
}) {
  if (!configured) {
    return (
      <Card data-testid="card-organic-missing-serp">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-sm font-semibold">Missing SERP features</CardTitle>
            <CardInfoPopover testId="info-card-organic-missing-serp">
              <p>
                Shows page-1 queries where a live SERP check suggests someone else owns a featured
                snippet or People Also Ask, or your URL is not visible in that snapshot.
              </p>
              <p>
                OpenRush must be activated first. Refreshing a query uses API credits and does not
                start a Search Console export.
              </p>
            </CardInfoPopover>
          </div>
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
          <div className="flex items-center gap-1.5 min-w-0">
            <CardTitle className="text-sm font-semibold">Missing SERP features</CardTitle>
            <CardInfoPopover testId="info-card-organic-missing-serp">
              <p>
                Shows page-1 queries where a live SERP check suggests someone else owns a featured
                snippet or People Also Ask, or your URL is not visible in that snapshot.
              </p>
              <p>
                Use Refresh on a row when you need a fresh check — that spends OpenRush credits.
                Refresh stale updates older snapshots only. Loading Search Console days does not
                fetch SERPs.
              </p>
            </CardInfoPopover>
          </div>
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
          <div className="[&>div]:max-h-80">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={STICKY_TABLE_HEAD}>Query / URL</TableHead>
                  <TableHead className={STICKY_TABLE_HEAD}>In SERP</TableHead>
                  <TableHead className={STICKY_TABLE_HEAD} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.query}-${r.url}`}>
                    <TableCell className="px-2 py-1.5 align-top">
                      <QueryUrlCell query={r.query} url={r.url} onOpenSeoMeta={onOpenSeoMeta} />
                      {r.alt_urls.length > 0 && (
                        <span className="block text-[10px] text-muted-foreground mt-0.5">
                          Also ranks: {r.alt_urls.length} more URL{r.alt_urls.length === 1 ? "" : "s"}
                        </span>
                      )}
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
                      <div className="inline-flex items-center justify-end gap-1 flex-wrap">
                        {r.cms_known && (
                          <AskAgentCell
                            testId={`ask-organic-missing-serp-${r.query}`}
                            prompt={buildOrganicAskAgentPrompt("organic-missing-serp", {
                              query: r.query,
                              url: shortUrl(r.url),
                              position: fmtPos(r.position),
                              impressions: fmtInt(r.impressions),
                              serp_status: formatOrganicSerpStatus(r),
                              window_label: wLabel,
                            })}
                            onAgentSelect={onAskAgent}
                            entryKey={r.entry_key}
                            writeCount={r.write_count}
                          />
                        )}
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
