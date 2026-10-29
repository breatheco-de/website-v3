import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  IconChevronLeft,
  IconChevronRight,
  IconLoader2,
  IconThumbDown,
  IconThumbUp,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { DevLocalNotice, type OutcomeVerdict } from "@/components/agents/ProposalOutcomeReview";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { apiFetch } from "@/lib/queryClient";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { proposalStatusUi } from "@/lib/proposalStatusUi";
import { closeReasonOptionLabel } from "@/lib/proposalCloseReason";
import { cn } from "@/lib/utils";
import {
  OUTCOMES_PAGE_SIZE,
  clampOutcomesPage,
  outcomeProposalHref,
  outcomesHref,
  parseOutcomesSearch,
  type OutcomeFilter,
  type OutcomesView,
} from "@/lib/agents-tab";
import type { ProposalListStats } from "@/pages/proposals-list-filters";

type OutcomeCardProposal = {
  id: string;
  title: string;
  summary?: string | null;
  status: string;
  close_reason?: string | null;
  close_note?: string | null;
  closed_at?: number | null;
  updated_at: number;
  outcome_review?: OutcomeVerdict | null;
  outcome_review_note?: string | null;
  outcome_review_at?: number | null;
  outcome_review_by?: string | null;
  outcome_lesson_captured_at?: number | null;
};

type OutcomesResponse = {
  proposals: OutcomeCardProposal[];
  total?: number;
  stats?: ProposalListStats;
};

const FILTER_LABEL: Record<OutcomeFilter, string> = {
  any: "All",
  good: "Good",
  bad: "Bad",
  none: "Not reviewed",
};

const EMPTY_COPY: Record<OutcomeFilter, string> = {
  any: "No closed proposals yet.",
  good: "No good outcomes yet.",
  bad: "No bad outcomes yet.",
  none: "Every closed proposal has a verdict.",
};

function closeReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const known = closeReasonOptionLabel(reason);
  if (known) return known;
  const words = reason.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ago(ms: number | null | undefined): string | null {
  return ms ? formatDistanceToNow(new Date(ms), { addSuffix: true }) : null;
}

function KpiTile({
  label,
  value,
  hint,
  toneClassName,
  active,
  onClick,
  testId,
}: {
  label: string;
  value: number | undefined;
  hint: string;
  toneClassName: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-w-0 rounded-md border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
        active && "ring-1 ring-primary",
      )}
      data-testid={`kpi-outcomes-${testId}`}
    >
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-semibold tabular-nums", toneClassName)}>{value ?? "—"}</p>
      <p className="truncate text-xs text-muted-foreground">{hint}</p>
    </button>
  );
}

