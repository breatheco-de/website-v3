import { useRef, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Check, ChevronDown, Info, Loader2, RefreshCw } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { useToast } from "@/hooks/use-toast";
import { useResizableWidth } from "@/hooks/use-resizable-width";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  FUNNEL_STAGE_DESCRIPTION,
  FUNNEL_STAGE_ICON,
  FUNNEL_STAGE_ICON_TONE,
  FUNNEL_STAGE_LABEL,
  FUNNEL_STAGE_TAPER,
} from "@/lib/funnel-stage-ui";
import { FUNNEL_STAGES, type FunnelStage } from "@shared/funnel";
import type { Finding, FindingLink, PageAdvice, PageStatsResponse, PageStatsScope } from "@shared/page-stats";
import { AdvicePanel, ObjectiveCard, ObjectiveFunnel } from "./ObjectivePanel";
import {
  EngagementSection,
  JourneySection,
  LeadsSection,
  LinksSection,
  PaidSection,
  SearchSection,
  SourcesSection,
} from "./PageStatsSections";
export type PageStatsSeoTab = "keywords" | "serp" | "funnel";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Public path of the page (no host). */
  path: string | null;
  pageErrorCount?: number;
  navigate: (href: string) => void;
  onOpenSeoModalTab?: (tab: PageStatsSeoTab) => void;
  scope: PageStatsScope;
  onScopeChange: (scope: PageStatsScope) => void;
  /** Called once the close animation has finished. */
  onExitComplete?: () => void;
};

