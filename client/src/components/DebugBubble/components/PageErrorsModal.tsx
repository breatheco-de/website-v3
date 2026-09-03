import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ToggleButtonBarList, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { PageDiagnostics } from "../types";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";
import { isContentFilePath } from "@shared/formatSitePath";
import { getDebugToken, useDebugAuth } from "@/hooks/useDebugAuth";
import { useToast } from "@/hooks/use-toast";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { apiFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { formatIssueActorLine } from "@/lib/formatIssueActor";
import {
  type GscInspectionGetResponse,
} from "@/lib/gscInspection";
import {
  crawlerBadgeState,
  googleToCrawlerStatus,
  type CrawlerBadgeState,
  type CrawlerPageStatus,
} from "@/lib/crawlerStatus";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBrandGoogle,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconCopy,
  IconExternalLink,
  IconLoader2,
  IconLock,
  IconLockOpen,
  IconRefresh,
  IconUser,
} from "@tabler/icons-react";
import * as Flags from "country-flag-icons/react/3x2";
import { buildSolveWithAiPrompt, type SolveWithAiAgentId } from "../solveWithAiPrompt";
import { SolveWithAiAgentDropdown } from "../SolveWithAiAgentDropdown";
import type { McpSetupTabId } from "@/components/mcp/mcpUrlHelpers";

/** Validators that make sense for a single page (entry-local only). */
export const PER_PAGE_VALIDATORS = [
  "meta",
  "required-fields",
  "editor-field-types",
  "unknown-keys",
  "seo-depth",
  "seo-intent",
  "seo-cluster",
  "schema-completeness",
  "content-quality",
  "section-variants",
];

interface PageErrorsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageDiagnostics: PageDiagnostics | null;
  pageUrl?: string;
  loading?: boolean;
  error?: string | null;
  onRefreshDiagnostics?: () => Promise<void>;
  /** Called after Solve with AI copies the prompt. Parent should close this modal and open MCP confirmation (do not open the LLM yet). */
  onSolveWithAi?: (payload: {
    agentId: SolveWithAiAgentId;
    setupTab: McpSetupTabId;
    prompt: string;
    label: string;
    prefillUrlPrefix?: string;
  }) => void;
  /** When opening the modal, start on this tab (e.g. from Page Details health strip). */
  preferredTab?: PageErrorsTab;
}

export type PageErrorsTab = "errors" | "warnings" | "crawlers" | "completed";

type PageIssue = NonNullable<PageDiagnostics["issues"]>[number];

function formatStaleness(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function LocaleFlag({ locale }: { locale: string }) {
  const FlagComponent = locale === "es" ? Flags.ES : Flags.US;
  return <FlagComponent className="h-3.5 w-auto rounded-sm" title={locale === "es" ? "Spanish" : "English"} />;
}

export function TabCountBadge({
  count,
  variant,
  testId,
  crawlerState,
  zeroAsCount = false,
}: {
  count?: number;
  variant?: "error" | "warning";
  testId: string;
  /** When set, badge follows crawler semantics (ok / problems / loading / none). */
  crawlerState?: CrawlerBadgeState;
  /** When true, show 0 instead of a checkmark for zero error/warning counts. */
  zeroAsCount?: boolean;
}) {
  if (crawlerState) {
    const { kind, count: problemCount } = crawlerState;
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-sm px-1.5 py-0 text-[10px] font-semibold tabular-nums",
          kind === "ok"
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : kind === "problems"
              ? "bg-destructive/15 text-destructive"
              : "bg-muted text-muted-foreground",
        )}
        data-testid={testId}
      >
        {kind === "ok" ? (
          <IconCheck className="h-3 w-3" stroke={2.5} aria-hidden />
        ) : kind === "problems" ? (
          problemCount
        ) : (
          "—"
        )}
      </span>
    );
  }

  const n = count ?? 0;
  const isZero = n === 0;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-sm px-1.5 py-0 text-[10px] font-semibold tabular-nums",
        isZero
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : variant === "error"
            ? "bg-destructive/15 text-destructive"
            : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      )}
      data-testid={testId}
    >
      {isZero ? (zeroAsCount ? 0 : <IconCheck className="h-3 w-3" stroke={2.5} aria-hidden />) : n}
    </span>
  );
}

