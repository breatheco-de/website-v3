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

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className="text-xs border-b border-border/60 px-4 py-2 hover:bg-white"
        data-testid={`resolved-issue-row-${idx}`}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full flex-col gap-0.5 text-left"
            data-testid={`button-resolved-issue-expand-${idx}`}
            aria-expanded={open}
          >
            <div className="flex flex-wrap items-center gap-2">
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
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
              <IssueCodePopover code={row.code} validator={row.validator} help={help} />
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
            <div className="text-foreground line-clamp-2 pl-5" title={row.message}>
              {formatSitePathsInText(row.message, formatSitePath)}
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pl-5 pt-2 space-y-2">
          {open ? (
            <div className="space-y-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Suggested fix
                </p>
                {suggestionText ? (
                  <p className="text-muted-foreground italic" data-testid="resolved-issue-suggestion">
                    {formatSitePathsInText(suggestionText, formatSitePath)}
                  </p>
                ) : (
                  <p className="text-muted-foreground" data-testid="resolved-issue-suggestion">
                    No suggested fix.
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  What they said they did
                </p>
                {row.report ? (
                  <p
                    className="text-muted-foreground whitespace-pre-wrap border-l-2 border-border/80 pl-2"
                    data-testid="resolved-issue-report"
                  >
                    {row.report}
                  </p>
                ) : (
                  <p className="text-muted-foreground" data-testid="resolved-issue-report">
                    No note on this fix.
                  </p>
                )}
              </div>
              {row.url || row.file ? (
                <div className="space-y-0.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Where</p>
                  {row.url ? <div className="text-muted-foreground">{row.url}</div> : null}
                  {row.file ? (
                    <div className="text-muted-foreground font-mono truncate" title={row.file}>
                      {formatSitePath(row.file)}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div data-testid="resolved-issue-agent-run">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Agent run</p>
                <AgentRunBlock
                  sessionId={sessionId}
                  siteReady={Boolean(site)}
                  sessionQuery={sessionQuery}
                />
              </div>
              <div>
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground underline-offset-2 hover:underline hover:text-foreground"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  data-testid="button-resolved-issue-advanced"
                >
                  {advancedOpen ? "Hide advanced" : "Read more (advanced)"}
                </button>
                {advancedOpen ? (
                  <div
                    className="mt-1 space-y-0.5 text-[11px] text-muted-foreground border-l-2 border-border pl-2"
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
                    <p className="font-mono">issue {row.issueId}</p>
                    {row.entryKey ? <p className="font-mono">{row.entryKey}</p> : null}
                    {sessionId ? <p className="font-mono">session {sessionId}</p> : null}
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