function VerdictBadge({ verdict }: { verdict: OutcomeVerdict | null }) {
  if (verdict === "good") {
    return (
      <Badge variant="outline" className="gap-1 border-status-online/40 text-status-online">
        <IconThumbUp className="h-3.5 w-3.5" aria-hidden />
        Good outcome
      </Badge>
    );
  }
  if (verdict === "bad") {
    return (
      <Badge variant="outline" className="gap-1 border-status-busy/40 text-status-busy">
        <IconThumbDown className="h-3.5 w-3.5" aria-hidden />
        Bad outcome
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-status-away/40 text-status-away">
      Not reviewed
    </Badge>
  );
}

function OutcomeCard({
  p,
  view,
  isSteward,
}: {
  p: OutcomeCardProposal;
  view: OutcomesView;
  isSteward: boolean;
}) {
  const verdict = p.outcome_review ?? null;
  const status = proposalStatusUi(p.status);
  const StatusIcon = status.icon;
  const closeLine = [closeReasonLabel(p.close_reason), p.close_note?.trim()].filter(Boolean).join(" — ");
  let body: ReactNode = null;
  if (verdict === "bad") {
    body = p.outcome_review_note ? (
      <p className="line-clamp-2 text-sm">
        <span className="font-medium">What went wrong: </span>
        {p.outcome_review_note}
      </p>
    ) : null;
  } else if (verdict === "good") {
    body = p.outcome_review_note ? <p className="line-clamp-1 text-sm">{p.outcome_review_note}</p> : null;
  } else {
    body = closeLine ? <p className="line-clamp-1 text-sm text-muted-foreground">{closeLine}</p> : null;
  }
  const footer = verdict
    ? `Reviewed by ${p.outcome_review_by ?? "unknown"}${ago(p.outcome_review_at) ? ` · ${ago(p.outcome_review_at)}` : ""}`
    : `Closed ${ago(p.closed_at ?? p.updated_at) ?? ""}`.trim();

  return (
    <Link
      href={outcomeProposalHref(p.id, view)}
      className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card p-3 transition-colors hover:bg-muted/40"
      data-testid={`card-outcome-${p.id}`}
      data-outcome={verdict ?? "none"}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <VerdictBadge verdict={verdict} />
        <span className={cn("inline-flex items-center gap-1 text-xs", status.className)}>
          <StatusIcon className="h-3.5 w-3.5" />
          {status.label}
        </span>
        {verdict === "bad" && p.outcome_lesson_captured_at ? (
          <Badge variant="secondary" className="text-xs">
            Lesson captured
          </Badge>
        ) : null}
      </div>
      <div className="min-w-0 space-y-1">
        <p className="line-clamp-1 font-medium text-foreground">{p.title || "Untitled proposal"}</p>
        {p.summary ? <p className="line-clamp-2 text-sm text-muted-foreground">{p.summary}</p> : null}
      </div>
      {body}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
        <span>{footer}</span>
        {!verdict && !isSteward ? <span>Waiting for a Platform Steward</span> : null}
      </div>
    </Link>
  );
}

export function AgentsOutcomesPanel() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const view = parseOutcomesSearch(search);
  const { roles } = useDebugAuth();
  const isSteward = roles.includes("platform_steward");

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["/api/admin/proposals", "outcomes", view.outcome, view.page],
    queryFn: async () => {
      const params = new URLSearchParams({
        outcome_review: view.outcome,
        sort: "outcome_recent",
        sort_dir: "desc",
        limit: String(OUTCOMES_PAGE_SIZE),
        offset: String(view.page * OUTCOMES_PAGE_SIZE),
      });
      const res = await apiFetch(`/api/admin/proposals?${params}`, { headers: getSessionHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load outcomes");
      return res.json() as Promise<OutcomesResponse>;
    },
    placeholderData: (prev) => prev,
  });

  const proposals = data?.proposals ?? [];
  const total = data?.total ?? proposals.length;
  const counts = data?.stats?.by_outcome;
  const allCount = counts ? counts.good + counts.bad + counts.none : undefined;

  useEffect(() => {
    if (!data || isFetching) return;
    const next = clampOutcomesPage(view.page, proposals.length, total);
    if (next != null) setLocation(outcomesHref({ outcome: view.outcome, page: next }), { replace: true });
  }, [data, isFetching, proposals.length, total, view.outcome, view.page, setLocation]);

  const go = (next: OutcomesView) => setLocation(outcomesHref(next));
  const selectFilter = (outcome: OutcomeFilter) => go({ outcome, page: 0 });
  const countFor: Record<OutcomeFilter, number | undefined> = {
    any: allCount,
    good: counts?.good,
    bad: counts?.bad,
    none: counts?.none,
  };
  const from = total === 0 ? 0 : view.page * OUTCOMES_PAGE_SIZE + 1;
  const to = Math.min(total, (view.page + 1) * OUTCOMES_PAGE_SIZE);
  const hasNext = (view.page + 1) * OUTCOMES_PAGE_SIZE < total;

  return (
    <Card data-testid="panel-agents-outcomes">
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <IconThumbUp className="h-5 w-5 text-muted-foreground" />
        <CardTitle className="text-base">Outcomes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          How closed proposals turned out. Open one to read the proposal and its review. Platform Stewards
          can mark unreviewed ones Good or Bad from there.
        </p>
        <DevLocalNotice testId="text-outcomes-dev-notice" />

        <div className="grid w-full grid-cols-2 gap-3 md:grid-cols-3" data-testid="outcomes-kpis">
          <KpiTile
            label="Good outcomes"
            value={counts?.good}
            hint="Ended the way it should have"
            toneClassName="text-status-online"
            active={view.outcome === "good"}
            onClick={() => selectFilter("good")}
            testId="good"
          />
          <KpiTile
            label="Bad outcomes"
            value={counts?.bad}
            hint={counts ? `${counts.bad_open} need a lesson` : "—"}
            toneClassName="text-status-busy"
            active={view.outcome === "bad"}
            onClick={() => selectFilter("bad")}
            testId="bad"
          />
          <KpiTile
            label="Not reviewed"
            value={counts?.none}
            hint="Closed, no verdict yet"
            toneClassName="text-status-away"
            active={view.outcome === "none"}
            onClick={() => selectFilter("none")}
            testId="none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ToggleButtonBar
            value={view.outcome}
            onValueChange={(v) => selectFilter(v as OutcomeFilter)}
            listTestId="outcomes-filter"
            listClassName="flex"
          >
            {(Object.keys(FILTER_LABEL) as OutcomeFilter[]).map((f) => (
              <ToggleButtonBarTrigger key={f} value={f} data-testid={`filter-outcomes-${f}`}>
                {FILTER_LABEL[f]}
                {countFor[f] != null ? ` (${countFor[f]})` : ""}
              </ToggleButtonBarTrigger>
            ))}
          </ToggleButtonBar>
          {isFetching ? <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>

        {error ? (
          <p className="py-8 text-center text-sm text-destructive" data-testid="text-outcomes-error">
            {(error as Error).message}
          </p>
        ) : isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading outcomes…</p>
        ) : proposals.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground" data-testid="text-outcomes-empty">
            {EMPTY_COPY[view.outcome]}
          </p>
        ) : (
          <div className="flex flex-col gap-3" data-testid="outcomes-grid">
            {proposals.map((p) => (
              <OutcomeCard key={p.id} p={p} view={view} isSteward={isSteward} />
            ))}
          </div>
        )}

        {total > OUTCOMES_PAGE_SIZE ? (
          <div className="flex flex-wrap items-center justify-between gap-2" data-testid="outcomes-pagination">
            <span className="text-sm text-muted-foreground tabular-nums">
              Showing {from}–{to} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={view.page === 0}
                onClick={() => go({ ...view, page: view.page - 1 })}
                data-testid="button-outcomes-prev"
              >
                <IconChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={() => go({ ...view, page: view.page + 1 })}
                data-testid="button-outcomes-next"
              >
                Next
                <IconChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
