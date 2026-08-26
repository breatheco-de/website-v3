import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconAlertTriangle, IconAlertCircle, IconServerBolt, IconBug, IconRefresh, IconInfoCircle } from "@tabler/icons-react";
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
import { apiFetch } from "@/lib/queryClient";

type LevelFilter = "all" | "error" | "warn";

interface ErrorLogEntry {
  id: number;
  ts: number;
  level: "error" | "warn";
  module: string;
  message: string;
  err_name: string | null;
}

interface UniqueIssue {
  module: string;
  level: "error" | "warn";
  message: string;
  err_name: string | null;
  count: number;
  lastTs: number;
}

interface ErrorLogResponse {
  totalErrors: number;
  totalWarnings: number;
  uniqueIssues: UniqueIssue[];
  topIssue: string | null;
  recent: ErrorLogEntry[];
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

export default function ErrorLogPage() {
  return (
    <MetricsAccessGate>
      <ErrorLogPageInner />
    </MetricsAccessGate>
  );
}

function ErrorLogPageInner() {
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");

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

  const topIssueModule = data?.uniqueIssues?.[0]?.module ?? "—";

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Error &amp; Warning Log</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Server-side warn/error events — last 48 hours</p>
        </div>
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
          <details className="text-xs">
            <summary className="cursor-pointer text-foreground/80 hover:text-foreground">
              Read more (advanced)
            </summary>
            <ul className="mt-2 list-disc pl-4 space-y-1 font-mono">
              <li>server/db.ts — SQLite warn sink rate-limit</li>
              <li>server/logger.ts — DbLogStream (warn+)</li>
              <li>server/utils/error-log-fingerprint.ts — message normalize</li>
              <li>server/routes/admin.ts — GET /api/admin/error-log</li>
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

      {data?.uniqueIssues && data.uniqueIssues.length > 0 && (
        <Card data-testid="card-unique-issues">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top unique issues</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Same message shape collapsed. Errors first, then by count. Last seen shows the most recent occurrence.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Level</TableHead>
                  <TableHead className="w-44">Module</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="text-right w-24">Count</TableHead>
                  <TableHead className="w-40">Last seen</TableHead>
                  <TableHead className="w-36">Error type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.uniqueIssues.map((row, idx) => (
                  <TableRow
                    key={`${row.level}-${row.module}-${idx}`}
                    data-testid={`row-unique-issue-${idx}`}
                  >
                    <TableCell>
                      <LevelBadge level={row.level} />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{row.module}</TableCell>
                    <TableCell className="text-sm text-foreground max-w-md">
                      <span className="line-clamp-2">{row.message}</span>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.count}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {formatTs(row.lastTs)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.err_name ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
                    <TableHead className="w-40">Time</TableHead>
                    <TableHead className="w-20">Level</TableHead>
                    <TableHead className="w-44">Module</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="w-36">Error Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recent.map((entry) => (
                    <TableRow key={entry.id} data-testid={`row-event-${entry.id}`}>
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
                        <span className="line-clamp-2">{entry.message}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {entry.err_name ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
