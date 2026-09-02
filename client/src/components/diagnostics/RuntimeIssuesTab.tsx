import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  CircleCheck,
  Copy,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  Route,
  TestTube,
  X,
  EyeOff,
  Filter,
} from "lucide-react";
import { IconAlertTriangle, IconDownload, IconInfoCircle, IconRefresh, IconTrash } from "@tabler/icons-react";
import { AddRedirectDialog } from "@/components/editing/AddRedirectDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { apiFetch } from "@/lib/queryClient";
import {
  FILTER_ALL,
  applyRuntimeIssueView,
  countActiveListFilters,
  filterRuntimeIssues,
  isRuntimeIssueFiltersActive,
  paginateRuntimeIssues,
  RUNTIME_ISSUES_PAGE_SIZE,
  deviceLabel,
  sortDevices,
  uniqueSorted,
  windowedSourceTags,
  type RuntimeIssueFilters,
} from "./runtime-issues-filters";
import { downloadRuntimeIssuesCsv } from "./runtime-issues-csv";
import {
  parseRuntimeIssueSearch,
  serializeRuntimeIssueSearch,
  type RuntimeIssueViewState,
} from "./runtime-issues-url";
import { RuntimeIssueSourceBadge } from "./RuntimeIssueSourceBadge";
import { RuntimeIssueQueryBadges } from "./RuntimeIssueQueryBadges";
import { RuntimeIssuesSparkline } from "./RuntimeIssuesSparkline";
import { referrerDisplayHost } from "./runtime-issues-referrer";
import { RuntimeIssueListFiltersDialog } from "./RuntimeIssueListFiltersDialog";
import { RuntimeIssueIngestionFiltersDialog } from "./RuntimeIssueIngestionFiltersDialog";
import { RuntimeIssueIgnoreRulesDialog } from "./RuntimeIssueIgnoreRulesDialog";
import type { ByHour, RuntimeIssueProbe, RuntimeQueryAttribution } from "@shared/runtime-issues";
import type { IgnoreRule, IgnoreRuleInput } from "@shared/runtime-issues-ignore";
import { aggregateHitsByDay, isRuntimeIssueProbeSuccess, localePrefixFromPath } from "@shared/runtime-issues";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { useContentTypes } from "@/hooks/useContentTypes";
import { entryKeyToPageUrl } from "@/lib/entryKeyToPageUrl";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";

interface RuntimeIssueRow {
  fingerprint: string;
  kind: string;
  path: string;
  locale: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  sampleReferrer?: string;
  uaBucket?: string;
  hostname?: string;
  likelyBot?: boolean;
  sources?: string[];
  byHour?: ByHour;
  count30?: number;
  lastProbe?: RuntimeIssueProbe;
  cmsReferrerCount?: number;
  queryAttribution?: RuntimeQueryAttribution;
}

interface RuntimeIssuesResponse {
  site: string;
  updatedAt: number;
  totalCount: number;
  issues: RuntimeIssueRow[];
  ignored?: IgnoreRule[];
  dropScrapers?: boolean;
  linkIndexUpdatedAt?: string | null;
}