async function fetchPageStats(path: string, scope: PageStatsScope, refresh: boolean): Promise<PageStatsResponse> {
  const params = new URLSearchParams({ path, scope });
  if (refresh) params.set("refresh", "1");
  const res = await apiFetch(`/api/analytics/page-stats?${params}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as PageStatsResponse;
}

/** Page errors from the bubble come first: they can break everything else. */
function withPageErrors(advice: PageAdvice, errorCount: number): PageAdvice {
  if (errorCount <= 0) return advice;
  const finding: Finding = {
    id: "page_errors",
    tone: "bad",
    title: `${errorCount} error${errorCount === 1 ? "" : "s"} on this page`,
    evidence: "Broken sections, links or tracking can hide every other result here.",
    action: "Fix the page errors first (red badge on the Dev Tools bubble).",
    link: null,
    weight: 100,
  };
  return { ...advice, findings: [finding, ...advice.findings].slice(0, 3) };
}

function AdvancedInfo() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Read more (advanced)" data-testid="button-page-stats-advanced">
          <Info className="h-4 w-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[10003] w-96 space-y-2 text-xs text-muted-foreground leading-relaxed">
        <p className="font-medium text-foreground text-sm">Read more (advanced)</p>
        <p>
          <span className="text-foreground">Main number per stage.</span> Awareness: sessions whose next page is a consideration or
          decision page. Consideration: sessions that reach a decision page later in the visit. Decision: leads submitted on this page ÷
          sessions. Post-enrollment: sessions with a click to an external destination (e.g. the learning platform).
        </p>
        <p>
          <span className="text-foreground">Targets.</span> Settings → Ads → Targets (stored in <code>settings.yml</code> under{" "}
          <code>funnel.targets</code>). Without one: median of other pages in the same stage with 100+ sessions, then this page's previous 28
          days. "By channel" compares each channel with the nightly baseline for the same channel, content type and stage.
        </p>
        <p>
          <span className="text-foreground">Leads.</span> From the lead ledger, excluding test and repeat leads. "Converted on this page" =
          form submitted here (<code>conversion_path</code>); "Started their visit here" = visit landed here (<code>landing_path</code>).
          Platform-reported leads (Meta pixel, Google conversions) are shown next to them, never added.
        </p>
        <p>
          <span className="text-foreground">Journey.</span> GA4 BigQuery export: page views per session, staff (<code>/private</code>) visits
          excluded. Time on page = until the next page view (or the last event on the page), capped at 30 minutes.
        </p>
        <p>
          <span className="text-foreground">Campaign goal fit.</span> Meta objective / ad set optimization goal and Google campaign type
          compared with the page's stage (e.g. a Leads campaign on an awareness page is a mismatch).
        </p>
        <p className="font-mono text-[10px]">server/analytics/page-stats/ · shared/page-objectives.ts · GET /api/analytics/page-stats</p>
      </PopoverContent>
    </Popover>
  );
}

function StageMenu({ stage, entry }: { stage: FunnelStage | null; entry: { content_type: string; slug: string } | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: async (next: FunnelStage) => {
      const res = await apiRequest("PUT", `/api/content-types/${entry!.content_type}/funnel/${entry!.slug}`, { stage: next });
      return (await res.json()) as { warnings?: { message: string }[] };
    },
    onSuccess: (body, next) => {
      void queryClient.invalidateQueries({ queryKey: [`/api/content-types/${entry!.content_type}/funnel/${entry!.slug}`] });
      void queryClient.invalidateQueries({ queryKey: ["/api/analytics/page-stats"] });
      toast({
        title: `Stage set to ${FUNNEL_STAGE_LABEL[next]}`,
        description: body.warnings?.[0]?.message ?? "Page stats now judge this page on its new job.",
      });
    },
    onError: (err) => {
      toast({ title: "Couldn't change the stage", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const Icon = stage ? FUNNEL_STAGE_ICON[stage] : null;
  const badge = (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", !stage && "text-muted-foreground")}>
      {save.isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : Icon && stage ? (
        <Icon className={cn("h-3 w-3", FUNNEL_STAGE_ICON_TONE[FUNNEL_STAGE_TAPER[stage]])} />
      ) : null}
      {stage ? FUNNEL_STAGE_LABEL[stage] : "No stage"}
      {entry && <ChevronDown className="h-3 w-3 opacity-60" />}
    </Badge>
  );
  if (!entry) return badge;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={save.isPending}>
        <button
          type="button"
          className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Change funnel stage"
          data-testid="button-page-stats-stage"
        >
          {badge}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="z-[10003] w-80">
        <DropdownMenuLabel className="space-y-0.5">
          <span className="block text-xs font-medium text-foreground">Funnel stage</span>
          <span className="block text-[11px] font-normal text-muted-foreground">
            Applies to every language of this page. The Store journey uses it too.
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FUNNEL_STAGES.map((s) => {
          const ItemIcon = FUNNEL_STAGE_ICON[s];
          const current = s === stage;
          return (
            <DropdownMenuItem
              key={s}
              className={cn("items-start gap-2.5 py-2", current && "bg-muted/50")}
              onSelect={() => {
                if (!current) save.mutate(s);
              }}
              data-testid={`menu-page-stats-stage-${s}`}
            >
              <ItemIcon className={cn("mt-0.5 h-4 w-4", FUNNEL_STAGE_ICON_TONE[FUNNEL_STAGE_TAPER[s]])} />
              <span className="flex-1 space-y-0.5">
                <span className="block text-sm font-medium text-foreground">{FUNNEL_STAGE_LABEL[s]}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">{FUNNEL_STAGE_DESCRIPTION[s]}</span>
              </span>
              {current && <Check className="mt-0.5 h-4 w-4 text-muted-foreground" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3" data-testid="page-stats-loading">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Reading GA4, Search Console, ads and leads. The first open takes a few seconds.
      </p>
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function PageStatsDrawer({
  open,
  onOpenChange,
  path,
  pageErrorCount = 0,
  navigate,
  onOpenSeoModalTab,
  scope,
  onScopeChange,
  onExitComplete,
}: Props) {
  const forceRefresh = useRef(false);
  const resize = useResizableWidth({ storageKey: "page-stats-drawer-width", defaultWidth: 672, minWidth: 420, maxRatio: 0.8 });
  const query = useQuery({
    queryKey: ["/api/analytics/page-stats", path, scope],
    enabled: open && !!path,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    queryFn: () => {
      const force = forceRefresh.current;
      forceRefresh.current = false;
      return fetchPageStats(path!, scope, force);
    },
  });
  const data = query.data;
  const stage = data?.stage ?? null;
  const multiLocale = data ? Object.keys(data.locale_urls).length > 1 : false;

  const handleLink = (link: FindingLink) => {
    switch (link.kind) {
      case "seo_modal":
        onOpenSeoModalTab?.("keywords");
        return;
      case "funnel_tab":
        onOpenSeoModalTab?.("funnel");
        return;
      case "leads": {
        const qs = new URLSearchParams({ [link.filter]: link.path });
        navigate(`/private/store/leads?${qs}`);
        return;
      }
      case "ads_diagnostics":
        navigate(link.platform ? `/private/diagnostics/ads/${link.platform}` : "/private/diagnostics/ads");
        return;
      case "targets":
        navigate("/private/settings/ads/targets");
        return;
      case "url":
        if (link.href.startsWith("/")) navigate(link.href);
        else window.open(link.href, "_blank", "noopener");
        return;
    }
  };

  const s = data?.sections;
  const markers = s?.changes.data?.markers ?? [];
  const verdictInBadge = data?.objective?.primary.status === "too_little_data";
  const sections = data && s
    ? (() => {
        const journey = (title: string) => <JourneySection key="journey" section={s.traffic} title={title} />;
        const sources = <SourcesSection key="sources" section={s.traffic} />;
        const leads = <LeadsSection key="leads" section={s.leads} path={data.path} />;
        const search = <SearchSection key="search" section={s.organic} />;
        const paid = (
          <PaidSection
            key="paid"
            section={s.paid}
            objective={data.objective}
            onOpenAds={(platform) => handleLink({ kind: "ads_diagnostics", platform })}
          />
        );
        const engagement = <EngagementSection key="engagement" section={s.traffic} />;
        const links = <LinksSection key="links" section={s.links} />;
        switch (stage) {
          case "awareness":
            return [search, journey("Where readers go next"), links, sources, engagement, paid, leads];
          case "consideration":
            return [journey("Path to a decision"), sources, engagement, leads, paid, search, links];
          case "decision":
            return [leads, paid, journey("Where non-converters go"), sources, engagement, search, links];
          case "post-enrollment":
            return [engagement, journey("Where students go next"), sources, links];
          default:
            return [sources, journey("Journey"), leads, search, paid, engagement, links];
        }
      })()
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="z-[10002] w-full sm:w-[var(--page-stats-width)] sm:max-w-none p-0 flex flex-col gap-0 border-l border-border bg-background text-foreground shadow-2xl"
        style={{ "--page-stats-width": `${resize.width}px` } as CSSProperties}
        onInteractOutside={(e) => e.preventDefault()}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget && e.currentTarget.dataset.state === "closed") onExitComplete?.();
        }}
        data-testid="drawer-page-stats"
      >
        <div
          {...resize.handleProps}
          aria-label="Resize page stats"
          title="Drag to resize. Double-click to reset."
          className="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize touch-none transition-colors hover:bg-primary/20 active:bg-primary/30 focus-visible:bg-primary/30 focus-visible:outline-none sm:block"
          data-testid="handle-page-stats-resize"
        />
        <div className="border-b border-border px-5 pt-5 pb-3 pr-12">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            <SheetTitle className="text-base">Page stats</SheetTitle>
            <AdvancedInfo />
            <div className="ml-auto flex items-center gap-2">
              {multiLocale && (
                <ToggleButtonBar value={scope} onValueChange={(v) => onScopeChange(v as PageStatsScope)} listTestId="toggle-page-stats-scope">
                  <ToggleButtonBarTrigger value="url" data-testid="toggle-page-stats-scope-url">
                    This URL
                  </ToggleButtonBarTrigger>
                  <ToggleButtonBarTrigger value="entry" data-testid="toggle-page-stats-scope-entry">
                    All languages
                  </ToggleButtonBarTrigger>
                </ToggleButtonBar>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Refresh"
                title="Re-read every source (skips the 10-minute cache)"
                disabled={query.isFetching}
                onClick={() => {
                  forceRefresh.current = true;
                  void query.refetch();
                }}
                data-testid="button-page-stats-refresh"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", query.isFetching && "animate-spin")} />
              </Button>
            </div>
          </div>
          <SheetDescription className="sr-only">
            How this page does at its job, where its visitors come from and go, and what to change first.
          </SheetDescription>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!path ? (
            <p className="text-sm text-muted-foreground">This page has no public URL yet, so there are no visits to report.</p>
          ) : query.isLoading ? (
            <LoadingState />
          ) : query.isError ? (
            <div className="rounded-lg border border-status-busy/40 bg-status-busy/5 p-3 text-sm text-status-busy" data-testid="page-stats-error">
              Couldn't load page stats: {(query.error as Error).message}
            </div>
          ) : data ? (
            <>
              {data.objective ? (
                <ObjectiveCard
                  objective={data.objective}
                  traffic={s?.traffic.data ?? null}
                  markers={markers}
                  onSetTarget={() => handleLink({ kind: "targets" })}
                  statusDetail={verdictInBadge ? data.advice.verdict.text : undefined}
                  stageControl={<StageMenu stage={stage} entry={data.entry} />}
                />
              ) : (
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2" data-testid="page-stats-no-stage">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">Set this page's funnel stage</p>
                    <StageMenu stage={stage} entry={data.entry} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The stage tells the drawer which number matters most here: reaching new people, building intent, getting leads, or helping
                    students. Until then you see the general view below.
                  </p>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleLink({ kind: "funnel_tab" })} data-testid="button-page-stats-set-stage">
                    Set the stage
                  </Button>
                </div>
              )}
              <AdvicePanel advice={withPageErrors(data.advice, pageErrorCount)} onLink={handleLink} hideVerdict={verdictInBadge} />
              {data.objective && <ObjectiveFunnel objective={data.objective} />}
              {sections}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
