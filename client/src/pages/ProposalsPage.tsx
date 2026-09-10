import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams, useSearch } from "wouter";
import {
  IconAlertTriangle,
  IconArrowsSort,
  IconCheck,
  IconCloudDownload,
  IconDots,
  IconFilter,
  IconInbox,
  IconLoader2,
  IconSearch,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProposalListFiltersDialog } from "@/components/agents/ProposalListFiltersDialog";
import {
  ProposalListCard,
  ProposalListCardSkeleton,
} from "@/components/agents/ProposalListCard";
import { apiFetch, apiRequestWithAuth } from "@/lib/queryClient";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { proposalStatusUi } from "@/lib/proposalStatusUi";
import {
  formatProposalRelativeUpdatedAt,
  proposalAttributionLines,
  proposalEntryProgress,
} from "@/lib/proposalCardMeta";
import {
  PROPOSAL_KIND_OPTIONS,
  PROPOSAL_SORT_PRESETS,
  PROPOSAL_STATUS_OPTIONS,
  clearProposalListFilters,
  countActiveProposalFilters,
  parseProposalListSearch,
  proposalListApiSearchParams,
  proposalSortFromPreset,
  proposalSortPresetValue,
  serializeProposalListSearch,
  toProposalListApiQuery,
  type ProposalListFilters,
  type ProposalListStats,
} from "@/pages/proposals-list-filters";

export const AGENTS_PROPOSALS_BASE = "/private/agents/proposals";

function proposalsListHref(search: string): string {
  const qs = search.startsWith("?") ? search.slice(1) : search;
  return qs ? `${AGENTS_PROPOSALS_BASE}?${qs}` : AGENTS_PROPOSALS_BASE;
}

type EntryRow = {
  id: number;
  contentType: string;
  slug: string;
  locale: string;
  variant: string | null;
  status: string;
  last_error: string | null;
  ops: Array<{ field_path: string; value?: unknown }>;
  baseline_context: { values: Record<string, unknown>; note?: string };
};

type BlockerRow = {
  id: number;
  body: string;
  status: string;
  author: string;
  created_at: number;
  resolve_note: string | null;
  resolved_by: string | null;
};

type Proposal = {
  id: string;
  title: string;
  summary: string;
  kind: string;
  status: string;
  review_mode?: string;
  promote_on_apply?: boolean;
  open_blocker_count?: number;
  proposer_username: string;
  proposer_actor?: Record<string, unknown>;
  related_issue_ids: string[];
  entries: EntryRow[];
  blockers?: BlockerRow[];
  claim?: {
    by: string;
    expiresAt: string;
    actor?: Record<string, unknown>;
  } | null;
  created_at: number;
  updated_at?: number;
};

function headers(): Record<string, string> {
  return { "Content-Type": "application/json", ...getSessionHeaders() };
}

function reviewModeBadge(p: Proposal): { label: string; variant: "default" | "secondary" | "outline" } {
  if (p.review_mode === "draft_backed" || p.promote_on_apply) {
    return { label: "Includes draft (go-live)", variant: "default" };
  }
  if (p.review_mode === "soft_variant" || p.entries?.some((e) => e.variant)) {
    return { label: "Soft on draft", variant: "secondary" };
  }
  return { label: "Soft suggestion", variant: "outline" };
}

function previewHref(entry: EntryRow): string | null {
  if (!entry.variant) return null;
  return `/private/preview/${encodeURIComponent(entry.contentType)}/${encodeURIComponent(entry.slug)}?locale=${encodeURIComponent(entry.locale)}&force_variant=${encodeURIComponent(entry.variant)}`;
}

function ProposalStatusChip({ status }: { status: string }) {
  const ui = proposalStatusUi(status);
  const Icon = ui.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", ui.className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {ui.label}
    </span>
  );
}

function ProposalBlockersChip({ count }: { count: number }) {
  if (count <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <IconCheck className="h-3 w-3 shrink-0" aria-hidden />
        Clear
      </span>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1 font-normal">
      <IconAlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
      {count} blocker{count === 1 ? "" : "s"}
    </Badge>
  );
}

