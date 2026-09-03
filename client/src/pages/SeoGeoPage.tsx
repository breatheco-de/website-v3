import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowRightLeft, ArrowUp, ArrowUpDown, Bot, BotOff, Brain, Check, ChevronDown, Copy, Crosshair, DownloadCloud, ExternalLink, Filter, Globe, Info, Loader2, MoreVertical, Network, Pencil, Plus, RefreshCw, Star, Unlink } from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ToggleButtonBarList, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ManagedSeoModal, type ManagedSeoModalTarget } from "@/components/editing/ManagedSeoModal";
import {
  SeoContextPickerDialog,
  resolveSeoContexts,
  type SeoContextChoice,
} from "@/components/editing/SeoContextPickerDialog";
import type { SeoModalTab } from "@/components/DebugBubble/components/SeoModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type {
  GscInspectEnqueueResponse,
  GscInspectMode,
  GscInspectionGetResponse,
  GscInspectionRecord,
  GscInspectionSummary,
  GscInspectQueueStats,
} from "@/lib/gscInspection";
import { gscHeadline, gscInspectModeLabel } from "@/lib/gscInspection";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { getDebugToken, resolveAuthorName, useDebugAuth } from "@/hooks/useDebugAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequestWithAuth, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { deslugifyLabel } from "@shared/relation-field";
import { formatSitePath } from "@shared/formatSitePath";
import { SitemapSearch, SitemapLocaleFilter } from "@/components/menus/SitemapSearch";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import type { SitemapSearchEntry } from "@/lib/sitemapSearch";
import { useMutation } from "@tanstack/react-query";

function lastPathSegment(pillarUrl: string): string {
  return pillarUrl.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "";
}

function clusterListLabel(keyword: string | null | undefined, pillarUrl: string): string {
  const kw = typeof keyword === "string" ? keyword.trim() : "";
  if (kw) return deslugifyLabel(kw);
  const seg = lastPathSegment(pillarUrl);
  return seg ? deslugifyLabel(seg) : "Untitled cluster";
}

function clusterCountBadgeClass(count: number): string | undefined {
  if (count <= 0) return "border-transparent bg-status-busy/15 text-status-busy";
  if (count <= 2) return "border-transparent bg-status-away/15 text-status-away";
  return undefined;
}

