import { Fragment, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  IconAlertTriangle,
  IconAlertCircle,
  IconServerBolt,
  IconBug,
  IconRefresh,
  IconInfoCircle,
  IconChevronRight,
  IconCopy,
  IconArrowUp,
  IconArrowDown,
  IconArrowsSort,
  IconCloudDownload,
  IconLoader2,
  IconEyeOff,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MetricsAccessGate } from "@/components/MetricsAccessGate";
import { ServerSectionHeader } from "@/components/process-stats/ServerSectionHeader";
import { ErrorLogIgnoreConfirmDialog } from "@/components/diagnostics/ErrorLogIgnoreConfirmDialog";
import { ErrorLogIgnoreRulesDialog } from "@/components/diagnostics/ErrorLogIgnoreRulesDialog";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiRequestWithAuth } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type {
  ErrorLogIgnoreCandidate,
  ErrorLogIgnoreRule,
  ErrorLogIgnoreRuleInput,
} from "@shared/error-log-ignore";
import {
  nextErrorLogSort,
  parseErrorLogSort,
  serializeErrorLogSort,
  sortErrorLogIssues,
  type ErrorLogSort,
  type ErrorLogSortKey,
} from "./error-log-sort";

type LevelFilter = "all" | "error" | "warn";

interface ErrorLogEntry {
  id: number;
  ts: number;
  level: "error" | "warn";
  module: string;
  message: string;
  err_name: string | null;
}

export interface UniqueIssue {
  fingerprint: string;
  module: string;
  level: "error" | "warn";
  message: string;
  err_name: string | null;
  count: number;
  lastTs: number;
  lastId: number;
  sampleTs: number[];
}

interface ErrorLogEntryDetail {
  id: number;
  ts: number;
  level: "error" | "warn";
  module: string;
  message: string;
  err_name: string | null;
  err_stack: string | null;
  context: Record<string, unknown> | null;
}

class ErrorLogDetailFetchError extends Error {
  status: number;
  constructor(status: number) {
    super(`Failed to fetch error log entry (${status})`);
    this.status = status;
  }
}

interface ErrorLogResponse {
  totalErrors: number;
  totalWarnings: number;
  uniqueIssues: UniqueIssue[];
  topIssue: string | null;
  recent: ErrorLogEntry[];
  ignored?: ErrorLogIgnoreRule[];
}