function CrawlerStatusCard({
  crawler,
  formatStaleness,
  onOpenChange,
  inspectError,
}: {
  crawler: CrawlerPageStatus;
  formatStaleness: (iso: string) => string;
  onOpenChange: (open: boolean) => void;
  inspectError?: string | null;
}) {
  const isGoogle = crawler.id === "google";

  return (
    <Card data-testid={isGoogle ? "card-google-indexing-kpi" : `card-crawler-${crawler.id}`}>
      <CardContent className="pt-4 pb-3 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isGoogle ? <IconBrandGoogle className="h-3.5 w-3.5" /> : null}
          <span>{crawler.label}</span>
        </div>
        {crawler.status === "loading" ? (
          <p className="text-sm text-muted-foreground">Loading cache…</p>
        ) : crawler.status === "not_configured" ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{crawler.detail || "Not configured"}</p>
            {isGoogle ? (
              <Link
                href="/private/settings/seo/search-console"
                className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
                data-testid="link-gsc-settings-from-modal"
                onClick={() => onOpenChange(false)}
              >
                Set up Search Console
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            <p
              className="text-sm font-medium text-foreground"
              data-testid={isGoogle ? "text-google-index-status" : `text-crawler-status-${crawler.id}`}
            >
              {crawler.status === "error"
                ? "Error"
                : crawler.detail || crawler.status}
            </p>
            {crawler.loc ? (
              <p className="text-[11px] font-mono text-muted-foreground truncate" title={crawler.loc}>
                {crawler.loc}
              </p>
            ) : null}
            {crawler.inSitemap === false && crawler.status !== "not_applicable" ? (
              <p className="text-xs text-chart-2">This URL is excluded from /sitemap.xml.</p>
            ) : null}
            {crawler.lastCrawlAt ? (
              <p className="text-xs text-muted-foreground">
                Last crawl {formatStaleness(crawler.lastCrawlAt)}
              </p>
            ) : null}
            {crawler.checkedAt ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <IconClock className="h-3 w-3" />
                Checked {formatStaleness(crawler.checkedAt)}
              </p>
            ) : null}
            {crawler.status === "error" && crawler.detail && crawler.detail !== "Error" ? (
              <p className="text-xs text-destructive">{crawler.detail}</p>
            ) : null}
            {inspectError ? (
              <p className="text-xs text-destructive">{inspectError}</p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Site-relative URL path in quotes (e.g. "/en/career-programs"), not a YAML file path. */
function isInternalUrlPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !isContentFilePath(path);
}

/**
 * In-dialog relative menu (not Radix DropdownMenu).
 * Portaled DropdownMenu content sits outside Dialog's focus scope; the Dialog
 * focus trap steals focus back and the menu closes immediately.
 */
function InternalPathActions({ path }: { path: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={menuRef} className="relative inline-block">
      <button
        type="button"
        className="inline font-mono text-primary underline underline-offset-2 hover:text-primary/80"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        data-testid="button-issue-path-menu"
      >
        {path}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-[10001] mt-1 w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover-elevate"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              void navigator.clipboard.writeText(path).then(
                () => toast({ title: "Copied", description: path }),
                () => toast({ title: "Copy failed", variant: "destructive" }),
              );
            }}
            data-testid="menu-issue-path-copy"
          >
            <IconCopy className="h-3.5 w-3.5" />
            Copy
          </button>
          <a
            role="menuitem"
            href={path}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover-elevate"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            data-testid="menu-issue-path-open"
          >
            <IconExternalLink className="h-3.5 w-3.5" />
            Open in new tab
          </a>
        </div>
      )}
    </span>
  );
}

