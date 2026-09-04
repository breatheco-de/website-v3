import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";
import { apiFetch } from "@/lib/queryClient";
import { formatIssueActorLine } from "@/lib/formatIssueActor";
import { cn } from "@/lib/utils";
import { formatSitePathsInText } from "@shared/formatSitePath";
import {
  IssueCodePopover,
  issueCodeLookupKey,
  resolveIssueSuggestionClient,
  type IssueCodeDefinitionClient,
} from "@/components/diagnostics/issue-code-help";

export type ResolvedArchiveRow = {
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
  agent_session_id?: string;
  resolution?: "verified_gone" | "soft_complete";
};

type AgentSessionDetail = {
  summary: {
    agent_session_id: string;
    write_count: number;
    issue_complete_count: number;
  };
  files: string[];
  headline: string | null;
};

type SiteInfo = {
  contentFolder: string;
};

export function ResolvedIssueRow({
  row,
  idx,
  defaultOpen = false,
  issueCodeMap,
}: {
  row: ResolvedArchiveRow;
  idx: number;
  defaultOpen?: boolean;
  issueCodeMap?: Map<string, IssueCodeDefinitionClient>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const formatSitePath = useFormatSitePath();
  const sessionId = row.agent_session_id?.trim() || "";
  const help =
    issueCodeMap && row.validator
      ? issueCodeMap.get(issueCodeLookupKey(row.validator, row.code))
      : undefined;
  const suggestionText = resolveIssueSuggestionClient(
    issueCodeMap ?? new Map(),
    row.validator,
    row.code,
    row.suggestion,
  );

  const { data: siteInfo } = useQuery<SiteInfo>({
    queryKey: ["/api/site/info"],
  });
  const site = siteInfo?.contentFolder;

  const sessionQuery = useQuery<AgentSessionDetail | null>({
    queryKey: ["/api/admin/agent-sessions", sessionId, site],
    enabled: open && Boolean(sessionId) && Boolean(site),
    retry: false,
    queryFn: async () => {
      const res = await apiFetch(
        `/api/admin/agent-sessions/${encodeURIComponent(sessionId)}?site=${encodeURIComponent(site!)}`,
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Failed to load agent session (${res.status})`);
      return (await res.json()) as AgentSessionDetail;
    },
  });

  const validatorLabel = row.validator || "unknown";
  const categoryLabel =
    row.category && row.category !== row.validator ? row.category : undefined;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "border-b border-border/60 px-4 py-3 text-xs transition-colors",
          open ? "bg-card" : "hover:bg-card/60",
        )}
        data-testid={`resolved-issue-row-${idx}`}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group flex w-full items-start gap-2.5 text-left"
            data-testid={`button-resolved-issue-expand-${idx}`}
            aria-expanded={open}
          >
            <ChevronDown
              className={cn(
                "mt-[3px] h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:text-foreground",
                open && "rotate-180",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                      row.severity === "error"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-chart-2/10 text-chart-2",
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {row.severity}
                  </span>
                  <IssueCodePopover
                    code={row.code}
                    validator={row.validator}
                    help={help}
                    className="truncate text-[11px] font-medium text-foreground/80"
                  />
                  {row.reopenedAt ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      data-testid="badge-resolved-reopened"
                    >
                      Reopened
                    </Badge>
                  ) : null}
                </div>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(row.resolvedAt), { addSuffix: true })}
                </span>
              </div>
              <p
                className="mt-1.5 line-clamp-2 leading-relaxed text-foreground"
                title={row.message}
              >
                {formatSitePathsInText(row.message, formatSitePath)}
              </p>
              <p className="mt-1 truncate text-[10px] text-muted-foreground">
                {validatorLabel}
                {categoryLabel ? ` · ${categoryLabel}` : ""} · resolved by{" "}
                {formatIssueActorLine(row.resolvedBy, row.actor)}
              </p>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {open ? (
            <div className="ml-6 mt-3 space-y-3 rounded-md border border-border/60 bg-background/50 p-3">
              <DetailRow label="Suggested fix">
                {suggestionText ? (
                  <p className="text-muted-foreground" data-testid="resolved-issue-suggestion">
                    {formatSitePathsInText(suggestionText, formatSitePath)}
                  </p>
                ) : (
                  <p className="text-muted-foreground/70" data-testid="resolved-issue-suggestion">
                    No suggested fix.
                  </p>
                )}
              </DetailRow>
              <DetailRow label="They said">
                {row.report ? (
                  <p
                    className="whitespace-pre-wrap text-foreground/90"
                    data-testid="resolved-issue-report"
                  >
                    {row.report}
                  </p>
                ) : (
                  <p className="text-muted-foreground/70" data-testid="resolved-issue-report">
                    No note on this fix.
                  </p>
                )}
              </DetailRow>
              {row.url || row.file ? (
                <DetailRow label="Where">
                  {row.url ? <p className="truncate text-muted-foreground">{row.url}</p> : null}
                  {row.file ? (
                    <p
                      className="truncate font-mono text-[11px] text-muted-foreground"
                      title={row.file}
                    >
                      {formatSitePath(row.file)}
                    </p>
                  ) : null}
                </DetailRow>
              ) : null}
              <DetailRow label="Agent run" testId="resolved-issue-agent-run">
                <AgentRunBlock
                  sessionId={sessionId}
                  siteReady={Boolean(site)}
                  sessionQuery={sessionQuery}
                />
              </DetailRow>
              <div className="border-t border-border/60 pt-2.5">
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  data-testid="button-resolved-issue-advanced"
                >
                  {advancedOpen ? "Hide advanced" : "Read more (advanced)"}
                </button>
                {advancedOpen ? (
                  <div
                    className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted-foreground"
                    data-testid="resolved-issue-advanced"
                  >
                    <p>
                      {row.resolution === "verified_gone"
                        ? "Verified — checks were re-run and the problem was gone."
                        : row.resolution === "soft_complete"
                          ? "Marked in UI — someone clicked done without that check."
                          : "How this was closed is not recorded."}
                    </p>
                    <p>
                      The agent run is the same diary as Background Pipeline and lasts about 7 days;
                      the note on the row is kept longer.
                    </p>
                    <p>Resolved {new Date(row.resolvedAt).toLocaleString()}</p>
                    {row.reopenedAt ? (
                      <p>Reopened {new Date(row.reopenedAt).toLocaleString()}</p>
                    ) : null}
                    <div className="space-y-0.5 pt-1 font-mono text-[10px] text-muted-foreground/80">
                      <p className="truncate">issue {row.issueId}</p>
                      {row.entryKey ? <p className="truncate">{row.entryKey}</p> : null}
                      {sessionId ? <p className="truncate">session {sessionId}</p> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function DetailRow({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="grid gap-0.5 sm:grid-cols-[6.5rem_1fr] sm:gap-x-4 sm:gap-y-0"
      data-testid={testId}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80 sm:pt-[2px]">
        {label}
      </p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function AgentRunBlock({
  sessionId,
  siteReady,
  sessionQuery,
}: {
  sessionId: string;
  siteReady: boolean;
  sessionQuery: {
    data: AgentSessionDetail | null | undefined;
    isPending: boolean;
    isFetching: boolean;
    isError: boolean;
  };
}) {
  if (!sessionId) {
    return <p className="text-muted-foreground">No agent run attached.</p>;
  }

  const waiting = !siteReady || sessionQuery.isPending || sessionQuery.isFetching;
  if (waiting && sessionQuery.data === undefined && !sessionQuery.isError) {
    return <p className="text-muted-foreground">Loading agent run…</p>;
  }

  if (sessionQuery.isError || sessionQuery.data == null) {
    return <p className="text-muted-foreground">Run history expired (about 7 days).</p>;
  }

  const detail = sessionQuery.data;
  const files = detail.files.slice(0, 6);
  const extraFiles = detail.files.length - files.length;

  return (
    <div className="space-y-1">
      {detail.headline ? (
        <p className="text-foreground/90 whitespace-pre-wrap leading-relaxed">{detail.headline}</p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="text-[10px] font-normal">
          {detail.summary.write_count} write{detail.summary.write_count === 1 ? "" : "s"}
        </Badge>
        <Badge variant="secondary" className="text-[10px] font-normal">
          {detail.summary.issue_complete_count} issue
          {detail.summary.issue_complete_count === 1 ? "" : "s"} fixed
        </Badge>
        {files.map((f) => (
          <Badge
            key={f}
            variant="outline"
            className="text-[10px] font-mono font-normal max-w-[14rem] truncate"
            title={f}
          >
            {f.split("/").slice(-2).join("/")}
          </Badge>
        ))}
        {extraFiles > 0 ? (
          <Badge variant="outline" className="text-[10px] font-normal">
            +{extraFiles}
          </Badge>
        ) : null}
      </div>
      <Link
        href={`/private/background-pipeline?session=${encodeURIComponent(sessionId)}`}
        className="text-primary underline-offset-2 hover:underline"
        data-testid="link-resolved-issue-pipeline"
      >
        Open in Background Pipeline
      </Link>
    </div>
  );
}