function formatTs(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function publicPathHref(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function isLocalHost(host: string): boolean {
  const hostname = host.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
}

function fullPublicUrl(relativePath: string, hostname?: string): string {
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  const host = hostname?.trim();
  if (host && !isLocalHost(host)) {
    const origin = host.includes("://") ? host.replace(/\/$/, "") : `https://${host.replace(/\/$/, "")}`;
    return `${origin}${relativePath}`;
  }
  if (typeof window !== "undefined") return `${window.location.origin}${relativePath}`;
  return relativePath;
}

function referrerFullUrl(referrer: string): string {
  const trimmed = referrer.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return fullPublicUrl(publicPathHref(trimmed));
}

function formatRelativeIndexAge(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "unknown";
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function CmsLinksCell({
  path,
  count,
  linkIndexUpdatedAt,
}: {
  path: string;
  count: number;
  linkIndexUpdatedAt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const contentTypes = useContentTypes();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/runtime-issues/referrers", path],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/runtime-issues/referrers?path=${encodeURIComponent(path)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load internal link referrers");
      return res.json() as {
        count: number;
        entryKeys: string[];
        referrers: Array<{ entryKey: string }>;
        linkIndexUpdatedAt: string | null;
      };
    },
    enabled: open && count > 0,
  });

  if (count <= 0) {
    return (
      <span className="opacity-60" title="No internal links indexed — index may be stale or empty">
        —
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          data-testid={`cms-links-${path}`}
        >
          {count} {count === 1 ? "entry" : "entries"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 text-xs" align="end">
        <p className="font-medium text-foreground mb-1">Pages linking here</p>
        <p className="text-muted-foreground mb-2 leading-snug">
          From published content that points at this URL. Updated{" "}
          {formatRelativeIndexAge(data?.linkIndexUpdatedAt ?? linkIndexUpdatedAt)}. Menus, app
          routes, and external sites are not included.
        </p>
        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {data && data.referrers.length > 0 && (
          <ul className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {data.referrers.map((r) => {
              const href = entryKeyToPageUrl(r.entryKey, contentTypes);
              return (
                <li
                  key={r.entryKey}
                  className="flex items-center gap-1.5 min-w-0"
                  data-testid={`internal-link-referrer-${r.entryKey}`}
                >
                  <code className="font-mono text-[11px] truncate min-w-0 flex-1">{r.entryKey}</code>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={`Open ${r.entryKey} in a new tab`}
                      data-testid={`link-internal-referrer-open-${r.entryKey}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {data && data.count > data.referrers.length && (
          <p className="text-muted-foreground mt-1">
            and {data.count - data.referrers.length} more…
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function InternalLinksColumnHeader({
  linkIndexUpdatedAt,
}: {
  linkIndexUpdatedAt?: string | null;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <div className="inline-flex items-center justify-end gap-1 w-full">
      <span>Internal Links</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex text-muted-foreground hover:text-foreground"
            aria-label="What are Internal Links?"
            data-testid="button-internal-links-info"
          >
            <IconInfoCircle className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-80 space-y-2 text-sm"
          data-testid="popover-internal-links-info"
        >
          <p className="font-medium text-foreground">What Internal Links means</p>
          <p className="text-muted-foreground">
            How many of your other pages link to this missing URL. Use it to see if fixing the 404
            matters for people browsing your site. A dash does not mean nobody links here — menus and
            code-built links are not counted.
          </p>
          <p className="text-xs text-muted-foreground">
            Index updated {formatRelativeIndexAge(linkIndexUpdatedAt)}.
          </p>
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                data-testid="button-internal-links-read-more"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                />
                Read more (advanced)
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-1.5 text-xs text-muted-foreground">
              <p>
                Counts come from the outbound link index (YAML + DB body fields). Not routing truth —
                run site diagnostics (<code className="text-[11px]">site-link-index</code>) for a full
                refresh.
              </p>
            </CollapsibleContent>
          </Collapsible>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function useCopyToast() {
  const { toast } = useToast();
  return async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };
}

function probeFailureToast(status: RuntimeIssueProbe["status"] | undefined): string {
  switch (status) {
    case "broken_redirect":
      return "Redirect found but the destination is missing or still a 404.";
    case "mismatch":
      return "Redirect index and live HTTP disagree for this URL.";
    case "loop":
      return "Redirect cycle detected.";
    default:
      return "Still a 404 — no matching redirect or live page.";
  }
}

function probeSourceLabel(probe: RuntimeIssueProbe): string {
  if (probe.status === "page") return "It now resolves as a live page.";
  if (probe.matchType === "canonical") {
    return "A canonical URL match sends visitors to the destination below (not a custom YAML redirect).";
  }
  if (probe.destination && /^https?:\/\//i.test(probe.destination)) {
    return "External destination (fetched):";
  }
  return "A redirect is implemented. Destination:";
}

function RuntimeIssueProbeControl({
  issue,
  hostname,
  probing,
  onTest,
}: {
  issue: RuntimeIssueRow;
  hostname?: string;
  probing: boolean;
  onTest: () => void;
}) {
  const probe = issue.lastProbe;
  const resolved = isRuntimeIssueProbeSuccess(probe?.status);
  const destination = probe?.destination;
  const destHref = destination ? publicPathHref(destination) : undefined;
  const destFull = destHref ? fullPublicUrl(destHref, hostname) : undefined;

  if (probing) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-xs shrink-0"
        disabled
        data-testid={`button-runtime-issue-testing-${issue.fingerprint}`}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Test
      </Button>
    );
  }

  if (!resolved) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-xs shrink-0"
        onClick={onTest}
        data-testid={`button-runtime-issue-test-${issue.fingerprint}`}
      >
        <TestTube className="h-3.5 w-3.5" />
        Test
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 shrink-0 text-status-online"
          aria-label="Probe passed"
          data-testid={`button-runtime-issue-resolved-${issue.fingerprint}`}
        >
          <CircleCheck className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 text-sm" data-testid={`popover-runtime-issue-resolved-${issue.fingerprint}`}>
        <p className="font-medium text-foreground">This URL no longer 404s.</p>
        <p className="text-muted-foreground">{probeSourceLabel(probe)}</p>
        {destination ? (
          <p className="font-mono text-xs break-all">
            {destHref ? (
              <a
                href={destHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {destination}
              </a>
            ) : (
              destination
            )}
          </p>
        ) : null}
        {probe.chained && probe.hops && probe.hops.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px] mr-1">
              Chained
            </Badge>
            {probe.hops.join(" → ")}
          </p>
        ) : null}
        {issue.lastSeen > probe.at ? (
          <p className="text-xs text-muted-foreground">
            404 hits were still recorded after this test ({formatTs(issue.lastSeen)}).
          </p>
        ) : null}
        {probe.at ? (
          <p className="text-xs text-muted-foreground">Last tested {formatTs(probe.at)}</p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          onClick={onTest}
          data-testid={`button-runtime-issue-test-again-${issue.fingerprint}`}
        >
          Test again
        </Button>
        {destFull ? (
          <p className="text-[10px] text-muted-foreground break-all">{destFull}</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function RuntimeIssuePathMenu({
  path,
  hostname,
  fingerprint,
  onAddRedirect,
  onIgnore,
}: {
  path: string;
  hostname?: string;
  fingerprint: string;
  onAddRedirect?: (path: string, fingerprint: string) => void;
  onIgnore?: (fingerprint: string) => void;
}) {
  const copy = useCopyToast();
  const relative = publicPathHref(path);
  const full = fullPublicUrl(relative, hostname);
  const pathLocale = localePrefixFromPath(path);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 min-w-0 max-w-full text-left text-primary hover:underline"
          title={pathLocale ? `${pathLocale} ${path}` : path}
          data-testid={`button-runtime-issue-path-${fingerprint}`}
        >
          {pathLocale ? (
            <span
              className="shrink-0 inline-flex"
              title={pathLocale}
              data-testid={`flag-runtime-issue-locale-${fingerprint}`}
            >
              <LocaleFlag locale={pathLocale} className="w-3.5 h-2.5 rounded-sm" />
            </span>
          ) : null}
          <span className="truncate">{path}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem
          onClick={() => void copy("Full link", full)}
          data-testid={`menu-runtime-issue-copy-full-${fingerprint}`}
        >
          <Copy className="h-4 w-4" />
          Copy full link
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void copy("Relative path", relative)}
          data-testid={`menu-runtime-issue-copy-relative-${fingerprint}`}
        >
          <LinkIcon className="h-4 w-4" />
          Copy relative path
        </DropdownMenuItem>
        {onAddRedirect || onIgnore ? <DropdownMenuSeparator /> : null}
        {onAddRedirect ? (
          <DropdownMenuItem
            onClick={() => onAddRedirect(path, fingerprint)}
            data-testid={`menu-runtime-issue-add-redirect-${fingerprint}`}
          >
            <Route className="h-4 w-4" />
            Add redirect
          </DropdownMenuItem>
        ) : null}
        {onIgnore ? (
          <DropdownMenuItem
            onClick={() => onIgnore(fingerprint)}
            data-testid={`menu-runtime-issue-ignore-${fingerprint}`}
          >
            <EyeOff className="h-4 w-4" />
            Ignore from 404 log
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <a
            href={relative}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`menu-runtime-issue-open-${fingerprint}`}
          >
            <ExternalLink className="h-4 w-4" />
            Open in a new tab
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RuntimeIssueUaBadge({
  uaBucket,
  fingerprint,
}: {
  uaBucket?: string;
  fingerprint: string;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const bucket = uaBucket || "unknown";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer"
          aria-label="What is UA?"
          data-testid={`badge-runtime-ua-${fingerprint}`}
        >
          <Badge variant="outline" className="text-[10px]">
            UA: {deviceLabel(bucket).toLowerCase()}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-2 text-sm"
        data-testid={`popover-runtime-ua-${fingerprint}`}
      >
        <p className="font-medium text-foreground">How to use UA</p>
        <p className="text-muted-foreground">
          UA tells you who hit the missing URL, so you know whether to fix it. Desktop or mobile is
          usually a person — add a redirect. Search crawler or LLM crawler is Google or an AI bot; a
          missing URL there is an SEO issue. Social preview is a share unfurl. Scraper or likely bot is
          noise (Hide scrapers already drops most of those). Use the Device list filter to look at one
          kind at a time.
        </p>
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              data-testid={`button-runtime-ua-read-more-${fingerprint}`}
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              />
              Read more (advanced)
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-1.5 text-xs text-muted-foreground">
            <p>
              UA is a coarse group from the request’s User-Agent string — not the full User-Agent.
              Typical values: desktop, mobile, search crawler, LLM crawler, social preview, scraper,
              likely bot, or unknown (missing or unrecognized). Same buckets as the Device list filter.
            </p>
            <p className="font-mono">shared/runtime-issues.ts — classifyRuntimeHit / uaBucket</p>
          </CollapsibleContent>
        </Collapsible>
      </PopoverContent>
    </Popover>
  );
}

function RuntimeIssueReferrerBadge({
  referrer,
  fingerprint,
}: {
  referrer?: string;
  fingerprint: string;
}) {
  const copy = useCopyToast();
  const value = referrer?.trim();
  if (!value) return null;

  const host = referrerDisplayHost(value);
  const full = referrerFullUrl(value);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer max-w-[160px]"
          title={full}
          data-testid={`badge-runtime-referrer-${fingerprint}`}
        >
          <Badge variant="outline" className="text-[10px] max-w-[160px] truncate">
            {host}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-2 text-sm"
        data-testid={`popover-runtime-referrer-${fingerprint}`}
      >
        <p className="font-medium text-foreground">Referrer</p>
        <p className="font-mono text-xs break-all text-muted-foreground">{full}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() => void copy("Full link", full)}
            data-testid={`button-runtime-referrer-copy-${fingerprint}`}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
          <Button variant="outline" size="sm" className="h-7" asChild>
            <a
              href={full}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`link-runtime-referrer-open-${fingerprint}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </a>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SortIcon({
  col,
  sortKey,
  sortDir,
}: {
  col: RuntimeIssueViewState["sortKey"];
  sortKey: RuntimeIssueViewState["sortKey"];
  sortDir: RuntimeIssueViewState["sortDir"];
}) {
  if (col !== sortKey) return <ArrowUpDown className="inline ml-1 opacity-40" size={12} />;
  return sortDir === "asc" ? (
    <ArrowUp className="inline ml-1" size={12} />
  ) : (
    <ArrowDown className="inline ml-1" size={12} />
  );
}

function CornerCountBadge({ count, testId }: { count: number; testId: string }) {
  if (count <= 0) return null;
  return (
    <span
      className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-secondary px-1 text-[10px] font-semibold leading-none text-secondary-foreground"
      data-testid={testId}
    >
      {count}
    </span>
  );
}

export default function RuntimeIssuesTab() {
  const [pathname, setLocation] = useLocation();
  const searchString = useSearch();
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [listFiltersOpen, setListFiltersOpen] = useState(false);
  const [ingestionOpen, setIngestionOpen] = useState(false);
  const [ignoreRulesOpen, setIgnoreRulesOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [redirectFrom, setRedirectFrom] = useState<{ path: string; fingerprint: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [probingIds, setProbingIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasCapability } = useDebugAuth();
  const canIgnore = hasCapability("seo_settings");
  const canEditRedirects = hasCapability("edit_redirects");

  const view = useMemo(() => parseRuntimeIssueSearch(searchString), [searchString]);
  const { filters, sortKey, sortDir, page } = view;
  const { locale: localeFilter, device: deviceFilter, tz } = filters;

  const writeView = useCallback(
    (next: RuntimeIssueViewState) => {
      const qs = serializeRuntimeIssueSearch(next, searchString);
      const pathOnly = pathname.split("?")[0];
      setLocation(qs ? `${pathOnly}?${qs}` : pathOnly, { replace: true });
    },
    [pathname, searchString, setLocation],
  );

  const patchView = useCallback(
    (patch: Partial<Pick<RuntimeIssueViewState, "sortKey" | "sortDir">>) => {
      writeView({ ...view, ...patch, page: 1 });
    },
    [view, writeView],
  );

  const patchFilters = useCallback(
    (patch: Partial<RuntimeIssueFilters>) => {
      writeView({ ...view, filters: { ...view.filters, ...patch }, page: 1 });
    },
    [view, writeView],
  );

  const { data, isLoading, refetch, isFetching, isError, error } = useQuery<RuntimeIssuesResponse>({
    queryKey: ["/api/admin/runtime-issues"],
    queryFn: async () => {
      const res = await apiFetch("/api/admin/runtime-issues");
      if (!res.ok) throw new Error("Failed to fetch runtime issues");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/admin/runtime-issues/reset", { method: "POST" });
      if (!res.ok) throw new Error("Failed to reset 404 log");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/runtime-issues"] });
      setResetOpen(false);
    },
  });

  const pullMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/admin/runtime-issues/pull-production", { method: "POST" });
      const body = (await res.json()) as {
        success?: boolean;
        reason?: string;
        error?: string;
        issueCount?: number;
      };
      if (!res.ok || !body.success) {
        throw new Error(body.reason || body.error || "Failed to pull production 404 log");
      }
      return body;
    },
    onSuccess: (body) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/runtime-issues"] });
      setPullOpen(false);
      toast({
        title: "Pulled production 404 log",
        description: `Replaced this machine’s log with ${body.issueCount ?? 0} production issues. Local 404s will keep being recorded.`,
      });
    },
    onError: (err) => {
      toast({
        variant: "destructive",
        title: "Pull failed",
        description: err instanceof Error ? err.message : "Failed to pull production 404 log",
      });
    },
  });

  function applyProbedIssue(issue: RuntimeIssueRow) {
    queryClient.setQueryData<RuntimeIssuesResponse>(["/api/admin/runtime-issues"], (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        issues: prev.issues.map((row) => (row.fingerprint === issue.fingerprint ? { ...row, ...issue } : row)),
      };
    });
  }

  const probeMutation = useMutation({
    mutationFn: async (fingerprint: string) => {
      const res = await apiFetch("/api/admin/runtime-issues/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint }),
      });
      if (!res.ok) throw new Error("Failed to test URL");
      return res.json() as Promise<{ issue: RuntimeIssueRow }>;
    },
    onMutate: (fingerprint) => {
      setProbingIds((prev) => new Set(prev).add(fingerprint));
    },
    onSuccess: (data) => {
      if (data.issue) applyProbedIssue(data.issue);
      if (!isRuntimeIssueProbeSuccess(data.issue?.lastProbe?.status)) {
        toast({
          title: "Still unresolved",
          description: probeFailureToast(data.issue?.lastProbe?.status),
          variant: "destructive",
        });
      }
    },
    onError: (err) => {
      toast({
        title: "Test failed",
        description: err instanceof Error ? err.message : "Failed to test URL",
        variant: "destructive",
      });
    },
    onSettled: (_data, _err, fingerprint) => {
      setProbingIds((prev) => {
        const next = new Set(prev);
        next.delete(fingerprint);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/runtime-issues"] });
    },
  });

  const bulkProbeMutation = useMutation({
    mutationFn: async (fingerprints: string[]) => {
      const res = await apiFetch("/api/admin/runtime-issues/probe-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprints }),
      });
      if (!res.ok) throw new Error("Failed to retest selected URLs");
      return res.json() as Promise<{ updated: string[]; failed: Array<{ fingerprint: string; error: string }> }>;
    },
    onMutate: (fingerprints) => {
      setProbingIds(new Set(fingerprints));
    },
    onSuccess: (data) => {
      const failedCount = data.failed?.length ?? 0;
      toast({
        title: "Retest finished",
        description:
          failedCount > 0
            ? `${data.updated.length} updated, ${failedCount} failed.`
            : `${data.updated.length} URL${data.updated.length === 1 ? "" : "s"} retested.`,
      });
      setSelected(new Set());
    },
    onError: (err) => {
      toast({
        title: "Bulk retest failed",
        description: err instanceof Error ? err.message : "Failed to retest",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setProbingIds(new Set());
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/runtime-issues"] });
    },
  });

  const dropScrapersMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiFetch("/api/admin/runtime-issues/drop-scrapers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update hide scrapers");
      return res.json() as Promise<{ dropScrapers: boolean }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/runtime-issues"] });
    },
    onError: (err) => {
      toast({
        title: "Could not update hide scrapers",
        description: err instanceof Error ? err.message : "Failed to update",
        variant: "destructive",
      });
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: async (payload: {
      rules: IgnoreRuleInput[];
      seedPaths: string[];
      purgeFingerprints: string[];
    }) => {
      const res = await apiFetch("/api/admin/runtime-issues/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to ignore paths");
      return body as { ignored: IgnoreRule[]; removed: number; added: number };
    },
    onSuccess: (body) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/runtime-issues"] });
      setSelected(new Set());
      let description: string;
      if (body.removed > 0 && body.added === 0) {
        description = `Rule already existed; ${body.removed} matching 404${body.removed === 1 ? "" : "s"} removed from the log.`;
      } else if (body.removed > 0) {
        description = `${body.removed} matching 404${body.removed === 1 ? "" : "s"} removed from the log.`;
      } else {
        description = "Ignore rules saved. No matching rows were in the log.";
      }
      toast({
        title: "Ignored selected paths",
        description,
      });
    },
    onError: (err) => {
      toast({
        title: "Ignore failed",
        description: err instanceof Error ? err.message : "Failed to ignore",
        variant: "destructive",
      });
    },
  });

  const purgeMutation = useMutation({
    mutationFn: async (fingerprints: string[]) => {
      const res = await apiFetch("/api/admin/runtime-issues/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprints }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to purge paths");
      return body as { removed: number };
    },
    onSuccess: (body) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/runtime-issues"] });
      setSelected(new Set());
      setPurgeOpen(false);
      toast({
        title: "Purged selected paths",
        description:
          body.removed > 0
            ? `${body.removed} matching 404${body.removed === 1 ? "" : "s"} removed from the log.`
            : "No matching rows were in the log.",
      });
    },
    onError: (err) => {
      toast({
        title: "Purge failed",
        description: err instanceof Error ? err.message : "Failed to purge",
        variant: "destructive",
      });
    },
  });

  const purgeMatchingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/admin/runtime-issues/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "matching_ignore_rules" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to purge matching paths");
      return body as { removed: number };
    },
    onSuccess: (body) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/runtime-issues"] });
      toast({
        title: "Removed matching 404s",
        description:
          body.removed > 0
            ? `${body.removed} matching 404${body.removed === 1 ? "" : "s"} removed from the log.`
            : "No matching rows were in the log.",
      });
    },
    onError: (err) => {
      toast({
        title: "Purge failed",
        description: err instanceof Error ? err.message : "Failed to purge",
        variant: "destructive",
      });
    },
  });

  const unignoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch("/api/admin/runtime-issues/unignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      if (!res.ok) throw new Error("Failed to remove ignore rule");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/runtime-issues"] });
      toast({ title: "Ignore rule removed" });
    },
    onError: (err) => {
      toast({
        title: "Could not remove rule",
        description: err instanceof Error ? err.message : "Failed to remove",
        variant: "destructive",
      });
    },
  });

  const issues = data?.issues ?? [];
  const filtersActive = isRuntimeIssueFiltersActive(filters);

  function ignoreExactPaths(fingerprints: string[]) {
    const wanted = new Set(fingerprints);
    const rows = issues.filter((row) => wanted.has(row.fingerprint));
    if (!rows.length) {
      toast({
        title: "Ignore failed",
        description: "No matching 404s found",
        variant: "destructive",
      });
      return;
    }
    ignoreMutation.mutate({
      rules: rows.map((row) => ({
        kind: "exact" as const,
        path: row.path,
        label: rows.length === 1 ? "This path only" : `This path only: ${row.path}`,
      })),
      seedPaths: rows.map((row) => row.path),
      purgeFingerprints: rows.map((row) => row.fingerprint),
    });
  }

  const locales = useMemo(() => {
    const set = uniqueSorted(issues.map((i) => i.locale));
    if (localeFilter !== FILTER_ALL && !set.includes(localeFilter)) set.push(localeFilter);
    return set;
  }, [issues, localeFilter]);

  const devices = useMemo(() => {
    const set = sortDevices(issues.map((i) => i.uaBucket || "unknown"));
    if (deviceFilter !== FILTER_ALL && !set.includes(deviceFilter) && ["desktop", "mobile", "unknown"].includes(deviceFilter)) {
      set.push(deviceFilter);
    }
    return set;
  }, [issues, deviceFilter]);

  const sortedIssues = useMemo(
    () => applyRuntimeIssueView(issues, filters, sortKey, sortDir),
    [issues, filters, sortKey, sortDir],
  );

  const filteredIssues = useMemo(
    () => filterRuntimeIssues(issues, filters),
    [issues, filters],
  );

  const dailySeries = useMemo(
    () =>
      aggregateHitsByDay(filteredIssues, {
        windowDays: filters.windowDays,
        tz: filters.tz,
        now: filters.now,
      }),
    [filteredIssues, filters],
  );

  const paged = useMemo(
    () => paginateRuntimeIssues(sortedIssues, page),
    [sortedIssues, page],
  );
  const { pageItems, totalPages } = paged;

  const visibleFingerprints = useMemo(
    () => pageItems.map((issue) => issue.fingerprint),
    [pageItems],
  );
  const allVisibleSelected =
    visibleFingerprints.length > 0 && visibleFingerprints.every((fp) => selected.has(fp));
  const someVisibleSelected = visibleFingerprints.some((fp) => selected.has(fp));
  const bulkMode = selected.size > 0;

  function toggleSelected(fingerprint: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(fingerprint);
      else next.delete(fingerprint);
      return next;
    });
  }

  function toggleSelectAllVisible(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const fp of visibleFingerprints) next.add(fp);
      } else {
        for (const fp of visibleFingerprints) next.delete(fp);
      }
      return next;
    });
  }

  const filteredHitCount = useMemo(
    () => sortedIssues.reduce((sum, issue) => sum + issue.count, 0),
    [sortedIssues],
  );

  const listFilterCount = countActiveListFilters(filters);
  const dropScrapers = data?.dropScrapers !== false;
  const ignored = data?.ignored ?? [];
  const ingestFilterCount = dropScrapers === false ? 1 : 0;

  function clearFilters() {
    patchFilters({
      pathQuery: "",
      referrerQuery: "",
      locale: FILTER_ALL,
      device: FILTER_ALL,
      source: FILTER_ALL,
      windowDays: 30,
      pagesOnly: true,
    });
  }

  function toggleSort(col: RuntimeIssueViewState["sortKey"]) {
    if (col === sortKey) {
      patchView({ sortDir: sortDir === "asc" ? "desc" : "asc" });
    } else {
      writeView({ ...view, sortKey: col, sortDir: "desc", page: 1 });
    }
  }

  function downloadCsv() {
    if (!data) return;
    const fromUrl = parseRuntimeIssueSearch(searchString);
    downloadRuntimeIssuesCsv(
      data.site,
      applyRuntimeIssueView(data.issues, fromUrl.filters, fromUrl.sortKey, fromUrl.sortDir).map((row) => ({
        ...row,
        windowDays: fromUrl.filters.windowDays,
        tz: fromUrl.filters.tz,
      })),
      { windowDays: fromUrl.filters.windowDays, tz: fromUrl.filters.tz },
    );
  }

  return (
    <div className="space-y-6" data-testid="runtime-issues-tab">
      <Card style={{ borderRadius: "0.8rem" }} data-testid="runtime-issues-how-it-works">
        <Collapsible open={howItWorksOpen} onOpenChange={setHowItWorksOpen}>
          <CardContent className="p-4 space-y-2 text-sm text-muted-foreground">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-foreground font-medium text-left"
                aria-expanded={howItWorksOpen}
                data-testid="button-runtime-issues-how-it-works"
              >
                <IconInfoCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1">How runtime issues work</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${howItWorksOpen ? "rotate-180" : ""}`}
                />
              </button>
            </CollapsibleTrigger>
            <div className="flex items-center gap-3" data-testid="runtime-issues-trend-strip">
              <RuntimeIssuesSparkline
                series={dailySeries}
                total={filteredHitCount}
                windowDays={filters.windowDays}
              />
              <div className="min-w-0 flex-1 space-y-1">
                {import.meta.env.DEV && !howItWorksOpen ? (
                  <p
                    className="flex items-start gap-2 text-xs text-foreground"
                    data-testid="runtime-issues-local-only-strip"
                  >
                    <IconAlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      This table is this machine only. Open Runtime issues on production to see live traffic.
                    </span>
                  </p>
                ) : !howItWorksOpen ? (
                  <p className="text-xs text-muted-foreground">
                    {filteredHitCount} hits in the last {filters.windowDays} days ({tz})
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Daily 404 hits for your current list filters (same window and timezone as Count). The
                  chart and totals include all matching paths; the table shows {RUNTIME_ISSUES_PAGE_SIZE}{" "}
                  per page. Query badges show params from the 404 URL; paths are grouped without the query
                  string. New hits only — existing rows update when traffic arrives after deploy.
                </p>
              </div>
            </div>
            <CollapsibleContent className="space-y-2">
              {import.meta.env.DEV && (
                <Alert data-testid="alert-runtime-issues-local-only">
                  <IconAlertTriangle className="h-4 w-4" />
                  <AlertTitle>This table is this machine only</AlertTitle>
                  <AlertDescription className="space-y-3">
                    <p>
                      Local 404s are stored in{" "}
                      <code className="text-xs font-mono">.runtime-issues-state.json</code> and are not
                      loaded from or uploaded to GCS. Rows here include hits from{" "}
                      <code className="text-xs font-mono">/private</code> (your Test column and localhost
                      referrers). Open Runtime issues on production to see live traffic. Reset here does
                      not wipe production.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPullOpen(true)}
                      data-testid="button-pull-production-runtime-issues"
                    >
                      <IconDownload className="h-4 w-4 mr-1.5" />
                      Pull production once
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              <p>
                HTTP 404s from this site’s content index (the same catalog as Redirects / Test a URL) —
                missing URLs that people, Google, LLMs, or social previews tried to open. A row is not
                “the page failed to paint”: the SPA may still render chrome or even an article if the
                client loaded by slug. <strong>List filters</strong> change the sparkline, CSV, totals
                chip, and table. <strong>Pagination</strong> affects the table only. CSV export still
                includes every filtered row. Pages only hides file URLs (including Internal).{" "}
                <strong>Ingestion Filters</strong> skip future digestion for scrapers.{" "}
                <strong>Ignore rules</strong> mute the selected exact path(s) from this log going forward.
                They survive Reset 404 log. Not a redirect. Built-in scraper/probe drops are separate. Needs SEO edit to mute; Metrics Viewer
                is read-only here. Hide scrapers is on by default; turning it off starts recording
                Ahrefs/<code className="text-xs font-mono">curl</code>/etc. and adds 1 to the ingest badge;
                turning it on again does not wipe old rows. File 404s from a 4Geeks referrer are still
                recorded (broken internal or old assets). Count is hits in the selected{" "}
                <strong>7 or 30 days in your timezone</strong> ({tz}) — the CSV uses the same window. Click
                a source badge for what it means (tag sums can exceed Count). The sample referrer domain sits
                next to those badges — click it for the full URL. Click a path to copy the URL or open it
                in a new tab (paths also offer Add redirect and Ignore from 404 log). Test (and bulk Retest)
                walks this server’s redirects then HTTP-follows until they stop. A green check means{" "}
                <code className="text-xs font-mono">status</code> is{" "}
                <code className="text-xs font-mono">page</code> or{" "}
                <code className="text-xs font-mono">redirect</code>. This table is public 404s only (not
                server exceptions). Reset wipes the stored log including GCS but keeps ingest settings.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-0 text-xs"
                onClick={() => setShowAdvanced((v) => !v)}
                data-testid="button-runtime-issues-read-more"
              >
                {showAdvanced ? "Hide advanced" : "Read more (advanced)"}
              </Button>
              {showAdvanced && (
                <ul className="list-disc pl-5 space-y-1 text-xs">
                  <li>
                    Ignore file: <code>{`{contentRoot}/.runtime-issues-ignore.json`}</code> and GCS{" "}
                    <code>…/sync/runtime-issues-ignore.json</code> (not the 404 counts file)
                  </li>
                  <li>
                    <code>shared/runtime-issues-ignore.ts</code> — exact / prefix / locales / slug_list matchers
                  </li>
                  <li>
                    <code>server/runtime-issues-ignore-store.ts</code> — load/save; digest reads memory only
                  </li>
                  <li>
                    <code>shared/runtime-issues.ts</code> — <code>dropScrapers</code>,{" "}
                    <code>shouldHardDropNotFound</code>, <code>SOURCE_EXPLANATIONS</code>,{" "}
                    <code>aggregateHitsByDay</code>, <code>windowHitCount</code>
                  </li>
                  <li>
                    <code>client/src/components/diagnostics/runtime-issues-filters.ts</code> —{" "}
                    <code>paginateRuntimeIssues</code> (table only; CSV/totals/sparkline stay full set)
                  </li>
                  <li>
                    <code>POST /api/admin/runtime-issues/drop-scrapers</code>,{" "}
                    <code>…/ignore</code>, <code>…/purge</code> (fingerprints or matching ignore rules), and{" "}
                    <code>…/unignore</code> (<code>seo_settings</code>)
                  </li>
                  <li>
                    <code>server/runtime-issues-probe.ts</code> — index walk + HTTP follow; destination check
                    shared with Redirects → Test a URL
                  </li>
                  <li>
                    <code>POST /api/admin/runtime-issues/pull-production</code> — development only;
                    replaces this machine’s log with GCS then continues local ingest (does not upload)
                  </li>
                  <li>
                    Non-effects: no public 404 HTML change; not Search Console; not auto-redirect; 404 log
                    last-write-wins does not apply to ignore rules; LLM down still allows exact ignore;
                    unignore does not restore old counts; Hide scrapers does not prune; Pages only does not
                    change ingest; pull production does not merge (replace then local ingest); pagination
                    does not change CSV, totals, or sparkline
                  </li>
                </ul>
              )}
            </CollapsibleContent>
          </CardContent>
        </Collapsible>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 overflow-visible">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 overflow-visible">
          <div className="relative overflow-visible shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setListFiltersOpen(true)}
              data-testid="button-runtime-list-filters"
            >
              <Filter className="h-4 w-4 mr-1.5" />
              List filters
            </Button>
            <CornerCountBadge count={listFilterCount} testId="badge-list-filters-count" />
          </div>
          <div className="relative overflow-visible shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIngestionOpen(true)}
              data-testid="button-runtime-ingestion-filters"
            >
              Ingestion Filters
            </Button>
            <CornerCountBadge count={ingestFilterCount} testId="badge-ingestion-filters-count" />
          </div>
          {data && (
            <Badge variant="secondary" className="shrink-0" data-testid="badge-runtime-total">
              {filtersActive
                ? `${sortedIssues.length} of ${issues.length} paths · ${filteredHitCount} hits`
                : `${data.issues.length} paths · ${filteredHitCount} hits`}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={downloadCsv}
            disabled={sortedIssues.length === 0}
            data-testid="button-download-runtime-issues-csv"
          >
            <IconDownload className="h-4 w-4 mr-1.5" />
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-runtime-issues"
          >
            <IconRefresh className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <div className="relative overflow-visible shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIgnoreRulesOpen(true)}
              data-testid="button-runtime-ignore-rules"
            >
              Ignore rules
            </Button>
            <CornerCountBadge count={ignored.length} testId="badge-ignore-rules-count" />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setResetOpen(true)}
            data-testid="button-reset-runtime-issues"
          >
            <IconTrash className="h-4 w-4 mr-1.5" />
            Reset 404 log
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            asChild
            data-testid="button-runtime-redirects"
          >
            <Link href="/private/redirects">
              <Route className="h-4 w-4 mr-1.5" />
              Redirects
            </Link>
          </Button>
        </div>
      </div>

      {data && data.issues.length > 0 && bulkMode && (
        <div className="flex flex-wrap items-center gap-3" data-testid="runtime-issues-bulk-bar">
          <span className="text-sm" data-testid="runtime-issues-bulk-count">
            {selected.size} selected
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setSelected(new Set())}
            data-testid="button-runtime-bulk-clear"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={bulkProbeMutation.isPending || selected.size === 0}
            onClick={() => bulkProbeMutation.mutate(Array.from(selected))}
            data-testid="button-runtime-bulk-retest"
          >
            {bulkProbeMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <TestTube className="h-3.5 w-3.5 mr-1.5" />
            )}
            Retest for resolution
          </Button>
          {canIgnore ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={ignoreMutation.isPending || selected.size === 0}
              onClick={() => ignoreExactPaths(Array.from(selected))}
              data-testid="button-runtime-bulk-ignore"
            >
              {ignoreMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <EyeOff className="h-3.5 w-3.5 mr-1.5" />
              )}
              Ignore selected
            </Button>
          ) : null}
          {canIgnore ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={purgeMutation.isPending || selected.size === 0}
              onClick={() => setPurgeOpen(true)}
              data-testid="button-runtime-bulk-purge"
            >
              {purgeMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <IconTrash className="h-3.5 w-3.5 mr-1.5" />
              )}
              Purge selected
            </Button>
          ) : null}
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-16">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
        </div>
      )}

      {!isLoading && isError && (
        <Card style={{ borderRadius: "0.8rem" }}>
          <CardContent className="p-8 text-center text-destructive text-sm" data-testid="runtime-issues-error">
            <IconAlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-50" />
            {error instanceof Error ? error.message : "Failed to load runtime issues"}
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && (!data || data.issues.length === 0) && (
        <Card style={{ borderRadius: "0.8rem" }}>
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            <IconAlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-50" />
            No runtime issues recorded for this site yet.
          </CardContent>
        </Card>
      )}

      {!isError && data && data.issues.length > 0 && (
        <Card style={{ borderRadius: "0.8rem" }}>
          <CardContent className="p-0 overflow-x-auto">
            {sortedIssues.length === 0 ? (
              <div
                className="p-8 text-center text-muted-foreground text-sm"
                data-testid="runtime-issues-empty-filters"
              >
                No runtime issues match the current filters.
              </div>
            ) : (
              <>
              <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">
                    <Checkbox
                      checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                      onCheckedChange={(checked) => toggleSelectAllVisible(checked === true)}
                      aria-label="Select all visible issues"
                      data-testid="checkbox-runtime-select-all"
                    />
                  </TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead className="w-24 text-right">
                    <button
                      type="button"
                      className="inline-flex items-center justify-end w-full hover:text-foreground"
                      onClick={() => toggleSort("count")}
                      data-testid="sort-runtime-count"
                    >
                      Count
                      <SortIcon col="count" sortKey={sortKey} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead className="w-32 text-right">
                    <InternalLinksColumnHeader linkIndexUpdatedAt={data.linkIndexUpdatedAt} />
                  </TableHead>
                  <TableHead className="w-36">
                    <button
                      type="button"
                      className="inline-flex items-center hover:text-foreground"
                      onClick={() => toggleSort("lastSeen")}
                      data-testid="sort-runtime-last-seen"
                    >
                      Last seen
                      <SortIcon col="lastSeen" sortKey={sortKey} sortDir={sortDir} />
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((issue) => (
                  <TableRow key={issue.fingerprint} data-testid={`runtime-issue-${issue.fingerprint}`}>
                    <TableCell className="w-10 pr-0">
                      <Checkbox
                        checked={selected.has(issue.fingerprint)}
                        onCheckedChange={(checked) => toggleSelected(issue.fingerprint, checked === true)}
                        aria-label={`Select ${issue.path}`}
                        data-testid={`checkbox-runtime-issue-${issue.fingerprint}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="min-w-0 truncate">
                          <RuntimeIssuePathMenu
                            path={issue.path}
                            hostname={issue.hostname}
                            fingerprint={issue.fingerprint}
                            onAddRedirect={
                              canEditRedirects
                                ? (path, fingerprint) => setRedirectFrom({ path, fingerprint })
                                : undefined
                            }
                            onIgnore={
                              canIgnore && !ignoreMutation.isPending
                                ? (fingerprint) => ignoreExactPaths([fingerprint])
                                : undefined
                            }
                          />
                        </div>
                        <RuntimeIssueProbeControl
                          issue={issue}
                          hostname={issue.hostname}
                          probing={probingIds.has(issue.fingerprint)}
                          onTest={() => probeMutation.mutate(issue.fingerprint)}
                        />
                      </div>
                      <span className="flex flex-wrap gap-1 mt-1">
                        {windowedSourceTags(issue, filters).map((tag) => (
                          <RuntimeIssueSourceBadge key={tag} tag={tag} fingerprint={issue.fingerprint} />
                        ))}
                        <RuntimeIssueUaBadge
                          uaBucket={issue.uaBucket}
                          fingerprint={issue.fingerprint}
                        />
                        <RuntimeIssueReferrerBadge
                          referrer={issue.sampleReferrer}
                          fingerprint={issue.fingerprint}
                        />
                        <RuntimeIssueQueryBadges
                          attribution={issue.queryAttribution}
                          fingerprint={issue.fingerprint}
                        />
                      </span>
                    </TableCell>
                    <TableCell className="w-24 text-right font-medium whitespace-nowrap">
                      {issue.count}
                    </TableCell>
                    <TableCell className="w-28 text-right text-xs text-muted-foreground whitespace-nowrap">
                      <CmsLinksCell
                        path={issue.path}
                        count={issue.cmsReferrerCount ?? 0}
                        linkIndexUpdatedAt={data?.linkIndexUpdatedAt}
                      />
                    </TableCell>
                    <TableCell className="w-36 text-xs text-muted-foreground whitespace-nowrap">
                      {formatTs(issue.lastSeen)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {totalPages > 1 && (
              <div
                className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3"
                data-testid="runtime-issues-pagination"
              >
                <span className="text-xs text-muted-foreground tabular-nums">
                  Page {paged.page} of {totalPages} · {paged.totalItems} paths
                </span>
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        aria-disabled={paged.page <= 1}
                        className={paged.page <= 1 ? "pointer-events-none opacity-50" : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          if (paged.page > 1) writeView({ ...view, page: paged.page - 1 });
                        }}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        aria-disabled={paged.page >= totalPages}
                        className={paged.page >= totalPages ? "pointer-events-none opacity-50" : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          if (paged.page < totalPages) writeView({ ...view, page: paged.page + 1 });
                        }}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <AddRedirectDialog
        key={redirectFrom?.fingerprint ?? "closed"}
        open={!!redirectFrom}
        onOpenChange={(open) => {
          if (!open) setRedirectFrom(null);
        }}
        initialFrom={redirectFrom?.path ?? ""}
        onSuccess={() => {
          if (redirectFrom) probeMutation.mutate(redirectFrom.fingerprint);
        }}
      />

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent data-testid="dialog-reset-runtime-issues">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset 404 log?</AlertDialogTitle>
            <AlertDialogDescription>
              Deletes all stored 404s for this site, including GCS. Ignore rules and Hide scrapers are
              kept. Not undoable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reset-runtime-issues">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                resetMutation.mutate();
              }}
              data-testid="button-confirm-reset-runtime-issues"
            >
              {resetMutation.isPending ? "Resetting…" : "Reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pullOpen} onOpenChange={setPullOpen}>
        <AlertDialogContent data-testid="dialog-pull-production-runtime-issues">
          <AlertDialogHeader>
            <AlertDialogTitle>Replace local 404 log with production?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the issues recorded on this machine and downloads production’s log once.
              After that, this process keeps ingesting local 404s (including{" "}
              <code className="text-xs font-mono">/private</code>). It does not upload anything back to
              GCS. Not undoable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-pull-production-runtime-issues">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                pullMutation.mutate();
              }}
              disabled={pullMutation.isPending}
              data-testid="button-confirm-pull-production-runtime-issues"
            >
              {pullMutation.isPending ? "Pulling…" : "Pull production once"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <AlertDialogContent data-testid="dialog-purge-runtime-issues">
          <AlertDialogHeader>
            <AlertDialogTitle>Purge selected 404s?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the checked rows from this log only. Future 404s for those paths can appear again.
              Does not add ignore rules.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-purge-runtime-issues">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                purgeMutation.mutate(Array.from(selected));
              }}
              disabled={purgeMutation.isPending}
              data-testid="button-confirm-purge-runtime-issues"
            >
              {purgeMutation.isPending ? "Purging…" : "Purge"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RuntimeIssueListFiltersDialog
        open={listFiltersOpen}
        onOpenChange={setListFiltersOpen}
        filters={filters}
        locales={locales}
        devices={devices}
        onApply={(next) => {
          writeView({ ...view, filters: next, page: 1 });
        }}
        onClear={clearFilters}
      />
      <RuntimeIssueIngestionFiltersDialog
        open={ingestionOpen}
        onOpenChange={setIngestionOpen}
        dropScrapers={dropScrapers}
        dropScrapersPending={dropScrapersMutation.isPending}
        onDropScrapersChange={(enabled) => dropScrapersMutation.mutate(enabled)}
      />
      <RuntimeIssueIgnoreRulesDialog
        open={ignoreRulesOpen}
        onOpenChange={setIgnoreRulesOpen}
        ignored={ignored}
        issuePaths={issues.map((issue) => issue.path)}
        canRemove={canIgnore}
        unignorePending={unignoreMutation.isPending}
        onRemove={(id) => unignoreMutation.mutate(id)}
        canPurge={canIgnore}
        purgeMatchingPending={purgeMatchingMutation.isPending}
        onPurgeMatching={() => purgeMatchingMutation.mutate()}
      />
    </div>
  );
}