/** Renders validation text; quoted internal URL paths get copy / open actions. */
function IssueMessageWithLinks({
  text,
  formatSitePath,
}: {
  text: string;
  formatSitePath: (path: string) => string;
}) {
  if (!text) return null;
  if (!text.includes('"')) {
    return <>{isContentFilePath(text) ? formatSitePath(text) : text}</>;
  }

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  const re = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const inner = match[1];
    if (isInternalUrlPath(inner)) {
      parts.push('"');
      parts.push(<InternalPathActions key={`path-${key++}`} path={inner} />);
      parts.push('"');
    } else if (isContentFilePath(inner)) {
      parts.push(`"${formatSitePath(inner)}"`);
    } else {
      parts.push(match[0]);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return <>{parts}</>;
}

function sortCompletedIssues(issues: PageIssue[]): PageIssue[] {
  return [...issues].sort((a, b) => {
    const atA = a.completed?.at ? new Date(a.completed.at).getTime() : 0;
    const atB = b.completed?.at ? new Date(b.completed.at).getTime() : 0;
    return atB - atA;
  });
}

type ResolvedArchiveApiRow = {
  issueId: string;
  entryKey: string;
  url?: string;
  code: string;
  message: string;
  severity: "error" | "warning";
  validator?: string;
  category?: string;
  file?: string;
  suggestion?: string;
  resolvedAt: string;
  resolvedBy: string;
  actor?: { type: "ui" | "mcp"; client?: string; model?: string };
  report?: string;
  reopenedAt?: string;
};

function archiveRowToPageIssue(row: ResolvedArchiveApiRow): PageIssue {
  return {
    id: row.issueId,
    type: row.severity,
    code: row.code,
    message: row.message,
    category: row.category,
    suggestion: row.suggestion,
    validator: row.validator,
    file: row.file,
    completed: {
      by: row.resolvedBy,
      at: row.resolvedAt,
      actor: row.actor,
      report: row.report,
    },
    reopenedAt: row.reopenedAt,
    archiveOnly: true,
  };
}

function LinkedIssueProposals({ issueId }: { issueId: string }) {
  const { data } = useQuery({
    queryKey: ["/api/admin/proposals", "issue", issueId],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/admin/proposals?issue_id=${encodeURIComponent(issueId)}`,
        { headers: { ...getSessionHeaders() } },
      );
      if (!res.ok) return { proposals: [] as Array<{ id: string; title: string; status: string }> };
      return res.json() as Promise<{
        proposals: Array<{ id: string; title: string; status: string }>;
      }>;
    },
  });
  const rows = data?.proposals ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="text-xs space-y-1 pt-1 border-t border-border/50">
      <div className="font-medium text-foreground">Linked proposals</div>
      {rows.map((p) => (
        <Link key={p.id} href={`/private/proposals/${p.id}`} className="block text-primary hover:underline">
          {p.title} ({p.status})
        </Link>
      ))}
    </div>
  );
}

function IssueCard({
  issue,
  index,
  variant,
  formatSitePath,
  onUpdateIssue,
  togglePending,
  showSeverityBadge = false,
}: {
  issue: PageIssue;
  index: number;
  variant: "error" | "warning";
  formatSitePath: (path: string) => string;
  onUpdateIssue?: (
    issue: PageIssue,
    action: "claim" | "release" | "complete" | "uncomplete",
  ) => void;
  togglePending?: boolean;
  /** When true, show Error/Warning badge (used on Completed tab). */
  showSeverityBadge?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isError = variant === "error";
  const cacheBuiltAt = issue.validationCacheBuiltAt;
  const isCompleted = Boolean(issue.completed);
  const isClaimed = Boolean(issue.claimed);
  const canAct = Boolean(issue.id && onUpdateIssue && !issue.archiveOnly);
  const hasDetails = Boolean(
    issue.details?.expected ||
      issue.suggestion ||
      issue.file ||
      cacheBuiltAt ||
      issue.completed ||
      issue.claimed ||
      issue.id ||
      (issue.attempts && issue.attempts.length > 0),
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={
          isCompleted
            ? "rounded-md bg-muted/40 border border-border text-sm opacity-80"
            : isError
              ? "rounded-md bg-destructive/10 border border-destructive/30 text-sm"
              : "rounded-md bg-amber-500/10 border border-amber-500/30 text-sm"
        }
        data-testid={`modal-${variant}-${index}${isCompleted ? "-completed" : ""}`}
      >
        <div className="flex w-full items-stretch gap-2 p-3">
          <div className="min-w-0 flex-1">
            <CollapsibleTrigger asChild disabled={!hasDetails}>
              <button
                type="button"
                className={cn(
                  "w-full text-left",
                  hasDetails ? "cursor-pointer" : "cursor-default",
                )}
                data-testid={`modal-${variant}-${index}-toggle`}
                aria-expanded={open}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <div
                    className={
                      isCompleted
                        ? "font-mono font-medium text-muted-foreground text-xs"
                        : isError
                          ? "font-mono font-medium text-destructive text-xs"
                          : "font-mono font-medium text-amber-700 dark:text-amber-300 text-xs"
                    }
                  >
                    {issue.code}
                  </div>
                  {showSeverityBadge && (
                    <span
                      className={cn(
                        "rounded px-1 py-0 text-[10px] font-semibold uppercase tracking-wide",
                        isError
                          ? "bg-destructive/15 text-destructive"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {isError ? "Error" : "Warning"}
                    </span>
                  )}
                  {issue.reopenedAt ? (
                    <span
                      className="rounded px-1 py-0 text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      data-testid={`modal-${variant}-${index}-reopened-badge`}
                    >
                      Reopened
                    </span>
                  ) : null}
                </div>
              </button>
            </CollapsibleTrigger>
            <div className={cn("mt-1", isCompleted ? "text-muted-foreground" : "text-foreground")}>
              <IssueMessageWithLinks text={issue.message} formatSitePath={formatSitePath} />
            </div>
            {issue.claimed && !isCompleted && (
              <p
                className="mt-1 text-[11px] text-muted-foreground flex items-center gap-1"
                data-testid={`modal-${variant}-${index}-claimed-by`}
              >
                <IconUser className="h-3 w-3 shrink-0" />
                Claimed by {formatIssueActorLine(issue.claimed.by, issue.claimed.actor)}
                {issue.claimed.expiresAt && (
                  <span className="opacity-80">
                    · until {new Date(issue.claimed.expiresAt).toLocaleTimeString()}
                  </span>
                )}
              </p>
            )}
            {issue.completed && (
              <div className="mt-1 space-y-1" data-testid={`modal-${variant}-${index}-completed-meta`}>
                <p
                  className="text-[11px] text-muted-foreground"
                  data-testid={`modal-${variant}-${index}-completed-by`}
                >
                  Completed by {formatIssueActorLine(issue.completed.by, issue.completed.actor)}
                  {issue.completed.at ? (
                    <span className="opacity-80">
                      {" "}
                      · {new Date(issue.completed.at).toLocaleString()}
                    </span>
                  ) : null}
                </p>
                {issue.completed.report ? (
                  <p
                    className="text-[11px] text-muted-foreground border-l-2 border-border/80 pl-2"
                    data-testid={`modal-${variant}-${index}-completed-report`}
                  >
                    {issue.completed.report}
                  </p>
                ) : null}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end self-stretch">
            {hasDetails && (
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="mt-0.5 text-muted-foreground"
                  aria-label={open ? "Hide details" : "Show details"}
                  data-testid={`modal-${variant}-${index}-chevron`}
                >
                  <IconChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform",
                      open && "rotate-180",
                    )}
                  />
                </button>
              </CollapsibleTrigger>
            )}
            {canAct && (
              <div className="mt-auto flex items-center gap-0.5">
                {!isCompleted && (
                  <button
                    type="button"
                    className={cn(
                      "rounded-md p-1 transition-colors",
                      isClaimed
                        ? "text-status-away hover:bg-muted"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                    aria-label={isClaimed ? "Release claim" : "Claim issue"}
                    title={
                      isClaimed
                        ? `Release claim (${issue.claimed?.by})`
                        : "Claim — mark as in progress (30m)"
                    }
                    disabled={togglePending}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateIssue?.(issue, isClaimed ? "release" : "claim");
                    }}
                    data-testid={`modal-${variant}-${index}-claim`}
                  >
                    {togglePending ? (
                      <IconLoader2 className="h-4 w-4 animate-spin" />
                    ) : isClaimed ? (
                      <IconLockOpen className="h-4 w-4" />
                    ) : (
                      <IconLock className="h-4 w-4" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  className={cn(
                    "rounded-md p-1 transition-colors",
                    isCompleted
                      ? "text-status-online hover:bg-muted"
                      : "text-muted-foreground hover:text-status-online hover:bg-muted",
                  )}
                  aria-label={isCompleted ? "Mark as open" : "Mark as fixed"}
                  title={
                    isCompleted
                      ? "Mark as open"
                      : "Mark as fixed — re-checks live content for this page; refuses if still failing"
                  }
                  disabled={togglePending}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateIssue?.(issue, isCompleted ? "uncomplete" : "complete");
                  }}
                  data-testid={`modal-${variant}-${index}-complete`}
                >
                  {togglePending ? (
                    <IconLoader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <IconCheck className="h-4 w-4" stroke={isCompleted ? 2.5 : 1.5} />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
        {hasDetails && (
          <CollapsibleContent>
            <div className="px-3 pb-3 space-y-1">
              {issue.details?.expected && (
                <div className="text-xs text-muted-foreground">
                  Expected: <span className="font-mono">{issue.details.expected}</span>
                  {issue.details.received && (
                    <>
                      {" "}
                      | Received: <span className="font-mono">{issue.details.received}</span>
                    </>
                  )}
                </div>
              )}
              {issue.suggestion && (
                <div className="text-xs text-muted-foreground">
                  <IssueMessageWithLinks text={issue.suggestion} formatSitePath={formatSitePath} />
                </div>
              )}
              {issue.file && (
                <div className="text-xs text-muted-foreground font-mono" title={issue.file}>
                  {formatSitePath(issue.file)}
                </div>
              )}
              {cacheBuiltAt && (
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <IconClock className="h-3 w-3" />
                  Cache built at {new Date(cacheBuiltAt).toLocaleString()}
                </div>
              )}
              {issue.attempts && issue.attempts.length > 0 && !isCompleted && (
                <div className="text-xs text-muted-foreground space-y-1 pt-1 border-t border-border/50">
                  <div className="font-medium text-foreground">
                    Tried {issue.attempts.length}×
                  </div>
                  {issue.attempts.slice(0, 3).map((a, i) => (
                    <div key={`${a.at}-${i}`}>
                      {a.reason === "ttl_expired"
                        ? `Claim expired (30m) — ${formatIssueActorLine(a.by, a.actor)}`
                        : `Released by ${formatIssueActorLine(a.by, a.actor)}`}
                      {a.claimedBy && a.claimedBy !== a.by ? ` (held by ${a.claimedBy})` : ""}
                      {a.report ? `: ${a.report}` : ""}
                    </div>
                  ))}
                </div>
              )}
              {issue.id && <LinkedIssueProposals issueId={issue.id} />}
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
}

export function PageErrorsModal(props: PageErrorsModalProps) {
  const {
    open,
    onOpenChange,
    pageDiagnostics,
    pageUrl,
    loading = false,
    error = null,
    onRefreshDiagnostics,
    onSolveWithAi,
    preferredTab,
  } = props;

  const [isRunningValidation, setIsRunningValidation] = useState(false);
  const [activeTab, setActiveTab] = useState<PageErrorsTab>("errors");
  const [openPageMenuOpen, setOpenPageMenuOpen] = useState(false);
  const [togglingIssueId, setTogglingIssueId] = useState<string | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<PageIssue | null>(null);
  const [releaseReport, setReleaseReport] = useState("");
  const openPageMenuRef = useRef<HTMLDivElement>(null);
  const formatSitePath = useFormatSitePath();
  const queryClient = useQueryClient();
  const { hasCapability } = useDebugAuth();
  const canInspect = hasCapability("seo_settings");
  const { toast } = useToast();

  const allErrors = pageDiagnostics?.issues?.filter((i) => i.type === "error") ?? [];
  const allWarnings = pageDiagnostics?.issues?.filter((i) => i.type === "warning") ?? [];
  const errors = allErrors.filter((i) => !i.completed);
  const warnings = allWarnings.filter((i) => !i.completed);
  const entryKey = pageDiagnostics?.entryKey;

  const resolvedArchiveQuery = useQuery<{
    rows: ResolvedArchiveApiRow[];
    total: number;
  }>({
    queryKey: ["/api/validation/resolved-issues", entryKey],
    enabled: open && Boolean(entryKey),
    queryFn: async () => {
      const token = getDebugToken();
      const params = new URLSearchParams({
        entryKey: entryKey!,
        limit: "50",
      });
      const res = await fetch(`/api/validation/resolved-issues?${params.toString()}`, {
        headers: {
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
      });
      if (!res.ok) throw new Error("Failed to load resolved issues");
      return res.json() as Promise<{ rows: ResolvedArchiveApiRow[]; total: number }>;
    },
  });

  const completedIssues = sortCompletedIssues(
    (resolvedArchiveQuery.data?.rows ?? []).map(archiveRowToPageIssue),
  );
  const canSolveWithAi = Boolean(pageDiagnostics && (errors.length > 0 || warnings.length > 0));
  const solvePrompt = pageDiagnostics ? buildSolveWithAiPrompt(pageDiagnostics) : "";
  const openPageUrl = pageUrl ?? pageDiagnostics?.url;
  const inspectLookupUrl = openPageUrl || "";

  const handleUpdateIssue = async (
    issue: PageIssue,
    action: "claim" | "release" | "complete" | "uncomplete",
    report?: string,
  ) => {
    if (action === "release" && report === undefined) {
      setReleaseTarget(issue);
      setReleaseReport("");
      return;
    }
    if (!issue.id) {
      toast({
        title: "Cannot update issue",
        description: "This issue has no id — refresh diagnostics and try again.",
        variant: "destructive",
      });
      return;
    }
    setTogglingIssueId(issue.id);
    try {
      const token = getDebugToken();
      const res = await fetch("/api/validation/cache-issues/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify({
          issueId: issue.id,
          action,
          ...(report ? { report } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Update failed");
      }
      setReleaseTarget(null);
      setReleaseReport("");
      await onRefreshDiagnostics?.();
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-issues"], exact: false });
      if (entryKey) {
        void queryClient.invalidateQueries({
          queryKey: ["/api/validation/resolved-issues", entryKey],
        });
      }
    } catch (err) {
      const titles: Record<typeof action, string> = {
        claim: "Could not claim issue",
        release: "Could not release claim",
        complete: "Could not mark fixed",
        uncomplete: "Could not reopen issue",
      };
      toast({
        title: titles[action],
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setTogglingIssueId(null);
    }
  };

  const gscQuery = useQuery<GscInspectionGetResponse>({
    queryKey: ["/api/debug/gsc-inspection", inspectLookupUrl],
    enabled: open && Boolean(inspectLookupUrl),
    queryFn: async () => {
      const token = getDebugToken();
      const res = await fetch(
        `/api/debug/gsc-inspection?url=${encodeURIComponent(inspectLookupUrl)}`,
        {
          headers: {
            ...getSessionHeaders(),
            ...(token ? { Authorization: `Token ${token}` } : {}),
          },
        },
      );
      if (!res.ok) throw new Error("Failed to load Search Console cache");
      return res.json() as Promise<GscInspectionGetResponse>;
    },
  });

  const crawlerStatuses: CrawlerPageStatus[] = [
    googleToCrawlerStatus({
      configured: gscQuery.data?.configured,
      record: gscQuery.data?.record,
      resolved: gscQuery.data?.resolved,
      loadError: gscQuery.isError,
      loading: gscQuery.isLoading,
    }),
  ];
  const crawlerBadge = crawlerBadgeState(crawlerStatuses);

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
        body: JSON.stringify({ urls: [inspectLookupUrl], force: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Inspect failed");
      }
      return body;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection"] });
    },
  });

  useEffect(() => {
    if (!open) {
      setOpenPageMenuOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!openPageMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (openPageMenuRef.current && !openPageMenuRef.current.contains(e.target as Node)) {
        setOpenPageMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openPageMenuOpen]);

  useEffect(() => {
    if (!open || !pageDiagnostics) return;
    if (preferredTab) {
      setActiveTab(preferredTab);
    } else {
      setActiveTab(errors.length > 0 ? "errors" : "warnings");
    }
  }, [open, pageDiagnostics?.url, pageDiagnostics?.entryKey, errors.length, warnings.length, preferredTab]);

  async function handleRunValidation() {
    if (isRunningValidation) return;
    if (pageDiagnostics?.validationSkippedReason === "unpublished_variant") return;
    setIsRunningValidation(true);
    try {
      const url = pageUrl ?? pageDiagnostics?.url;
      if (url) {
        const token = getDebugToken();
        const variant = pageDiagnostics?.variant;
        await fetch("/api/validation/run-page", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getSessionHeaders(),
            ...(token ? { Authorization: `Token ${token}` } : {}),
          },
          body: JSON.stringify({
            url,
            validators: PER_PAGE_VALIDATORS,
            ...(variant ? { variant } : {}),
          }),
        });
      }
      if (onRefreshDiagnostics) {
        await onRefreshDiagnostics();
      }
    } catch {}
    setIsRunningValidation(false);
  }

  const unpublishedVariant =
    pageDiagnostics?.validationSkippedReason === "unpublished_variant";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <IconAlertTriangle className="h-5 w-5 text-destructive" />
            {pageDiagnostics
              ? `${pageDiagnostics.contentType} · ${pageDiagnostics.slug}`
              : "Page Diagnostics"}
            {pageDiagnostics?.variant && (
              <span
                className="text-xs font-normal px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                data-testid="badge-diagnostics-variant-layer"
              >
                {pageDiagnostics.locale}
                {" · "}
                {pageDiagnostics.variant}
                {typeof pageDiagnostics.allocation === "number"
                  ? ` · ${pageDiagnostics.allocation}%`
                  : ""}
              </span>
            )}
          </DialogTitle>
          <DialogDescription data-testid="text-modal-description" className="flex items-center gap-1.5">
            {pageDiagnostics ? (
              <>
                <span>{pageDiagnostics.url}</span>
                <LocaleFlag locale={pageDiagnostics.locale} />
                {openPageUrl && (
                  <div ref={openPageMenuRef} className="relative">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground"
                      aria-label="Open page"
                      aria-haspopup="menu"
                      aria-expanded={openPageMenuOpen}
                      onClick={() => setOpenPageMenuOpen((prev) => !prev)}
                      data-testid="button-open-page"
                    >
                      <IconExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    {openPageMenuOpen && (
                      <div
                        role="menu"
                        className="absolute left-0 z-50 mt-1 w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover-elevate"
                          onClick={() => {
                            setOpenPageMenuOpen(false);
                            window.location.href = openPageUrl;
                          }}
                          data-testid="menu-open-page-same-tab"
                        >
                          <IconArrowRight className="h-3.5 w-3.5" />
                          Same tab
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover-elevate"
                          onClick={() => {
                            setOpenPageMenuOpen(false);
                            window.open(openPageUrl, "_blank", "noopener,noreferrer");
                          }}
                          data-testid="menu-open-page-new-tab"
                        >
                          <IconExternalLink className="h-3.5 w-3.5" />
                          New tab
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : loading ? (
              "Loading diagnostics…"
            ) : error ? (
              "Could not load diagnostics"
            ) : (
              "No diagnostics available"
            )}
          </DialogDescription>
        </DialogHeader>
        {!pageDiagnostics && error && (
          <div
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            data-testid="text-diagnostics-error"
          >
            {error}
          </div>
        )}
        {pageDiagnostics && (
          <div className="space-y-4">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as PageErrorsTab)}
              className="w-full"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <ToggleButtonBarList data-testid="tabs-page-errors">
                  <ToggleButtonBarTrigger value="errors" data-testid="tab-errors" className="gap-1.5">
                    Errors
                    <TabCountBadge
                      count={errors.length}
                      variant="error"
                      testId="text-modal-error-count"
                    />
                  </ToggleButtonBarTrigger>
                  <ToggleButtonBarTrigger value="warnings" data-testid="tab-warnings" className="gap-1.5">
                    Warnings
                    <TabCountBadge
                      count={warnings.length}
                      variant="warning"
                      testId="text-modal-warning-count"
                    />
                  </ToggleButtonBarTrigger>
                  <ToggleButtonBarTrigger value="crawlers" data-testid="tab-crawlers" className="gap-1.5">
                    Crawlers
                    <TabCountBadge
                      crawlerState={crawlerBadge}
                      testId="text-modal-crawler-error-count"
                    />
                  </ToggleButtonBarTrigger>
                  <ToggleButtonBarTrigger value="completed" data-testid="tab-completed" className="gap-1.5">
                    Completed
                    <TabCountBadge
                      count={completedIssues.length}
                      testId="text-modal-completed-count"
                      zeroAsCount
                    />
                  </ToggleButtonBarTrigger>
                </ToggleButtonBarList>
                <div className="flex items-center gap-2">
                  {activeTab === "crawlers" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => inspectMutation.mutate()}
                      disabled={
                        inspectMutation.isPending ||
                        !canInspect ||
                        !gscQuery.data?.configured ||
                        !!gscQuery.data?.resolved?.isDraft
                      }
                      title={
                        !gscQuery.data?.configured
                          ? "Search Console is not configured"
                          : gscQuery.data?.resolved?.isDraft
                            ? "Draft pages are not sent to Google"
                            : "Check Google"
                      }
                      data-testid="button-check-google"
                    >
                      {inspectMutation.isPending ? (
                        <>
                          <IconLoader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                          <span className="hidden sm:inline">Checking…</span>
                        </>
                      ) : (
                        <>
                          <IconBrandGoogle className="h-3.5 w-3.5 shrink-0" />
                          <span className="hidden sm:inline">Check Google</span>
                        </>
                      )}
                    </Button>
                  ) : activeTab !== "completed" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRunValidation}
                      disabled={isRunningValidation || unpublishedVariant}
                      title={
                        unpublishedVariant
                          ? "Unpublished variants are not validated"
                          : isRunningValidation
                            ? "Running…"
                            : "Validate"
                      }
                      aria-label={isRunningValidation ? "Running…" : "Validate"}
                      data-testid="button-run-validation"
                    >
                      {isRunningValidation ? (
                        <>
                          <IconLoader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                          <span className="hidden sm:inline">Running…</span>
                        </>
                      ) : (
                        <>
                          <IconRefresh className="h-3.5 w-3.5 shrink-0" />
                          <span className="hidden sm:inline">Validate</span>
                        </>
                      )}
                    </Button>
                  ) : null}
                </div>
              </div>

              {unpublishedVariant ? (
                <p
                  className="text-sm text-muted-foreground mt-3 p-3 rounded-md bg-muted/50 border border-border"
                  data-testid="text-unpublished-variant-education"
                >
                  {pageDiagnostics.education?.summary ||
                    "This variant isn’t published (0% traffic). Diagnostics run after you assign traffic. Redirects stay on the live locale file only."}
                </p>
              ) : (
                activeTab !== "crawlers" && activeTab !== "completed" && (pageDiagnostics.cached ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-2" data-testid="text-cached-staleness">
                  <IconClock className="h-3.5 w-3.5" />
                  Validated {formatStaleness(pageDiagnostics.cached.lastRunAt)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-2" data-testid="cached-not-yet-validated">
                  Not yet validated — click &quot;Validate&quot; to refresh this list.
                </p>
              ))
              )}

              {!unpublishedVariant && (
              <TabsContent value="errors" className="mt-3 space-y-2">
                {errors.length === 0 ? (
                  <div
                    className="p-3 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground"
                    data-testid="modal-errors-empty"
                  >
                    No open errors for this entry.
                  </div>
                ) : (
                  errors.map((issue, i) => (
                    <IssueCard
                      key={issue.id ?? `${issue.code}-${i}`}
                      issue={issue}
                      index={i}
                      variant="error"
                      formatSitePath={formatSitePath}
                      onUpdateIssue={handleUpdateIssue}
                      togglePending={togglingIssueId === issue.id}
                    />
                  ))
                )}
              </TabsContent>
              )}

              {!unpublishedVariant && (
              <TabsContent value="warnings" className="mt-3 space-y-2">
                {warnings.length === 0 ? (
                  <div
                    className="p-3 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground"
                    data-testid="modal-warnings-empty"
                  >
                    No open warnings for this entry.
                  </div>
                ) : (
                  warnings.map((issue, i) => (
                    <IssueCard
                      key={issue.id ?? `${issue.code}-${i}`}
                      issue={issue}
                      index={i}
                      variant="warning"
                      formatSitePath={formatSitePath}
                      onUpdateIssue={handleUpdateIssue}
                      togglePending={togglingIssueId === issue.id}
                    />
                  ))
                )}
              </TabsContent>
              )}

              {!unpublishedVariant && (
              <TabsContent value="completed" className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground" data-testid="text-completed-education">
                  History of issues marked fixed for this page (including fixes that removed them from
                  Errors/Warnings). Reopened means diagnostics found the problem again.
                </p>
                {resolvedArchiveQuery.isLoading && entryKey ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground p-3">
                    <IconLoader2 className="h-4 w-4 animate-spin" />
                    Loading resolved history…
                  </div>
                ) : !entryKey ? (
                  <div
                    className="p-3 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground"
                    data-testid="modal-completed-no-entry"
                  >
                    No entry key for this page — resolved history is unavailable.
                  </div>
                ) : completedIssues.length === 0 ? (
                  <div
                    className="p-3 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground"
                    data-testid="modal-completed-empty"
                  >
                    No completed issues for this entry.
                  </div>
                ) : (
                  completedIssues.map((issue, i) => (
                    <IssueCard
                      key={issue.id ?? `completed-${issue.code}-${i}`}
                      issue={issue}
                      index={i}
                      variant={issue.type === "error" ? "error" : "warning"}
                      formatSitePath={formatSitePath}
                      onUpdateIssue={handleUpdateIssue}
                      togglePending={togglingIssueId === issue.id}
                      showSeverityBadge
                    />
                  ))
                )}
              </TabsContent>
              )}

              <TabsContent value="crawlers" className="mt-3 space-y-3">
                <div className="space-y-1.5" data-testid="text-crawlers-education">
                  <p className="text-xs text-muted-foreground">
                    Badge counts crawlers that are not OK (never checked, not indexed, errors, or not
                    configured). Green check means every applicable crawler has this URL indexed —
                    drafts do not count. Cached Search Console data only; Check Google spends daily
                    quota.
                  </p>
                  <Collapsible>
                    <CollapsibleTrigger className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                      Read more (advanced)
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-1.5 text-[11px] text-muted-foreground space-y-1">
                      <p>
                        Status model: <code className="font-mono">client/src/lib/crawlerStatus.ts</code>
                      </p>
                      <p>
                        Google inspection helpers:{" "}
                        <code className="font-mono">client/src/lib/gscInspection.ts</code>
                      </p>
                      <p>
                        Configure the service account under SEO/GEO → Search Console. Restarts do not
                        call Google; they read the disk cache.
                      </p>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
                {crawlerStatuses.map((crawler) => (
                  <CrawlerStatusCard
                    key={crawler.id}
                    crawler={crawler}
                    formatStaleness={formatStaleness}
                    onOpenChange={onOpenChange}
                    inspectError={
                      crawler.id === "google" && inspectMutation.isError
                        ? inspectMutation.error instanceof Error
                          ? inspectMutation.error.message
                          : "Inspect failed"
                        : null
                    }
                  />
                ))}
              </TabsContent>
            </Tabs>
          </div>
        )}
        <DialogFooter className="sm:justify-end gap-2 flex-wrap">
          {!pageDiagnostics && error && onRefreshDiagnostics && (
            <Button
              variant="default"
              onClick={() => void onRefreshDiagnostics()}
              disabled={loading}
              data-testid="button-retry-diagnostics"
            >
              {loading ? (
                <>
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                  Retrying…
                </>
              ) : (
                "Retry"
              )}
            </Button>
          )}
          <SolveWithAiAgentDropdown
            label="Solve with AI Agent"
            prompt={solvePrompt}
            disabled={!canSolveWithAi}
            onAgentSelect={(payload) => onSolveWithAi?.(payload)}
          />
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-page-errors">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(releaseTarget)}
        onOpenChange={(next) => {
          if (!next) {
            setReleaseTarget(null);
            setReleaseReport("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Release claim</DialogTitle>
            <DialogDescription>
              Note what you tried and why you are stopping. The next agent or teammate will see this
              on the issue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="release-report">What went wrong (min 80 characters)</Label>
            <Textarea
              id="release-report"
              value={releaseReport}
              onChange={(e) => setReleaseReport(e.target.value)}
              rows={4}
              placeholder="Tried X… still failing because Y…"
              data-testid="textarea-release-report"
            />
            <p className="text-[10px] text-muted-foreground">
              {releaseReport.trim().length}/80
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setReleaseTarget(null);
                setReleaseReport("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={releaseReport.trim().length < 80 || !releaseTarget}
              onClick={() => {
                if (!releaseTarget) return;
                void handleUpdateIssue(releaseTarget, "release", releaseReport.trim());
              }}
              data-testid="button-confirm-release"
            >
              {togglingIssueId === releaseTarget?.id ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Release"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