/** @deprecated Prefer Agents org-chart shell at /private/agents/proposals */
export default function ProposalsPage() {
  const params = useParams<{ id?: string }>();
  const id = params.id;
  if (id) return <ProposalDetailPanel id={id} />;
  return <ProposalListPanel />;
}

export function ProposalListPanel() {
  const [pathname, setLocation] = useLocation();
  const searchString = useSearch();
  const view = useMemo(() => parseProposalListSearch(searchString), [searchString]);
  const [qInput, setQInput] = useState(view.q);
  const [advanced, setAdvanced] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pullProductionOpen, setPullProductionOpen] = useState(false);
  const [pullingProduction, setPullingProduction] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    setQInput(view.q);
  }, [view.q]);

  useEffect(() => {
    const trimmed = qInput.trim();
    const urlQ = view.q.trim();
    if (trimmed === urlQ) return;
    const t = setTimeout(() => {
      const qs = serializeProposalListSearch(
        { filters: view.filters, q: qInput },
        searchString,
      );
      const pathOnly = pathname.split("?")[0];
      setLocation(qs ? `${pathOnly}?${qs}` : pathOnly, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [qInput, view.filters, view.q, searchString, pathname, setLocation]);

  const writeView = (next: { filters: ProposalListFilters; q: string }) => {
    const qs = serializeProposalListSearch(next, searchString);
    const pathOnly = pathname.split("?")[0];
    setLocation(qs ? `${pathOnly}?${qs}` : pathOnly, { replace: true });
  };

  const apiQuery = useMemo(
    () => toProposalListApiQuery(view.filters, view.q),
    [view.filters, view.q],
  );
  const apiQs = useMemo(() => proposalListApiSearchParams(apiQuery), [apiQuery]);
  const activeFilterCount = countActiveProposalFilters(view.filters);
  const hasSearch = view.q.trim().length > 0;
  const listSearch = searchString.startsWith("?") ? searchString.slice(1) : searchString;
  const listSummary = useMemo(() => {
    const parts: string[] = [];
    if (view.filters.status !== "all") {
      parts.push(
        PROPOSAL_STATUS_OPTIONS.find((o) => o.value === view.filters.status)?.label ??
          view.filters.status,
      );
    }
    if (view.filters.kind !== "all") {
      parts.push(
        PROPOSAL_KIND_OPTIONS.find((o) => o.value === view.filters.kind)?.label ?? view.filters.kind,
      );
    }
    return parts.join(" · ");
  }, [view.filters.status, view.filters.kind]);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/proposals", apiQuery],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/proposals?${apiQs}`, { headers: headers() });
      if (!res.ok) throw new Error("Failed to load proposals");
      return res.json() as Promise<{
        proposals: Proposal[];
        total?: number;
        stats?: ProposalListStats;
      }>;
    },
  });

  const proposals = data?.proposals ?? [];
  const resultCount = data?.total ?? proposals.length;

  const pullProduction = async () => {
    if (!import.meta.env.DEV) return;
    // Close confirm first so the production-token Dialog is not trapped under AlertDialog.
    setPullProductionOpen(false);
    setPullingProduction(true);
    try {
      const res = await apiRequestWithAuth("POST", "/api/admin/proposals/pull-production", {});
      const body = (await res.json()) as {
        imported?: number;
        productionOrigin?: string;
        reason?: string;
        error?: string;
      };
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/proposals"] });
      toast({
        title: "Production proposals loaded",
        description: `Imported ${body.imported ?? 0} proposals from ${body.productionOrigin ?? "production"}.`,
      });
    } catch (err) {
      toast({
        title: "Could not load production proposals",
        description: err instanceof Error ? err.message : "Download failed.",
        variant: "destructive",
      });
    } finally {
      setPullingProduction(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="panel-agents-proposals">
      <div className="max-w-3xl">
        <p className="text-sm leading-6 text-muted-foreground">
          Proposals are suggested entry changes or handoff notes. They do not change the live site until
          someone else applies edits or acknowledges a notes handoff. Soft suggestions patch fields;
          proposals that include a draft must be previewed before approve — go-live proposals promote that
          draft. Open blockers mean not ready to approve (you can still reject).
        </p>
        <Collapsible open={advanced} onOpenChange={setAdvanced}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-auto px-0 mt-1 text-xs text-muted-foreground">
              {advanced ? "Hide advanced" : "Read more (advanced)"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="text-xs text-muted-foreground space-y-1 mt-1">
            <p>Stored in per-site SQLite (data/&lt;site&gt;/app.db). Exact fingerprint blocks clones; similar open proposals need confirm_distinct. One open proposal per draft variant.</p>
            <p>MCP: propose_change and list_proposals need content_view or seo_edit. update_proposal needs content_edit_text or seo_edit. Apply is four-eyes. Claimant-only resolve for blockers.</p>
            <p>Issue panels only list proposals linked to that issue. This page lists everything.</p>
          </CollapsibleContent>
        </Collapsible>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <IconSearch
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-9"
            placeholder="Search proposals"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            data-testid="input-proposal-search"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="relative shrink-0"
          onClick={() => setFiltersOpen(true)}
          data-testid="button-proposal-filters"
        >
          <IconFilter className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 ? (
            <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 gap-1.5"
              data-testid="button-proposal-sort"
            >
              <IconArrowsSort className="h-4 w-4" />
              <span className="hidden sm:inline max-w-[10rem] truncate">
                {PROPOSAL_SORT_PRESETS.find(
                  (p) => p.value === proposalSortPresetValue(view.filters.sort, view.filters.sortDir),
                )?.label ?? "Sort"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {PROPOSAL_SORT_PRESETS.map((opt) => {
              const selected =
                proposalSortPresetValue(view.filters.sort, view.filters.sortDir) === opt.value;
              return (
                <DropdownMenuItem
                  key={opt.value}
                  className="gap-2"
                  data-testid={`menu-proposal-sort-${opt.value}`}
                  onClick={() => {
                    const next = proposalSortFromPreset(opt.value);
                    writeView({
                      filters: { ...view.filters, ...next },
                      q: view.q,
                    });
                  }}
                >
                  <IconCheck className={cn("h-3.5 w-3.5", selected ? "opacity-100" : "opacity-0")} />
                  {opt.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        {import.meta.env.DEV ? (
          <Button
            type="button"
            variant="outline"
            disabled={pullingProduction}
            onClick={() => setPullProductionOpen(true)}
            data-testid="button-pull-production-proposals"
          >
            {pullingProduction ? (
              <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <IconCloudDownload className="h-4 w-4 mr-2" />
            )}
            {pullingProduction ? "Downloading…" : "Download from production"}
          </Button>
        ) : null}
      </div>
      <ProposalListFiltersDialog
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={view.filters}
        stats={data?.stats}
        onApply={(dims) =>
          writeView({
            filters: { ...view.filters, status: dims.status, kind: dims.kind },
            q: view.q,
          })
        }
        onClear={() =>
          writeView({ filters: clearProposalListFilters(view.filters), q: view.q })
        }
      />
      <AlertDialog open={pullProductionOpen} onOpenChange={setPullProductionOpen}>
        <AlertDialogContent data-testid="dialog-pull-production-proposals">
          <AlertDialogHeader>
            <AlertDialogTitle>Download production proposals?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces your local proposal list with production&apos;s. You may be asked for a
              production staff token (not your localhost login). Draft YAML and live content are not
              downloaded — only proposal records. Nothing is uploaded back to production.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              disabled={pullingProduction}
              onClick={() => void pullProduction()}
              data-testid="button-confirm-pull-production-proposals"
            >
              <IconCloudDownload className="h-4 w-4 mr-2" />
              Download from production
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {isLoading ? (
        <div className="space-y-2.5" data-testid="loading-proposal-list">
          <ProposalListCardSkeleton />
          <ProposalListCardSkeleton />
          <ProposalListCardSkeleton />
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.length > 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="text-proposal-count">
              {resultCount} proposal{resultCount === 1 ? "" : "s"}
              {listSummary ? ` · ${listSummary}` : ""}
            </p>
          ) : null}
          <div className="space-y-2.5">
            {proposals.map((p) => (
              <ProposalListCard
                key={p.id}
                proposal={p}
                href={
                  listSearch
                    ? `${AGENTS_PROPOSALS_BASE}/${p.id}?${listSearch}`
                    : `${AGENTS_PROPOSALS_BASE}/${p.id}`
                }
              />
            ))}
          </div>
          {proposals.length === 0 && (
            <div
              className="flex flex-col items-center gap-3 rounded-card border border-dashed border-card-border px-6 py-12 text-center"
              data-testid="empty-proposal-list"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <IconInbox className="h-5 w-5" aria-hidden />
              </span>
              {activeFilterCount > 0 || hasSearch ? (
                <>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">No proposals match these filters</p>
                    <p className="text-xs text-muted-foreground">
                      Try a broader status or clear the search to see everything.
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {activeFilterCount > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          writeView({
                            filters: clearProposalListFilters(view.filters),
                            q: view.q,
                          })
                        }
                        data-testid="button-empty-clear-proposal-filters"
                      >
                        Clear filters
                      </Button>
                    ) : null}
                    {hasSearch ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setQInput("");
                          writeView({ filters: view.filters, q: "" });
                        }}
                        data-testid="button-empty-clear-proposal-search"
                      >
                        Clear search
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm font-medium">No open proposals</p>
                  <p className="text-xs text-muted-foreground">
                    Suggested entry changes and handoff notes show up here for review.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ProposalDetailPanel({ id }: { id: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const searchString = useSearch();
  const backHref = proposalsListHref(searchString);
  const [blockerBody, setBlockerBody] = useState("");
  const [resolveNotes, setResolveNotes] = useState<Record<number, string>>({});
  const [confirmExperiment, setConfirmExperiment] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/proposals", id],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/proposals/${id}`, { headers: headers() });
      if (!res.ok) throw new Error("Not found");
      return res.json() as Promise<{ proposal: Proposal }>;
    },
  });

  const mut = useMutation({
    mutationFn: async (payload: { action: string; body?: Record<string, unknown> }) => {
      const res = await apiFetch(`/api/admin/proposals/${id}/${payload.action}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload.body ?? {}),
      });
      const json = await res.json();
      if (!res.ok) throw Object.assign(new Error(json.error || "Action failed"), { data: json });
      return json;
    },
    onSuccess: (json) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/proposals"] });
      toast({ title: "Updated" });
      if (json.warnings?.length) {
        toast({
          title: json.warnings[0].message,
          variant: "default",
        });
      }
    },
    onError: (e: Error & { data?: { code?: string; traffic_siblings?: unknown } }) => {
      toast({ title: e.message, variant: "destructive" });
      if (e.data?.code === "confirm_end_experiment") {
        setConfirmExperiment(true);
      }
    },
  });

  const p = data?.proposal;
  const mode = p ? reviewModeBadge(p) : null;
  const claimActive =
    p?.claim && new Date(p.claim.expiresAt).getTime() > Date.now() ? p.claim : null;
  const attribution = p
    ? proposalAttributionLines({
        proposerUsername: p.proposer_username,
        proposerActor: p.proposer_actor,
        claim: p.claim,
      })
    : null;
  const progress = p && p.kind === "edits" ? proposalEntryProgress(p.entries ?? []) : null;
  // Resolve enabled when any staff holds claim — server enforces claimant match via session author.
  const canResolveUi = Boolean(claimActive);
  const isTerminal =
    p != null &&
    (p.status === "finished" || p.status === "rejected" || p.status === "withdrawn");
  const blockersOpen = (p?.open_blocker_count ?? 0) > 0;
  const showPrimaryEdits = Boolean(p && p.kind === "edits" && !isTerminal);
  const showPrimaryNotes = Boolean(p && p.kind === "notes" && p.status === "open");
  const primaryActionLabel = !p
    ? ""
    : p.kind === "notes"
      ? "Acknowledge"
      : p.promote_on_apply || p.review_mode === "draft_backed"
        ? confirmExperiment
          ? "Confirm end experiment & make draft live"
          : "Approve and make draft live"
        : "Apply remaining";

  return (
    <div className="space-y-6" data-testid="panel-agents-proposal-detail">
      <Button variant="ghost" size="sm" asChild>
        <Link href={backHref}>Back</Link>
      </Button>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {p && mode && attribution && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold">{p.title}</h2>
            <ProposalStatusChip status={p.status} />
            <Badge variant="outline" className="font-normal capitalize">
              {p.kind}
            </Badge>
            <Badge variant={mode.variant}>{mode.label}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <ProposalBlockersChip count={p.open_blocker_count ?? 0} />
            {progress ? (
              <span className={progress.failed > 0 ? "text-destructive" : undefined}>
                {progress.label}
              </span>
            ) : null}
            <span>
              Updated {formatProposalRelativeUpdatedAt(p.updated_at ?? p.created_at)}
            </span>
          </div>
          {attribution.lines.map((line) => (
            <p key={line} className="text-sm text-muted-foreground">
              {line}
            </p>
          ))}
          {attribution.expiredLine ? (
            <p className="text-sm text-muted-foreground/80">{attribution.expiredLine}</p>
          ) : null}
          {claimActive ? (
            <p className="text-xs text-muted-foreground">
              Claim holds until {new Date(claimActive.expiresAt).toLocaleString()}
            </p>
          ) : null}
          {p.review_mode === "draft_backed" || p.promote_on_apply ? (
            <p className="text-sm">
              This proposal includes a prepared draft. Preview that version before you approve or reject.
              Approving makes that draft the live page for this locale. Open blockers block approve;
              clearing them still requires a fresh preview — resolving means the acceptance criteria were
              met, not “I disagree.”
            </p>
          ) : p.review_mode === "soft_variant" || p.entries.some((e) => e.variant) ? (
            <p className="text-sm">
              Soft suggestion on a draft. Approving writes the proposed field changes into that draft —
              it does not go live. Preview the draft before deciding.
            </p>
          ) : (
            <p className="text-sm">
              Soft suggestion only. Nothing is live until you apply. There is no separate draft page to
              preview unless an entry lists a variant.
            </p>
          )}
          <p className="text-sm">{p.summary}</p>
          {p.related_issue_ids.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Linked issues: {p.related_issue_ids.join(", ")}
            </p>
          )}

          {p.kind === "edits" && (
            <div className="space-y-3">
              {p.entries.map((e) => {
                const href = previewHref(e);
                return (
                  <Card key={e.id}>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">
                        {e.contentType}/{e.slug} ({e.locale})
                        {e.variant ? ` · draft ${e.variant}` : ""} — {e.status}
                      </CardTitle>
                      {href && (
                        <Button variant="outline" size="sm" asChild className="w-fit mt-2">
                          <a href={href} target="_blank" rel="noreferrer">
                            Preview draft
                          </a>
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="text-xs space-y-2">
                      {e.last_error && <p className="text-destructive">{e.last_error}</p>}
                      {e.ops.length === 0 && (p.promote_on_apply || p.review_mode === "draft_backed") && (
                        <p className="text-muted-foreground">
                          No field-diff list — the attached draft is the change. Preview it before approve.
                        </p>
                      )}
                      {e.ops.map((op) => (
                        <div key={op.field_path} className="border rounded p-2">
                          <p className="font-mono">{op.field_path}</p>
                          <p className="text-muted-foreground">
                            Then: {JSON.stringify(e.baseline_context.values[op.field_path])}
                          </p>
                          <p>Proposed: {JSON.stringify(op.value)}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">
                Blockers {(p.open_blocker_count ?? 0) > 0 ? `(${p.open_blocker_count} open)` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(p.blockers ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">No blockers yet.</p>
              )}
              {(p.blockers ?? []).map((b) => (
                <div key={b.id} className="border rounded p-3 space-y-2 text-sm">
                  <div className="flex gap-2 items-center">
                    <Badge variant={b.status === "open" ? "destructive" : "secondary"}>{b.status}</Badge>
                    <span className="text-xs text-muted-foreground">by {b.author}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{b.body}</p>
                  {b.resolve_note && (
                    <p className="text-xs text-muted-foreground">
                      Resolved by {b.resolved_by}: {b.resolve_note}
                    </p>
                  )}
                  {b.status === "open" && canResolveUi && (
                    <div className="space-y-2">
                      <Textarea
                        placeholder="What changed (min 20 chars)"
                        value={resolveNotes[b.id] ?? ""}
                        onChange={(ev) =>
                          setResolveNotes((prev) => ({ ...prev, [b.id]: ev.target.value }))
                        }
                        data-testid={`input-resolve-blocker-${b.id}`}
                      />
                      <Button
                        size="sm"
                        disabled={mut.isPending}
                        onClick={() =>
                          mut.mutate({
                            action: "resolve_blocker",
                            body: { blocker_id: b.id, resolve_note: resolveNotes[b.id] },
                          })
                        }
                        data-testid={`button-resolve-blocker-${b.id}`}
                      >
                        Resolve (claimant)
                      </Button>
                    </div>
                  )}
                  {b.status === "resolved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={mut.isPending}
                      onClick={() => mut.mutate({ action: "reopen_blocker", body: { blocker_id: b.id } })}
                    >
                      Reopen
                    </Button>
                  )}
                </div>
              ))}
              <div className="space-y-2 pt-2 border-t">
                <p className="text-xs text-muted-foreground">
                  Add blocker: what’s wrong, what fixed looks like, and why (min 80 characters). No tool lists.
                </p>
                <Textarea
                  placeholder="On draft …, X is wrong. It must be Y because …"
                  value={blockerBody}
                  onChange={(e) => setBlockerBody(e.target.value)}
                  data-testid="input-add-blocker"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={mut.isPending || blockerBody.trim().length < 80}
                  onClick={() => {
                    mut.mutate({ action: "add_blocker", body: { body: blockerBody } });
                    setBlockerBody("");
                  }}
                  data-testid="button-add-blocker"
                >
                  Add blocker
                </Button>
              </div>
            </CardContent>
          </Card>

          <Collapsible open={advanced} onOpenChange={setAdvanced}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-auto px-0 text-xs text-muted-foreground">
                {advanced ? "Hide advanced" : "Read more (advanced)"}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="text-xs text-muted-foreground space-y-1">
              <p>Promote copies the draft over live for one locale; SEO cluster on live is preserved when promoting over an existing live file.</p>
              <p>Ending an experiment deletes other traffic-bearing variants after confirm. Claim TTL is 30 minutes; only the claimant resolves blockers.</p>
              <p>Variant attachment is write-once in the creating agent session.</p>
            </CollapsibleContent>
          </Collapsible>

          {!isTerminal ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {showPrimaryEdits ? (
                  <Button
                    onClick={() =>
                      mut.mutate({
                        action: "apply",
                        body: confirmExperiment ? { confirm_end_experiment: true } : {},
                      })
                    }
                    disabled={mut.isPending || blockersOpen}
                    data-testid="button-apply-proposal"
                  >
                    {primaryActionLabel}
                  </Button>
                ) : null}
                {showPrimaryNotes ? (
                  <Button
                    onClick={() => mut.mutate({ action: "acknowledge" })}
                    disabled={mut.isPending}
                    data-testid="button-acknowledge-proposal"
                  >
                    {primaryActionLabel}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  onClick={() => mut.mutate({ action: "reject" })}
                  disabled={mut.isPending}
                  data-testid="button-reject-proposal"
                >
                  Reject
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={mut.isPending}
                      aria-label="More actions"
                      data-testid="button-proposal-more-actions"
                    >
                      <IconDots className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      disabled={mut.isPending}
                      onClick={() => mut.mutate({ action: "claim" })}
                      data-testid="button-claim-proposal"
                    >
                      Claim
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={mut.isPending}
                      onClick={() =>
                        mut.mutate({
                          action: "release",
                          body: { report: "Released after review work. ".repeat(4) },
                        })
                      }
                      data-testid="button-release-proposal"
                    >
                      Release claim
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={mut.isPending}
                      onClick={() => mut.mutate({ action: "withdraw" })}
                      data-testid="button-withdraw-proposal"
                    >
                      Withdraw
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {confirmExperiment ? (
                <p className="text-sm text-destructive">
                  Other versions still have traffic. Confirming will remove those traffic-bearing
                  variants when this draft goes live.
                </p>
              ) : null}
              {blockersOpen ? (
                <p className="text-xs text-muted-foreground">
                  Approve is disabled while blockers are open. Reject remains available.
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
