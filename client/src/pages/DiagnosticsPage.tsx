import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {AlertTriangle, ArrowLeft, Brain, Check, CircleCheck, ChevronDown, Crosshair, DownloadCloud, Eraser, Filter, Globe, Info, Loader2, Play, RefreshCw, Save, Search, Stethoscope, Trash2, Users, Wrench, X} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ToggleButtonBarList, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";
import { formatIssueActorLine } from "@/lib/formatIssueActor";
import { formatSitePathsInText } from "@shared/formatSitePath";
import {
  parseGlobalHealthSearch,
  serializeGlobalHealthSearch,
  buildCacheIssuesQuery,
  type GlobalHealthKpi,
  type GlobalHealthScopeKey,
  type GlobalHealthViewState,
} from "@/components/diagnostics/global-health-url";
import { normalizeIssuePath } from "@shared/normalizeIssuePath";

function issueLayerLabel(entryKey?: string, file?: string): string | null {
  if (entryKey?.includes("@")) {
    const variant = entryKey.slice(entryKey.lastIndexOf("@") + 1);
    return variant ? `variant: ${variant}` : null;
  }
  const base = (file || "").split(/[/\\]/).pop() || "";
  const isVariantPath =
    /^[a-z0-9-]+\.[a-z]{2}(-[a-z]{2})?\.ya?ml$/i.test(base) ||
    /^(?:template|single)\.[a-z0-9-]+\.[a-z]{2}(-[a-z]{2})?\.ya?ml$/i.test(base);
  if (!isVariantPath) return null;
  const parts = base.replace(/\.ya?ml$/i, "").split(".");
  const variantSlug =
    (parts[0] === "single" || parts[0] === "template") && parts.length >= 3
      ? parts[1]
      : parts.length >= 2
        ? parts.slice(0, -1).join(".")
        : null;
  if (!variantSlug || variantSlug === "single" || variantSlug === "template") return null;
  return `variant: ${variantSlug}`;
}
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { MetricsAccessGate } from "@/components/MetricsAccessGate";
import LeadsTab from "@/components/diagnostics/LeadsTab";
import RuntimeIssuesTab from "@/components/diagnostics/RuntimeIssuesTab";
import { DiagnosticsSeoPanel, DiagnosticsGeoPanel, DiagnosticsFunnelPanel } from "@/components/diagnostics/DiagnosticsSeoGeoPanels";
import { SitemapSearch } from "@/components/menus/SitemapSearch";
import {
  RedirectConflictResolverModal,
  parseRedirectConflict,
  useRedirectConflictResolver,
  type ValidatorIssue,
} from "@/components/RedirectConflictResolver";

interface ValidatorResult {
  name: string;
  description: string;
  status: "passed" | "failed" | "warning";
  errors: ValidatorIssue[];
  warnings: ValidatorIssue[];
  duration: number;
  category?: string;
  artifacts?: Record<string, unknown>;
}

interface PageSummary {
  url: string;
  title: string;
  locale: string;
  contentType: string;
  slug: string;
  filePath: string;
  hasMeta: boolean;
  hasSchema: boolean;
}

interface PageDiagnostics {
  url: string;
  contentType: string;
  slug: string;
  locale: string;
  filePath: string;
  title: string;
  meta: {
    page_title: string;
    titleLength: number;
    description: string;
    descriptionLength: number;
    og_image: string;
    canonical_url: string;
    robots: string;
  };
  schema: {
    configured: boolean;
    includes: string[];
    sources?: string[];
    renderedJsonLd: object[];
    htmlPreview: string;
  };
  sections: { count: number; types: string[]; hasFaq: boolean };
  images: {
    referencedIds: string[];
    missingFromRegistry: string[];
    missingFromDisk: string[];
  };
  translations: {
    locale: string;
    availableLocales: string[];
    counterpartUrl: string | null;
  };
  redirects: { incomingRedirects: string[] };
  emptyFields: string[];
  schemaValidation?: {
    valid: boolean;
    errors: Array<{
      path: string;
      code: string;
      message: string;
      expected?: string;
      received?: string;
    }>;
  };
  issues?: Array<{
    type: "error" | "warning" | "info";
    code: string;
    message: string;
    category?: string;
    validator?: string;
    details?: {
      path?: string;
      expected?: string;
      received?: string;
    };
  }>;
  /** @deprecated Removed from API — use issues from the shared store. */
  score?: { total: number; seo: number; schema: number; content: number };
  dirty?: boolean;
  entryKey?: string;
  education?: {
    summary: string;
    details?: string;
    advanced_paths?: string[];
  };
}