function ClusterPillarPath({ pillarUrl }: { pillarUrl: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(pillarUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const iconBtnClass = cn(
    "shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-sm",
    "text-muted-foreground hover:text-foreground transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  );

  return (
    <div className="flex items-center gap-1 pb-2 min-w-0">
      <p
        className="text-[11px] text-muted-foreground font-mono min-w-0 flex-1 truncate"
        data-testid={`cluster-path-${pillarUrl}`}
      >
        {pillarUrl}
      </p>
      <a
        href={pillarUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={iconBtnClass}
        title="Open page in new tab"
        aria-label="Open page in new tab"
        data-testid={`cluster-path-open-${pillarUrl}`}
      >
        <ExternalLink className="h-3 w-3" />
      </a>
      <button
        type="button"
        onClick={handleCopy}
        className={iconBtnClass}
        title={copied ? "Copied!" : "Copy path"}
        aria-label="Copy path"
        data-testid={`cluster-path-copy-${pillarUrl}`}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

type ClusterSortBy = "name" | "page-count";
type ClusterSortDir = "asc" | "desc";

const CLUSTER_SORT_FIELDS: { value: ClusterSortBy; label: string; defaultDir: ClusterSortDir }[] = [
  { value: "name", label: "Name", defaultDir: "asc" },
  { value: "page-count", label: "Page count", defaultDir: "desc" },
];

function ClusterSortIcon({
  field,
  sortBy,
  sortDir,
}: {
  field: ClusterSortBy;
  sortBy: ClusterSortBy;
  sortDir: ClusterSortDir;
}) {
  if (field !== sortBy) return <ArrowUpDown className="inline ml-1 opacity-40" size={12} />;
  return sortDir === "asc" ? (
    <ArrowUp className="inline ml-1" size={12} />
  ) : (
    <ArrowDown className="inline ml-1" size={12} />
  );
}

function compareClustersByName(
  a: { keyword?: string | null; pillarUrl: string },
  b: { keyword?: string | null; pillarUrl: string },
): number {
  return clusterListLabel(a.keyword, a.pillarUrl).localeCompare(
    clusterListLabel(b.keyword, b.pillarUrl),
    undefined,
    { sensitivity: "base" },
  );
}

function ClusterMapHelp() {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <div className="mb-3 space-y-1.5" data-testid="cluster-map-help">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Clusters group a hub page and its supporting pages. Stats below cover content types with{" "}
        <strong className="font-medium text-foreground">SEO monitoring</strong> enabled in content-type
        settings. <strong className="font-medium text-foreground">Unclustered</strong> is the setup gap
        (including pages with no SEO yet). Opt out with{" "}
        <code className="font-mono text-[10px]">seo.pillar_path: null</code>. Assign members via{" "}
        <code className="font-mono text-[10px]">seo.pillar_path</code> on locale YAML.
      </p>
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="px-0 h-auto text-xs"
            data-testid="button-cluster-map-read-more"
          >
            {advancedOpen ? "Hide advanced details" : "Read more (advanced)"}
            <ChevronDown
              className={`h-3.5 w-3.5 ml-1 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1 space-y-1 text-xs text-muted-foreground">
          <p>
            Hub = <code className="font-mono text-[10px]">seo.is_pillar</code> on the locale YAML.
            Members set <code className="font-mono text-[10px]">seo.pillar_path</code> to that hub URL.
            Missing or empty path = gap (counted in stats).{" "}
            <code className="font-mono text-[10px]">pillar_path: null</code> = intentional opt-out.
          </p>
          <p>
            Monitoring is configured per content type in{" "}
            <code className="font-mono text-[10px]">content-types.yml</code> (
            <code className="font-mono text-[10px]">seo_monitoring.enabled</code>; omitted = off). DB-backed
            types can map <code className="font-mono text-[10px]">seo_main_keyword</code> /{" "}
            <code className="font-mono text-[10px]">seo_pillar_path</code> in field_mapping; locale YAML wins.
          </p>
          <p className="font-mono">{"{contentRoot}/seo-index.json"}</p>
          <p className="font-mono">server/seo-index.ts</p>
          <p className="font-mono">server/seo-monitoring.ts</p>
          <p className="font-mono">server/content-types.ts</p>
          <p className="font-mono">client/src/components/editing/MappingFieldsTab.tsx</p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function isSitemapLastmodStale(lastmod: string | null | undefined, nowMs = Date.now()): boolean {
  if (!lastmod) return false;
  const day = lastmod.split("T")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const then = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(then)) return false;
  return nowMs - then > TWO_WEEKS_MS;
}

type ClusterMember = {
  id: string;
  slug: string;
  contentType: string;
  locale: string;
  path: string;
  keyword?: string | null;
  lastmod?: string | null;
  updated_at?: string | null;
};

type ClusterEntryInfo = {
  title: string | null;
  page_title: string | null;
  description: string | null;
  path: string;
  contentType: string;
  slug: string;
  locale: string;
  main_keyword: string | null;
  kw_monthly_volume: number | null;
  kw_difficulty: number | null;
  is_pillar: boolean;
  pillar_path: string | null;
  file: string | null;
  lastmod?: string | null;
  updated_at?: string | null;
  gscStatus?: {
    configured: boolean;
    record: GscInspectionRecord | null;
    stale: boolean;
  };
};

type ClusterDiagnosticsResult = {
  hubId: string;
  pillarUrl: string;
  scanStatus: "ok" | "render_failed";
  missingLinks: { memberPath: string; memberSlug: string; memberId: string }[];
  scannedAt: string;
  fromCache?: boolean;
};

function invalidateClusterQueries(hubId?: string) {
  void queryClient.invalidateQueries({ queryKey: ["/api/seo/overview"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/seo/cluster-entries"] });
  void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-issues", "seo-cluster"] });
  if (hubId) {
    void queryClient.invalidateQueries({ queryKey: ["/api/seo/cluster-diagnostics", hubId] });
  }
}

type ClusterBucketCounts = {
  unclustered: number;
  partiallySet: number;
  brokenRefs: number;
  optedOut: number;
  clustered: number;
  hub: number;
};

type ClusterHealth = {
  emptyHubCount: number;
  stats: ClusterBucketCounts;
  byContentType: Record<string, ClusterBucketCounts>;
  byLocale: Record<string, ClusterBucketCounts>;
};

type SeoClusterIssueRow = {
  code: string;
  entryKey?: string;
  message?: string;
  suggestion?: string;
  severity?: "error" | "warning";
  file?: string;
};

const SEO_CLUSTER_ISSUE_HELP: Record<string, { title: string; body: string }> = {
  DUPLICATE_PILLAR: {
    title: "Duplicate hub path",
    body: "Two pages are marked as pillars for the same URL. Only one hub can own a path — fix is_pillar / pillar_path so hubs do not collide.",
  },
  SEO_BLOCK_ON_COMMON_YML: {
    title: "SEO block on _common.yml",
    body: "Shared _common.yml must not define seo:. Move seo.* to the locale YAML (en.yml / es.yml).",
  },
  INVALID_PILLAR: {
    title: "Pillar path not live or not a hub",
    body: "This page points at a pillar_path that does not resolve to a live pillar hub. Fix the path or mark the hub as is_pillar.",
  },
  ORPHAN_PAGE: {
    title: "Unclustered page",
    body: "This page has no seo.pillar_path and belongs to no cluster. Set a hub URL or pillar_path: null to opt out.",
  },
  PARTIALLY_SET_CLUSTER: {
    title: "Partially set cluster",
    body: "This page has a main keyword but no pillar_path. Link it to a hub or opt out.",
  },
  SEO_KEYWORD_RESEARCH_INCOMPLETE: {
    title: "Incomplete keyword research",
    body: "This page has a main keyword but is missing monthly search volume and/or keyword difficulty estimates. Add both planning numbers (not live traffic).",
  },
};

type StatHelp = { title: string; body: string };

const CLUSTER_STAT_HELP = {
  unclustered: {
    title: "Unclustered",
    body: "These pages still need cluster setup. That includes pages with no SEO block yet, and pages that have neither a hub nor a main keyword. Intentional opt-outs (pillar_path: null) are not counted here.",
  },
  partiallySet: {
    title: "Partially set",
    body: "These pages have a main keyword, but they are not linked to a hub page yet. They are halfway set up.",
  },
  brokenRefs: {
    title: "Broken refs",
    body: "These pages point to a hub that does not exist or is not marked as a hub. The link needs to be fixed.",
  },
  emptyHubs: {
    title: "Empty hubs",
    body: "These are pillar pages with no members linked to them yet. A hub should gather related pages under one topic.",
  },
  clustered: {
    title: "Clustered",
    body: "These pages are linked to a hub page and belong to a topic group. This is the healthy state.",
  },
} as const satisfies Record<string, StatHelp>;

type ClusterFilterBucket =
  | "unclustered"
  | "partiallySet"
  | "brokenRefs"
  | "emptyHubs"
  | "clustered";

type ClusterBucketEntryRow = {
  id: string;
  slug: string;
  contentType: string;
  locale: string;
  path: string;
  main_keyword: string | null;
  kw_monthly_volume: number | null;
  kw_difficulty: number | null;
  file: string;
  reason?: "hub_not_found" | "hub_not_pillar";
  pillar_path?: string | null;
};

type ClusterBucketEntriesResponse = {
  items: ClusterBucketEntryRow[];
  total: number;
  page: number;
  pageSize: number;
};

const CLUSTER_BUCKET_PAGE_SIZE = 25;

const GSC_STAT_HELP = {
  inSitemap: {
    title: "In sitemap",
    body: "How many pages are listed in your sitemap so Google can find them.",
  },
  inspected: {
    title: "Inspected",
    body: "How many of those pages we have already checked with Google Search Console.",
  },
  indexed: {
    title: "Indexed",
    body: "Google has these pages in its search results. People can find them on Google.",
  },
  notIndexed: {
    title: "Not indexed",
    body: "We checked these pages, but Google is not showing them in search yet. They may need a fix.",
  },
  errors: {
    title: "Errors",
    body: "Checks that failed — for example a connection problem or Google could not inspect the page.",
  },
  neverChecked: {
    title: "Never checked",
    body: "Pages in the sitemap that we have not asked Google about yet.",
  },
} as const satisfies Record<string, StatHelp>;

function StatHelpBadge({
  label,
  count,
  help,
  variant,
  testId,
}: {
  label: string;
  count: number;
  help: StatHelp;
  variant: "secondary" | "destructive" | "outline";
  testId?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          variant={variant}
          className="tabular-nums cursor-pointer"
          data-testid={testId}
          role="button"
          tabIndex={0}
          aria-label={`${label} ${count}. Click for explanation.`}
        >
          {label} {count}
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-1.5 p-3">
        <p className="text-sm font-medium text-foreground">{help.title}</p>
        <p className="text-sm text-muted-foreground leading-snug">{help.body}</p>
      </PopoverContent>
    </Popover>
  );
}

function ClusterHealthPanel({
  health,
  clusters,
  onEditSeo,
  canEditSeoFor,
}: {
  health: ClusterHealth;
  clusters: {
    pillarUrl: string;
    hubId?: string;
    keyword?: string | null;
    locale?: string;
  }[];
  onEditSeo: (contentType: string, slug: string, locale: string) => void;
  canEditSeoFor: (contentType: string) => boolean;
}) {
  const { stats } = health;
  const [activeBucket, setActiveBucket] = useState<ClusterFilterBucket | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setSearchInput("");
    setDebouncedQ("");
    setPage(1);
  }, [activeBucket]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ]);

  const { data: entries, isLoading: entriesLoading, isFetching } = useQuery<ClusterBucketEntriesResponse>({
    queryKey: ["/api/seo/cluster-entries", activeBucket, debouncedQ, page],
    enabled: activeBucket != null,
    queryFn: async () => {
      const token = getDebugToken();
      const params = new URLSearchParams({
        bucket: activeBucket!,
        page: String(page),
        pageSize: String(CLUSTER_BUCKET_PAGE_SIZE),
      });
      if (debouncedQ) params.set("q", debouncedQ);
      const res = await fetch(`/api/seo/cluster-entries?${params}`, {
        credentials: "include",
        headers: {
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "Failed to load entries");
      }
      return res.json() as Promise<ClusterBucketEntriesResponse>;
    },
  });

  const filters: {
    bucket: ClusterFilterBucket;
    label: string;
    count: number;
    variant: "secondary" | "destructive" | "outline";
    testId: string;
  }[] = [
    {
      bucket: "unclustered",
      label: "Unclustered",
      count: stats.unclustered,
      variant: "secondary",
      testId: "stat-unclustered",
    },
    {
      bucket: "partiallySet",
      label: "Partially set",
      count: stats.partiallySet,
      variant: "secondary",
      testId: "stat-partially-set",
    },
    {
      bucket: "brokenRefs",
      label: "Broken refs",
      count: stats.brokenRefs,
      variant: stats.brokenRefs > 0 ? "destructive" : "secondary",
      testId: "stat-broken-refs",
    },
    {
      bucket: "emptyHubs",
      label: "Empty hubs",
      count: health.emptyHubCount,
      variant: "outline",
      testId: "stat-empty-hubs",
    },
    {
      bucket: "clustered",
      label: "Clustered",
      count: stats.clustered,
      variant: "outline",
      testId: "stat-clustered",
    },
  ];

  const help = activeBucket ? CLUSTER_STAT_HELP[activeBucket] : null;
  const total = entries?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (entries?.pageSize ?? CLUSTER_BUCKET_PAGE_SIZE)));
  const showAssign =
    activeBucket === "unclustered" ||
    activeBucket === "partiallySet" ||
    activeBucket === "brokenRefs";

  return (
    <div className="mb-4 space-y-3" data-testid="cluster-health-stats">
      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Cluster health filters">
        {filters.map((f) => {
          const pressed = activeBucket === f.bucket;
          return (
            <Badge
              key={f.bucket}
              variant={f.variant}
              className={cn(
                "tabular-nums cursor-pointer",
                pressed && "ring-2 ring-ring ring-offset-2 ring-offset-background",
              )}
              data-testid={f.testId}
              role="button"
              tabIndex={0}
              aria-pressed={pressed}
              aria-label={`${f.label} ${f.count}. ${pressed ? "Selected. Click to show summary." : "Click to list matching pages."}`}
              onClick={() => setActiveBucket((cur) => (cur === f.bucket ? null : f.bucket))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActiveBucket((cur) => (cur === f.bucket ? null : f.bucket));
                }
              }}
            >
              {f.label} {f.count}
            </Badge>
          );
        })}
      </div>

      {activeBucket == null ? (
        Object.keys(health.byContentType).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-1 pr-2 font-medium">Type</th>
                  <th className="text-right py-1 px-1">Uncl.</th>
                  <th className="text-right py-1 px-1">Partial</th>
                  <th className="text-right py-1 px-1">Broken</th>
                  <th className="text-right py-1 pl-1">Clustered</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(health.byContentType)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([ct, row]) => (
                    <tr key={ct} className="border-b border-border/50" data-testid={`cluster-health-type-${ct}`}>
                      <td className="py-1 pr-2 capitalize">{ct}</td>
                      <td className="text-right py-1 px-1 tabular-nums">{row.unclustered}</td>
                      <td className="text-right py-1 px-1 tabular-nums">{row.partiallySet}</td>
                      <td className="text-right py-1 px-1 tabular-nums">{row.brokenRefs}</td>
                      <td className="text-right py-1 pl-1 tabular-nums">{row.clustered + row.hub}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null
      ) : (
        <div className="space-y-3" data-testid="cluster-bucket-entries">
          {help ? (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1">
              <p className="text-sm font-medium text-foreground">{help.title}</p>
              <p className="text-sm text-muted-foreground leading-snug">{help.body}</p>
              <p className="text-[11px] text-muted-foreground pt-1">
                Advanced: classification lives in{" "}
                <code className="font-mono text-[10px]">server/seo-cluster-stats.ts</code> (
                <code className="font-mono text-[10px]">classifyClusterEntry</code>,{" "}
                <code className="font-mono text-[10px]">computeClusterHealth</code>).
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground tabular-nums">
              {entriesLoading && !entries
                ? "Loading…"
                : `${total} page${total !== 1 ? "s" : ""}${isFetching ? " · updating…" : ""}`}
            </p>
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search pages…"
              className="h-8 max-w-xs text-xs"
              data-testid="cluster-bucket-search"
              aria-label="Search pages in this bucket"
            />
          </div>

          {entriesLoading && !entries ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : total === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center" data-testid="cluster-bucket-empty">
              {debouncedQ
                ? "No matches for this search. Try a different slug, path, or keyword."
                : "No pages in this bucket right now."}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border rounded-md border border-border">
                {(entries?.items ?? []).map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                    data-testid={`cluster-bucket-row-${row.id}`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-foreground truncate">{row.slug}</span>
                        <span className="text-muted-foreground">
                          · {row.contentType} · {row.locale.toUpperCase()}
                        </span>
                      </div>
                      {row.path ? (
                        <p className="font-mono text-[11px] text-muted-foreground truncate" title={row.path}>
                          <a
                            href={row.path}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-foreground hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.path}
                          </a>
                        </p>
                      ) : null}
                      {row.main_keyword ? (
                        <p className="text-[11px] text-muted-foreground">
                          Keyword: {row.main_keyword}
                          {typeof row.kw_monthly_volume === "number" ||
                          typeof row.kw_difficulty === "number" ? (
                            <span className="text-muted-foreground/80">
                              {" "}
                              · vol{" "}
                              {typeof row.kw_monthly_volume === "number"
                                ? row.kw_monthly_volume.toLocaleString()
                                : "—"}
                              {" / "}
                              KD{" "}
                              {typeof row.kw_difficulty === "number" ? row.kw_difficulty : "—"}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                      {row.reason ? (
                        <p className="text-[11px] text-muted-foreground">
                          {row.reason === "hub_not_pillar"
                            ? "Target URL is live but not marked as a pillar hub."
                            : "Target hub URL was not found."}
                          {row.pillar_path ? (
                            <>
                              {" "}
                              <code className="font-mono">{row.pillar_path}</code>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        data-testid={`button-cluster-bucket-edit-seo-${row.slug}`}
                        disabled={!canEditSeoFor(row.contentType)}
                        title={
                          !canEditSeoFor(row.contentType)
                            ? `You need seo_edit for content type "${row.contentType}"`
                            : undefined
                        }
                        onClick={() => onEditSeo(row.contentType, row.slug, row.locale)}
                      >
                        Edit SEO
                      </Button>
                      {showAssign ? (
                        <OrphanAssignButton
                          orphan={{
                            slug: row.slug,
                            contentType: row.contentType,
                            locale: row.locale,
                          }}
                          clusters={clusters as SeoOverview["clusters"]}
                        />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>

              {totalPages > 1 ? (
                <div
                  className="flex flex-wrap items-center justify-between gap-3"
                  data-testid="cluster-bucket-pagination"
                >
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Page {page} of {totalPages}
                  </span>
                  <Pagination className="mx-0 w-auto justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          aria-disabled={page <= 1}
                          className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            if (page > 1) setPage((p) => p - 1);
                          }}
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          aria-disabled={page >= totalPages}
                          className={page >= totalPages ? "pointer-events-none opacity-50" : undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            if (page < totalPages) setPage((p) => p + 1);
                          }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function parseSeoIndexEntryId(
  entry: string | undefined,
): { contentType: string; slug: string; locale: string } | null {
  if (!entry) return null;
  const parts = entry.split("/").filter(Boolean);
  if (parts.length < 3) return null;
  const locale = parts[parts.length - 1]!;
  const slug = parts[parts.length - 2]!;
  const contentType = parts.slice(0, -2).join("/");
  if (!contentType || !slug || !locale) return null;
  return { contentType, slug, locale };
}

function IndexWarningsPanel({
  onOpenSiteMeta,
}: {
  onOpenSiteMeta: (target: { contentType: string; slug: string; locale: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<{
    issues: SeoClusterIssueRow[];
  }>({
    queryKey: ["/api/validation/cache-issues", "seo-cluster"],
    queryFn: async () => {
      const token = getDebugToken();
      const res = await fetch("/api/validation/cache-issues?validator=seo-cluster", {
        headers: {
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error("Failed to load seo-cluster issues");
      return res.json() as Promise<{ issues: SeoClusterIssueRow[] }>;
    },
  });
  const issues = data?.issues ?? [];
  if (!isLoading && !issues.length) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-4">
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-auto min-h-8 py-1.5 text-xs w-full justify-between gap-2 whitespace-normal text-left"
          data-testid="button-index-warnings"
        >
          <span>Configuration issues in the site’s internal SEO index</span>
          <Badge variant="secondary" className="shrink-0">
            {isLoading ? "…" : issues.length}
          </Badge>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-2" data-testid="index-warnings-list">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          These rows come from the diagnostics validation cache (
          <code className="font-mono text-[10px]">seo-cluster</code>
          ), not Google Search Console. Fix via site meta; run Refresh stale / Hard refresh on
          Diagnostics if the list looks out of date.
        </p>
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="px-0 h-auto text-[11px]">
              Read more (advanced)
              <ChevronDown className="h-3 w-3 ml-1" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1 space-y-0.5 font-mono text-[10px] text-muted-foreground">
            <p>scripts/validation/validators/seo-cluster.ts</p>
            <p>scripts/validation/shared/seoValidationScope.ts</p>
            <p>{"{contentRoot}/validation-cache.json"}</p>
            <p>GET /api/validation/cache-issues?validator=seo-cluster</p>
          </CollapsibleContent>
        </Collapsible>
        {isLoading ? (
          <p className="text-[11px] text-muted-foreground">Loading cluster issues…</p>
        ) : (
          <ul className="space-y-2">
            {issues.map((w, i) => {
              const help = SEO_CLUSTER_ISSUE_HELP[w.code];
              const target = parseSeoIndexEntryId(w.entryKey);
              return (
                <li
                  key={`${w.code}-${w.entryKey ?? i}`}
                  className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-[11px] font-medium text-foreground">
                        {help?.title ?? w.code}
                        {w.entryKey ? (
                          <span className="font-normal text-muted-foreground"> · {w.entryKey}</span>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        {help?.body ?? w.message ?? "Check the entry’s seo.* fields."}
                        {w.message && help ? ` ${w.message}` : ""}
                      </p>
                      <p className="text-[10px] font-mono text-muted-foreground/80">{w.code}</p>
                    </div>
                    {target ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 shrink-0 gap-1 px-2 text-[10px]"
                        data-testid={`button-open-site-meta-${w.code}-${target.slug}-${target.locale}`}
                        onClick={() => onOpenSiteMeta(target)}
                      >
                        Open site meta to fix it
                        <ArrowRight className="!size-3" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

async function putSeoPillarPath(opts: {
  contentType: string;
  slug: string;
  locale: string;
  pillarPath: string;
}): Promise<void> {
  const token = getDebugToken();
  const author = await resolveAuthorName();
  const res = await fetch(
    `/api/content-types/${encodeURIComponent(opts.contentType)}/field-overrides/${encodeURIComponent(opts.slug)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...getSessionHeaders(),
        ...(token ? { Authorization: `Token ${token}` } : {}),
      },
      body: JSON.stringify({
        locale: opts.locale,
        fields: { "seo.pillar_path": opts.pillarPath },
        author: author || undefined,
      }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = (err as { error?: string }).error || "Failed to update cluster";
    if (message.toLowerCase().includes("locale file not found") || message.includes("seo_file_missing")) {
      throw new Error("This entry has no locale YAML — open it in the editor first.");
    }
    throw new Error(message);
  }
}

type GscIndexChipState = "indexed" | "not-indexed" | "unknown" | "stale" | "not-configured" | "error";

function gscIndexChipLabel(gscStatus: ClusterEntryInfo["gscStatus"]): string {
  if (!gscStatus?.configured) return "GSC not configured";
  if (!gscStatus.record) return "Unknown";
  if (gscStatus.stale) return "Stale";
  const headline = gscHeadline(gscStatus.record);
  if (headline === "Indexed") return "Indexed";
  if (headline === "Never checked") return "Unknown";
  return headline;
}

function gscIndexChipState(gscStatus: ClusterEntryInfo["gscStatus"]): GscIndexChipState {
  if (!gscStatus?.configured) return "not-configured";
  if (!gscStatus.record) return "unknown";
  if (gscStatus.stale) return "stale";
  const headline = gscHeadline(gscStatus.record);
  if (headline === "Indexed") return "indexed";
  if (headline === "Not indexed") return "not-indexed";
  if (headline === "Error") return "error";
  return "unknown";
}

function gscIndexChipClass(state: GscIndexChipState): string {
  if (state === "indexed") return "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (state === "not-indexed") return "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400";
  if (state === "error") return "border-transparent bg-destructive/15 text-destructive";
  if (state === "stale") return "border-transparent bg-muted text-muted-foreground";
  if (state === "not-configured") return "border-transparent bg-muted text-muted-foreground opacity-60";
  return "border-transparent bg-muted text-muted-foreground";
}

function GscIndexChipIcon({ state }: { state: GscIndexChipState }) {
  const className = "h-3 w-3";
  if (state === "indexed") return <Bot className={className} aria-hidden />;
  if (state === "not-indexed" || state === "error") return <BotOff className={className} aria-hidden />;
  return <Bot className={className} aria-hidden />;
}

function formatLastmodAgo(lastmod: string, now = new Date()): string {
  const day = lastmod.split("T")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return lastmod;
  const then = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(then)) return lastmod;
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((nowDay - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (days < 60) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

function ClusterMemberLastmod({ lastmod, prefix }: { lastmod: string; prefix?: string }) {
  const stale = isSitemapLastmodStale(lastmod);
  const day = lastmod.split("T")[0];
  return (
    <span
      className={cn(
        "text-xs font-normal shrink-0 whitespace-nowrap",
        stale ? "text-amber-500 dark:text-amber-400" : "text-foreground",
      )}
      title={stale ? `Sitemap lastmod ${day} from editorial updated_at — older than 2 weeks` : `Sitemap lastmod ${day} from editorial updated_at`}
      data-testid="text-cluster-slug-lastmod"
    >
      {prefix}
      {formatLastmodAgo(lastmod)}
    </span>
  );
}

function ClusterGscIndexChip({
  entryPath,
  gscStatus,
  gscConfigured,
}: {
  entryPath: string;
  gscStatus?: ClusterEntryInfo["gscStatus"];
  gscConfigured?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const configured = gscStatus?.configured ?? gscConfigured ?? false;
  const resolvedStatus = gscStatus ?? { configured, record: null, stale: true };
  const label = gscIndexChipLabel(resolvedStatus);
  const state = gscIndexChipState(resolvedStatus);
  const inspectMutation = useMutation({
    mutationFn: async () => {
      const token = getDebugToken();
      const res = await fetch("/api/debug/gsc-inspection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify({ urls: [entryPath], force: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Inspect failed");
      }
      return body;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/seo/entry"] });
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center rounded-md border h-5 w-5 shrink-0",
            gscIndexChipClass(state),
          )}
          disabled={!entryPath}
          data-testid="chip-cluster-gsc-index"
          title={label}
          aria-label={`Google index status: ${label}`}
          onClick={(e) => e.stopPropagation()}
        >
          <GscIndexChipIcon state={state} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 space-y-2 bg-popover text-popover-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {!configured ? (
          <p className="text-xs text-muted-foreground">
            Search Console is not configured. Set credentials and site URL in settings.
          </p>
        ) : (
          <>
            <p className="text-xs text-foreground">
              {gscStatus?.record?.inspectedAt
                ? `Last checked ${new Date(gscStatus.record.inspectedAt).toLocaleString()}`
                : "This URL has not been inspected yet."}
            </p>
            {gscStatus?.record?.coverageState ? (
              <p className="text-[11px] text-muted-foreground">{gscStatus.record.coverageState}</p>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              disabled={!entryPath || inspectMutation.isPending}
              onClick={() => inspectMutation.mutate()}
              data-testid="button-cluster-check-google"
            >
              {inspectMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : null}
              Check Google
            </Button>
            {inspectMutation.isError ? (
              <p className="text-[11px] text-destructive">
                {inspectMutation.error instanceof Error
                  ? inspectMutation.error.message
                  : "Inspect failed"}
              </p>
            ) : null}
            <p className="text-[10px] text-muted-foreground">
              Re-inspects via Search Console. For bulk scans use Inspect URLs above.
            </p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ClusterMissingLinksPanel({ hubId }: { hubId: string }) {
  const { data, isLoading, isError } = useQuery<ClusterDiagnosticsResult>({
    queryKey: ["/api/seo/cluster-diagnostics", hubId],
    queryFn: async () => {
      const token = getDebugToken();
      const params = new URLSearchParams({ hubId });
      const res = await fetch(`/api/seo/cluster-diagnostics?${params}`, {
        credentials: "include",
        headers: {
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Diagnostics failed");
      }
      return res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <p className="text-[11px] text-muted-foreground pb-2 flex items-center gap-1.5" data-testid="cluster-links-scanning">
        <Loader2 className="h-3 w-3 animate-spin" />
        Scanning hub…
      </p>
    );
  }

  if (isError || data?.scanStatus === "render_failed") {
    return (
      <p className="text-[11px] text-muted-foreground pb-2" data-testid="cluster-links-scan-failed">
        Could not render the hub page for link scan. Try again after visiting the hub publicly.
      </p>
    );
  }

  if (!data?.missingLinks.length) return null;

  return (
    <div className="pb-2" data-testid="cluster-missing-links">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-transparent bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
            data-testid="badge-cluster-missing-links"
          >
            <AlertTriangle className="h-3 w-3" />
            {data.missingLinks.length} missing hub link{data.missingLinks.length !== 1 ? "s" : ""}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 bg-popover text-popover-foreground">
          <p className="text-xs text-muted-foreground mb-2">
            These members were not found as rendered <code className="font-mono text-[10px]">&lt;a href&gt;</code> on
            the hub (nav/footer links count).
          </p>
          <ul className="space-y-1 text-xs">
            {data.missingLinks.map((m) => (
              <li key={m.memberId} className="font-mono truncate" title={m.memberPath}>
                {deslugifyLabel(m.memberSlug)}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}

type ClusterPickerTarget = {
  contentType: string;
  slug: string;
  locale: string;
  pillar_path?: string | null;
  is_pillar?: boolean;
};

function ClusterMemberAssignFlow({
  hubPillarUrl,
  hubLabel,
  locale,
  excludePaths,
  excludeIds,
  onAssigned,
  trigger,
}: {
  hubPillarUrl: string;
  hubLabel?: string;
  locale: string;
  excludePaths: string[];
  excludeIds: string[];
  onAssigned: () => void;
  trigger: ReactNode;
}) {
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<{
    entry: SitemapSearchEntry;
    previousPillar: string | null;
    previousLabel: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const assignEntry = async (target: ClusterPickerTarget) => {
    setSaving(true);
    try {
      await putSeoPillarPath({
        contentType: target.contentType,
        slug: target.slug,
        locale: target.locale,
        pillarPath: hubPillarUrl,
      });
      toast({
        title: "Cluster updated",
        description: "Pending Cloud Sync — locale YAML was updated.",
      });
      onAssigned();
      setPickerOpen(false);
      setPending(null);
    } catch (err) {
      toast({
        title: "Could not add to cluster",
        description: err instanceof Error ? err.message : "Update failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSelectEntry = async (entry: SitemapSearchEntry) => {
    const contentType = entry.content_type?.trim();
    const slug = entry.slug?.trim();
    const entryLocale = entry.locale?.trim();
    if (!contentType || !slug || !entryLocale) {
      toast({
        title: "Missing entry metadata",
        description: "Pick a page with content type, slug, and locale — not URL alone.",
        variant: "destructive",
      });
      return;
    }

    try {
      const params = new URLSearchParams({ locale: entryLocale });
      const res = await fetch(
        `/api/seo/entry/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}?${params}`,
        { credentials: "include", headers: getSessionHeaders() },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Could not load entry");
      }
      const info = (await res.json()) as ClusterEntryInfo;
      if (info.is_pillar) {
        toast({
          title: "Hub pages cannot be members",
          description: "That page is itself a pillar hub.",
          variant: "destructive",
        });
        return;
      }
      const prev = info.pillar_path?.trim() || null;
      if (prev && prev !== hubPillarUrl) {
        setPending({
          entry,
          previousPillar: prev,
          previousLabel: prev,
        });
        return;
      }
      await assignEntry({
        contentType,
        slug,
        locale: entryLocale,
        pillar_path: prev,
        is_pillar: info.is_pillar,
      });
    } catch (err) {
      toast({
        title: "Could not add to cluster",
        description: err instanceof Error ? err.message : "Preflight failed",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0 bg-popover" sideOffset={4}>
          <SitemapSearch
            embedded
            value=""
            onChange={() => {}}
            locale={locale}
            showLocaleFilter={false}
            excludePaths={excludePaths}
            excludeIds={excludeIds}
            hideCustomUrl
            onSelectEntry={handleSelectEntry}
            onClose={() => setPickerOpen(false)}
            testId="cluster-add-page"
          />
        </PopoverContent>
      </Popover>

      <AlertDialog open={!!pending} onOpenChange={(v) => !v && setPending(null)}>
        <AlertDialogContent data-testid="dialog-cluster-replace-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Move to this cluster?</AlertDialogTitle>
            <AlertDialogDescription>
              This page currently belongs to another cluster ({pending?.previousLabel}). Adding it
              to {hubLabel || "this hub"} will replace that assignment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving || !pending}
              onClick={(e) => {
                e.preventDefault();
                if (!pending?.entry.content_type || !pending.entry.slug || !pending.entry.locale) return;
                void assignEntry({
                  contentType: pending.entry.content_type,
                  slug: pending.entry.slug,
                  locale: pending.entry.locale,
                });
              }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Move page"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ClusterMemberRow({
  member,
  hubPillarUrl,
  hubId,
  clusters,
  gscConfigured,
  canEditSeo,
  onEditSeo,
}: {
  member: ClusterMember;
  hubPillarUrl: string;
  hubId: string;
  clusters: SeoOverview["clusters"];
  gscConfigured?: boolean;
  canEditSeo: boolean;
  onEditSeo: (contentType: string, slug: string, locale: string) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { data, isLoading, isError, error } = useQuery<ClusterEntryInfo>({
    queryKey: ["/api/seo/entry", member.contentType, member.slug, member.locale],
    enabled: open && !!member.contentType && !!member.slug,
    staleTime: 60_000,
    queryFn: async () => {
      const params = new URLSearchParams({ locale: member.locale || "en" });
      const res = await fetch(
        `/api/seo/entry/${encodeURIComponent(member.contentType)}/${encodeURIComponent(member.slug)}?${params}`,
        { credentials: "include", headers: getSessionHeaders() },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Failed to load entry");
      }
      return res.json();
    },
  });

  const href = data?.path || member.path;
  const heading =
    data?.title || data?.page_title || deslugifyLabel(member.slug);
  const lastmod = data?.lastmod || member.lastmod || null;

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await putSeoPillarPath({
        contentType: member.contentType,
        slug: member.slug,
        locale: member.locale,
        pillarPath: "",
      });
      toast({
        title: "Removed from cluster",
        description: "Pending Cloud Sync — seo.pillar_path was cleared.",
      });
      invalidateClusterQueries(hubId);
      setRemoveOpen(false);
      setOpen(false);
    } catch (err) {
      toast({
        title: "Could not remove",
        description: err instanceof Error ? err.message : "Update failed",
        variant: "destructive",
      });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <div
          className="flex w-full items-center gap-2 py-1.5 hover:bg-muted/50 rounded-sm px-1 -mx-1 group"
          data-testid={`cluster-slug-${member.slug}`}
        >
          <PopoverTrigger asChild>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <LocaleFlag
                locale={member.locale || "en"}
                className="h-3 w-4 shrink-0 rounded-sm"
              />
              <span className="text-xs font-medium text-foreground min-w-0 flex-1 truncate">
                {deslugifyLabel(member.slug)}
              </span>
              {lastmod ? <ClusterMemberLastmod lastmod={lastmod} prefix="Last published " /> : null}
              {href ? (
                <ClusterGscIndexChip
                  entryPath={href}
                  gscStatus={data?.gscStatus}
                  gscConfigured={gscConfigured}
                />
              ) : null}
            </button>
          </PopoverTrigger>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 hover:bg-muted text-muted-foreground transition-opacity"
                aria-label="Cluster member actions"
                data-testid={`button-cluster-actions-${member.slug}`}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                data-testid={`button-cluster-edit-seo-${member.slug}`}
                disabled={!canEditSeo}
                title={
                  !canEditSeo
                    ? `You need seo_edit for content type "${member.contentType}"`
                    : undefined
                }
                onSelect={() => onEditSeo(member.contentType, member.slug, member.locale)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit SEO
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid={`button-cluster-change-${member.slug}`}
                onSelect={() => setChangeOpen(true)}
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Change cluster
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                data-testid={`button-cluster-remove-${member.slug}`}
                onSelect={() => setRemoveOpen(true)}
              >
                <Unlink className="h-3.5 w-3.5 text-destructive" />
                Remove from cluster
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <PopoverContent
          align="start"
          className="w-80 space-y-3 bg-popover text-popover-foreground"
          data-testid={`popover-cluster-entry-${member.slug}`}
        >
          {isLoading ? (
            <div className="space-y-2" data-testid="cluster-entry-loading">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : isError ? (
            <p className="text-xs text-destructive" data-testid="cluster-entry-error">
              {error instanceof Error ? error.message : "Could not load this entry."}
            </p>
          ) : (
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-foreground leading-snug" data-testid="text-cluster-entry-title">
                  {heading}
                </p>
                {data?.description ? (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{data.description}</p>
                ) : null}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Type</dt>
                <dd className="text-foreground truncate">{data?.contentType || member.contentType}</dd>
                <dt className="text-muted-foreground">Locale</dt>
                <dd className="text-foreground uppercase">{data?.locale || member.locale}</dd>
                {(data?.main_keyword || member.keyword) && (
                  <>
                    <dt className="text-muted-foreground">Keyword</dt>
                    <dd className="text-foreground truncate">{data?.main_keyword || member.keyword}</dd>
                  </>
                )}
                {typeof data?.kw_monthly_volume === "number" ? (
                  <>
                    <dt className="text-muted-foreground">Monthly volume</dt>
                    <dd className="text-foreground">{data.kw_monthly_volume.toLocaleString()}</dd>
                  </>
                ) : null}
                {typeof data?.kw_difficulty === "number" ? (
                  <>
                    <dt className="text-muted-foreground">Difficulty</dt>
                    <dd className="text-foreground">{data.kw_difficulty}</dd>
                  </>
                ) : null}
                {href ? (
                  <>
                    <dt className="text-muted-foreground">Path</dt>
                    <dd className="text-foreground font-mono truncate" title={href}>{href}</dd>
                  </>
                ) : null}
                {lastmod ? (
                  <>
                    <dt className="text-muted-foreground">Lastmod</dt>
                    <dd>
                      <ClusterMemberLastmod lastmod={lastmod} />
                    </dd>
                  </>
                ) : null}
                {href ? (
                  <>
                    <dt className="text-muted-foreground">Google</dt>
                    <dd>
                      <ClusterGscIndexChip
                        entryPath={href}
                        gscStatus={data?.gscStatus}
                        gscConfigured={gscConfigured}
                      />
                    </dd>
                  </>
                ) : null}
              </dl>
              {data?.is_pillar ? (
                <Badge variant="secondary" className="text-[10px]">Pillar</Badge>
              ) : null}
              {data?.file ? (
                <p className="text-[11px] text-muted-foreground font-mono truncate" title={data.file}>
                  {formatSitePath(data.file)}
                </p>
              ) : null}
            </div>
          )}
          {href ? (
            <Button asChild size="sm" className="w-full" data-testid={`button-cluster-entry-url-${member.slug}`}>
              <a href={href} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open page
              </a>
            </Button>
          ) : (
            <Button size="sm" className="w-full" disabled data-testid={`button-cluster-entry-url-${member.slug}`}>
              <ExternalLink className="h-3.5 w-3.5" />
              Open page
            </Button>
          )}
        </PopoverContent>
      </Popover>

      <AssignClusterDialog
        open={changeOpen}
        onOpenChange={setChangeOpen}
        entry={member}
        clusters={clusters}
        excludePillarUrl={hubPillarUrl}
        title="Change cluster"
        descriptionPrefix="Pick a new hub"
        successTitle="Moved to cluster"
        testIdPrefix="cluster-change"
        onAssigned={() => {
          invalidateClusterQueries(hubId);
          setOpen(false);
        }}
      />

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent data-testid={`dialog-cluster-remove-${member.slug}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from cluster?</AlertDialogTitle>
            <AlertDialogDescription>
              This page will no longer belong to this cluster. Its{" "}
              <code className="font-mono text-xs">seo.pillar_path</code> field will be cleared.
              Internal links between the hub and this page are not changed automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void handleRemove();
              }}
            >
              {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AssignClusterDialog({
  open,
  onOpenChange,
  entry,
  clusters,
  excludePillarUrl,
  title,
  descriptionPrefix,
  successTitle,
  testIdPrefix,
  onAssigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: { slug: string; contentType: string; locale?: string };
  clusters: SeoOverview["clusters"];
  excludePillarUrl?: string;
  title: string;
  descriptionPrefix: string;
  successTitle: string;
  testIdPrefix: string;
  onAssigned?: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const locale = entry.locale || "en";
  const hubs = clusters.filter(
    (c) =>
      (c.locale || "en") === locale &&
      (!excludePillarUrl || c.pillarUrl !== excludePillarUrl),
  );

  const assignToHub = async (pillarUrl: string) => {
    if (!entry.contentType || !entry.slug) {
      toast({
        title: "Missing entry metadata",
        description: "This page is missing content type or slug.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await putSeoPillarPath({
        contentType: entry.contentType,
        slug: entry.slug,
        locale,
        pillarPath: pillarUrl,
      });
      toast({
        title: successTitle,
        description: "Pending Cloud Sync — seo.pillar_path was updated.",
      });
      onAssigned?.();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not assign cluster",
        description: err instanceof Error ? err.message : "Update failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-sm bg-background text-foreground"
        data-testid={`dialog-${testIdPrefix}-${entry.slug}`}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {descriptionPrefix} ({locale.toUpperCase()}) for{" "}
            <span className="font-medium text-foreground">{deslugifyLabel(entry.slug)}</span>.
          </DialogDescription>
        </DialogHeader>
        {hubs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {excludePillarUrl
              ? "No other pillar hubs found for this locale."
              : "No pillar hubs found for this locale."}
          </p>
        ) : (
          <ScrollArea className="max-h-56">
            <div className="space-y-1 pr-2">
              {hubs.map((hub) => (
                <button
                  key={hub.hubId || hub.pillarUrl}
                  type="button"
                  disabled={saving}
                  className="w-full text-left rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted/50 disabled:opacity-50"
                  onClick={() => void assignToHub(hub.pillarUrl)}
                  data-testid={`${testIdPrefix}-hub-option-${hub.hubId || hub.pillarUrl}`}
                >
                  <span className="font-medium block">
                    {clusterListLabel(hub.keyword, hub.pillarUrl)}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground truncate block">
                    {hub.pillarUrl}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrphanAssignButton({
  orphan,
  clusters,
}: {
  orphan: { slug: string; contentType: string; locale?: string };
  clusters: SeoOverview["clusters"];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen(true)}
        data-testid={`button-orphan-assign-${orphan.slug}`}
      >
        Assign to cluster
      </Button>
      <AssignClusterDialog
        open={open}
        onOpenChange={setOpen}
        entry={orphan}
        clusters={clusters}
        title="Assign to cluster"
        descriptionPrefix="Pick a hub"
        successTitle="Assigned to cluster"
        testIdPrefix="orphan-assign"
        onAssigned={() => invalidateClusterQueries()}
      />
    </>
  );
}

interface SeoOverview {
  intentDistribution: Record<string, Record<string, number>>;
  clusters: {
    pillarUrl: string;
    clusterSlugs: string[];
    clusterCount: number;
    hubId?: string;
    keyword?: string | null;
    locale?: string;
    members?: ClusterMember[];
  }[];
  clusterHealth?: ClusterHealth;
  orphanPages: {
    slug: string;
    contentType: string;
    intent: string;
    filePath: string;
    locale?: string;
    pillar_path?: string;
    reason?: "hub_not_found" | "hub_not_pillar";
  }[];
  featureCoverage: Record<string, number>;
  faqCoverage: { slug: string; contentType: string; locale: string; faqCount: number }[];
  schemaCoverage: Record<string, number>;
  totals: {
    totalPages: number;
    withPillar: number;
    withIntent: number;
    withFocusFeatures: number;
    withFaq: number;
    withSchema: number;
    withKeyword?: number;
  };
}

interface BrandContext {
  brand?: { name?: string; tagline?: string; mission?: string };
  voice?: { tone?: string; style?: string; personality?: string };
  key_differentiators?: string[];
  forbidden_phrases?: { phrase: string; reason: string }[];
  target_audience?: {
    primary?: { description?: string; age_range?: string; motivations?: string[]; concerns?: string[] };
  };
}

const INTENT_LABELS: Record<string, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  decision: "Decision",
  "post-enrollment": "Post-Enroll",
  unknown: "Unknown",
};

const INTENT_COLORS: Record<string, string> = {
  awareness: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  consideration: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  decision: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "post-enrollment": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  unknown: "bg-muted text-muted-foreground",
};

const ALL_INTENTS = ["awareness", "consideration", "decision", "post-enrollment"];
const ALL_FEATURES: Record<string, string> = {
  mentorship: "1-on-1 Mentorship",
  job_guarantee: "Job Guarantee",
  flexible_schedule: "Flexible Schedule",
  financing: "Financing & ISA",
  community: "Alumni Community",
  portfolio: "Real Portfolio",
  career_support: "Career Support",
  multilingual: "Multilingual",
};

function SeoOverviewCollapsibleCard({
  title,
  icon,
  titleExtra,
  summary,
  actions,
  alwaysVisible,
  children,
  className,
  testId,
  contentClassName,
  toggleTestId,
}: {
  title: ReactNode;
  icon?: ReactNode;
  titleExtra?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  alwaysVisible?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
  contentClassName?: string;
  toggleTestId?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={className} data-testid={testId}>
        <CardHeader className="pb-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="text-left rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-expanded={open}
                    data-testid={toggleTestId}
                  >
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      {icon}
                      {title}
                    </CardTitle>
                  </button>
                </CollapsibleTrigger>
                {titleExtra}
              </div>
              {summary ? (
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full text-left rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-expanded={open}
                  >
                    <p className="text-xs text-muted-foreground tabular-nums">{summary}</p>
                  </button>
                </CollapsibleTrigger>
              ) : null}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {actions}
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-expanded={open}
                  aria-label={open ? "Collapse section" : "Expand section"}
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform duration-200",
                      open && "rotate-180",
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
          {alwaysVisible}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className={cn("pt-0", contentClassName)}>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

type SeoReindexResponse = {
  ok: boolean;
  entries: number;
  clusters: number;
  orphans: number;
  warnings: number;
  durationMs: number;
};

function ClusterReindexButton() {
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const reindexMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequestWithAuth("POST", "/api/seo/reindex");
      return res.json() as Promise<SeoReindexResponse>;
    },
    onSuccess: (result) => {
      invalidateClusterQueries();
      toast({
        title: "SEO index rebuilt",
        description: `${result.entries} entries, ${result.clusters} clusters, ${result.orphans} broken refs — in ${(result.durationMs / 1000).toFixed(1)}s.`,
      });
    },
    onError: (e) => {
      toast({
        title: "Re-index failed",
        description: e instanceof Error ? e.message : "Could not rebuild the SEO index.",
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        disabled={reindexMutation.isPending}
        onClick={() => setConfirmOpen(true)}
        data-testid="button-cluster-reindex"
      >
        {reindexMutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        Re-index
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-cluster-reindex">
          <AlertDialogHeader>
            <AlertDialogTitle>Rebuild the SEO index?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Re-indexing rescans every content YAML file and rebuilds the cached SEO index
                  that powers this page — cluster memberships, pillar assignments, and the health
                  counts above.
                </p>
                <p>
                  The cache only updates automatically when pages are saved through the app. Edits
                  made outside it (git pulls, scripts, manual file changes) can leave these stats
                  out of sync until a rebuild runs.
                </p>
                <p className="text-muted-foreground">
                  It is safe and non-destructive — no content is modified. It usually takes a few
                  seconds, up to about a minute on large sites. The stats refresh automatically
                  when it finishes.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                reindexMutation.mutate();
              }}
              data-testid="button-cluster-reindex-confirm"
            >
              Rebuild index
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StatCard({
  label,
  value,
  total,
  icon,
  warning,
  notice,
  subline,
  testId,
  dual = false,
}: {
  label: string;
  value: number;
  total?: number;
  icon?: ReactNode;
  warning?: string;
  notice?: string;
  subline?: string;
  testId?: string;
  dual?: boolean;
}) {
  const pct = total && total > 0 ? Math.round((value / total) * 100) : null;
  const slug = testId ?? `stat-card-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <Card data-testid={slug}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {dual && total != null ? (
              <p className="text-2xl font-bold text-foreground tabular-nums">
                {value}
                <span className="text-muted-foreground font-medium text-lg"> / {total}</span>
              </p>
            ) : (
              <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            {warning ? (
              <Badge variant="destructive" className="mt-1 text-[10px]" data-testid={`${slug}-warning`}>
                {warning}
              </Badge>
            ) : null}
            {notice ? (
              <Badge variant="secondary" className="mt-1 text-[10px]" data-testid={`${slug}-notice`}>
                {notice}
              </Badge>
            ) : null}
            {subline ? (
              <p className="text-[11px] text-muted-foreground mt-1">{subline}</p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1">
            {icon && <span className="text-muted-foreground">{icon}</span>}
            {pct !== null && (
              <span className="text-xs text-muted-foreground">{pct}%</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingSection() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

const GSC_INSPECT_MAX_PER_JOB = 2000;
const GSC_INSPECT_INTERVAL_SEC = 1.5;

function gscInspectJobSize(count: number): number {
  return Math.min(Math.max(0, count), GSC_INSPECT_MAX_PER_JOB);
}

function gscInspectDurationLabel(count: number): string {
  const sec = Math.ceil(gscInspectJobSize(count) * GSC_INSPECT_INTERVAL_SEC);
  if (sec < 60) return `~${sec}s`;
  const min = Math.ceil(sec / 60);
  return `~${min} min`;
}

function SearchConsoleCoverageCard({
  configured,
  summary,
}: {
  configured?: boolean;
  summary?: GscInspectionSummary;
}) {
  const [openList, setOpenList] = useState<string | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pullConfirmOpen, setPullConfirmOpen] = useState(false);
  const [mode, setMode] = useState<GscInspectMode>("never");
  const [starting, setStarting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { toast } = useToast();
  const { hasCapability } = useDebugAuth();
  const canEdit = hasCapability("seo_settings");
  const isDev = import.meta.env.DEV;
  const types = summary ? Object.keys(summary.byContentType).sort() : [];
  const inspected = summary?.inspected ?? 0;
  const neverChecked = summary?.neverChecked ?? 0;
  const staleCount = summary?.stale ?? 0;
  const sitemapCount = summary?.sitemapCount ?? 0;
  const wasRunning = useRef(false);

  const { data: queue } = useQuery<GscInspectQueueStats>({
    queryKey: ["/api/debug/gsc-inspection/queue"],
    queryFn: async () => {
      const token = getDebugToken();
      const res = await fetch("/api/debug/gsc-inspection/queue", {
        headers: {
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error("Failed to load inspect queue");
      return res.json() as Promise<GscInspectQueueStats>;
    },
    enabled: configured === true,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.running ? 1500 : false),
  });

  useEffect(() => {
    if (queue?.running) {
      wasRunning.current = true;
      return;
    }
    if (wasRunning.current) {
      wasRunning.current = false;
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection"] });
    }
  }, [queue?.running]);

  useEffect(() => {
    if (!queue?.running) return;
    const id = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection"] });
    }, 4000);
    return () => window.clearInterval(id);
  }, [queue?.running]);

  const running = Boolean(queue?.running);
  const processed = (queue?.completed ?? 0) + (queue?.failed ?? 0);
  const totalQueued = queue?.queued ?? 0;
  const progressPct = totalQueued > 0 ? Math.min(100, Math.round((processed / totalQueued) * 100)) : 0;
  const neverJob = gscInspectJobSize(neverChecked);
  const staleJob = gscInspectJobSize(staleCount);
  const allJob = gscInspectJobSize(sitemapCount);
  const selectedCount = mode === "never" ? neverJob : mode === "stale" ? staleJob : allJob;
  const inspectDisabled = !configured || running;
  const pullDisabled = running || pulling;

  async function startInspect() {
    if (inspectDisabled || starting || selectedCount === 0) return;
    setStarting(true);
    try {
      const res = await apiRequestWithAuth("POST", "/api/debug/gsc-inspection/enqueue", { mode });
      const body = (await res.json()) as GscInspectEnqueueResponse;
      queryClient.setQueryData(["/api/debug/gsc-inspection/queue"], body.queue);
      setDialogOpen(false);
      if (body.queued === 0) {
        toast({
          title: "Nothing to inspect",
          description:
            mode === "never"
              ? "Every public sitemap URL already has a cache row. Use Stale to refresh rows older than 7 days, or All to recrawl."
              : mode === "stale"
                ? "No public sitemap URLs are missing or older than 7 days. Use All to recrawl everything."
                : "No public sitemap URLs to inspect.",
        });
        return;
      }
      toast({
        title: "Inspect URLs started",
        description: body.capped
          ? `Queued the first ${body.queued} URLs (cap ${GSC_INSPECT_MAX_PER_JOB}).`
          : `Queued ${body.queued} URLs in the background.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const already = message.includes("inspect_already_running") || message.startsWith("409:");
      toast({
        title: already ? "Inspect already running" : "Could not start inspect",
        description: already
          ? "Wait for the current job to finish. Test connection and Crawlers still work."
          : message,
        variant: "destructive",
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection/queue"] });
    } finally {
      setStarting(false);
    }
  }

  async function stopInspect() {
    if (!running || stopping) return;
    setStopping(true);
    try {
      const res = await apiRequestWithAuth("POST", "/api/debug/gsc-inspection/cancel");
      const body = (await res.json()) as {
        stopped?: boolean;
        queue?: GscInspectQueueStats;
        message?: string;
      };
      if (body.queue) {
        queryClient.setQueryData(["/api/debug/gsc-inspection/queue"], body.queue);
      }
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection/queue"] });
      toast({
        title: body.stopped ? "Inspect stopped" : "Nothing to stop",
        description:
          body.message ??
          (body.stopped
            ? "Rows already written were kept. Use Never inspected to continue."
            : "No inspect job was running."),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: "Could not stop inspect",
        description: message,
        variant: "destructive",
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection/queue"] });
    } finally {
      setStopping(false);
    }
  }

  async function pullProductionCache() {
    if (pullDisabled) return;
    setPulling(true);
    try {
      const res = await apiRequestWithAuth("POST", "/api/debug/gsc-inspection/pull-from-gcs");
      const body = (await res.json()) as {
        success?: boolean;
        recordCount?: number;
        gcsKey?: string;
        message?: string;
        error?: string;
      };
      setPullConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection"] });
      toast({
        title: "Production cache loaded",
        description:
          body.message ??
          `Loaded ${body.recordCount ?? 0} inspection row(s) from GCS into local .cache.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: "Could not load production cache",
        description: message,
        variant: "destructive",
      });
    } finally {
      setPulling(false);
    }
  }

  const collapsedSummary =
    configured === false
      ? "Not configured"
      : !summary || inspected === 0
        ? "No URLs inspected yet"
        : `${summary.indexed} indexed · ${summary.notIndexed} not indexed · ${summary.neverChecked} never checked`;

  const gscActions = (
    <>
      {isDev && canEdit ? (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={pullDisabled}
          onClick={() => setPullConfirmOpen(true)}
          data-testid="button-gsc-pull-production"
        >
          {pulling ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Loading…
            </>
          ) : (
            <>
              <DownloadCloud className="h-3.5 w-3.5 mr-1.5" />
              Load production
            </>
          )}
        </Button>
      ) : null}
      {canEdit ? (
        running ? (
          <Button
            size="sm"
            variant="destructive"
            className="shrink-0"
            disabled={stopping}
            onClick={() => void stopInspect()}
            data-testid="button-gsc-inspect-stop"
          >
            {stopping ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Stopping…
              </>
            ) : (
              "Stop"
            )}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            disabled={inspectDisabled}
            onClick={() => {
              setMode(neverChecked > 0 ? "never" : staleCount > 0 ? "stale" : "all");
              setDialogOpen(true);
            }}
            data-testid="button-gsc-inspect-urls"
          >
            Inspect URLs
          </Button>
        )
      ) : null}
    </>
  );

  const gscProgress =
    running && queue ? (
      <div className="space-y-1.5" data-testid="progress-gsc-inspect-queue">
        <Progress value={progressPct} className="h-2" />
        <p className="text-xs text-muted-foreground tabular-nums">
          {processed} of {totalQueued} done
          {queue.failed > 0 ? ` · ${queue.failed} failed` : ""}
          {queue.active ? ` · inspecting ${queue.active}` : ""}
          {queue.mode ? ` · ${gscInspectModeLabel(queue.mode)}` : ""}
        </p>
      </div>
    ) : null;

  return (
    <>
    <SeoOverviewCollapsibleCard
      testId="card-search-console-coverage"
      toggleTestId="button-toggle-search-console-coverage"
      icon={<Globe className="h-4 w-4" />}
      title="Search Console coverage"
      summary={collapsedSummary}
      actions={gscActions}
      alwaysVisible={gscProgress}
      contentClassName="space-y-3"
    >
        <p className="text-xs text-muted-foreground">
          Inspect URLs walks the sitemap in the background (one Google call at a time, process-wide, ~1.5s
          apart, max {GSC_INSPECT_MAX_PER_JOB}). It does not re-index and does not freeze the site. Cached
          results are not a live crawl. Production restarts load the sidecar from GCS, then{" "}
          <code className="font-mono text-[10px]">.cache</code> — they still do not call Google. The inspect
          queue is process-local and is not stored in GCS.{" "}
          <Link href="/private/settings/seo/search-console" className="underline underline-offset-2 hover:text-foreground">
            SEO/GEO → Search Console
          </Link>
        </p>
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="px-0 h-auto text-xs" data-testid="button-gsc-inspect-read-more">
              Read more (advanced)
              <ChevronDown className={`h-3.5 w-3.5 ml-1 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1 space-y-1 text-xs text-muted-foreground">
            <p>
              Never inspected = no cache row yet (use after a mid-run redeploy or after Stop). Stale = no row or
              inspected more than 7 days ago. All = every sitemap URL, including the last hour. Stop drops the
              remaining queue; rows already written stay. A permission error also stops the job. Restart drops
              the queue — Never inspected continues missing rows. Single-page inspect (Test connection /
              Crawlers) still works during a run. Disabled until property + GCS_CREDENTIALS_JSON are set. Dual
              write in production: local disk, then GCS after ~30s.
              {isDev
                ? " Load production (dev only) overwrites local .cache from GCS; it does not upload and does not call Google."
                : ""}
            </p>
            <p className="font-mono">server/gsc-inspect-queue.ts</p>
            <p className="font-mono">server/gsc-url-inspection.ts</p>
            <p className="font-mono">shared/gcsKeys.ts</p>
            <p className="font-mono">.cache/{"{site}"}/gsc-url-inspection.json</p>
            <p className="font-mono">{"{site}"}/sync/gsc-url-inspection.json</p>
            <p className="font-mono">POST /api/debug/gsc-inspection/cancel</p>
            {isDev ? (
              <p className="font-mono">POST /api/debug/gsc-inspection/pull-from-gcs</p>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
        {configured === true && !running ? (
          <p className="text-xs text-muted-foreground" data-testid="text-gsc-inspect-restart-hint">
            If a run was interrupted by restart, use Never inspected.
          </p>
        ) : null}
        {queue?.aborted === "permission_denied" && !running ? (
          <p className="text-xs text-destructive" data-testid="text-gsc-inspect-aborted">
            Inspect stopped: Search Console permission denied. Rows already written were kept. Fix the role on{" "}
            <Link href="/private/settings/seo/search-console" className="underline underline-offset-2">
              SEO/GEO → Search Console
            </Link>{" "}
            (role-not-set), then start again.
          </p>
        ) : null}
        {queue?.aborted === "cancelled" && !running ? (
          <p className="text-xs text-muted-foreground" data-testid="text-gsc-inspect-cancelled">
            Inspect stopped. Rows already written were kept. Use Never inspected to continue missing URLs.
          </p>
        ) : null}
        {configured === false ? (
          <p className="text-sm text-muted-foreground" data-testid="text-gsc-unconfigured">
            Search Console is not configured. Save a property in SEO/GEO → Search Console, set GCS_CREDENTIALS_JSON, and add that service account on the Search Console property.
          </p>
        ) : !summary || inspected === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-gsc-empty-sidecar">
            No URLs inspected yet. Use Inspect URLs, check a page from diagnostics, or Test connection in settings.
            {isDev ? " Or Load production to copy the GCS sidecar into local .cache." : ""}
          </p>
        ) : null}
        {configured !== false && summary ? (
          <>
            <div className="flex flex-wrap gap-2 text-xs" data-testid="gsc-funnel">
              <StatHelpBadge
                label="In sitemap"
                count={summary.sitemapCount}
                help={GSC_STAT_HELP.inSitemap}
                variant="secondary"
                testId="stat-gsc-in-sitemap"
              />
              <StatHelpBadge
                label="Inspected"
                count={summary.inspected}
                help={GSC_STAT_HELP.inspected}
                variant="secondary"
                testId="stat-gsc-inspected"
              />
              <StatHelpBadge
                label="Indexed"
                count={summary.indexed}
                help={GSC_STAT_HELP.indexed}
                variant="secondary"
                testId="stat-gsc-indexed"
              />
              <StatHelpBadge
                label="Not indexed"
                count={summary.notIndexed}
                help={GSC_STAT_HELP.notIndexed}
                variant="secondary"
                testId="stat-gsc-not-indexed"
              />
              <StatHelpBadge
                label="Errors"
                count={summary.errors}
                help={GSC_STAT_HELP.errors}
                variant="secondary"
                testId="stat-gsc-errors"
              />
              <StatHelpBadge
                label="Never checked"
                count={summary.neverChecked}
                help={GSC_STAT_HELP.neverChecked}
                variant="outline"
                testId="stat-gsc-never-checked"
              />
            </div>
            {types.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="gsc-coverage-table">
                  <thead>
                    <tr>
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Content Type</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">In sitemap</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">Inspected</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">Indexed</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">Not indexed</th>
                      <th className="text-center py-2 px-2 text-muted-foreground font-medium">Never checked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {types.map((ct) => {
                      const row = summary.byContentType[ct];
                      return (
                        <tr key={ct} className="border-t border-border">
                          <td className="py-2 pr-4 font-medium text-foreground capitalize">{ct}</td>
                          <td className="py-2 px-2 text-center tabular-nums">{row.inSitemap}</td>
                          <td className="py-2 px-2 text-center tabular-nums">{row.inspected}</td>
                          <td className="py-2 px-2 text-center tabular-nums">{row.indexed}</td>
                          <td className="py-2 px-2 text-center tabular-nums">{row.notIndexed}</td>
                          <td className="py-2 px-2 text-center tabular-nums">{row.neverChecked}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {(summary.exceptions.notIndexed.length > 0 || summary.exceptions.canonicalMismatch.length > 0) && (
              <Accordion type="single" collapsible value={openList} onValueChange={setOpenList}>
                {summary.exceptions.notIndexed.length > 0 && (
                  <AccordionItem value="not-indexed">
                    <AccordionTrigger className="text-xs">Not indexed ({summary.exceptions.notIndexed.length})</AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-1">
                        {summary.exceptions.notIndexed.map((row) => (
                          <li key={row.loc} className="text-xs font-mono truncate text-muted-foreground" title={row.loc}>
                            {row.loc}
                            {row.coverageState ? ` — ${row.coverageState}` : ""}
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                )}
                {summary.exceptions.canonicalMismatch.length > 0 && (
                  <AccordionItem value="canonical">
                    <AccordionTrigger className="text-xs">
                      Canonical mismatch ({summary.exceptions.canonicalMismatch.length})
                    </AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-1">
                        {summary.exceptions.canonicalMismatch.map((row) => (
                          <li key={row.loc} className="text-xs font-mono truncate text-muted-foreground" title={row.loc}>
                            {row.loc} → {row.googleCanonical}
                          </li>
                        ))}
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>
            )}
          </>
        ) : null}
    </SeoOverviewCollapsibleCard>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md bg-background text-foreground" data-testid="dialog-gsc-inspect-urls">
          <DialogHeader>
            <DialogTitle>Inspect URLs</DialogTitle>
            <DialogDescription>
              One Google call at a time (~1.5s apart), max {GSC_INSPECT_MAX_PER_JOB} per job. Does not request
              indexing. Never inspected = no cache row. Stale = no row or older than 7 days. All retries
              everything, including the last hour.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as GscInspectMode)}
            className="space-y-3"
            data-testid="radio-gsc-inspect-mode"
          >
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="never" id="gsc-inspect-never" className="mt-0.5" />
              <Label htmlFor="gsc-inspect-never" className="font-normal cursor-pointer space-y-0.5">
                <span className="block text-foreground">Never inspected</span>
                <span className="block text-xs text-muted-foreground">
                  {neverChecked} public sitemap URL{neverChecked === 1 ? "" : "s"} with no cache row
                  {neverChecked > GSC_INSPECT_MAX_PER_JOB
                    ? ` · this job will inspect the first ${GSC_INSPECT_MAX_PER_JOB} (${gscInspectDurationLabel(neverChecked)})`
                    : neverChecked > 0
                      ? ` · ${gscInspectDurationLabel(neverChecked)}`
                      : ""}
                  .
                </span>
              </Label>
            </div>
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="stale" id="gsc-inspect-stale" className="mt-0.5" />
              <Label htmlFor="gsc-inspect-stale" className="font-normal cursor-pointer space-y-0.5">
                <span className="block text-foreground">Stale (older than 7 days)</span>
                <span className="block text-xs text-muted-foreground">
                  {staleCount} public sitemap URL{staleCount === 1 ? "" : "s"} with no cache row or inspected more
                  than 7 days ago
                  {staleCount > GSC_INSPECT_MAX_PER_JOB
                    ? ` · this job will inspect the first ${GSC_INSPECT_MAX_PER_JOB} (${gscInspectDurationLabel(staleCount)})`
                    : staleCount > 0
                      ? ` · ${gscInspectDurationLabel(staleCount)}`
                      : ""}
                  .
                </span>
              </Label>
            </div>
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="all" id="gsc-inspect-all" className="mt-0.5" />
              <Label htmlFor="gsc-inspect-all" className="font-normal cursor-pointer space-y-0.5">
                <span className="block text-foreground">All</span>
                <span className="block text-xs text-muted-foreground">
                  {sitemapCount} public sitemap URL{sitemapCount === 1 ? "" : "s"}, including previous errors
                  {sitemapCount > GSC_INSPECT_MAX_PER_JOB
                    ? ` · this job will inspect the first ${GSC_INSPECT_MAX_PER_JOB} (${gscInspectDurationLabel(sitemapCount)})`
                    : sitemapCount > 0
                      ? ` · ${gscInspectDurationLabel(sitemapCount)}`
                      : ""}
                  .
                </span>
              </Label>
            </div>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={starting || selectedCount === 0 || inspectDisabled}
              onClick={() => void startInspect()}
              data-testid="button-gsc-inspect-start"
            >
              {starting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Start inspect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pullConfirmOpen} onOpenChange={setPullConfirmOpen}>
        <AlertDialogContent
          className="bg-background text-foreground"
          data-testid="dialog-gsc-pull-production"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Load production cache?</AlertDialogTitle>
            <AlertDialogDescription>
              Overwrites local{" "}
              <code className="font-mono text-xs">.cache/{"{site}"}/gsc-url-inspection.json</code> with the
              production GCS sidecar. Does not call Google and does not upload anything back to production.
              Local Inspect URLs after this still stay local-only.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pulling}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pulling}
              onClick={(e) => {
                e.preventDefault();
                void pullProductionCache();
              }}
              data-testid="button-gsc-pull-production-confirm"
            >
              {pulling ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Load production
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function DiagnosticsFunnelTab({ data }: { data: SeoOverview }) {
  const contentTypes = Object.keys(data.intentDistribution);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="funnel-totals-grid">
        <StatCard
          label="With funnel stage"
          value={data.totals.withIntent}
          total={data.totals.totalPages}
          icon={<Filter className="h-4 w-4" />}
          testId="stat-card-with-funnel-stage"
        />
      </div>

      <SeoOverviewCollapsibleCard
        testId="card-funnel-stage-distribution"
        toggleTestId="button-toggle-funnel-stage-distribution"
        icon={<Filter className="h-4 w-4" />}
        title="Funnel stage distribution"
        summary={`${data.totals.withIntent} with stage · ${Math.max(0, data.totals.totalPages - data.totals.withIntent)} unknown`}
      >
        {contentTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No funnel stage data found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="intent-distribution-table">
              <thead>
                <tr>
                  <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Content Type</th>
                  {ALL_INTENTS.map((intent) => (
                    <th key={intent} className="text-center py-2 px-2 text-muted-foreground font-medium">
                      {INTENT_LABELS[intent]}
                    </th>
                  ))}
                  <th className="text-center py-2 px-2 text-muted-foreground font-medium">Unknown</th>
                </tr>
              </thead>
              <tbody>
                {contentTypes.map((ct) => (
                  <tr key={ct} className="border-t border-border" data-testid={`intent-row-${ct}`}>
                    <td className="py-2 pr-4 font-medium text-foreground capitalize">{ct}</td>
                    {[...ALL_INTENTS, "unknown"].map((intent) => {
                      const count = data.intentDistribution[ct]?.[intent] || 0;
                      return (
                        <td key={intent} className="py-2 px-2 text-center" data-testid={`intent-cell-${ct}-${intent}`}>
                          {count > 0 ? (
                            <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${INTENT_COLORS[intent]}`}>
                              {count}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SeoOverviewCollapsibleCard>
    </div>
  );
}

export function SeoTab({ data }: { data: SeoOverview }) {
  const { toast } = useToast();
  const { hasCapability } = useDebugAuth();
  const canEditSeoFor = useCallback(
    (contentType: string) => hasCapability("seo_edit", contentType),
    [hasCapability],
  );
  const [clusterSortBy, setClusterSortBy] = useState<ClusterSortBy>("name");
  const [clusterSortDir, setClusterSortDir] = useState<ClusterSortDir>("asc");
  const [clusterLocaleFilter, setClusterLocaleFilter] = useState("");
  const [seoModalOpen, setSeoModalOpen] = useState(false);
  const [seoModalTarget, setSeoModalTarget] = useState<ManagedSeoModalTarget | null>(null);
  const [seoPickerOpen, setSeoPickerOpen] = useState(false);
  const [seoPickerPending, setSeoPickerPending] = useState<{
    contentType: string;
    slug: string;
    locale: string;
    initialTab?: SeoModalTab;
  } | null>(null);
  const { data: gsc } = useQuery<GscInspectionGetResponse>({
    queryKey: ["/api/debug/gsc-inspection"],
    queryFn: async () => {
      const token = getDebugToken();
      const res = await fetch("/api/debug/gsc-inspection", {
        headers: {
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error("Failed to load Search Console summary");
      return res.json() as Promise<GscInspectionGetResponse>;
    },
  });
  const summary = gsc?.summary;
  const withKeyword = data.totals.withKeyword ?? 0;
  const keywordedNotClustered = Math.max(0, withKeyword - data.totals.withPillar);
  const sortedClusters = [...data.clusters].sort((a, b) => {
    let cmp = 0;
    if (clusterSortBy === "page-count") {
      cmp = a.clusterCount - b.clusterCount;
      if (cmp === 0) cmp = compareClustersByName(a, b);
    } else {
      cmp = compareClustersByName(a, b);
    }
    return clusterSortDir === "asc" ? cmp : -cmp;
  });
  const filteredClusters = clusterLocaleFilter
    ? sortedClusters.filter((cluster) => (cluster.locale || "en") === clusterLocaleFilter)
    : sortedClusters;

  const beginEditSeo = useCallback(
    async (
      contentType: string,
      slug: string,
      locale: string,
      initialTab: SeoModalTab = "general",
    ) => {
      try {
        const contexts = await resolveSeoContexts(contentType, slug, locale);
        if (contexts.contexts.length <= 1) {
          const choice: SeoContextChoice =
            contexts.default ?? contexts.contexts[0] ?? { type: "live" };
          setSeoModalTarget({
            contentType,
            slug,
            locale,
            initialTab,
            variant: choice.type === "variant" ? choice.variant : undefined,
          });
          setSeoModalOpen(true);
          return;
        }
        setSeoPickerPending({ contentType, slug, locale, initialTab });
        setSeoPickerOpen(true);
      } catch (e) {
        toast({
          title: "Failed to load SEO contexts",
          description: e instanceof Error ? e.message : "Could not list LIVE/variant contexts.",
          variant: "destructive",
        });
      }
    },
    [toast],
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="seo-totals-grid">
        <StatCard
          label="Total vs Indexed pages"
          value={summary?.indexed ?? 0}
          total={data.totals.totalPages}
          dual
          icon={<Network className="h-4 w-4" />}
          warning={summary && summary.notOnSitemap > 0 ? `${summary.notOnSitemap} not on sitemap` : undefined}
          subline={
            summary
              ? `${summary.indexed} indexed · ${summary.notIndexed} not indexed · ${summary.neverChecked} never checked`
              : undefined
          }
          testId="stat-card-total-vs-indexed-pages"
        />
        <StatCard
          label="Keyworded vs Clustered"
          value={data.totals.withPillar}
          total={withKeyword}
          dual
          icon={<Network className="h-4 w-4" />}
          notice={keywordedNotClustered > 0 ? `${keywordedNotClustered} keyworded, not clustered` : undefined}
          testId="stat-card-keyworded-vs-clustered"
        />
        <StatCard label="Focus Features" value={data.totals.withFocusFeatures} total={data.totals.totalPages} icon={<Star className="h-4 w-4" />} />
      </div>

      <SearchConsoleCoverageCard configured={gsc?.configured} summary={summary} />

      <SeoOverviewCollapsibleCard
        testId="card-cluster-map"
        toggleTestId="button-toggle-cluster-map"
        icon={<Network className="h-4 w-4" />}
        title="Cluster Map"
        titleExtra={
          <Badge variant="secondary">
            {data.clusters.length} pillar{data.clusters.length !== 1 ? "s" : ""}
          </Badge>
        }
        summary={
          data.clusterHealth
            ? `${data.clusterHealth.stats.unclustered} unclustered`
            : data.clusters.length === 0
              ? "No clusters yet"
              : undefined
        }
        actions={<ClusterReindexButton />}
      >
          <ClusterMapHelp />
          {data.clusterHealth ? (
            <ClusterHealthPanel
              health={data.clusterHealth}
              clusters={data.clusters}
              canEditSeoFor={canEditSeoFor}
              onEditSeo={(contentType, slug, locale) => {
                void beginEditSeo(contentType, slug, locale, "general");
              }}
            />
          ) : null}
          <IndexWarningsPanel
            onOpenSiteMeta={({ contentType, slug, locale }) => {
              void beginEditSeo(contentType, slug, locale, "general");
            }}
          />
          {data.clusters.length === 0 ? (
            <div className="text-center py-8" data-testid="clusters-empty">
              <Network className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No clusters yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Open a page and use the SEO Meta tab: mark the hub as a pillar, then point
                supporting pages at that hub.
              </p>
            </div>
          ) : (
            <>
            <div
              className="flex items-center justify-end gap-2 mb-2"
              data-testid="cluster-sort-bar"
            >
              <SitemapLocaleFilter
                locale={clusterLocaleFilter}
                onLocaleChange={setClusterLocaleFilter}
                testId="cluster"
                title="Filter clusters by language"
                triggerClassName="h-7 w-7 rounded-md border border-border hover:bg-muted/40"
              />
              <div className="inline-flex rounded-md border border-border overflow-hidden">
                {CLUSTER_SORT_FIELDS.map((field, index) => {
                  const active = field.value === clusterSortBy;
                  return (
                    <button
                      key={field.value}
                      type="button"
                      className={cn(
                        "inline-flex items-center h-7 px-2.5 text-xs transition-colors",
                        index > 0 && "border-l border-border",
                        active
                          ? "bg-muted text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                      )}
                      aria-pressed={active}
                      data-testid={`sort-cluster-${field.value}`}
                      onClick={() => {
                        if (active) {
                          setClusterSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
                        } else {
                          setClusterSortBy(field.value);
                          setClusterSortDir(field.defaultDir);
                        }
                      }}
                    >
                      {field.label}
                      <ClusterSortIcon
                        field={field.value}
                        sortBy={clusterSortBy}
                        sortDir={clusterSortDir}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
            {filteredClusters.length === 0 ? (
              <p
                className="text-sm text-muted-foreground py-6 text-center"
                data-testid="clusters-locale-empty"
              >
                No clusters for {clusterLocaleFilter.toUpperCase()}. Clear the language filter to see
                all hubs.
              </p>
            ) : (
            <Accordion type="multiple">
              {filteredClusters
                .map((cluster) => {
                  const hubId = cluster.hubId || cluster.pillarUrl;
                  const hubLocale = cluster.locale || "en";
                  const members =
                    cluster.members && cluster.members.length > 0
                      ? cluster.members
                      : cluster.clusterSlugs.map((slug) => ({
                          id: slug,
                          slug,
                          contentType: "",
                          locale: hubLocale,
                          path: "",
                        }));
                  const excludePaths = [
                    cluster.pillarUrl,
                    ...members.map((m) => m.path).filter(Boolean),
                  ];
                  const excludeIds = members.map((m) => m.id).filter(Boolean);

                  return (
                  <AccordionItem
                    key={hubId}
                    value={hubId}
                    data-testid={`cluster-${cluster.pillarUrl}`}
                  >
                    <AccordionTrigger className="text-xs py-2 hover:no-underline">
                      <div className="flex items-center gap-2 text-left">
                        <Network className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <LocaleFlag
                          locale={hubLocale}
                          className="h-3 w-4 shrink-0 rounded-sm"
                        />
                        <span className="text-xs font-medium text-foreground">
                          {clusterListLabel(cluster.keyword, cluster.pillarUrl)}
                        </span>
                        <Badge variant="secondary" className={clusterCountBadgeClass(cluster.clusterCount)}>
                          {cluster.clusterCount} page{cluster.clusterCount !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="text-xs">
                      <ClusterPillarPath pillarUrl={cluster.pillarUrl} />
                      {hubId ? <ClusterMissingLinksPanel hubId={hubId} /> : null}
                      <div className="divide-y divide-border" data-testid="cluster-members-list">
                        {members.map((member) => (
                          <ClusterMemberRow
                            key={member.id}
                            member={member}
                            hubPillarUrl={cluster.pillarUrl}
                            hubId={hubId}
                            clusters={data.clusters}
                            gscConfigured={gsc?.configured}
                            canEditSeo={canEditSeoFor(member.contentType)}
                            onEditSeo={(contentType, slug, locale) => {
                              void beginEditSeo(contentType, slug, locale, "general");
                            }}
                          />
                        ))}
                      </div>
                      <div className="pt-2">
                        <ClusterMemberAssignFlow
                          hubPillarUrl={cluster.pillarUrl}
                          hubLabel={clusterListLabel(cluster.keyword, cluster.pillarUrl)}
                          locale={hubLocale}
                          excludePaths={excludePaths}
                          excludeIds={excludeIds}
                          onAssigned={() => invalidateClusterQueries(hubId)}
                          trigger={
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              data-testid={`button-cluster-add-page-${hubId}`}
                            >
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              Add page
                            </Button>
                          }
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                  );
                })}
            </Accordion>
            )}
            </>
          )}
      </SeoOverviewCollapsibleCard>

      <SeoOverviewCollapsibleCard
        className="col-span-12"
        testId="card-focus-feature-coverage"
        toggleTestId="button-toggle-focus-feature-coverage"
        icon={<Star className="h-4 w-4" />}
        title="Focus Feature Coverage"
        summary={`${
          Object.keys(ALL_FEATURES).filter((key) => (data.featureCoverage[key] || 0) > 0).length
        } of ${Object.keys(ALL_FEATURES).length} features used · ${data.totals.withFocusFeatures} pages tagged`}
      >
            <div className="space-y-2" data-testid="feature-coverage-list">
              {Object.entries(ALL_FEATURES).map(([key, label]) => {
                const count = data.featureCoverage[key] || 0;
                return (
                  <div key={key} className="flex items-center justify-between gap-2" data-testid={`feature-row-${key}`}>
                    <span className={`text-xs ${count === 0 ? "text-muted-foreground" : "text-foreground"}`}>{label}</span>
                    <Badge variant={count === 0 ? "outline" : "secondary"} className="text-xs tabular-nums">
                      {count}
                    </Badge>
                  </div>
                );
              })}
            </div>
      </SeoOverviewCollapsibleCard>

      <ManagedSeoModal
        open={seoModalOpen}
        onOpenChange={(open) => {
          setSeoModalOpen(open);
          if (!open) setSeoModalTarget(null);
        }}
        target={seoModalTarget}
        onSaved={() => {
          invalidateClusterQueries();
        }}
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
              initialTab: seoPickerPending.initialTab,
              variant: choice.type === "variant" ? choice.variant : undefined,
            });
            setSeoPickerOpen(false);
            setSeoPickerPending(null);
            setSeoModalOpen(true);
          }}
        />
      ) : null}
    </div>
  );
}

export function GeoTab({ data, brand }: { data: SeoOverview; brand: BrandContext | null }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="geo-totals-grid">
        <StatCard label="Total Pages" value={data.totals.totalPages} icon={<Globe className="h-4 w-4" />} />
        <StatCard label="With FAQ" value={data.totals.withFaq} total={data.totals.totalPages} icon={<Brain className="h-4 w-4" />} />
        <StatCard label="With Schema" value={data.totals.withSchema} total={data.totals.totalPages} icon={<Info className="h-4 w-4" />} />
      </div>

      {brand && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Brand Context
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {brand.brand && (
              <div data-testid="brand-identity">
                <p className="text-base font-semibold text-foreground">{brand.brand.name}</p>
                {brand.brand.tagline && (
                  <p className="text-sm text-muted-foreground italic mt-0.5">"{brand.brand.tagline}"</p>
                )}
                {brand.brand.mission && (
                  <p className="text-xs text-muted-foreground mt-1">{brand.brand.mission}</p>
                )}
              </div>
            )}

            {brand.key_differentiators && brand.key_differentiators.length > 0 && (
              <div data-testid="brand-differentiators">
                <p className="text-xs font-medium text-foreground mb-1.5">Key Differentiators</p>
                <div className="flex flex-wrap gap-1.5">
                  {brand.key_differentiators.map((d, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{d}</Badge>
                  ))}
                </div>
              </div>
            )}

            {brand.forbidden_phrases && brand.forbidden_phrases.length > 0 && (
              <div data-testid="brand-forbidden">
                <p className="text-xs font-medium text-foreground mb-1.5">Forbidden Phrases</p>
                <div className="flex flex-wrap gap-1.5">
                  {brand.forbidden_phrases.map((fp, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="text-xs text-destructive border-destructive/30"
                      title={fp.reason}
                      data-testid={`forbidden-${fp.phrase.replace(/\s+/g, "-")}`}
                    >
                      {fp.phrase}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {brand.target_audience?.primary && (
              <div data-testid="brand-audience">
                <p className="text-xs font-medium text-foreground mb-1.5">Primary Audience</p>
                <p className="text-xs text-muted-foreground">{brand.target_audience.primary.description}</p>
                {brand.target_audience.primary.concerns && (
                  <div className="mt-1.5">
                    <p className="text-xs text-muted-foreground font-medium">Common concerns:</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {brand.target_audience.primary.concerns.map((c, i) => (
                        <Badge key={i} variant="outline" className="text-xs">{c}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Brain className="h-4 w-4" />
              FAQ Coverage
              <Badge variant="secondary">{data.faqCoverage.length} pages</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.faqCoverage.length === 0 ? (
              <div className="text-center py-6" data-testid="faq-empty">
                <p className="text-sm text-muted-foreground">No FAQ sections found</p>
                <p className="text-xs text-muted-foreground mt-1">Add <code className="bg-muted px-1 rounded">type: faq</code> sections to improve AI search coverage</p>
              </div>
            ) : (
              <ScrollArea className="max-h-64">
                <div className="space-y-1.5" data-testid="faq-coverage-list">
                  {data.faqCoverage.map((f, i) => (
                    <div key={`${f.slug}-${f.locale}-${i}`} className="flex items-center justify-between gap-2 py-1 border-b border-border last:border-0" data-testid={`faq-${f.slug}-${f.locale}`}>
                      <div className="min-w-0">
                        <span className="text-xs font-mono text-foreground truncate block">{f.slug}</span>
                        <span className="text-xs text-muted-foreground">{f.locale} · {f.contentType}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">{f.faqCount} FAQ{f.faqCount !== 1 ? "s" : ""}</Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Info className="h-4 w-4" />
              Schema.org Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(data.schemaCoverage).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No schema types found</p>
            ) : (
              <div className="flex flex-wrap gap-2" data-testid="schema-distribution">
                {Object.entries(data.schemaCoverage)
                  .sort(([, a], [, b]) => b - a)
                  .map(([schemaType, count]) => (
                    <div key={schemaType} className="flex items-center gap-1.5" data-testid={`schema-type-${schemaType}`}>
                      <Badge variant="secondary" className="text-xs font-mono">{schemaType}</Badge>
                      <span className="text-xs text-muted-foreground">{count}</span>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function SeoGeoPage() {
  const { data: overview, isLoading: overviewLoading } = useQuery<SeoOverview>({
    queryKey: ["/api/seo/overview"],
  });

  const { data: brandRaw, isLoading: brandLoading } = useQuery<BrandContext>({
    queryKey: ["/api/brand-context"],
  });

  const brand = brandRaw && !("error" in brandRaw) ? brandRaw : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Tabs defaultValue="seo">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <Link href="/private/diagnostics">
                <Button variant="ghost" size="icon" data-testid="button-back-diagnostics">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <Crosshair className="h-5 w-5 text-primary" />
                <h1 className="text-lg font-semibold text-foreground" data-testid="text-seo-geo-title">
                  SEO &amp; GEO
                </h1>
              </div>
            </div>
            <ToggleButtonBarList data-testid="tabs-seo-geo">
              <ToggleButtonBarTrigger value="seo" data-testid="tab-seo">SEO</ToggleButtonBarTrigger>
              <ToggleButtonBarTrigger value="geo" data-testid="tab-geo">GEO</ToggleButtonBarTrigger>
            </ToggleButtonBarList>
          </div>

          <TabsContent value="seo">
            {overviewLoading ? (
              <LoadingSection />
            ) : overview ? (
              <SeoTab data={overview} />
            ) : (
              <p className="text-muted-foreground text-sm text-center py-12">Failed to load SEO data</p>
            )}
          </TabsContent>

          <TabsContent value="geo">
            {overviewLoading || brandLoading ? (
              <LoadingSection />
            ) : overview ? (
              <GeoTab data={overview} brand={brand} />
            ) : (
              <p className="text-muted-foreground text-sm text-center py-12">Failed to load GEO data</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