function formatTs(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function LevelBadge({ level }: { level: "error" | "warn" }) {
  if (level === "error") {
    return (
      <Badge variant="destructive" className="text-xs font-mono uppercase">
        error
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs font-mono uppercase text-amber-600 border-amber-400">
      warn
    </Badge>
  );
}

function MessageWithErrorType({ message, errName }: { message: string; errName: string | null }) {
  return (
    <div className="flex flex-col items-start gap-1">
      {errName && (
        <Badge
          variant="outline"
          className="text-[10px] font-mono px-1.5 py-0 border-transparent bg-destructive/10 text-destructive"
        >
          {errName}
        </Badge>
      )}
      <span className="line-clamp-2">{message}</span>
    </div>
  );
}

function formatContextValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function buildCopyText(
  entry: ErrorLogEntryDetail,
  opts: { count?: number; sampleTs?: number[] },
): string {
  const lines = [
    `Error log entry #${entry.id}`,
    `Level: ${entry.level}`,
    `Module: ${entry.module}`,
    `Message: ${entry.message}`,
    `Error type: ${entry.err_name ?? "—"}`,
    `Time: ${new Date(entry.ts).toISOString()}`,
  ];
  if (opts.count != null) lines.push(`Count (last 48h): ${opts.count}`);
  if (opts.sampleTs && opts.sampleTs.length > 0) {
    lines.push(`Recent occurrences: ${opts.sampleTs.map((ts) => new Date(ts).toISOString()).join(", ")}`);
  }
  lines.push("", "Context:", entry.context ? JSON.stringify(entry.context, null, 2) : "(none)");
  lines.push("", "Stack:", entry.err_stack ?? "(none)");
  return lines.join("\n");
}

function ErrorLogDetail({
  id,
  count,
  sampleTs,
}: {
  id: number;
  count?: number;
  sampleTs?: number[];
}) {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<ErrorLogEntryDetail, ErrorLogDetailFetchError>({
    queryKey: ["/api/admin/error-log", "entry", id],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/error-log/${id}`);
      if (!res.ok) throw new ErrorLogDetailFetchError(res.status);
      return res.json();
    },
    retry: (failures, err) => err.status !== 404 && failures < 2,
    staleTime: Infinity,
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading details…</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-muted-foreground" data-testid={`error-log-detail-error-${id}`}>
        {error.status === 404
          ? "This entry was pruned (older than 48 hours)."
          : "Could not load details for this entry. Try Refresh."}
      </p>
    );
  }
  if (!data) return null;

  const contextEntries = data.context ? Object.entries(data.context) : [];
  const hasDetails = contextEntries.length > 0 || !!data.err_stack;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildCopyText(data, { count, sampleTs }));
      toast({ title: "Details copied", description: "Paste them to a developer or an agent.", duration: 2000 });
    } catch {
      toast({ title: "Copy failed", description: "Your browser blocked clipboard access.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4" data-testid={`error-log-detail-${id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Latest occurrence of this issue. Copy details to share with a developer or an agent.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          data-testid={`button-copy-error-log-${id}`}
        >
          <IconCopy className="w-4 h-4 mr-2" />
          Copy details
        </Button>
      </div>

      {sampleTs && sampleTs.length > 1 && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Recent occurrences: </span>
          <span className="font-mono">{sampleTs.map(formatTs).join(" · ")}</span>
        </div>
      )}

      {!hasDetails && (
        <p className="text-sm text-muted-foreground">
          No extra details were recorded for this entry (it may predate detail capture).
        </p>
      )}

      {contextEntries.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Context</h4>
          <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1 rounded-md border bg-background p-3 text-xs">
            {contextEntries.map(([key, value]) => (
              <Fragment key={key}>
                <dt className="font-mono text-muted-foreground">{key}</dt>
                <dd className="font-mono text-foreground whitespace-pre-wrap break-all">
                  {formatContextValue(value)}
                </dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}

      {data.err_stack && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stack</h4>
          <pre className="max-h-80 overflow-auto rounded-md border bg-background p-3 text-xs font-mono text-foreground whitespace-pre">
            {data.err_stack}
          </pre>
        </div>
      )}
    </div>
  );
}

function ExpandChevron({ open }: { open: boolean }) {
  return (
    <IconChevronRight
      className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-90")}
      aria-hidden
    />
  );
}

function SortableHead({
  col,
  label,
  sort,
  onSort,
  className,
  align = "left",
}: {
  col: ErrorLogSortKey;
  label: string;
  sort: ErrorLogSort;
  onSort: (col: ErrorLogSortKey) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const active = sort.key === col;
  const Icon = !active ? IconArrowsSort : sort.dir === "asc" ? IconArrowUp : IconArrowDown;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          align === "right" && "w-full justify-end",
          active && "text-foreground",
        )}
        onClick={() => onSort(col)}
        data-testid={`sort-error-log-${col}`}
      >
        {label}
        <Icon className={cn("w-3 h-3", !active && "opacity-40")} aria-hidden />
      </button>
    </TableHead>
  );
}

export function ErrorLogIssueTable({
  issues,
  bare = false,
  canIgnore = false,
  ignorePending = false,
  onIgnore,
}: {
  issues: UniqueIssue[];
  bare?: boolean;
  canIgnore?: boolean;
  ignorePending?: boolean;
  onIgnore?: (issue: UniqueIssue) => void;
}) {
  const [openIssue, setOpenIssue] = useState<string | null>(null);
  const [pathname, setLocation] = useLocation();
  const searchString = useSearch();
  const sort = useMemo(() => parseErrorLogSort(searchString), [searchString]);
  const handleSort = useCallback(
    (col: ErrorLogSortKey) => {
      const qs = serializeErrorLogSort(nextErrorLogSort(sort, col), searchString);
      const pathOnly = pathname.split("?")[0];
      setLocation(qs ? `${pathOnly}?${qs}` : pathOnly, { replace: true });
    },
    [sort, searchString, pathname, setLocation],
  );
  const sortedIssues = useMemo(() => sortErrorLogIssues(issues, sort), [issues, sort]);
  if (issues.length === 0) return null;
  const colSpan = canIgnore ? 7 : 6;
  const table = (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" aria-label="Expand" />
              <TableHead className="w-20">Level</TableHead>
              <TableHead className="w-44">Module</TableHead>
              <TableHead>Message</TableHead>
              <SortableHead col="count" label="Count" sort={sort} onSort={handleSort} className="text-right w-24" align="right" />
              <SortableHead col="lastSeen" label="Last seen" sort={sort} onSort={handleSort} className="w-40" />
              {canIgnore ? <TableHead className="w-24 text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedIssues.map((row, idx) => {
              const open = openIssue === row.fingerprint;
              const toggle = () => setOpenIssue(open ? null : row.fingerprint);
              return (
                <Fragment key={row.fingerprint}>
                  <TableRow
                    data-testid={`row-unique-issue-${idx}`}
                    className="cursor-pointer"
                    onClick={toggle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle();
                      }
                    }}
                    tabIndex={0}
                    aria-expanded={open}
                  >
                    <TableCell className="pr-0">
                      <ExpandChevron open={open} />
                    </TableCell>
                    <TableCell>
                      <LevelBadge level={row.level} />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{row.module}</TableCell>
                    <TableCell className="text-sm text-foreground max-w-md">
                      <MessageWithErrorType message={row.message} errName={row.err_name} />
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{row.count}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {formatTs(row.lastTs)}
                    </TableCell>
                    {canIgnore ? (
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7"
                          disabled={ignorePending || !onIgnore}
                          onClick={() => onIgnore?.(row)}
                          data-testid={`button-ignore-issue-${idx}`}
                        >
                          <IconEyeOff className="h-3.5 w-3.5 mr-1" />
                          Ignore
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                  {open && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={colSpan} className="bg-muted/40 p-4">
                        <ErrorLogDetail id={row.lastId} count={row.count} sampleTs={row.sampleTs} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
  );
  if (bare) return table;
  return (
    <Card data-testid="card-unique-issues">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Top unique issues</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Same message shape collapsed. Errors first, then by count, unless you sort by Count or Last seen
          (click again to flip, a third time to reset). Last seen shows the most recent occurrence.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {table}
      </CardContent>
    </Card>
  );
}

export default function ErrorLogPage() {
  return (
    <MetricsAccessGate>
      <ErrorLogPageInner />
    </MetricsAccessGate>
  );
}

function productionErrorLogFilename(productionOrigin: string | undefined): string {
  let host = "production";
  if (productionOrigin) {
    try {
      host = new URL(productionOrigin).host;
    } catch {
      /* keep default */
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `error-log-${host}-${stamp}.json`;
}

function ErrorLogPageInner() {
  const { toast } = useToast();
  const { hasCapability } = useDebugAuth();
  const queryClient = useQueryClient();
  const canIgnore = hasCapability("errors_manage");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [openEventId, setOpenEventId] = useState<number | null>(null);
  const [downloadingProduction, setDownloadingProduction] = useState(false);
  const [ignoreRulesOpen, setIgnoreRulesOpen] = useState(false);
  const [ignoreCandidate, setIgnoreCandidate] = useState<ErrorLogIgnoreCandidate | null>(null);

  const downloadProduction = async () => {
    if (!import.meta.env.DEV) return;
    setDownloadingProduction(true);
    try {
      const res = await apiRequestWithAuth("POST", "/api/admin/error-log/pull-production", {});
      const body = (await res.json()) as { productionOrigin?: string; total?: number };
      const filename = productionErrorLogFilename(body.productionOrigin);
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      toast({
        title: "Production log downloaded",
        description: `${body.total ?? 0} entries from ${body.productionOrigin ?? "production"} saved as ${filename}.`,
      });
    } catch (err) {
      toast({
        title: "Could not download production log",
        description: err instanceof Error ? err.message : "Download failed.",
        variant: "destructive",
      });
    } finally {
      setDownloadingProduction(false);
    }
  };

  const { data, isLoading, refetch, isFetching, isError } = useQuery<ErrorLogResponse>({
    queryKey: ["/api/admin/error-log", levelFilter],
    queryFn: async () => {
      const params = levelFilter !== "all" ? `?level=${levelFilter}` : "";
      const res = await apiFetch(`/api/admin/error-log${params}`);
      if (!res.ok) throw new Error("Failed to fetch error log");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const ignored = data?.ignored ?? [];

  const ignoreMutation = useMutation({
    mutationFn: async (rule: ErrorLogIgnoreRuleInput) => {
      const res = await apiFetch("/api/admin/error-log/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to ignore");
      return body as { ignored: ErrorLogIgnoreRule[]; added: number; removed: number };
    },
    onSuccess: (body) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/error-log"] });
      setIgnoreCandidate(null);
      toast({
        title: "Ignore rule saved",
        description:
          body.removed > 0
            ? `${body.removed} matching row${body.removed === 1 ? "" : "s"} removed from the log.`
            : "Future matches will not be stored. No matching rows were in the log.",
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

  const unignoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch("/api/admin/error-log/unignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to unignore");
      return body as { ignored: ErrorLogIgnoreRule[] };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/error-log"] });
      toast({ title: "Ignore rule removed" });
    },
    onError: (err) => {
      toast({
        title: "Unignore failed",
        description: err instanceof Error ? err.message : "Failed to unignore",
        variant: "destructive",
      });
    },
  });

  const startIgnore = async (issue: UniqueIssue) => {
    let context: Record<string, unknown> | null = null;
    try {
      const res = await apiFetch(`/api/admin/error-log/${issue.lastId}`);
      if (res.ok) {
        const detail = (await res.json()) as ErrorLogEntryDetail;
        context = detail.context;
      }
    } catch {
      /* use issue fields only */
    }
    setIgnoreCandidate({
      level: issue.level,
      module: issue.module,
      message: issue.message,
      errName: issue.err_name,
      context,
    });
  };

  const topIssueModule = data?.uniqueIssues?.[0]?.module ?? "—";

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <ServerSectionHeader
        section="logs"
        title="Logs"
        description="Warnings and errors from the whole server, for every site, kept for the last 48 hours. The table groups the same message into one issue. Repeated warnings are rate-limited when they are stored, so the totals stay usable."
      />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap gap-2">
          {canIgnore ? (
            <Button
              variant="outline"
              size="default"
              onClick={() => setIgnoreRulesOpen(true)}
              data-testid="button-error-log-ignore-rules"
            >
              <IconEyeOff className="w-4 h-4 mr-2" />
              Ignore rules{ignored.length ? ` (${ignored.length})` : ""}
            </Button>
          ) : null}
          {import.meta.env.DEV ? (
            <Button
              variant="outline"
              size="default"
              onClick={() => void downloadProduction()}
              disabled={downloadingProduction}
              data-testid="button-download-production-error-log"
            >
              {downloadingProduction ? (
                <IconLoader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <IconCloudDownload className="w-4 h-4 mr-2" />
              )}
              {downloadingProduction ? "Downloading…" : "Download from production"}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="default"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-error-log"
          >
            <IconRefresh className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-md border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <IconInfoCircle className="h-4 w-4 mt-0.5 shrink-0 text-foreground/60" />
        <div className="space-y-2">
          <p>
            This log is <strong className="text-foreground font-medium">centralized across all sites</strong>.
            It captures process-level errors and warnings from the entire server, not just the currently active site.
          </p>
          <p>
            The main table lists <strong className="text-foreground font-medium">unique issues</strong> (same message shape collapsed).
            Repeated warnings are rate-limited when stored so totals stay usable.
            The DebugBubble badge counts <strong className="text-foreground font-medium">errors only</strong>.
          </p>
          <p>
            <strong className="text-foreground font-medium">Ignore</strong> is a hand-reviewed decision: it stops
            future matching rows from being stored and removes matching rows already listed. Only staff with
            Manage error log can ignore.
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer text-foreground/80 hover:text-foreground">
              Read more (advanced)
            </summary>
            <ul className="mt-2 list-disc pl-4 space-y-1 font-mono">
              <li>errors_manage — capability for Ignore / Unignore</li>
              <li>data/error-log-ignore.json — local ignore rules</li>
              <li>multisite-global/error-log-ignore.json — production GCS (prod only uploads)</li>
              <li>server/db.ts — SQLite warn sink rate-limit + ignore filter</li>
              <li>server/logger.ts — DbLogStream (warn+)</li>
              <li>shared/error-log-fingerprint.ts — message normalize</li>
              <li>server/utils/error-log-context.ts — what is saved in Context, sensitive keys redacted, 4 KB cap</li>
              <li>server/routes/admin.ts — GET /api/admin/error-log, ignore / unignore / preview-ignore</li>
              <li>server/routes/admin.ts — GET /api/admin/error-log/export (full 48h dump incl. stack + context)</li>
              <li>
                server/error-log/pull-production.ts — POST /api/admin/error-log/pull-production (dev only:
                saves production&apos;s log as a JSON file; local log unchanged)
              </li>
            </ul>
          </details>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-total-errors">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Errors</CardTitle>
            <IconAlertCircle className="w-4 h-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-total-errors">
              {isLoading ? "—" : (data?.totalErrors ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">last 48h</p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-warnings">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Warnings</CardTitle>
            <IconAlertTriangle className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-total-warnings">
              {isLoading ? "—" : (data?.totalWarnings ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">last 48h (after rate-limit)</p>
          </CardContent>
        </Card>

        <Card data-testid="card-top-module">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Top Issue Module</CardTitle>
            <IconServerBolt className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-base font-semibold truncate" data-testid="text-top-module">
              {isLoading ? "—" : topIssueModule}
            </div>
            <p className="text-xs text-muted-foreground mt-1">from top unique issue</p>
          </CardContent>
        </Card>

        <Card data-testid="card-top-issue">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Top Issue Type</CardTitle>
            <IconBug className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-base font-semibold truncate" data-testid="text-top-issue">
              {isLoading ? "—" : (data?.topIssue ?? "—")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">most common error name</p>
          </CardContent>
        </Card>
      </div>

      <ErrorLogIssueTable
        issues={data?.uniqueIssues ?? []}
        canIgnore={canIgnore}
        ignorePending={ignoreMutation.isPending}
        onIgnore={(issue) => void startIgnore(issue)}
      />

      <ErrorLogIgnoreConfirmDialog
        open={!!ignoreCandidate}
        onOpenChange={(open) => {
          if (!open) setIgnoreCandidate(null);
        }}
        candidate={ignoreCandidate}
        pending={ignoreMutation.isPending}
        onConfirm={(rule) => ignoreMutation.mutate(rule)}
      />

      <ErrorLogIgnoreRulesDialog
        open={ignoreRulesOpen}
        onOpenChange={setIgnoreRulesOpen}
        ignored={ignored}
        canRemove={canIgnore}
        unignorePending={unignoreMutation.isPending}
        onRemove={(id) => unignoreMutation.mutate(id)}
      />

      <Card data-testid="card-recent-events">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Recent Events</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Latest raw rows as stored (warnings already rate-limited at ingest).
              </p>
            </div>
            <div className="flex gap-1" role="group" aria-label="Filter by level">
              {(["all", "error", "warn"] as LevelFilter[]).map((f) => (
                <Button
                  key={f}
                  variant={levelFilter === f ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLevelFilter(f)}
                  data-testid={`button-filter-${f}`}
                >
                  {f === "all" ? "All" : f === "error" ? "Errors" : "Warnings"}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Loading…</div>
          ) : isError ? (
            <div className="p-6 text-center text-destructive text-sm" data-testid="error-log-fetch-error">
              Failed to load error log. Check that you are signed in.
            </div>
          ) : !data?.recent || data.recent.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              No events in the last 48 hours.
            </div>
          ) : (
            <div className="overflow-auto max-h-[480px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" aria-label="Expand" />
                    <TableHead className="w-40">Time</TableHead>
                    <TableHead className="w-20">Level</TableHead>
                    <TableHead className="w-44">Module</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recent.map((entry) => {
                    const open = openEventId === entry.id;
                    const toggle = () => setOpenEventId(open ? null : entry.id);
                    return (
                      <Fragment key={entry.id}>
                        <TableRow
                          data-testid={`row-event-${entry.id}`}
                          className="cursor-pointer"
                          onClick={toggle}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggle();
                            }
                          }}
                          tabIndex={0}
                          aria-expanded={open}
                        >
                          <TableCell className="pr-0">
                            <ExpandChevron open={open} />
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                            {formatTs(entry.ts)}
                          </TableCell>
                          <TableCell>
                            <LevelBadge level={entry.level} />
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[10rem]">
                            {entry.module}
                          </TableCell>
                          <TableCell className="text-sm text-foreground max-w-xs">
                            <MessageWithErrorType message={entry.message} errName={entry.err_name} />
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={5} className="bg-muted/40 p-4">
                              <ErrorLogDetail id={entry.id} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