/** Tiny count pill pinned to the top-right of a filter trigger. */
function FilterCornerBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background"
      aria-hidden
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function InfoPopover({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-5 w-5 shrink-0"
          data-testid={testId ?? "button-info-popover"}
        >
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2 text-sm text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Full suggestion stays on the issue payload; Global Health truncates long copy in the list. */
const SUGGESTION_PREVIEW_CHARS = 240;

function TruncatableSuggestion({
  text,
  formatSitePath,
}: {
  text: string;
  formatSitePath: (path: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncate = text.length > SUGGESTION_PREVIEW_CHARS;
  const display =
    needsTruncate && !expanded
      ? `${text.slice(0, SUGGESTION_PREVIEW_CHARS).trimEnd()}…`
      : text;
  return (
    <div className="text-muted-foreground italic mt-0.5" title={text} data-testid="issue-suggestion">
      <span>{formatSitePathsInText(display, formatSitePath)}</span>
      {needsTruncate ? (
        <button
          type="button"
          className="ml-1 not-italic text-foreground/70 underline-offset-2 hover:underline"
          onClick={() => setExpanded((v) => !v)}
          data-testid="button-suggestion-expand"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}


type CacheIssuesResponse = {
  issues: CachedIssueRow[];
  facets?: {
    validator: string[];
    category: string[];
    code: string[];
    severity: Array<"error" | "warning">;
  };
  facetsAll?: {
    validator: string[];
    category: string[];
    code: string[];
    severity: Array<"error" | "warning">;
  };
  totals?: {
    open: number;
    filtered: number;
    errors: number;
    warnings: number;
    uniqueUrls: number;
    openErrors: number;
    openWarnings: number;
    openUniqueUrls: number;
    legacy: number;
  };
};

type CachedIssueRow = {
  url: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  validator?: string;
  category?: string;
  lastFullRunAt?: string;
  suggestion?: string;
  file?: string;
  entryKey?: string;
  claimed?: {
    by: string;
    at: string;
    expiresAt: string;
    actor?: { type: "ui" | "mcp"; client?: string; model?: string };
  };
  completed?: {
    by: string;
    at: string;
    actor?: { type: "ui" | "mcp"; client?: string; model?: string };
  };
  attempts?: Array<{
    by: string;
    claimedBy?: string;
    at: string;
    reason: "released" | "ttl_expired";
    report?: string;
    claimedAt?: string;
    claimReport?: string;
    actor?: { type: "ui" | "mcp"; client?: string; model?: string };
  }>;
};

type ResolvedArchiveRow = {
  issueId: string;
  entryKey: string;
  url?: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  validator?: string;
  category?: string;
  suggestion?: string;
  file?: string;
  resolvedAt: string;
  resolvedBy: string;
  actor?: { type: "ui" | "mcp"; client?: string; model?: string };
  report?: string;
  reopenedAt?: string;
};

type ResolvedIssuesResponse = {
  rows: ResolvedArchiveRow[];
  total: number;
  summary: {
    total: number;
    errors: number;
    warnings: number;
    reopened: number;
    resolvedCount: number;
  };
};

type JobStartResponse = {
  status: string;
  job_id?: string;
  retry_after_seconds?: number;
  message?: string;
  code?: string;
  validators?: ValidatorResult[];
  issuesBySlug?: Record<string, unknown>;
  scope?: { processed?: number; total?: number; staleUrlCount?: number; urlCount?: number };
  scoped?: boolean;
  last_site_wide_run_at?: string | null;
  last_site_wide_run_ago?: string;
  last_site_wide_duration_ms?: number | null;
  last_site_wide_duration_human?: string | null;
  last_site_wide_url_count?: number | null;
};

type DiagnosticsConfirmInfo = {
  message: string;
  scoped: boolean;
  last_site_wide_run_ago: string;
  last_site_wide_duration_human: string | null;
  last_site_wide_url_count: number | null;
};

async function postDiagnosticsJobs(
  body: Record<string, unknown>,
): Promise<JobStartResponse & { httpStatus: number }> {
  const res = await apiFetch("/api/validation/diagnostics-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  const data = (await res.json()) as JobStartResponse;
  return { ...data, httpStatus: res.status };
}

function diagnosticsConfirmCopy(info: DiagnosticsConfirmInfo): { title: string; body: string } {
  const duration = info.last_site_wide_duration_human ?? "unknown";
  const ago = info.last_site_wide_run_ago || "never";
  const urlBit =
    info.last_site_wide_url_count != null ? ` (${info.last_site_wide_url_count} URLs)` : "";
  if (info.scoped) {
    return {
      title: "Run scoped diagnostics?",
      body:
        `This is a scoped re-check (usually faster). Last full site-wide run was ${ago} and took ${duration}${urlBit} (reference only).`,
    };
  }
  return {
    title: "Run diagnostics?",
    body:
      ago === "never"
        ? "No full site-wide diagnostics run is recorded yet. This can take several minutes depending on site size."
        : `Last full site-wide run was ${ago} and took ${duration}${urlBit}.`,
  };
}

type JobLogLine = {
  t: number;
  level: string;
  text: string;
};

type JobPollResponse = {
  status: string;
  job_id?: string;
  processed?: number;
  total?: number;
  retry_after_seconds?: number;
  validators?: ValidatorResult[];
  error?: string;
  message?: string;
  code?: string;
  summary?: { errorCount: number; warningCount: number };
  log?: JobLogLine[];
};

type JobPanelState = {
  jobId: string;
  label?: string;
  status: string;
  processed: number;
  total: number;
  log: JobLogLine[];
  running: boolean;
};

const ISSUE_DISPLAY_CAP = 200;

async function pollDiagnosticsJob(
  jobId: string,
  onProgress?: (p: {
    processed: number;
    total: number;
    status: string;
    log: JobLogLine[];
  }) => void,
): Promise<JobPollResponse> {
  for (;;) {
    const res = await apiFetch(`/api/validation/diagnostics-jobs/${encodeURIComponent(jobId)}`, {
      credentials: "include",
    });
    const data = (await res.json()) as JobPollResponse;
    if (res.status === 404 || data.status === "not_found") {
      return { ...data, status: "not_found" };
    }
    if (!res.ok) {
      throw new Error(data.message || data.error || `Job poll failed (${res.status})`);
    }
    if (data.status === "queued" || data.status === "running") {
      onProgress?.({
        processed: data.processed ?? 0,
        total: data.total ?? 0,
        status: data.status,
        log: data.log ?? [],
      });
      const waitMs = Math.max(1, data.retry_after_seconds ?? 5) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    return data;
  }
}

type RecheckState = "idle" | "running" | "resolved" | "still_present" | "error";

function RecheckIssueButton({
  url,
  code,
  validator,
  category,
  onResolved,
  startWithConfirm,
}: {
  url: string;
  code: string;
  validator?: string;
  category?: string;
  onResolved: () => void;
  startWithConfirm: (body: Record<string, unknown>) => Promise<JobStartResponse>;
}) {
  const [state, setState] = useState<RecheckState>("idle");

  const handleRecheck = async () => {
    setState("running");
    try {
      const startData = await startWithConfirm({
        urls: [url],
        freshness: "hard",
        ...(validator ? { validators: [validator] } : {}),
        ...(category ? { categories: [category] } : {}),
      });
      if (startData.status === "busy") {
        setState("error");
        return;
      }
      if (startData.status !== "cached") {
        if (!startData.job_id) {
          setState("error");
          return;
        }
        await pollDiagnosticsJob(startData.job_id);
      }
      // Check if the issue still exists in the refreshed cache
      const issuesRes = await apiFetch(
        `/api/validation/cache-issues?url=${encodeURIComponent(url)}`,
        { credentials: "include" },
      );
      const issuesData = (await issuesRes.json()) as { issues: CachedIssueRow[] };
      const stillPresent = issuesData.issues.some((i) => i.code === code);
      if (!stillPresent) {
        // Auto-dismiss from cache
        await apiFetch("/api/validation/cache-issues/dismiss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, code }),
          credentials: "include",
        });
        setState("resolved");
        onResolved();
      } else {
        setState("still_present");
        // Even when the issue remains, re-check should update the "detected X ago"
        // timestamp coming from cache. The list UI is driven by the shared cache
        // query, so we must invalidate it here too.
        onResolved();
      }
    } catch (err) {
      if (err instanceof Error && err.message === "cancelled") {
        setState("idle");
        return;
      }
      setState("error");
    }
  };

  if (state === "resolved") {
    return (
      <span className="text-[10px] text-chart-2 flex items-center gap-1">
        <CircleCheck className="h-3 w-3" /> resolved
      </span>
    );
  }
  if (state === "still_present") {
    return (
      <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={handleRecheck}>
        <RefreshCw className="h-3 w-3" /> still present · re-check
      </Button>
    );
  }
  if (state === "error") {
    return (
      <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={handleRecheck}>
        <RefreshCw className="h-3 w-3" /> re-check failed · retry
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 text-[10px] gap-1 text-muted-foreground"
      onClick={handleRecheck}
      disabled={state === "running"}
    >
      {state === "running" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <RefreshCw className="h-3 w-3" />
      )}
      {state === "running" ? "checking…" : "re-check"}
    </Button>
  );
}

function RecheckFileIssueButton({
  file,
  code,
  category,
  validator,
  onResolved,
  startWithConfirm,
}: {
  file: string;
  code: string;
  category?: string;
  validator?: string;
  onResolved: () => void;
  startWithConfirm: (body: Record<string, unknown>) => Promise<JobStartResponse>;
}) {
  const [state, setState] = useState<RecheckState>("idle");

  const handleRecheck = async () => {
    setState("running");
    try {
      const body: Record<string, unknown> = {
        // Force a re-run so we don't depend on max_age freshness for this specific entry.
        freshness: "hard",
        file,
      };
      if (category) body.categories = [category];
      if (validator) body.validators = [validator];
      const startData = await startWithConfirm(body);
      if (startData.status === "busy") {
        setState("error");
        return;
      }
      if (startData.status !== "cached") {
        if (!startData.job_id) {
          setState("error");
          return;
        }
        await pollDiagnosticsJob(startData.job_id);
      }
      const issuesRes = await apiFetch(
        `/api/validation/cache-issues?file=${encodeURIComponent(file)}`,
        { credentials: "include" },
      );
      const issuesData = (await issuesRes.json()) as { issues: CachedIssueRow[] };
      const stillPresent = issuesData.issues.some((i) => i.code === code);
      if (!stillPresent) {
        await apiFetch("/api/validation/cache-issues/dismiss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file, code }),
          credentials: "include",
        });
        setState("resolved");
        onResolved();
      } else {
        setState("still_present");
        // Same as URL issues: if it still exists, we still want to refresh the
        // cache so the "detected X ago" label updates.
        onResolved();
      }
    } catch (err) {
      if (err instanceof Error && err.message === "cancelled") {
        setState("idle");
        return;
      }
      setState("error");
    }
  };

  if (state === "resolved") {
    return (
      <span className="text-[10px] text-chart-2 flex items-center gap-1">
        <CircleCheck className="h-3 w-3" /> resolved
      </span>
    );
  }
  if (state === "still_present") {
    return (
      <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={handleRecheck}>
        <RefreshCw className="h-3 w-3" /> still present · re-check
      </Button>
    );
  }
  if (state === "error") {
    return (
      <Button variant="outline" size="sm" className="h-6 text-[10px] gap-1" onClick={handleRecheck}>
        <RefreshCw className="h-3 w-3" /> re-check failed · retry
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 text-[10px] gap-1 text-muted-foreground"
      onClick={handleRecheck}
      disabled={state === "running"}
    >
      {state === "running" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <RefreshCw className="h-3 w-3" />
      )}
      {state === "running" ? "checking…" : "re-check"}
    </Button>
  );
}

function cacheRowToValidatorIssue(row: CachedIssueRow): ValidatorIssue {
  return {
    type: row.severity === "error" ? "error" : "warning",
    code: row.code,
    message: row.message,
    ...(row.file ? { file: row.file } : {}),
    ...(row.suggestion ? { suggestion: row.suggestion } : {}),
  };
}

type CacheFreshnessResponse = {
  fresh: number;
  stale: number;
  total: number;
  max_age_seconds: number;
  last_site_wide_run_at: string | null;
};

type CoverageSummary = {
  meanPercent: number;
  fullyCovered: number;
  totalUrls: number;
  expectedValidators: number;
};

type CoverageUrlItem = {
  url: string;
  lastFullRunAt: string | null;
  isFresh: boolean;
  coveredCount: number;
  expectedCount: number;
  coveragePercent: number;
  oldestCoveredAt: string | null;
};

type CoverageUrlsResponse = {
  totalItems: number;
  page: number;
  pageSize: number;
  coverage: CoverageSummary;
  items: CoverageUrlItem[];
};

type DiagnosticsJobListItem = {
  jobId: string;
  status: string;
  processed?: number;
  total?: number;
};

function formatRelativeAgo(iso: string, nowMs: number = Date.now()): string {
  const diffMs = nowMs - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (!Number.isFinite(diffMs) || Number.isNaN(mins)) return "unknown";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatLastSiteWideRun(iso: string): string {
  const when = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
  return `Last site-wide run: ${when} (${formatRelativeAgo(iso)})`;
}

function formatInFlightJobStatus(job: {
  status: string;
  processed?: number;
  total?: number;
}): string {
  const total = job.total ?? 0;
  const processed = job.processed ?? 0;
  if (total > 0) return `Job currently running (${processed}/${total})`;
  if (job.status === "queued") return "Job currently running (queued)";
  return "Job currently running";
}

function firstInFlightJob(
  jobs: DiagnosticsJobListItem[] | undefined,
): DiagnosticsJobListItem | undefined {
  return jobs?.find((j) => j.status === "queued" || j.status === "running");
}

function isDiagnosticsInFlight(
  jobPanel: JobPanelState | null,
  jobs: DiagnosticsJobListItem[] | undefined,
): boolean {
  return jobPanel?.running === true || firstInFlightJob(jobs) != null;
}

const REDIRECT_FIX_DEFERRED_TOAST = {
  title: "Fix saved",
  description:
    "The redirect change is in content. The issue list will refresh when the current diagnostics job finishes.",
} as const;

type RunSingleValidatorArg = string | { name: string; deferOnBusy?: boolean };

type RunSingleValidatorResult = { name: string; deferred?: boolean };

const FRESH_URLS_PAGE_SIZE = 50;

function GlobalHealthTab({ onOpenLeads }: { onOpenLeads?: () => void }) {
  void onOpenLeads;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canMutateMetrics } = useDebugAuth();
  const formatSitePath = useFormatSitePath();
  const [pathname, setLocation] = useLocation();
  const searchString = useSearch();
  const view = useMemo(() => parseGlobalHealthSearch(searchString), [searchString]);
  const { kpi: activeKpiTab, path: pagePathFilter, scope: categoryFilters, validators: validatorFilters, priorAttempts: priorAttemptsFilter } =
    view;

  const writeView = useCallback(
    (next: GlobalHealthViewState) => {
      const qs = serializeGlobalHealthSearch(next, searchString);
      const pathOnly = pathname.split("?")[0];
      setLocation(qs ? `${pathOnly}?${qs}` : pathOnly, { replace: true });
    },
    [pathname, searchString, setLocation],
  );

  const patchView = useCallback(
    (patch: Partial<GlobalHealthViewState>) => {
      writeView({ ...view, ...patch });
    },
    [view, writeView],
  );

  const setActiveKpiTab = useCallback(
    (kpi: GlobalHealthKpi) => {
      if (kpi === "completed") setResolvedOffset(0);
      patchView({ kpi });
    },
    [patchView],
  );

  const setPagePathFilter = useCallback(
    (path: string) => {
      patchView({ path });
    },
    [patchView],
  );

  const setCategoryFilters = useCallback(
    (
      next:
        | GlobalHealthScopeKey[]
        | ((prev: GlobalHealthScopeKey[]) => GlobalHealthScopeKey[]),
    ) => {
      const scope = typeof next === "function" ? next(view.scope) : next;
      patchView({ scope });
    },
    [patchView, view.scope],
  );

  const setValidatorFilters = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      const validators = typeof next === "function" ? next(view.validators) : next;
      patchView({ validators });
    },
    [patchView, view.validators],
  );

  const [search, setSearch] = useState("");
  const [pageFilterOpen, setPageFilterOpen] = useState(false);
  const [rerunValidator, setRerunValidator] = useState<string>("");
  const [freshUrlSearch, setFreshUrlSearch] = useState("");
  const [freshUrlFilter, setFreshUrlFilter] = useState<"all" | "fresh" | "not_fresh">("all");
  const [freshUrlPage, setFreshUrlPage] = useState(1);
  const freshKpiView: "issues" | "fresh_urls" | "resolved" =
    activeKpiTab === "completed"
      ? "resolved"
      : activeKpiTab === "coverage" || activeKpiTab === "unique"
        ? "fresh_urls"
        : "issues";
  const [resolvedOffset, setResolvedOffset] = useState(0);
  const RESOLVED_PAGE_SIZE = 50;
  const [jobPanel, setJobPanel] = useState<JobPanelState | null>(null);
  const [educationOpen, setEducationOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [purgeLegacyOpen, setPurgeLegacyOpen] = useState(false);
  const [pullProductionOpen, setPullProductionOpen] = useState(false);
  const isDev = import.meta.env.DEV;
  const [confirmGate, setConfirmGate] = useState<{
    info: DiagnosticsConfirmInfo;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [confirmAdvancedOpen, setConfirmAdvancedOpen] = useState(false);
  const jobLogScrollRef = useRef<HTMLDivElement>(null);
  const hideJobPanelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { resolveModalOpen, setResolveModalOpen, activeConflict, openResolver } = useRedirectConflictResolver();

  const startWithConfirm = async (body: Record<string, unknown>): Promise<JobStartResponse> => {
    let data = await postDiagnosticsJobs(body);
    if (data.httpStatus === 409 || data.status === "busy") {
      return data;
    }
    if (data.status === "needs_confirm") {
      const ok = await new Promise<boolean>((resolve) => {
        setConfirmAdvancedOpen(false);
        setConfirmGate({
          info: {
            message: data.message || "Confirm to run diagnostics.",
            scoped: data.scoped === true,
            last_site_wide_run_ago: data.last_site_wide_run_ago || "never",
            last_site_wide_duration_human: data.last_site_wide_duration_human ?? null,
            last_site_wide_url_count: data.last_site_wide_url_count ?? null,
          },
          resolve,
        });
      });
      setConfirmGate(null);
      if (!ok) {
        throw new Error("cancelled");
      }
      data = await postDiagnosticsJobs({ ...body, confirm: true });
    }
    if (data.httpStatus === 409 || data.status === "busy") {
      return data;
    }
    if (data.httpStatus >= 400 && data.status !== "needs_confirm") {
      throw new Error(data.message || "Failed to start diagnostics job");
    }
    return data;
  };

  useEffect(() => {
    const el = jobLogScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [jobPanel?.log.length, jobPanel?.jobId]);

  useEffect(() => {
    return () => {
      if (hideJobPanelTimer.current) clearTimeout(hideJobPanelTimer.current);
    };
  }, []);

  const scheduleHideJobPanel = () => {
    if (hideJobPanelTimer.current) clearTimeout(hideJobPanelTimer.current);
    hideJobPanelTimer.current = setTimeout(() => setJobPanel(null), 3000);
  };

  const cacheIssuesQueryKey = [
    "/api/validation/cache-issues",
    "global-health",
    activeKpiTab,
    pagePathFilter,
    categoryFilters.join(","),
    validatorFilters.join(","),
    priorAttemptsFilter,
    search,
  ] as const;

  const { data: cacheIssuesData, refetch: refetchCacheIssues, isLoading: cacheIssuesLoading } =
    useQuery<CacheIssuesResponse>({
    queryKey: cacheIssuesQueryKey,
    enabled: freshKpiView === "issues",
    queryFn: async () => {
      const params = buildCacheIssuesQuery(view, search);
      const qs = params.toString();
      const res = await apiFetch(
        qs ? `/api/validation/cache-issues?${qs}` : "/api/validation/cache-issues",
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Failed to load cache issues (${res.status})`);
      return (await res.json()) as CacheIssuesResponse;
    },
  });
  const cacheIssues = cacheIssuesData?.issues ?? [];
  const cacheTotals = cacheIssuesData?.totals;
  const cacheFacetsAll = cacheIssuesData?.facetsAll;

  /** Unfiltered open-issue totals for KPI bar — stable across list filters and KPI tabs. */
  const { data: cacheKpiTotalsData } = useQuery<CacheIssuesResponse>({
    queryKey: ["/api/validation/cache-issues", "global-health", "kpi-totals"],
    queryFn: async () => {
      const res = await apiFetch("/api/validation/cache-issues", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load cache issue totals (${res.status})`);
      return (await res.json()) as CacheIssuesResponse;
    },
  });
  const kpiTotals = cacheKpiTotalsData?.totals;

  const { data: resolvedSummaryData } = useQuery<ResolvedIssuesResponse["summary"]>({
    queryKey: ["/api/validation/resolved-issues", "summary"],
    queryFn: async () => {
      const res = await apiFetch("/api/validation/resolved-issues?limit=1");
      if (!res.ok) throw new Error("Failed to load resolved summary");
      const data = (await res.json()) as ResolvedIssuesResponse;
      return data.summary;
    },
  });

  const { data: resolvedIssuesData, isLoading: resolvedIssuesLoading } = useQuery<ResolvedIssuesResponse>({
    queryKey: [
      "/api/validation/resolved-issues",
      "list",
      resolvedOffset,
      pagePathFilter,
      search,
      categoryFilters.join(","),
      validatorFilters.join(","),
    ],
    enabled: activeKpiTab === "completed",
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(RESOLVED_PAGE_SIZE),
        offset: String(resolvedOffset),
      });
      if (pagePathFilter.trim()) params.set("url", pagePathFilter.trim());
      if (search.trim()) params.set("search", search.trim());
      if (categoryFilters.length === 1) params.set("category", categoryFilters[0]!);
      if (validatorFilters.length === 1) params.set("validator", validatorFilters[0]!);
      const res = await apiFetch(`/api/validation/resolved-issues?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load resolved issues");
      return res.json() as Promise<ResolvedIssuesResponse>;
    },
  });

  const { data: cacheFreshness } = useQuery<CacheFreshnessResponse>({
    queryKey: ["/api/validation/cache-freshness"],
  });

  const { data: coverageSummaryData } = useQuery<CoverageUrlsResponse>({
    queryKey: ["/api/validation/cache-freshness-urls", "summary"],
    queryFn: async () => {
      const res = await apiFetch("/api/validation/cache-freshness-urls?page=1&pageSize=1", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load coverage summary (${res.status})`);
      return (await res.json()) as CoverageUrlsResponse;
    },
  });

  const { data: freshUrlsData, isFetching: isFreshUrlsFetching } = useQuery<CoverageUrlsResponse>({
    queryKey: ["/api/validation/cache-freshness-urls", freshUrlSearch, freshUrlFilter, freshUrlPage],
    enabled: freshKpiView === "fresh_urls",
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(freshUrlPage));
      params.set("pageSize", String(FRESH_URLS_PAGE_SIZE));
      params.set("filter", freshUrlFilter);
      if (freshUrlSearch.trim()) params.set("q", freshUrlSearch.trim());
      const res = await apiFetch(`/api/validation/cache-freshness-urls?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load fresh URLs (${res.status})`);
      return (await res.json()) as CoverageUrlsResponse;
    },
  });

  const { data: jobsListData } = useQuery<{ jobs: DiagnosticsJobListItem[] }>({
    queryKey: ["/api/validation/diagnostics-jobs"],
    refetchInterval: (query) => {
      if (jobPanel?.running) return 5000;
      const jobs = query.state.data?.jobs ?? [];
      if (jobs.some((j) => j.status === "queued" || j.status === "running")) return 5000;
      return 15000;
    },
  });

  const { data: validatorsData } = useQuery<{
    validators: Array<{ name: string; description?: string; category?: string }>;
  }>({
    queryKey: ["/api/validation/validators"],
  });
  const availableValidators = validatorsData?.validators ?? [];

  const startJobMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (hideJobPanelTimer.current) clearTimeout(hideJobPanelTimer.current);
      const data = await startWithConfirm(body);
      if (data.status === "busy") {
        throw new Error(data.message || "Another diagnostics job is already running for this site.");
      }
      if (data.status === "cached") {
        return { kind: "cached" as const, data };
      }
      if (!data.job_id) {
        throw new Error("Missing job_id from diagnostics-jobs");
      }
      const jobId = data.job_id;
      setJobPanel({
        jobId,
        status: "queued",
        processed: 0,
        total: 0,
        log: [],
        running: true,
      });
      const final = await pollDiagnosticsJob(jobId, (p) => {
        setJobPanel({
          jobId,
          status: p.status,
          processed: p.processed,
          total: p.total,
          log: p.log,
          running: true,
        });
      });
      setJobPanel({
        jobId,
        status: final.status,
        processed: final.processed ?? 0,
        total: final.total ?? 0,
        log: final.log ?? [],
        running: false,
      });
      if (final.status === "failed" || final.status === "not_found") {
        throw new Error(final.error || final.message || `Job ${final.status}`);
      }
      return { kind: "completed" as const, data: final };
    },
    onSuccess: (outcome) => {
      scheduleHideJobPanel();
      void refetchCacheIssues();
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-issues"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-freshness"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-freshness-urls"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/diagnostics-jobs"] });
      if (outcome.kind === "cached") {
        toast({ title: "Cache fresh", description: "No stale URLs — showing cached diagnostics." });
        return;
      }
      toast({
        title: "Diagnostics completed",
        description: outcome.data.summary
          ? `${outcome.data.summary.errorCount} errors, ${outcome.data.summary.warningCount} warnings`
          : "Cache updated.",
      });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === "cancelled") {
        return;
      }
      setJobPanel((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              status: "failed",
              log: [
                ...prev.log,
                {
                  t: Date.now(),
                  level: "error",
                  text: err instanceof Error ? err.message : "Unknown error",
                },
              ],
            }
          : prev,
      );
      scheduleHideJobPanel();
      toast({
        title: "Diagnostics failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const runAllMutation = {
    isPending: startJobMutation.isPending,
    mutate: (freshness: "max_age" | "hard" = "max_age") => {
      startJobMutation.mutate({
        freshness,
        max_age_seconds: 86400,
        include_artifacts: true,
      });
    },
  };

  const runSingleMutation = useMutation({
    mutationFn: async (arg: RunSingleValidatorArg): Promise<RunSingleValidatorResult> => {
      const name = typeof arg === "string" ? arg : arg.name;
      const deferOnBusy = typeof arg === "object" && arg.deferOnBusy === true;
      if (hideJobPanelTimer.current) clearTimeout(hideJobPanelTimer.current);
      const data = await startWithConfirm({
        validators: [name],
        include_artifacts: true,
        freshness: "hard",
      });
      if (data.status === "busy") {
        if (deferOnBusy) {
          return { name, deferred: true };
        }
        throw new Error(data.message || "Another diagnostics job is already running.");
      }
      if (data.status === "cached") {
        return { name };
      }
      if (!data.job_id) throw new Error("Missing job_id");
      const jobId = data.job_id;
      setJobPanel({
        jobId,
        label: name,
        status: "queued",
        processed: 0,
        total: 0,
        log: [],
        running: true,
      });
      const final = await pollDiagnosticsJob(jobId, (p) => {
        setJobPanel({
          jobId,
          label: name,
          status: p.status,
          processed: p.processed,
          total: p.total,
          log: p.log,
          running: true,
        });
      });
      setJobPanel({
        jobId,
        label: name,
        status: final.status,
        processed: final.processed ?? 0,
        total: final.total ?? 0,
        log: final.log ?? [],
        running: false,
      });
      if (final.status === "failed" || final.status === "not_found") {
        throw new Error(final.error || final.message || `Job ${final.status}`);
      }
      return { name };
    },
    onSuccess: (data) => {
      if (data.deferred) {
        void refetchCacheIssues();
        toast(REDIRECT_FIX_DEFERRED_TOAST);
        return;
      }
      scheduleHideJobPanel();
      void refetchCacheIssues();
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-freshness"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-freshness-urls"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/diagnostics-jobs"] });
      toast({
        title: "Validator finished",
        description: `Updated cache for ${data.name}.`,
      });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === "cancelled") {
        return;
      }
      setJobPanel((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              status: "failed",
              log: [
                ...prev.log,
                {
                  t: Date.now(),
                  level: "error",
                  text: err instanceof Error ? err.message : "Unknown error",
                },
              ],
            }
          : prev,
      );
      scheduleHideJobPanel();
      toast({
        title: "Validator run failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const saveReportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/validation/save-report", {});
      return (await res.json()) as { ok: boolean; path: string; timestamp: string };
    },
    onSuccess: (data) => {
      toast({
        title: "Report saved",
        description: formatSitePath(data.path),
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to save report",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const clearCacheMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/validation/clear-cache", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as { success?: boolean; message?: string; error?: string };
      if (res.status === 409) {
        throw new Error(data.message || "Diagnostics job is running — wait before clearing.");
      }
      if (!res.ok || data.success === false) {
        throw new Error(data.message || data.error || "Failed to clear validation cache");
      }
      return data;
    },
    onSuccess: () => {
      setClearCacheOpen(false);
      void refetchCacheIssues();
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-freshness"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-freshness-urls"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-issues"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/diagnostics-jobs"] });
      toast({
        title: "Validation cache cleared",
        description: "Run Refresh stale or Hard refresh to rebuild diagnostics.",
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to clear cache",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const pullProductionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/validation/pull-from-gcs", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
        issueCount?: number;
        gcsKey?: string;
      };
      if (res.status === 409) {
        throw new Error(data.message || "Diagnostics job is running — wait before pulling.");
      }
      if (!res.ok || data.success === false) {
        throw new Error(data.message || data.error || "Failed to pull production validation cache");
      }
      return data;
    },
    onSuccess: (data) => {
      setPullProductionOpen(false);
      void refetchCacheIssues();
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-freshness"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-freshness-urls"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-issues"], exact: false });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/diagnostics-jobs"] });
      toast({
        title: "Production cache loaded",
        description:
          data.message ??
          `Loaded ${data.issueCount ?? 0} issue(s) from GCS into local validation-cache.json.`,
      });
    },
    onError: (err) => {
      toast({
        title: "Could not load production cache",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const purgeLegacyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/validation/purge-legacy-issues", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
        removed?: number;
      };
      if (res.status === 409) {
        throw new Error(data.message || "Diagnostics job is running — wait before purging.");
      }
      if (!res.ok || data.success === false) {
        throw new Error(data.message || data.error || "Failed to remove legacy issues");
      }
      return data;
    },
    onSuccess: (data) => {
      setPurgeLegacyOpen(false);
      void refetchCacheIssues();
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-freshness"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-freshness-urls"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-issues"], exact: false });
      toast({
        title: "Legacy issues removed",
        description:
          data.message ??
          `Removed ${data.removed ?? 0} legacy validator issue(s).`,
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to remove legacy issues",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const scopeCategories: { key: GlobalHealthScopeKey; label: string }[] = [
    { key: "seo", label: "SEO" },
    { key: "integrity", label: "Integrity" },
    { key: "content", label: "Content" },
    { key: "components", label: "Components" },
    { key: "forms", label: "Forms" },
    { key: "bindings", label: "Bindings" },
    { key: "performance", label: "Performance" },
  ];

  const validatorFilterOptions = (() => {
    const names = new Set<string>();
    for (const v of availableValidators) {
      if (v.name) names.add(v.name);
    }
    if (cacheFacetsAll?.validator.includes("legacy")) {
      names.add("legacy");
    }
    return Array.from(names).sort((a, b) => {
      if (a === "legacy") return 1;
      if (b === "legacy") return -1;
      return a.localeCompare(b);
    });
  })();

  const kpiSummary = {
    errors: kpiTotals?.openErrors ?? 0,
    warnings: kpiTotals?.openWarnings ?? 0,
    urls: kpiTotals?.openUniqueUrls ?? 0,
  };

  const openIssueCount = cacheTotals?.open ?? 0;
  const filteredIssueCount = cacheTotals?.filtered ?? cacheIssues.length;
  const legacyIssueCount = cacheTotals?.legacy ?? 0;

  const jobPending =
    startJobMutation.isPending ||
    runSingleMutation.isPending ||
    clearCacheMutation.isPending ||
    purgeLegacyMutation.isPending ||
    pullProductionMutation.isPending;
  const displayedIssues = cacheIssues.slice(0, ISSUE_DISPLAY_CAP);
  const issueListFilterKey = [
    activeKpiTab,
    pagePathFilter,
    categoryFilters.join(","),
    validatorFilters.join(","),
    priorAttemptsFilter,
    search,
  ].join("|");
  const coverageSummary = coverageSummaryData?.coverage;
  const freshUrlItems = freshUrlsData?.items ?? [];
  const freshUrlTotalItems = freshUrlsData?.totalItems ?? 0;
  const freshUrlTotalPages = Math.max(1, Math.ceil(freshUrlTotalItems / FRESH_URLS_PAGE_SIZE));
  const inFlightJob = jobPanel?.running
    ? jobPanel
    : firstInFlightJob(jobsListData?.jobs);
  const diagnosticsStatusLine = inFlightJob
    ? formatInFlightJobStatus(inFlightJob)
    : cacheFreshness === undefined
      ? ""
      : cacheFreshness.last_site_wide_run_at
        ? formatLastSiteWideRun(cacheFreshness.last_site_wide_run_at)
        : "No site-wide diagnostics run yet.";

  const rerunOptions = (() => {
    const names = new Set<string>();
    for (const v of availableValidators) {
      if (v.name && v.name !== "lighthouse") names.add(v.name);
    }
    for (const n of cacheFacetsAll?.validator ?? []) names.add(n);
    return Array.from(names).sort();
  })();

  const showIssuesAll = activeKpiTab === null && freshKpiView === "issues";
  const errorsKpiActive = activeKpiTab === "errors" || showIssuesAll;
  const warningsKpiActive = activeKpiTab === "warnings" || showIssuesAll;
  const coverageKpiActive = activeKpiTab === "coverage";
  const uniqueKpiActive = activeKpiTab === "unique";
  const completedKpiActive = activeKpiTab === "completed";
  const resolvedRows = resolvedIssuesData?.rows ?? [];
  const resolvedTotal = resolvedIssuesData?.total ?? 0;

  const kpiActiveClass = (active: boolean) =>
    active ? "bg-muted/70 border-b-0 -mb-px" : "bg-card";

  return (
    <div className="space-y-6">
      <Card style={{ borderRadius: "0.8rem" }} data-testid="diagnostics-how-it-works">
        <Collapsible open={educationOpen} onOpenChange={setEducationOpen}>
          <CardContent className="p-4 space-y-2 text-sm text-muted-foreground">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-foreground font-medium text-left"
                aria-expanded={educationOpen}
                data-testid="button-diagnostics-how-it-works"
              >
                <Info className="h-4 w-4 shrink-0" />
                <span className="flex-1">How diagnostics work</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${educationOpen ? "rotate-180" : ""}`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2">
              <p>
                Global Health shows one shared issue store in{" "}
                <code className="text-xs">validation-cache.json</code>. Use{" "}
                <strong className="text-foreground font-medium">Page or URL</strong> to filter by sitemap page;
                open the live page + DebugBubble for in-context fixes (Page Analysis tab removed).
                KPI (Errors/Warnings), Page or URL, Error scope, and Validators filters persist in the URL query
                string so a refresh keeps your view.
                <strong className="text-foreground font-medium"> Validation Coverage</strong> shows average entry-local
                validator coverage and fully-covered URLs. Under Refresh, an in-flight
                job shows while queued/running; otherwise the last <em>site-wide</em> run (Refresh / Hard refresh,
                not a page save). Refresh / Hard refresh / Re-run validator update the store via a{" "}
                <strong className="text-foreground font-medium">background worker</strong>; starting a new job asks for
                confirm and shows the last full site-wide duration. The job panel shows milestones (fixed height, scrolls).
                Cached issues refresh when the job finishes. Delete cache wipes the store until the next refresh.
                Remove Legacy Issues drops v4→v5 migration orphans (`validator: legacy`) that normal re-checks never clear.
                {isDev
                  ? " In development, Sync with production issues copies the GCS sidecar into local validation-cache.json (never uploads)."
                  : ""}{" "}
                One job runs at a time per site.
              </p>
              <button
                type="button"
                className="text-xs text-primary underline-offset-2 hover:underline"
                onClick={() => setShowAdvanced((v) => !v)}
                data-testid="button-diagnostics-read-more"
              >
                {showAdvanced ? "Hide advanced" : "Read more (advanced)"}
              </button>
              {showAdvanced && (
                <ul className="list-disc pl-5 text-xs space-y-1">
                  <li><code>server/services/diagnosticsJobService.ts</code> — parent job orchestration + IPC + confirm gate (<code>needs_confirm</code>)</li>
                  <li><code>scripts/validation/diagnostics-worker.ts</code> — forked worker that runs validators</li>
                  <li><code>{"{contentRoot}/validation-cache.json"}</code> — issue cache (GCS <code>{"{site}/sync/validation-cache.json"}</code> in prod). <code>lastFullRunAt</code> (per URL / any full stamp) vs <code>lastSiteWideRunAt</code> (Refresh / Hard refresh / site-wide validators)</li>
                  <li><code>scripts/validation/shared/runClass.ts</code> — <code>ENTRY_LOCAL_VALIDATOR_NAMES</code> drives coverage denominator</li>
                  <li><code>{"{contentRoot}/.cache/diagnostics-jobs/"}</code> — job envelopes + results files (duration stats for confirm dialog)</li>
                  <li><code>client/src/components/diagnostics/global-health-url.ts</code> — Global Health query params (<code>kpi</code>, <code>path</code>, <code>scope</code>, <code>validators</code>)</li>
                  <li>API: <code>POST/GET /api/validation/diagnostics-jobs</code> (<code>confirm: true</code> when starting), <code>GET /api/validation/cache-issues</code>, <code>GET /api/validation/cache-freshness</code>, <code>GET /api/validation/cache-freshness-urls</code>, <code>POST /api/validation/purge-legacy-issues</code>{isDev ? <>, <code>POST /api/validation/pull-from-gcs</code> (dev only)</> : null}</li>
                  <li>MCP <code>run_entry_diagnostics</code> — same confirm gate (<code>confirm_run_diagnostics</code>); mid-run poll returns URLs flushed since job start only</li>
                </ul>
              )}
            </CollapsibleContent>
          </CardContent>
        </Collapsible>
      </Card>

      {jobPanel && (
        <div
          className="rounded-lg border border-border overflow-hidden"
          data-testid="diagnostics-job-banner"
        >
          <div className="flex items-center gap-2 px-4 py-2.5 text-sm text-foreground bg-muted/40 border-b border-border">
            {jobPanel.running ? (
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            ) : jobPanel.status === "failed" || jobPanel.status === "not_found" ? (
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            ) : (
              <Check className="h-4 w-4 text-chart-2 shrink-0" />
            )}
            <span className="truncate">
              {jobPanel.label ? `${jobPanel.label}: ` : "Job "}
              {jobPanel.jobId}: {jobPanel.status}
              {jobPanel.total > 0 ? ` (${jobPanel.processed}/${jobPanel.total})` : ""}
            </span>
          </div>
          <div
            ref={jobLogScrollRef}
            className="bg-zinc-950 text-zinc-100 font-mono text-xs max-h-48 overflow-y-auto px-3 py-2 space-y-0.5"
            data-testid="diagnostics-job-log"
          >
            {jobPanel.log.length === 0 ? (
              <div className="text-zinc-500">Waiting for worker output…</div>
            ) : (
              jobPanel.log.map((line, i) => (
                <div
                  key={`${line.t}-${i}`}
                  className={
                    line.level === "error"
                      ? "text-red-400"
                      : line.level === "warn"
                        ? "text-amber-300"
                        : "text-zinc-200"
                  }
                >
                  <span className="text-zinc-500 mr-2">
                    {new Date(line.t).toLocaleTimeString()}
                  </span>
                  {line.text}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground" data-testid="text-global-health-title">
            Content Diagnostics
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Shared validation store for the whole site. Page bubbles show the same issues filtered to each entry.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
        {canMutateMetrics && (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={rerunValidator || undefined} onValueChange={setRerunValidator}>
              <SelectTrigger className="w-[180px]" data-testid="select-rerun-validator">
                <SelectValue placeholder="Re-run validator…" />
              </SelectTrigger>
              <SelectContent>
                {rerunOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={!rerunValidator || jobPending}
              onClick={() => rerunValidator && runSingleMutation.mutate(rerunValidator)}
              data-testid="button-rerun-validator"
            >
              {runSingleMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={jobPending || saveReportMutation.isPending}
                  data-testid="button-run-all"
                >
                  {jobPending || saveReportMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {jobPending ? "Running..." : saveReportMutation.isPending ? "Saving..." : "Refresh"}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => runAllMutation.mutate("max_age")}
                  data-testid="menu-item-refresh-stale"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh stale
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => runAllMutation.mutate("hard")}
                  data-testid="menu-item-hard-refresh"
                >
                  <Play className="h-4 w-4" />
                  Hard refresh
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => saveReportMutation.mutate()}
                  data-testid="menu-item-save-report"
                >
                  <Save className="h-4 w-4" />
                  Save JSON report
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {isDev ? (
                  <DropdownMenuItem
                    onClick={() => setPullProductionOpen(true)}
                    data-testid="menu-item-pull-production-cache"
                  >
                    <DownloadCloud className="h-4 w-4" />
                    Sync with production issues
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onClick={() => setPurgeLegacyOpen(true)}
                  data-testid="menu-item-purge-legacy-issues"
                >
                  <Eraser className="h-4 w-4" />
                  Remove Legacy Issues
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setClearCacheOpen(true)}
                  data-testid="menu-item-delete-cache"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete cache
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
          {diagnosticsStatusLine ? (
            <p className="text-xs text-muted-foreground text-right" data-testid="text-diagnostics-status">
              {diagnosticsStatusLine}
            </p>
          ) : null}
        </div>
      </div>

      <Dialog open={clearCacheOpen} onOpenChange={setClearCacheOpen}>
        <DialogContent data-testid="dialog-delete-validation-cache">
          <DialogHeader>
            <DialogTitle>Delete validation cache?</DialogTitle>
            <DialogDescription>
              This clears all stored diagnostics issues and run metadata in{" "}
              <code className="text-xs">validation-cache.json</code> for this site.
              Cached issues will disappear until you run Refresh stale or Hard refresh again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClearCacheOpen(false)}
              disabled={clearCacheMutation.isPending}
              data-testid="button-cancel-delete-cache"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => clearCacheMutation.mutate()}
              disabled={clearCacheMutation.isPending}
              data-testid="button-confirm-delete-cache"
            >
              {clearCacheMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete cache
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={purgeLegacyOpen} onOpenChange={setPurgeLegacyOpen}>
        <DialogContent data-testid="dialog-purge-legacy-issues">
          <DialogHeader>
            <DialogTitle>Remove legacy issues?</DialogTitle>
            <DialogDescription>
              Removes only issues tagged <code className="text-xs">validator: legacy</code>{" "}
              (orphans from the v4→v5 cache migration). Other issues and run metadata stay.
              {legacyIssueCount > 0
                ? ` Currently ${legacyIssueCount} legacy issue${legacyIssueCount === 1 ? "" : "s"} in this cache.`
                : " No legacy issues are currently loaded."}
              {isDev
                ? " In development this updates local validation-cache.json only; run the same action on production (or upload via Cloud Sync) to update GCS."
                : " On production the updated cache is uploaded to GCS."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPurgeLegacyOpen(false)}
              disabled={purgeLegacyMutation.isPending}
              data-testid="button-cancel-purge-legacy"
            >
              Cancel
            </Button>
            <Button
              onClick={() => purgeLegacyMutation.mutate()}
              disabled={purgeLegacyMutation.isPending || legacyIssueCount === 0}
              data-testid="button-confirm-purge-legacy"
            >
              {purgeLegacyMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Eraser className="h-4 w-4" />
              )}
              Remove Legacy Issues
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isDev ? (
        <Dialog open={pullProductionOpen} onOpenChange={setPullProductionOpen}>
          <DialogContent data-testid="dialog-pull-production-validation-cache">
            <DialogHeader>
              <DialogTitle>Sync with production issues?</DialogTitle>
              <DialogDescription>
                This overwrites local{" "}
                <code className="text-xs">validation-cache.json</code> with the production GCS
                copy. It does not upload anything back. Not undoable — local issues and run
                metadata will be replaced.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPullProductionOpen(false)}
                disabled={pullProductionMutation.isPending}
                data-testid="button-cancel-pull-production-cache"
              >
                Cancel
              </Button>
              <Button
                onClick={() => pullProductionMutation.mutate()}
                disabled={pullProductionMutation.isPending}
                data-testid="button-confirm-pull-production-cache"
              >
                {pullProductionMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <DownloadCloud className="h-4 w-4" />
                )}
                Sync with production issues
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog
        open={!!confirmGate}
        onOpenChange={(open) => {
          if (!open && confirmGate) {
            confirmGate.resolve(false);
            setConfirmGate(null);
          }
        }}
      >
        <DialogContent data-testid="dialog-confirm-diagnostics">
          <DialogHeader>
            <DialogTitle>
              {confirmGate ? diagnosticsConfirmCopy(confirmGate.info).title : "Run diagnostics?"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {confirmGate
                    ? diagnosticsConfirmCopy(confirmGate.info).body
                    : "Confirm to start a diagnostics job."}
                </p>
                <p className="text-foreground">
                  Diagnostics can take minutes on a full site. Confirm only when you want a new background job.
                </p>
                <button
                  type="button"
                  className="text-xs text-primary underline-offset-2 hover:underline"
                  onClick={() => setConfirmAdvancedOpen((v) => !v)}
                  data-testid="button-diagnostics-confirm-read-more"
                >
                  {confirmAdvancedOpen ? "Hide advanced" : "Read more (advanced)"}
                </button>
                {confirmAdvancedOpen && (
                  <ul className="list-disc pl-5 text-xs space-y-1 text-left">
                    <li>
                      <code className="text-[10px]">server/services/diagnosticsJobService.ts</code> — confirm gate +
                      last full site-wide duration from job envelopes
                    </li>
                    <li>
                      <code className="text-[10px]">{"{contentRoot}/.cache/diagnostics-jobs/"}</code> — job envelopes
                      used for duration stats
                    </li>
                    <li>
                      MCP <code className="text-[10px]">run_entry_diagnostics</code> uses the same gate (
                      <code className="text-[10px]">confirm: true</code> /{" "}
                      <code className="text-[10px]">confirm_run_diagnostics</code>)
                    </li>
                  </ul>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                confirmGate?.resolve(false);
                setConfirmGate(null);
              }}
              data-testid="button-cancel-diagnostics-confirm"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                confirmGate?.resolve(true);
                setConfirmGate(null);
              }}
              data-testid="button-confirm-diagnostics-run"
            >
              Run diagnostics
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-0">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 border-b border-border" data-testid="cache-summary-bar">
          <Card
            role="button"
            tabIndex={0}
            aria-pressed={errorsKpiActive}
            className={`rounded-none cursor-pointer ${kpiActiveClass(errorsKpiActive)}`}
            onClick={() => {
              setActiveKpiTab("errors");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveKpiTab("errors");
              }
            }}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-destructive">{kpiSummary.errors}</p>
              <p className="text-xs text-muted-foreground">Errors</p>
            </CardContent>
          </Card>
          <Card
            role="button"
            tabIndex={0}
            aria-pressed={warningsKpiActive}
            className={`rounded-none cursor-pointer ${kpiActiveClass(warningsKpiActive)}`}
            onClick={() => {
              setActiveKpiTab("warnings");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveKpiTab("warnings");
              }
            }}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-chart-2">{kpiSummary.warnings}</p>
              <p className="text-xs text-muted-foreground">Warnings</p>
            </CardContent>
          </Card>
          <Card
            role="button"
            tabIndex={0}
            aria-pressed={uniqueKpiActive}
            className={`rounded-none cursor-pointer ${kpiActiveClass(uniqueKpiActive)}`}
            onClick={() => {
              setActiveKpiTab("unique");
              setFreshUrlFilter("all");
              setFreshUrlSearch("");
              setFreshUrlPage(1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveKpiTab("unique");
                setFreshUrlFilter("all");
                setFreshUrlSearch("");
                setFreshUrlPage(1);
              }
            }}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{kpiSummary.urls}</p>
              <p className="text-xs text-muted-foreground">Unique URLs</p>
            </CardContent>
          </Card>
          <Card
            role="button"
            tabIndex={0}
            aria-pressed={coverageKpiActive}
            className={`rounded-none cursor-pointer ${kpiActiveClass(coverageKpiActive)}`}
            onClick={() => {
              setActiveKpiTab("coverage");
              setFreshUrlFilter("fresh");
              setFreshUrlSearch("");
              setFreshUrlPage(1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveKpiTab("coverage");
                setFreshUrlFilter("fresh");
                setFreshUrlSearch("");
                setFreshUrlPage(1);
              }
            }}
          >
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-foreground" data-testid="text-coverage-mean">
                {coverageSummary ? `${coverageSummary.meanPercent}%` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Avg coverage</p>
              {coverageSummary && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {coverageSummary.fullyCovered}/{coverageSummary.totalUrls} fully covered
                </p>
              )}
            </CardContent>
          </Card>
          <Card
            role="button"
            tabIndex={0}
            aria-pressed={completedKpiActive}
            className={`rounded-none cursor-pointer ${kpiActiveClass(completedKpiActive)}`}
            onClick={() => {
              setActiveKpiTab("completed");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveKpiTab("completed");
              }
            }}
          >
            <CardContent className="p-4 text-center">
              <p
                className="text-2xl font-bold text-emerald-600 dark:text-emerald-400"
                data-testid="text-resolved-count"
              >
                {resolvedSummaryData?.resolvedCount ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">Resolved</p>
              {resolvedSummaryData && resolvedSummaryData.reopened > 0 ? (
                <p className="text-[11px] text-muted-foreground mt-0.5" data-testid="text-resolved-reopened">
                  {resolvedSummaryData.reopened} reopened
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

      {(freshKpiView === "resolved" || (freshKpiView === "issues" && openIssueCount > 0)) && (
        <div className="space-y-3" data-testid="cache-issue-filters">
          <div className="flex flex-wrap items-center gap-2 border-x border-border pt-3 px-6 bg-muted">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search issues…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                data-testid="input-search-issues"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1" data-testid="page-path-filter">
              <Popover open={pageFilterOpen} onOpenChange={setPageFilterOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="relative toggle-elevate max-w-[280px]"
                    title={pagePathFilter || undefined}
                    data-testid="button-page-url-filter"
                  >
                    <span className="truncate">Page or URL</span>
                    <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70 shrink-0" />
                    <FilterCornerBadge count={pagePathFilter ? 1 : 0} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-0">
                  <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
                    <p className="text-xs font-medium text-muted-foreground truncate" title={pagePathFilter || undefined}>
                      {pagePathFilter
                        ? `Filtering: ${pagePathFilter}`
                        : "Filter issues by page or custom URL"}
                    </p>
                    {pagePathFilter && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs shrink-0"
                        onClick={() => setPagePathFilter("")}
                        data-testid="button-clear-page-filter"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <SitemapSearch
                    embedded
                    value={pagePathFilter}
                    onChange={(value) => setPagePathFilter(normalizeIssuePath(value))}
                    onClose={() => setPageFilterOpen(false)}
                    placeholder="Filter by page…"
                    testId="sitemap-page-filter"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="relative toggle-elevate"
                    data-testid="button-scope-filter"
                  >
                    Error scope
                    <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
                    <FilterCornerBadge count={categoryFilters.length} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Toggle scopes to filter issues
                    </p>
                    {categoryFilters.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setCategoryFilters([])}
                        data-testid="button-scope-clear"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5" data-testid="scope-tag-cloud">
                    {scopeCategories.map((c) => {
                      const active = categoryFilters.includes(c.key);
                      return (
                        <Button
                          key={c.key}
                          variant={active ? "default" : "outline"}
                          size="sm"
                          className="h-7 toggle-elevate"
                          onClick={() => {
                            setCategoryFilters((prev) =>
                              prev.includes(c.key)
                                ? prev.filter((v) => v !== c.key)
                                : [...prev, c.key],
                            );
                          }}
                          data-testid={`button-category-${c.key}`}
                        >
                          {c.label}
                        </Button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              {validatorFilterOptions.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="relative toggle-elevate"
                      data-testid="button-validator-filter"
                    >
                      Validators
                      <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
                      <FilterCornerBadge count={validatorFilters.length} />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Toggle validators to filter issues. All validators are listed; only those with
                        cached issues return rows.
                      </p>
                      {validatorFilters.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setValidatorFilters([])}
                          data-testid="button-validator-clear"
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5" data-testid="validator-tag-cloud">
                      {validatorFilterOptions.map((name) => {
                        const active = validatorFilters.includes(name);
                        const isLegacy = name === "legacy";
                        return (
                          <Button
                            key={name}
                            variant={active ? "default" : "outline"}
                            size="sm"
                            className="h-7 toggle-elevate"
                            onClick={() => {
                              setValidatorFilters((prev) =>
                                prev.includes(name)
                                  ? prev.filter((v) => v !== name)
                                  : [...prev, name],
                              );
                            }}
                            data-testid={`button-validator-${name}`}
                          >
                            {isLegacy ? (
                              <span
                                className={
                                  active
                                    ? "text-[10px] lowercase opacity-90"
                                    : "text-[10px] text-muted-foreground lowercase"
                                }
                              >
                                {name}
                              </span>
                            ) : (
                              name
                            )}
                          </Button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              <Button
                variant={priorAttemptsFilter ? "default" : "outline"}
                size="sm"
                className="toggle-elevate"
                onClick={() => patchView({ priorAttempts: !priorAttemptsFilter })}
                data-testid="button-filter-prior-attempts"
              >
                Has prior attempts
              </Button>
            </div>
          </div>
        </div>
      )}

      {freshKpiView === "issues" && jobPending && openIssueCount === 0 && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
            <p className="mt-4 text-muted-foreground">Running diagnostics job…</p>
          </div>
        </div>
      )}

      {freshKpiView === "issues" && !jobPending && !cacheIssuesLoading && openIssueCount === 0 && (
        <Card className="rounded-t-none border-t-0 bg-muted/70">
          <CardContent className="p-8 text-center">
            <Stethoscope className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              {canMutateMetrics
                ? "No cached diagnostics yet — run Refresh stale or Hard refresh."
                : "No cached diagnostics yet. Ask a Webmaster (or staff with edit access) to run a refresh."}
            </p>
            {canMutateMetrics && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  onClick={() => runAllMutation.mutate("max_age")}
                  data-testid="button-run-all-empty"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh stale
                </Button>
                <Button
                  variant="outline"
                  onClick={() => runAllMutation.mutate("hard")}
                  data-testid="button-hard-refresh-empty"
                >
                  <Play className="h-4 w-4" />
                  Hard refresh
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {freshKpiView === "issues" && openIssueCount > 0 && (
        <Card className="rounded-t-none border-t-0 bg-muted/70" data-testid="cached-issues-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Cached issues ({filteredIssueCount}
              {filteredIssueCount !== openIssueCount ? ` of ${openIssueCount}` : ""})
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[32rem] overflow-auto space-y-2 !p-0">
            <div key={issueListFilterKey}>
            {displayedIssues.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center" data-testid="text-no-issues-match">
                No issues match your filters
              </p>
            ) : (
              displayedIssues.map((issue, idx) => {
                const asValidatorIssue = cacheRowToValidatorIssue(issue);
                const conflict = parseRedirectConflict(asValidatorIssue);
                const rowKey = `${issue.url || issue.file || "site"}|${issue.code}|${
                  issue.validator || ""
                }|${issue.category || ""}|${issue.severity}`;
                return (
                  <div
                    key={rowKey}
                    className="text-xs border-b border-border/60 px-4 py-2 hover:bg-white"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          issue.severity === "error"
                            ? "text-destructive font-medium"
                            : "text-chart-2 font-medium"
                        }
                      >
                        {issue.severity}
                      </span>
                      <span className="text-muted-foreground">{issue.validator || "unknown"}</span>
                      {issue.category && (
                        <Badge variant="outline" className="text-[10px]">
                          {issue.category}
                        </Badge>
                      )}
                      <code>{issue.code}</code>
                      {(() => {
                        const label = issueLayerLabel(issue.entryKey, issue.file);
                        if (!label) return null;
                        return (
                          <Badge
                            variant="secondary"
                            className="text-[10px]"
                            data-testid="badge-issue-layer"
                          >
                            {label}
                          </Badge>
                        );
                      })()}
                      {issue.lastFullRunAt && (
                        <span className="text-muted-foreground text-[10px] ml-auto">
                          detected {formatDistanceToNow(new Date(issue.lastFullRunAt), { addSuffix: true })}
                        </span>
                      )}
                      {issue.claimed && (
                        <span
                          className="text-muted-foreground text-[10px]"
                          data-testid="badge-issue-claimed"
                        >
                          claimed {formatIssueActorLine(issue.claimed.by, issue.claimed.actor)}
                        </span>
                      )}
                      {!issue.claimed && issue.completed && (
                        <span
                          className="text-muted-foreground text-[10px]"
                          data-testid="badge-issue-completed"
                        >
                          completed {formatIssueActorLine(issue.completed.by, issue.completed.actor)}
                        </span>
                      )}
                      {!issue.completed &&
                        issue.attempts &&
                        issue.attempts.length > 0 && (
                          <span
                            className="text-muted-foreground text-[10px]"
                            data-testid="badge-issue-prior-attempts"
                            title={
                              issue.attempts[0]?.reason === "ttl_expired"
                                ? "Last claim expired (30m)"
                                : issue.attempts[0]?.report || "Prior attempt"
                            }
                          >
                            tried {issue.attempts.length}×
                            {issue.attempts[0]
                              ? ` · ${formatIssueActorLine(
                                  issue.attempts[0].by,
                                  issue.attempts[0].actor,
                                )}`
                              : ""}
                          </span>
                        )}
                      {issue.url ? (
                        <RecheckIssueButton
                          url={issue.url}
                          code={issue.code}
                          validator={issue.validator}
                          category={issue.category}
                          startWithConfirm={startWithConfirm}
                          onResolved={() =>
                            void queryClient.invalidateQueries({
                              queryKey: ["/api/validation/cache-issues"],
                              exact: false,
                            })
                          }
                        />
                      ) : issue.file ? (
                        <RecheckFileIssueButton
                          file={issue.file}
                          code={issue.code}
                          category={issue.category}
                          validator={issue.validator}
                          startWithConfirm={startWithConfirm}
                          onResolved={() =>
                            void queryClient.invalidateQueries({
                              queryKey: ["/api/validation/cache-issues"],
                              exact: false,
                            })
                          }
                        />
                      ) : null}
                      {conflict && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 ml-auto"
                          onClick={() => openResolver(asValidatorIssue)}
                          data-testid={`button-resolve-cache-${issue.code}-${idx}`}
                        >
                          <Wrench className="h-3.5 w-3.5" />
                          Resolve
                        </Button>
                      )}
                    </div>
                    <div className="text-foreground mt-0.5">
                      {formatSitePathsInText(issue.message, formatSitePath)}
                    </div>
                    {issue.suggestion && (
                      <TruncatableSuggestion
                        text={issue.suggestion}
                        formatSitePath={formatSitePath}
                      />
                    )}
                    {!issue.completed &&
                      issue.attempts &&
                      issue.attempts.length > 0 && (
                        <details className="mt-1 text-[10px] text-muted-foreground" data-testid="details-prior-attempts">
                          <summary className="cursor-pointer hover:text-foreground">
                            What went wrong ({issue.attempts.length})
                          </summary>
                          <ul className="mt-1 space-y-1 pl-3 list-disc">
                            {issue.attempts.map((a, ai) => (
                              <li key={`${a.at}-${ai}`}>
                                {a.reason === "ttl_expired"
                                  ? "Claim expired (30m)"
                                  : "Released"}{" "}
                                · {formatIssueActorLine(a.by, a.actor)}
                                {a.claimedBy && a.claimedBy !== a.by
                                  ? ` (held by ${a.claimedBy})`
                                  : ""}
                                {a.report ? ` — ${a.report}` : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    {issue.url && <div className="text-muted-foreground">{issue.url}</div>}
                    {issue.file && (
                      <div className="text-muted-foreground font-mono truncate" title={issue.file}>
                        {formatSitePath(issue.file)}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            </div>
            {filteredIssueCount > ISSUE_DISPLAY_CAP && (
              <p className="text-xs text-muted-foreground">
                Showing first {ISSUE_DISPLAY_CAP} of {filteredIssueCount}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {freshKpiView === "resolved" && (
        <Card className="rounded-t-none border-t-0 bg-muted/70" data-testid="resolved-issues-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Resolved issues ({resolvedTotal})
            </CardTitle>
            <p className="text-xs text-muted-foreground font-normal">
              History of fixes — not current blockers. Reopened badge means diagnostics found the
              problem again.
            </p>
          </CardHeader>
          <CardContent className="max-h-[32rem] overflow-auto space-y-2 !p-0">
            {resolvedIssuesLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Loading resolved history…</p>
            ) : resolvedRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center" data-testid="text-no-resolved-issues">
                No resolved issues match your filters.
              </p>
            ) : (
              resolvedRows.map((row, idx) => (
                <div
                  key={`${row.issueId}-${row.resolvedAt}-${idx}`}
                  className="text-xs border-b border-border/60 px-4 py-2 hover:bg-white"
                  data-testid={`resolved-issue-row-${idx}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        row.severity === "error"
                          ? "text-destructive font-medium"
                          : "text-chart-2 font-medium"
                      }
                    >
                      {row.severity}
                    </span>
                    <span className="text-muted-foreground">{row.validator || "unknown"}</span>
                    {row.category ? (
                      <Badge variant="outline" className="text-[10px]">
                        {row.category}
                      </Badge>
                    ) : null}
                    <code>{row.code}</code>
                    {row.reopenedAt ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        data-testid="badge-resolved-reopened"
                      >
                        Reopened
                      </Badge>
                    ) : null}
                    <span className="text-muted-foreground text-[10px] ml-auto">
                      resolved {formatDistanceToNow(new Date(row.resolvedAt), { addSuffix: true })}
                    </span>
                    <span className="text-muted-foreground text-[10px] w-full sm:w-auto">
                      by {formatIssueActorLine(row.resolvedBy, row.actor)}
                    </span>
                  </div>
                  <div className="text-foreground mt-0.5">
                    {formatSitePathsInText(row.message, formatSitePath)}
                  </div>
                  {row.report ? (
                    <p className="text-muted-foreground mt-1 border-l-2 border-border/80 pl-2">
                      {row.report}
                    </p>
                  ) : null}
                  {row.url ? <div className="text-muted-foreground">{row.url}</div> : null}
                </div>
              ))
            )}
            {resolvedTotal > RESOLVED_PAGE_SIZE && (
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resolvedOffset === 0}
                  onClick={() => setResolvedOffset((o) => Math.max(0, o - RESOLVED_PAGE_SIZE))}
                  data-testid="button-resolved-prev"
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  {resolvedOffset + 1}–{Math.min(resolvedOffset + RESOLVED_PAGE_SIZE, resolvedTotal)} of{" "}
                  {resolvedTotal}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resolvedOffset + RESOLVED_PAGE_SIZE >= resolvedTotal}
                  onClick={() => setResolvedOffset((o) => o + RESOLVED_PAGE_SIZE)}
                  data-testid="button-resolved-next"
                >
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {freshKpiView === "fresh_urls" && (
        <Card className="rounded-t-none border-t-0 bg-muted/70" data-testid="fresh-urls-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Coverage URLs ({freshUrlTotalItems})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 bg-muted rounded-md p-2">
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search URLs…"
                  value={freshUrlSearch}
                  onChange={(e) => {
                    setFreshUrlSearch(e.target.value);
                    setFreshUrlPage(1);
                  }}
                  className="pl-10"
                  data-testid="input-search-fresh-urls"
                />
              </div>
              <div className="flex items-center gap-1">
                {[
                  ["all", "All"],
                  ["fresh", "Fresh"],
                  ["not_fresh", "Not fresh"],
                ].map(([value, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={freshUrlFilter === value ? "default" : "outline"}
                    onClick={() => {
                      setFreshUrlFilter(value as "all" | "fresh" | "not_fresh");
                      setFreshUrlPage(1);
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="max-h-[32rem] overflow-auto space-y-2">
              {isFreshUrlsFetching ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Loading URLs…</p>
              ) : freshUrlItems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No URLs match your search.</p>
              ) : (
                freshUrlItems.map((item) => (
                  <div key={item.url} className="text-xs border-b border-border/60 pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={item.isFresh
                          ? "text-[10px] border-green-500/40 bg-green-500/10 text-green-400"
                          : "text-[10px] border-destructive/40 bg-destructive/10 text-destructive"}
                      >
                        {item.isFresh ? "fresh" : "not fresh"}
                      </Badge>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Badge variant="outline" className="text-[10px] cursor-pointer">
                            {item.coveredCount}/{item.expectedCount} · {item.coveragePercent}%
                          </Badge>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-72 text-sm space-y-1.5">
                          <p className="font-medium text-foreground">Validator coverage</p>
                          <p className="text-muted-foreground">
                            <span className="font-medium text-foreground">{item.coveredCount} of {item.expectedCount}</span> checks have run on this URL ({item.coveragePercent}%).
                          </p>
                          <p className="text-muted-foreground text-xs">
                            Each "check" is a validator — a rule that scans this page for issues (broken links, SEO fields, required content, etc.). A higher number means more of the site's checks have looked at this page.
                          </p>
                          {item.coveredCount < item.expectedCount && (
                            <p className="text-xs text-amber-400">
                              {item.expectedCount - item.coveredCount} check{item.expectedCount - item.coveredCount === 1 ? "" : "s"} haven't run yet. Try "Hard refresh" to revalidate all URLs.
                            </p>
                          )}
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 mt-0.5">
                      <div className="text-foreground">{item.url}</div>
                      <div className="text-muted-foreground shrink-0">
                        {item.lastFullRunAt ? `Last full run ${formatRelativeAgo(item.lastFullRunAt)}` : "Never fully validated"}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {freshUrlTotalPages > 1 && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Page {freshUrlPage} of {freshUrlTotalPages} · {freshUrlTotalItems} URLs
                </p>
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        aria-disabled={freshUrlPage <= 1}
                        className={freshUrlPage <= 1 ? "pointer-events-none opacity-50" : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          if (freshUrlPage > 1) setFreshUrlPage((p) => p - 1);
                        }}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        aria-disabled={freshUrlPage >= freshUrlTotalPages}
                        className={freshUrlPage >= freshUrlTotalPages ? "pointer-events-none opacity-50" : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          if (freshUrlPage < freshUrlTotalPages) setFreshUrlPage((p) => p + 1);
                        }}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      </div>

      <RedirectConflictResolverModal
        open={resolveModalOpen}
        onOpenChange={setResolveModalOpen}
        conflict={activeConflict}
        onResolved={() => {
          void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-issues"], exact: false });
          if (isDiagnosticsInFlight(jobPanel, jobsListData?.jobs)) {
            toast(REDIRECT_FIX_DEFERRED_TOAST);
            return;
          }
          runSingleMutation.mutate({ name: "redirects", deferOnBusy: true });
        }}
      />
    </div>
  );
}


const DIAGNOSTICS_TABS: {
  id: "global-health" | "leads" | "runtime-issues" | "seo" | "geo" | "funnel";
  label: string;
  href: string;
  Icon: LucideIcon;
}[] = [
  { id: "global-health", label: "Global", href: "/private/diagnostics", Icon: Globe },
  { id: "leads", label: "Leads", href: "/private/diagnostics/leads", Icon: Users },
  { id: "runtime-issues", label: "Runtime", href: "/private/diagnostics/runtime-issues", Icon: AlertTriangle },
  { id: "seo", label: "SEO", href: "/private/diagnostics/seo", Icon: Crosshair },
  { id: "geo", label: "GEO", href: "/private/diagnostics/geo", Icon: Brain },
  { id: "funnel", label: "Funnel", href: "/private/diagnostics/funnel", Icon: Filter },
];

type DiagnosticsTabId = (typeof DIAGNOSTICS_TABS)[number]["id"];

function resolveDiagnosticsTab(pathname: string): DiagnosticsTabId {
  if (pathname.endsWith("/leads")) return "leads";
  if (pathname.endsWith("/runtime-issues")) return "runtime-issues";
  if (pathname.endsWith("/seo")) return "seo";
  if (pathname.endsWith("/geo")) return "geo";
  if (pathname.endsWith("/funnel")) return "funnel";
  if (pathname.endsWith("/global-health")) return "global-health";
  return "global-health";
}

function tabHref(id: DiagnosticsTabId): string {
  return DIAGNOSTICS_TABS.find((t) => t.id === id)?.href ?? "/private/diagnostics";
}

export default function DiagnosticsPage() {
  const [pathname, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const activeTab = resolveDiagnosticsTab(pathname);

  const onTabChange = (next: string) => {
    const id = next as DiagnosticsTabId;
    setLocation(tabHref(id));
  };

  return (
    <MetricsAccessGate>
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <Tabs value={activeTab} onValueChange={onTabChange}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <div className="flex items-center gap-3">
                <Link href="/">
                  <Button variant="ghost" size="icon" data-testid="button-back-home">
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                </Link>
                <div className="flex items-center gap-2">
                  <Stethoscope className="h-5 w-5 text-primary" />
                  <h1 className="text-lg font-semibold text-foreground" data-testid="text-diagnostics-title">
                    Diagnostics
                  </h1>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isMobile ? (
                  <Select value={activeTab} onValueChange={onTabChange}>
                    <SelectTrigger className="w-[200px]" data-testid="select-diagnostics-tab">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIAGNOSTICS_TABS.map((t) => (
                        <SelectItem key={t.id} value={t.id} data-testid={`select-tab-${t.id}`}>
                          <span className="inline-flex items-center gap-2">
                            <t.Icon className="h-3.5 w-3.5" />
                            {t.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <ToggleButtonBarList data-testid="tabs-diagnostics" className="flex">
                    {DIAGNOSTICS_TABS.map((t) => (
                      <ToggleButtonBarTrigger key={t.id} value={t.id} data-testid={`tab-${t.id}`} className="gap-1.5">
                        <t.Icon className="h-3.5 w-3.5" />
                        {t.label}
                      </ToggleButtonBarTrigger>
                    ))}
                  </ToggleButtonBarList>
                )}
              </div>
            </div>
            <TabsContent value="global-health">
              <GlobalHealthTab onOpenLeads={() => setLocation("/private/diagnostics/leads")} />
            </TabsContent>
            <TabsContent value="leads">
              <LeadsTab />
            </TabsContent>
            <TabsContent value="runtime-issues">
              <RuntimeIssuesTab />
            </TabsContent>
            <TabsContent value="seo">
              <DiagnosticsSeoPanel />
            </TabsContent>
            <TabsContent value="geo">
              <DiagnosticsGeoPanel />
            </TabsContent>
            <TabsContent value="funnel">
              <DiagnosticsFunnelPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </MetricsAccessGate>
  );
}
