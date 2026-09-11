import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams, useSearch } from "wouter";
import {
  IconAlertTriangle,
  IconArrowsSort,
  IconBan,
  IconCheck,
  IconChevronLeft,
  IconCircleCheck,
  IconCircleX,
  IconCloudDownload,
  IconExternalLink,
  IconFilter,
  IconInbox,
  IconInfoCircle,
  IconLink,
  IconLoader2,
  IconLock,
  IconLockOpen,
  IconMessage,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getDebugUserName } from "@/hooks/useDebugAuth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CLOSE_NOTE_MIN,
  PROPOSAL_CLOSE_REASON_OPTIONS,
  closeNoteRequired,
  type ProposalCloseReasonValue,
} from "@/lib/proposalCloseReason";
import { minLengthHint } from "@/lib/minLengthHint";
import { ProposalListFiltersDialog } from "@/components/agents/ProposalListFiltersDialog";
import {
  ProposalListCard,
  ProposalListCardSkeleton,
  ProposalMetaRow,
  ProposalCategoryTags,
} from "@/components/agents/ProposalListCard";
import { ProposalFieldDiff } from "@/components/agents/ProposalFieldDiff";
import { EntryActivityBadge } from "@/components/pipeline/EntryActivityBadge";
import { RelatedEntryPopover } from "@/components/agents/RelatedEntryPopover";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import { AskActivityGateCopy } from "@/components/DebugBubble/SolveWithAiAgentDropdown";
import { ValidationIssueDetailModal } from "@/components/diagnostics/ValidationIssueDetailModal";
import { buildEntryKey } from "@/lib/entryKeyToPageUrl";
import { ENTRY_ACTIVITY_WINDOW_DAYS } from "@shared/event-log-filters";
import { apiFetch, apiRequestWithAuth } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { proposalStatusUi } from "@/lib/proposalStatusUi";
import {
  formatProposalRelativeUpdatedAt,
  proposalAttributionLines,
  proposalEntryProgress,
  shortProposalId,
} from "@/lib/proposalCardMeta";
import { McpCopyButton } from "@/components/mcp/McpSetupUi";import {
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

const REJECT_UNDO_MS = 10_000;

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
  category?: string;
  tags?: string[];
  review_mode?: string;
  promote_on_apply?: boolean;
  open_blocker_count?: number;
  no_auto_retry?: boolean;
  close_reason?: string | null;
  close_note?: string | null;
  closed_by?: string | null;
  closed_at?: number | null;
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
  recent_activity?: Array<{ entryKey: string; writeCount: number; windowDays: number }>;
  recent_activity_error?: string;
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

function reviewModeExplain(p: Proposal): { title: string; body: string; advanced: string[] } {
  if (p.review_mode === "draft_backed" || p.promote_on_apply) {
    return {
      title: "Approving publishes a prepared draft",
      body: "This proposal already has a draft ready. Preview that version before you decide. Approving makes that draft the live page for this locale — rejecting leaves live unchanged.",
      advanced: [
        "Stored as review_mode draft_backed (or promote_on_apply).",
        "Open needs-changes items still block Approve until cleared.",
      ],
    };
  }
  if (p.review_mode === "soft_variant" || p.entries?.some((e) => e.variant)) {
    return {
      title: "Suggested edits go into a draft",
      body: "Approving writes the proposed field changes into the linked draft only — the live page does not change. Preview the draft before you decide.",
      advanced: [
        "Stored as review_mode soft_variant when an entry lists a variant.",
        "Go-live still requires publishing that draft separately.",
      ],
    };
  }
  return {
    title: "Suggested edits — not live until you Approve",
    body: "Approving writes the remaining suggested field changes onto the live page for each open entry. Until then, visitors still see the current live content. There is usually no separate draft to preview unless an entry lists a variant.",
    advanced: [
      "Default soft path: no draft_backed promote and no variant target.",
      "Apply is still four-eyes — the proposer cannot approve their own edits.",
    ],
  };
}

function ReviewModeBadge({
  proposal,
  label,
  variant,
}: {
  proposal: Proposal;
  label: string;
  variant: "default" | "secondary" | "outline";
}) {
  const [advanced, setAdvanced] = useState(false);
  const explain = reviewModeExplain(proposal);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0"
          data-testid="badge-proposal-review-mode"
          aria-label={`${label} — what this means`}
        >
          <Badge variant={variant} className="cursor-pointer font-normal hover-elevate">
            {label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-3 text-sm"
        align="start"
        data-testid="popover-proposal-review-mode"
      >
        <p className="font-medium text-foreground">{explain.title}</p>
        <p className="text-muted-foreground leading-5">{explain.body}</p>
        {explain.advanced.length > 0 ? (
          <>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              data-testid="button-proposal-review-mode-advanced"
              onClick={() => setAdvanced((v) => !v)}
            >
              {advanced ? "Hide advanced" : "Read more (advanced)"}
            </button>
            {advanced ? (
              <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground leading-5">
                {explain.advanced.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function previewHref(entry: EntryRow): string | null {
  if (!entry.variant) return null;
  return `/private/preview/${encodeURIComponent(entry.contentType)}/${encodeURIComponent(entry.slug)}?locale=${encodeURIComponent(entry.locale)}&force_variant=${encodeURIComponent(entry.variant)}`;
}

function proposalStatusExplain(
  status: string,
  kind: string,
): { title: string; body: string; advanced: string[] } {
  if (status === "open" && kind === "notes") {
    return {
      title: "Still being tracked",
      body: "This handoff is on the open list as a reminder. Leave it open if work still needs doing, Claim if you are working it, or Close with a reason when you stop tracking it. Open does not change the live site.",
      advanced: [
        "Status stays open until Close, Withdraw, or Reject finishes the proposal.",
        "No auto-retry (if on) only applies while the handoff stays open.",
      ],
    };
  }
  if (status === "open") {
    return {
      title: "Waiting for review",
      body: "Suggested changes are not live yet. Someone else with edit access can Approve to apply them, or Reject. Open by itself does not change the live site.",
      advanced: [
        "Needs-change notes block Approve until the claimant marks them done.",
        "Apply/Reject are four-eyes: the proposer cannot approve their own edits.",
      ],
    };
  }
  if (status === "partial") {
    return {
      title: "Partly applied",
      body: "Some suggested entries from this proposal are already live; others still need Approve. The live site only changed for the entries that were applied.",
      advanced: ["Remaining open entries can still be applied or the proposal can be rejected/withdrawn."],
    };
  }
  if (status === "finished" && kind === "notes") {
    return {
      title: "Closed",
      body: "This handoff is finished and off the open list. Closing did not change the live site or complete linked issues by itself.",
      advanced: ["Close reason and note are stored on the proposal for later context."],
    };
  }
  if (status === "finished") {
    return {
      title: "Finished",
      body: "This proposal’s remaining work is done. Applied entries are live for their locales; nothing else is waiting on this card.",
      advanced: ["Finished clears any active claim on the proposal."],
    };
  }
  if (status === "rejected") {
    return {
      title: "Rejected",
      body: "A reviewer rejected this proposal. It is no longer waiting for Approve. Reject does not undo entries that were already applied earlier.",
      advanced: ["Reject is four-eyes on edits proposals."],
    };
  }
  if (status === "withdrawn") {
    return {
      title: "Withdrawn",
      body: "The proposer pulled this back. It is no longer waiting for review or tracking as an open handoff.",
      advanced: ["Withdraw does not change the live site."],
    };
  }
  return {
    title: status || "Unknown status",
    body: "This status is not one of the usual proposal states.",
    advanced: [],
  };
}

function ProposalStatusLabel({
  status,
  kind,
  label,
  className,
}: {
  status: string;
  kind: string;
  label: string;
  className?: string;
}) {
  const [advanced, setAdvanced] = useState(false);
  const explain = proposalStatusExplain(status, kind);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex shrink-0 text-xs font-medium hover-elevate rounded-sm px-0.5 -mx-0.5",
            className,
          )}
          data-testid="badge-proposal-status"
          aria-label={`${label} — what this means`}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 text-sm" align="start" data-testid="popover-proposal-status">
        <p className="font-medium text-foreground">{explain.title}</p>
        <p className="text-muted-foreground leading-5">{explain.body}</p>
        {explain.advanced.length > 0 ? (
          <>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              data-testid="button-proposal-status-advanced"
              onClick={() => setAdvanced((v) => !v)}
            >
              {advanced ? "Hide advanced" : "Read more (advanced)"}
            </button>
            {advanced ? (
              <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground leading-5">
                {explain.advanced.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function HandoffKindBadge() {
  const [advanced, setAdvanced] = useState(false);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0"
          data-testid="badge-proposal-kind-handoff"
          aria-label="Handoff — what this means"
        >
          <Badge variant="outline" className="cursor-pointer font-normal hover-elevate">
            Handoff
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 text-sm" align="start" data-testid="popover-handoff-kind">
        <p className="font-medium text-foreground">A reminder note, not a content change</p>
        <p className="text-muted-foreground leading-5">
          Someone (often a coding agent) hit a wall and left this open so the next person can pick it
          up. There is nothing to Approve — leave it open as a reminder, Claim if you are working it,
          or Close with a reason when you stop tracking it. Closing does not change the live site.
        </p>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          data-testid="button-handoff-kind-advanced"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? "Hide advanced" : "Read more (advanced)"}
        </button>
        {advanced ? (
          <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground leading-5">
            <p>
              Stored as proposal kind <code className="text-foreground">notes</code> — no field
              updates or draft promote on apply.
            </p>
            <p>
              Close is not four-eyes (unlike Approve/Reject on Edits). Prefer an Edits proposal when
              there is a concrete fix to review.
            </p>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function EditsKindBadge() {
  const [advanced, setAdvanced] = useState(false);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0"
          data-testid="badge-proposal-kind-edits"
          aria-label="Edits — what this means"
        >
          <Badge variant="outline" className="cursor-pointer font-normal hover-elevate">
            Edits
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 text-sm" align="start" data-testid="popover-edits-kind">
        <p className="font-medium text-foreground">Proposed content changes to review</p>
        <p className="text-muted-foreground leading-5">
          Someone suggested field updates on the linked pages. Nothing on the live site changes until
          a different person Approves. Reject leaves live unchanged. Use a Handoff when there is no
          concrete fix to apply — only a reminder for the next person.
        </p>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          data-testid="button-edits-kind-advanced"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? "Hide advanced" : "Read more (advanced)"}
        </button>
        {advanced ? (
          <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground leading-5">
            <p>
              Stored as proposal kind <code className="text-foreground">edits</code> — Approve
              applies field updates and/or promotes a prepared draft; Reject does not write YAML.
            </p>
            <p>
              Approve and Reject are four-eyes: the proposer cannot finish their own proposal. The
              review-mode badge next to this one explains draft vs soft vs go-live.
            </p>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function NoAutoRetryBadge({
  noAutoRetry,
  disabled,
  onNoAutoRetryChange,
}: {
  noAutoRetry: boolean;
  disabled?: boolean;
  onNoAutoRetryChange: (next: boolean) => void;
}) {
  const [advanced, setAdvanced] = useState(false);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0"
          data-testid="badge-no-auto-retry"
          aria-label={
            noAutoRetry ? "No auto-retry — what this means" : "Retry allowed — what this means"
          }
        >
          <Badge
            variant={noAutoRetry ? "secondary" : "outline"}
            className="cursor-pointer font-normal hover-elevate"
          >
            {noAutoRetry ? "No auto-retry" : "Retry allowed"}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 text-sm" align="start" data-testid="popover-no-auto-retry">
        <p className="font-medium text-foreground">Blocks another proposal on the same issue</p>
        <p className="text-muted-foreground leading-5">
          While this reminder stays open, coding agents cannot open a second handoff note for the same
          linked issue. That stops the same wall from being reported over and over.
        </p>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <Label htmlFor="switch-no-auto-retry" className="text-xs leading-4 text-foreground">
            Block another proposal on this issue
          </Label>
          <Switch
            id="switch-no-auto-retry"
            checked={noAutoRetry}
            disabled={disabled}
            onCheckedChange={onNoAutoRetryChange}
            data-testid="switch-no-auto-retry"
          />
        </div>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          data-testid="button-no-auto-retry-advanced"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? "Hide advanced" : "Read more (advanced)"}
        </button>
        {advanced ? (
          <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground leading-5">
            <p>New handoffs default to this block when they link an issue. Handoffs with no linked issue are not gated this way.</p>
            <p>Staff can change this without claiming. Agents must claim first, then change the flag.</p>
            <p>Closing or finishing this handoff ends the block for that issue link.</p>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
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
          Suggested entry changes wait for Approve or Reject (preview drafts first). Handoff notes stay
          open when an agent hits a wall — leave them open as a reminder, or Close with a reason (that
          does not change the live site). Needs changes (blockers) mean not ready to approve.
        </p>
        <Collapsible open={advanced} onOpenChange={setAdvanced}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-auto px-0 mt-1 text-xs text-muted-foreground">
              {advanced ? "Hide advanced" : "Read more (advanced)"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="text-xs text-muted-foreground space-y-1 mt-1">
            <p>Stored in per-site SQLite (data/&lt;site&gt;/app.db). Exact fingerprint blocks clones; similar open proposals need confirm_distinct. One open proposal per draft variant.</p>
            <p>Notes default to no auto-retry on linked issues. Close reasons: wont_fix, fixed_elsewhere, tracked_elsewhere, other. Apply/Reject are four-eyes; Close is not. MCP must claim before clearing no_auto_retry.</p>
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
                    Suggested entry changes and wall handoffs show up here for review.
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
  const [claimOpen, setClaimOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [activityAck, setActivityAck] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState<ProposalCloseReasonValue>("wont_fix");
  const [closeNote, setCloseNote] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectPending, setRejectPending] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const addBlockerFormRef = useRef<HTMLDivElement>(null);
  const addBlockerInputRef = useRef<HTMLTextAreaElement>(null);
  const rejectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rejectToastDismissRef = useRef<(() => void) | null>(null);

  const scrollToAskForChanges = () => {
    addBlockerFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      addBlockerInputRef.current?.focus();
    }, 350);
  };

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
        setApplyOpen(true);
      }
      if (e.data?.code === "confirm_recent_activity") {
        setApplyOpen(true);
        setActivityAck(false);
      }
    },
  });
  const mutRef = useRef(mut);
  mutRef.current = mut;

  const clearPendingReject = () => {
    if (rejectTimerRef.current) {
      clearTimeout(rejectTimerRef.current);
      rejectTimerRef.current = null;
    }
    rejectToastDismissRef.current?.();
    rejectToastDismissRef.current = null;
    setRejectPending(false);
  };

  const undoReject = () => {
    if (!rejectTimerRef.current) return;
    clearPendingReject();
    toast({
      title: "Rejection cancelled",
      description: "The proposal is still open for review.",
    });
  };

  const scheduleReject = () => {
    clearPendingReject();
    setRejectOpen(false);
    setRejectPending(true);
    const rejectToast = toast({
      title: "Rejecting proposal…",
      description: "Undo within 10 seconds to keep it open.",
      duration: REJECT_UNDO_MS,
      action: (
        <ToastAction
          altText="Undo rejection"
          onClick={undoReject}
          data-testid="toast-undo-reject-proposal"
        >
          Undo
        </ToastAction>
      ),
    });
    rejectToastDismissRef.current = rejectToast.dismiss;
    rejectTimerRef.current = setTimeout(() => {
      rejectTimerRef.current = null;
      rejectToastDismissRef.current = null;
      setRejectPending(false);
      mutRef.current.mutate({ action: "reject" });
    }, REJECT_UNDO_MS);
  };

  const p = data?.proposal;
  const mode = p ? reviewModeBadge(p) : null;
  const ui = p ? proposalStatusUi(p.status) : null;
  const recentActivity = p?.recent_activity ?? [];
  const activityByKey = useMemo(() => {
    const m = new Map<string, { writeCount: number; windowDays: number }>();
    for (const row of recentActivity) {
      m.set(row.entryKey, { writeCount: row.writeCount, windowDays: row.windowDays });
    }
    return m;
  }, [recentActivity]);
  const gateWriteTotal = recentActivity.reduce((sum, row) => sum + (row.writeCount || 0), 0);
  const needsActivityAck = gateWriteTotal > 0;
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
  const viewerUsername = getDebugUserName().trim();
  const isProposer =
    Boolean(viewerUsername) &&
    Boolean(p?.proposer_username) &&
    viewerUsername.toLowerCase() === p!.proposer_username.trim().toLowerCase();
  // Known identity: proposer sees Withdraw only; others see Reject (edits). Unknown: keep both.
  const viewerKnown = Boolean(viewerUsername);
  const showReject = Boolean(
    p && p.kind === "edits" && !isTerminal && (!viewerKnown || !isProposer),
  );
  const showWithdraw = Boolean(p && !isTerminal && (!viewerKnown || isProposer));
  const primaryActionLabel = !p
    ? ""
    : p.kind === "notes"
      ? "Close this proposal"
      : p.promote_on_apply || p.review_mode === "draft_backed"
        ? confirmExperiment
          ? "Confirm end experiment & make draft live"
          : "Approve and make draft live"
        : "Apply changes";
  const closeNoteOk =
    !closeNoteRequired(closeReason) || closeNote.trim().length >= CLOSE_NOTE_MIN;
  const closeNoteHint = closeNoteRequired(closeReason)
    ? minLengthHint(closeNote, CLOSE_NOTE_MIN)
    : null;
  const blockerHint =
    blockerBody.trim().length > 0 ? minLengthHint(blockerBody, 80) : null;
  const closeReasonLabel =
    PROPOSAL_CLOSE_REASON_OPTIONS.find((o) => o.value === p?.close_reason)?.label ?? p?.close_reason;

  const detailMeta: Array<{ key: string; node: ReactNode }> = [];
  if (p && attribution) {
    for (const line of attribution.lines) {
      detailMeta.push({ key: `attr-${line}`, node: <span>{line}</span> });
    }
    if (attribution.expiredLine) {
      detailMeta.push({
        key: "expired",
        node: <span className="text-muted-foreground/70">{attribution.expiredLine}</span>,
      });
    }
    if (progress) {
      detailMeta.push({
        key: "progress",
        node: (
          <span className={progress.failed > 0 ? "font-medium text-destructive" : undefined}>
            {progress.label}
          </span>
        ),
      });
    }
    detailMeta.push({
      key: "updated",
      node: <span>Updated {formatProposalRelativeUpdatedAt(p.updated_at ?? p.created_at)}</span>,
    });
    if (claimActive) {
      detailMeta.push({
        key: "claim",
        node: <span>Claim holds until {new Date(claimActive.expiresAt).toLocaleString()}</span>,
      });
    }
  }

  return (
    <div className="space-y-5" data-testid="panel-agents-proposal-detail">
      <Button variant="ghost" asChild className="-ml-2 h-10 gap-1.5 px-3 text-sm text-muted-foreground">
        <Link href={backHref}>
          <IconChevronLeft className="h-5 w-5" />
          All proposals
        </Link>
      </Button>
      {isLoading && (
        <Card className="space-y-3 p-5" data-testid="loading-proposal-detail">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </Card>
      )}
      {p && mode && attribution && ui && (
        <>
          <Card className={cn("border-l-2", ui.accentClassName)}>
            <div className="flex items-start gap-3 p-5">
              <span
                className={cn(
                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  ui.chipClassName,
                )}
                aria-hidden
              >
                <ui.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <ProposalStatusLabel
                    status={p.status}
                    kind={p.kind}
                    label={ui.label}
                    className={ui.className}
                  />
                  {p.kind === "notes" ? <HandoffKindBadge /> : <EditsKindBadge />}
                  {p.kind === "edits" ? (
                    <ReviewModeBadge proposal={p} label={mode.label} variant={mode.variant} />
                  ) : null}
                  {p.kind === "notes" && !isTerminal ? (
                    <NoAutoRetryBadge
                      noAutoRetry={Boolean(p.no_auto_retry)}
                      disabled={mut.isPending}
                      onNoAutoRetryChange={(next) =>
                        mut.mutate({ action: "set_no_auto_retry", body: { no_auto_retry: next } })
                      }
                    />
                  ) : null}
                  {blockersOpen ? (
                    <Badge variant="destructive" className="gap-1 font-normal">
                      <IconAlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                      {p.open_blocker_count} needs changes
                    </Badge>
                  ) : null}
                </div>
                <h2 className="text-xl font-semibold leading-tight tracking-tight">{p.title}</h2>
                <div
                  className="flex flex-wrap items-center gap-2"
                  data-testid="proposal-identity-row"
                >
                  <ProposalCategoryTags
                    category={p.category}
                    tags={p.tags}
                    testIdPrefix="proposal-detail"
                  />
                  <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                    <span className="font-mono" data-testid="text-proposal-short-id" title={p.id}>
                      {shortProposalId(p.id)}
                    </span>
                    <McpCopyButton text={p.id} testId="button-copy-proposal-id" />
                  </span>
                </div>
                {p.kind === "edits" && p.entries.length > 0 ? (
                  <div
                    className="flex flex-wrap items-center gap-1.5"
                    data-testid="proposal-related-entries"
                  >
                    <span className="text-xs text-muted-foreground">Related</span>
                    {p.entries.map((e) => {
                      const liveKey = buildEntryKey({
                        contentType: e.contentType,
                        slug: e.slug,
                        locale: e.locale,
                      });
                      const draftKey = e.variant
                        ? buildEntryKey({
                            contentType: e.contentType,
                            slug: e.slug,
                            locale: e.locale,
                            variant: e.variant,
                          })
                        : null;
                      const liveAct = activityByKey.get(liveKey);
                      const draftAct = draftKey ? activityByKey.get(draftKey) : undefined;
                      return (
                        <span
                          key={e.id}
                          className="inline-flex max-w-full flex-wrap items-center gap-1"
                        >
                          <RelatedEntryPopover
                            contentType={e.contentType}
                            slug={e.slug}
                            locale={e.locale}
                            variant={e.variant}
                            previewHref={previewHref(e)}
                            testId={`popover-related-entry-${e.id}`}
                          >
                            <Badge
                              variant="outline"
                              className="gap-1 font-mono font-normal max-w-full truncate"
                              data-testid={`badge-related-entry-${e.id}`}
                            >
                              <IconLink className="h-3 w-3 shrink-0" aria-hidden />
                              <span className="truncate">
                                {e.contentType}/{e.slug}
                                <span className="text-muted-foreground"> · {e.locale}</span>
                                {e.variant ? (
                                  <span className="text-muted-foreground"> · draft {e.variant}</span>
                                ) : null}
                              </span>
                            </Badge>
                          </RelatedEntryPopover>
                          <EntryActivityBadge
                            entryKey={liveKey}
                            writeCount={liveAct?.writeCount ?? 0}
                            windowDays={liveAct?.windowDays ?? ENTRY_ACTIVITY_WINDOW_DAYS}
                            testIdPrefix={`proposal-activity-live-${e.id}`}
                          />
                          {draftKey ? (
                            <EntryActivityBadge
                              entryKey={draftKey}
                              writeCount={draftAct?.writeCount ?? 0}
                              windowDays={draftAct?.windowDays ?? ENTRY_ACTIVITY_WINDOW_DAYS}
                              testIdPrefix={`proposal-activity-draft-${e.id}`}
                            />
                          ) : null}
                        </span>
                      );
                    })}
                  </div>
                ) : null}
                <ProposalMetaRow items={detailMeta} className="text-xs" />
              </div>
            </div>
            {!isTerminal ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-card-border px-5 py-3">
                {showPrimaryEdits ? (
                  <Button
                    onClick={() => {
                      setActivityAck(false);
                      setApplyOpen(true);
                    }}
                    disabled={mut.isPending || rejectPending || blockersOpen || Boolean(p.recent_activity_error)}
                    data-testid="button-apply-proposal"
                  >
                    <IconCheck className="h-4 w-4" aria-hidden />
                    {primaryActionLabel}
                  </Button>
                ) : null}
                {showPrimaryNotes ? (
                  <Button
                    onClick={() => setCloseOpen(true)}
                    disabled={mut.isPending || rejectPending}
                    data-testid="button-close-proposal"
                  >
                    <IconX className="h-4 w-4" aria-hidden />
                    {primaryActionLabel}
                  </Button>
                ) : null}
                {claimActive ? (
                  <Button
                    variant="outline"
                    onClick={() =>
                      mut.mutate({
                        action: "release",
                        body: { report: "Released after review work. ".repeat(4) },
                      })
                    }
                    disabled={mut.isPending || rejectPending}
                    data-testid="button-release-proposal"
                  >
                    <IconLockOpen className="h-4 w-4" aria-hidden />
                    Release claim
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setClaimOpen(true)}
                    disabled={mut.isPending || rejectPending}
                    data-testid="button-claim-proposal"
                  >
                    <IconLock className="h-4 w-4" aria-hidden />
                    Claim
                  </Button>
                )}
                {showPrimaryEdits ? (
                  <Button
                    variant="outline"
                    onClick={scrollToAskForChanges}
                    disabled={mut.isPending || rejectPending}
                    data-testid="button-ask-for-changes"
                  >
                    <IconMessage className="h-4 w-4" aria-hidden />
                    Ask for changes
                  </Button>
                ) : null}
                {showReject ? (
                  <Button
                    variant="outline"
                    onClick={() => setRejectOpen(true)}
                    disabled={mut.isPending || rejectPending}
                    data-testid="button-reject-proposal"
                  >
                    <IconCircleX className="h-4 w-4 text-destructive" aria-hidden />
                    {rejectPending ? "Rejecting…" : "Reject Completely"}
                  </Button>
                ) : null}
                {showWithdraw ? (
                  <Button
                    variant="outline"
                    onClick={() => mut.mutate({ action: "withdraw" })}
                    disabled={mut.isPending || rejectPending}
                    data-testid="button-withdraw-proposal"
                  >
                    <IconBan className="h-4 w-4" aria-hidden />
                    Withdraw
                  </Button>
                ) : null}
                {blockersOpen && showReject ? (
                  <span className="text-xs text-muted-foreground">
                    Approve is disabled while needs-changes items are open. Reject Completely remains
                    available.
                  </span>
                ) : blockersOpen ? (
                  <span className="text-xs text-muted-foreground">
                    Approve is disabled while needs-changes items are open.
                  </span>
                ) : null}
              </div>
            ) : null}
          </Card>

          {confirmExperiment ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Other versions still have traffic. Confirming will remove those traffic-bearing
                variants when this draft goes live.
              </p>
            </div>
          ) : null}

          {rejectPending ? (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm"
              data-testid="banner-reject-pending"
            >
              <p className="text-destructive">
                Rejecting this proposal… You can undo for 10 seconds. Live content stays as it is.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={undoReject}
                data-testid="button-undo-reject-proposal"
              >
                Undo
              </Button>
            </div>
          ) : null}

          {p.kind === "edits" && p.recent_activity_error ? (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
              data-testid="banner-proposal-activity-error"
            >
              <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Could not load recent changes for linked pages. Approve is blocked until activity
                history is available again.
              </p>
            </div>
          ) : null}

          {p.kind === "edits" && !isTerminal && gateWriteTotal > 0 ? (
            <div
              className="rounded-md border border-card-border bg-muted/40 px-3 py-2.5"
              data-testid="banner-proposal-recent-activity"
            >
              <AskActivityGateCopy
                writeCount={gateWriteTotal}
                windowDays={
                  recentActivity[0]?.windowDays ?? ENTRY_ACTIVITY_WINDOW_DAYS
                }
                testId="proposal-activity-gate-copy"
              />
              <p className="mt-2 text-xs text-muted-foreground pl-10">
                Open the write count badges above to review recent changes before you approve.
              </p>
            </div>
          ) : null}

          {p.status === "finished" && p.kind === "notes" && p.close_reason ? (
            <div
              className="flex items-start gap-2 rounded-md border border-card-border bg-muted/40 px-3 py-2.5 text-sm"
              data-testid="text-proposal-close-reason"
            >
              <IconCircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <p>
                Closed as {closeReasonLabel}
                {p.closed_by ? ` by ${p.closed_by}` : ""}
                {p.close_note ? `: ${p.close_note}` : ""}
              </p>
            </div>
          ) : null}

          {!isTerminal ? (
          <div className="flex items-start gap-2 rounded-md border border-card-border bg-muted/40 px-3 py-2.5 text-sm leading-6">
            <IconInfoCircle className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            {p.kind === "notes" ? (
              <p>
                Wall handoff — no content change is attached. Leave open as a reminder, Claim if you (or
                a coding agent) are working it, or Close with a reason when you stop tracking it. Closing
                does not change the live site.
                {p.no_auto_retry ? (
                  <>
                    {" "}
                    No auto-retry is on, so agents cannot open another handoff for the same linked issue
                    — click the badge above to turn it off.
                  </>
                ) : null}
              </p>
            ) : p.review_mode === "draft_backed" || p.promote_on_apply ? (
              <p>
                This proposal includes a prepared draft. Preview that version before you approve or
                reject. Approving makes that draft the live page for this locale. Open needs-changes
                items block approve; clearing them still requires a fresh preview — resolving means the
                acceptance criteria were met, not “I disagree.”
              </p>
            ) : p.review_mode === "soft_variant" || p.entries.some((e) => e.variant) ? (
              <p>
                Soft suggestion on a draft. Approving writes the proposed field changes into that draft —
                it does not go live. Preview the draft before deciding.
              </p>
            ) : (
              <p>
                Soft suggestion only. Nothing is live until you apply. There is no separate draft page to
                preview unless an entry lists a variant.
              </p>
            )}
          </div>
          ) : null}

          <Card className="p-5 space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {p.kind === "notes" ? "Handoff note" : "Summary"}
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-6">{p.summary}</p>
            {p.related_issue_ids.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-xs text-muted-foreground">Linked issues</span>
                {p.related_issue_ids.map((issueId) => (
                  <button
                    key={issueId}
                    type="button"
                    onClick={() => setSelectedIssueId(issueId)}
                    className="inline-flex max-w-full"
                    data-testid={`button-linked-issue-${issueId}`}
                  >
                    <Badge
                      variant="outline"
                      className="gap-1 font-mono font-normal cursor-pointer hover:bg-muted max-w-full truncate"
                    >
                      <IconLink className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="truncate">{issueId}</span>
                    </Badge>
                  </button>
                ))}
              </div>
            ) : null}
          </Card>

          <ValidationIssueDetailModal
            issueId={selectedIssueId}
            open={Boolean(selectedIssueId)}
            onOpenChange={(next) => {
              if (!next) setSelectedIssueId(null);
            }}
          />

          {p.kind === "edits" && p.entries.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Proposed changes ({p.entries.length})
              </h3>
              {p.entries.map((e) => {
                const href = previewHref(e);
                return (
                  <Card key={e.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-card-border px-4 py-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          <span
                            className="inline-flex shrink-0"
                            title={e.locale}
                            aria-label={e.locale}
                          >
                            <LocaleFlag locale={e.locale} className="w-3.5 h-2.5 rounded-sm" />
                          </span>
                          <span className="truncate">
                            {e.contentType}/{e.slug}
                          </span>
                        </p>
                        {e.variant ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            draft {e.variant}
                          </p>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <EntryActivityBadge
                            entryKey={buildEntryKey({
                              contentType: e.contentType,
                              slug: e.slug,
                              locale: e.locale,
                            })}
                            writeCount={
                              activityByKey.get(
                                buildEntryKey({
                                  contentType: e.contentType,
                                  slug: e.slug,
                                  locale: e.locale,
                                }),
                              )?.writeCount ?? 0
                            }
                            testIdPrefix={`proposal-entry-activity-${e.id}`}
                          />
                          {e.variant ? (
                            <EntryActivityBadge
                              entryKey={buildEntryKey({
                                contentType: e.contentType,
                                slug: e.slug,
                                locale: e.locale,
                                variant: e.variant,
                              })}
                              writeCount={
                                activityByKey.get(
                                  buildEntryKey({
                                    contentType: e.contentType,
                                    slug: e.slug,
                                    locale: e.locale,
                                    variant: e.variant,
                                  }),
                                )?.writeCount ?? 0
                              }
                              testIdPrefix={`proposal-entry-draft-activity-${e.id}`}
                            />
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={cn(
                            "text-xs font-medium capitalize",
                            e.status === "done"
                              ? "text-status-online"
                              : e.status === "failed"
                                ? "text-destructive"
                                : "text-muted-foreground",
                          )}
                        >
                          {e.status}
                        </span>
                        {href && (
                          <Button variant="outline" size="sm" asChild>
                            <a href={href} target="_blank" rel="noreferrer">
                              <IconExternalLink className="h-3.5 w-3.5 mr-1.5" />
                              Preview draft
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2 p-4">
                      {e.last_error && (
                        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                          <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                          <p className="whitespace-pre-wrap">{e.last_error}</p>
                        </div>
                      )}
                      {e.ops.length === 0 && (p.promote_on_apply || p.review_mode === "draft_backed") && (
                        <p className="text-xs text-muted-foreground">
                          No field-diff list — the attached draft is the change. Preview it before approve.
                        </p>
                      )}
                      {e.ops.map((op) => (
                        <ProposalFieldDiff
                          key={op.field_path}
                          fieldPath={op.field_path}
                          current={e.baseline_context.values[op.field_path]}
                          proposed={op.value}
                        />
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {p.kind === "edits" ? (
            <Card>
              <div className="flex items-center justify-between gap-2 border-b border-card-border px-4 py-3">
                <h3 className="text-sm font-medium">Needs changes</h3>
                {blockersOpen ? (
                  <Badge variant="destructive" className="font-normal">
                    {p.open_blocker_count} open
                  </Badge>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <IconCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Clear
                  </span>
                )}
              </div>
              <div className="space-y-3 p-4">
                {(p.blockers ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nothing is blocking this proposal yet.
                  </p>
                )}
                {(p.blockers ?? []).map((b) => (
                  <div
                    key={b.id}
                    className={cn(
                      "space-y-2 rounded-md border border-card-border p-3 text-sm",
                      b.status === "open" ? "border-l-2 border-l-destructive" : "bg-muted/30",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          "font-medium capitalize",
                          b.status === "open" ? "text-destructive" : "text-status-online",
                        )}
                      >
                        {b.status}
                      </span>
                      <span aria-hidden className="text-muted-foreground/40">
                        ·
                      </span>
                      <span>by {b.author}</span>
                      <span aria-hidden className="text-muted-foreground/40">
                        ·
                      </span>
                      <span>{formatProposalRelativeUpdatedAt(b.created_at)}</span>
                    </div>
                    <p className="whitespace-pre-wrap leading-6">{b.body}</p>
                    {b.resolve_note && (
                      <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                        Resolved by {b.resolved_by}: {b.resolve_note}
                      </p>
                    )}
                    {b.status === "open" && canResolveUi && (
                      <div className="space-y-2 pt-1">
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
                        onClick={() =>
                          mut.mutate({ action: "reopen_blocker", body: { blocker_id: b.id } })
                        }
                      >
                        Reopen
                      </Button>
                    )}
                  </div>
                ))}
                <div
                  ref={addBlockerFormRef}
                  id="proposal-ask-for-changes"
                  className="space-y-2 border-t border-card-border pt-3"
                >
                  <p className="text-xs text-muted-foreground">
                    Add needs-change note: what’s wrong, what fixed looks like, and why (min 80
                    characters). No tool lists.
                  </p>
                  <Textarea
                    ref={addBlockerInputRef}
                    placeholder="On draft …, X is wrong. It must be Y because …"
                    value={blockerBody}
                    onChange={(e) => setBlockerBody(e.target.value)}
                    data-testid="input-add-blocker"
                  />
                  <div className="flex items-center gap-2">
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
                      Add needs-change note
                    </Button>
                    {blockerHint ? (
                      <span className={blockerHint.className} data-testid="text-blocker-length-hint">
                        {blockerHint.text}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

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
              <p>
                Recent-activity warnings use a {ENTRY_ACTIVITY_WINDOW_DAYS}-day window of people and
                agent writes. The live page always counts; a named draft counts too. Approve always
                re-checks. This proposal&apos;s own earlier applies do not re-trigger the Approve
                warning. If activity history cannot load, create/approve stays blocked.
              </p>
            </CollapsibleContent>
          </Collapsible>

          <AlertDialog open={applyOpen} onOpenChange={setApplyOpen}>
            <AlertDialogContent data-testid="dialog-apply-proposal">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {p.promote_on_apply || p.review_mode === "draft_backed"
                    ? confirmExperiment
                      ? "End experiment and make draft live?"
                      : "Approve and make draft live?"
                    : p.review_mode === "soft_variant" || p.entries.some((e) => e.variant)
                      ? "Apply changes to the draft?"
                      : "Apply changes?"}
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    {p.promote_on_apply || p.review_mode === "draft_backed" ? (
                      <>
                        <p>
                          Approving copies the prepared draft over the live page for this locale.
                          Visitors will see that version.
                        </p>
                        {confirmExperiment ? (
                          <p className="text-destructive">
                            Other versions still have traffic. Confirming will remove those
                            traffic-bearing variants when this draft goes live.
                          </p>
                        ) : (
                          <p>This does not push to GitHub by itself or complete linked validation issues.</p>
                        )}
                      </>
                    ) : p.review_mode === "soft_variant" || p.entries.some((e) => e.variant) ? (
                      <>
                        <p>
                          This writes the proposed field changes into the draft only. The live page
                          does not change until someone promotes that draft later.
                        </p>
                        <p>This does not complete linked validation issues.</p>
                      </>
                    ) : (
                      <>
                        <p>
                          This writes the remaining suggested field changes onto the live page for
                          each open entry. Those updates become visible to visitors.
                        </p>
                        <p>
                          This does not push to GitHub by itself or complete linked validation
                          issues. Reject or Withdraw if you do not want these changes live.
                        </p>
                      </>
                    )}
                    {needsActivityAck ? (
                      <div
                        className="space-y-2 rounded-md border border-card-border bg-muted/40 p-3"
                        data-testid="apply-recent-activity-ack"
                      >
                        <AskActivityGateCopy
                          writeCount={gateWriteTotal}
                          windowDays={
                            recentActivity[0]?.windowDays ?? ENTRY_ACTIVITY_WINDOW_DAYS
                          }
                          testId="apply-activity-gate-copy"
                        />
                        <label className="flex items-start gap-2 text-sm text-foreground cursor-pointer">
                          <Checkbox
                            checked={activityAck}
                            onCheckedChange={(v) => setActivityAck(v === true)}
                            className="mt-0.5"
                            data-testid="checkbox-activity-ack"
                          />
                          <span>I checked recent changes — this proposal is still needed.</span>
                        </label>
                      </div>
                    ) : null}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-apply-proposal">Cancel</AlertDialogCancel>
                <Button
                  type="button"
                  disabled={
                    mut.isPending ||
                    blockersOpen ||
                    Boolean(p.recent_activity_error) ||
                    (needsActivityAck && !activityAck)
                  }
                  onClick={() => {
                    const body: Record<string, unknown> = {};
                    if (confirmExperiment) body.confirm_end_experiment = true;
                    if (needsActivityAck) body.confirm_recent_activity = true;
                    mut.mutate(
                      {
                        action: "apply",
                        body,
                      },
                      {
                        onSuccess: () => {
                          setApplyOpen(false);
                          setActivityAck(false);
                        },
                      },
                    );
                  }}
                  data-testid="button-confirm-apply-proposal"
                >
                  <IconCheck className="h-4 w-4" aria-hidden />
                  {primaryActionLabel}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={claimOpen} onOpenChange={setClaimOpen}>
            <AlertDialogContent data-testid="dialog-claim-proposal">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {p.kind === "notes" ? "Claim this handoff?" : "Claim this proposal?"}
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    {p.kind === "notes" ? (
                      <>
                        <p>
                          You are saying you are working this for about 30 minutes. Others can still
                          see it; when the claim expires (or you release it), anyone else can claim
                          next.
                        </p>
                        <p>This does not close the handoff, change the live site, or complete linked issues.</p>
                      </>
                    ) : (
                      <>
                        <p>
                          You are saying you are the person fixing the review notes right now (about
                          30 minutes). While your claim is active, only you can mark those notes done.
                        </p>
                        <p>
                          This does not approve or apply content, and it does not change the live
                          site. You can release the claim early when you are done.
                        </p>
                      </>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-claim-proposal">Cancel</AlertDialogCancel>
                <Button
                  type="button"
                  disabled={mut.isPending}
                  onClick={() => {
                    mut.mutate(
                      { action: "claim" },
                      {
                        onSuccess: () => setClaimOpen(false),
                      },
                    );
                  }}
                  data-testid="button-confirm-claim-proposal"
                >
                  Claim
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={rejectOpen}
            onOpenChange={(open) => {
              if (rejectPending) return;
              setRejectOpen(open);
            }}
          >
            <AlertDialogContent data-testid="dialog-reject-proposal">
              <AlertDialogHeader>
                <AlertDialogTitle>Reject this proposal completely?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      Rejecting closes this proposal. It leaves the open list and will no longer wait
                      for Approve.
                    </p>
                    <p>
                      The live site does not change from this action. Entries already applied earlier
                      stay as they are — reject does not roll those back.
                    </p>
                    <p>
                      After you confirm, you have 10 seconds to undo before the rejection is final.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-reject-proposal">
                  Cancel
                </AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={mut.isPending || rejectPending}
                  onClick={scheduleReject}
                  data-testid="button-confirm-reject-proposal"
                >
                  <IconCircleX className="h-4 w-4" aria-hidden />
                  Reject completely
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Dialog
            open={closeOpen}
            onOpenChange={(open) => {
              setCloseOpen(open);
              if (!open) {
                setCloseNote("");
                setCloseReason("wont_fix");
              }
            }}
          >
            <DialogContent data-testid="dialog-close-proposal">
              <DialogHeader>
                <DialogTitle>Close this handoff?</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      Closing removes this reminder from the open list and marks it finished. Pick a
                      reason so the next person knows why it stopped being tracked.
                    </p>
                    <p>
                      This does not change the live site or complete linked issues. If “No auto-retry”
                      was on, closing also ends that block so agents can open another handoff for the
                      same issue.
                    </p>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="proposal-close-reason">Reason</Label>
                  <Select
                    value={closeReason}
                    onValueChange={(v) => setCloseReason(v as ProposalCloseReasonValue)}
                  >
                    <SelectTrigger id="proposal-close-reason" data-testid="select-close-reason">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROPOSAL_CLOSE_REASON_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {PROPOSAL_CLOSE_REASON_OPTIONS.find((o) => o.value === closeReason)?.hint}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="proposal-close-note">Note</Label>
                  <Textarea
                    id="proposal-close-note"
                    value={closeNote}
                    onChange={(e) => setCloseNote(e.target.value)}
                    placeholder={
                      closeNoteRequired(closeReason)
                        ? "Where / what (min 20 characters)"
                        : "Optional"
                    }
                    data-testid="input-close-note"
                  />
                  {closeNoteHint ? (
                    <p className={closeNoteHint.className} data-testid="text-close-note-length-hint">
                      {closeNoteHint.text}
                    </p>
                  ) : null}
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setCloseOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={mut.isPending || !closeNoteOk}
                  onClick={() => {
                    mut.mutate(
                      {
                        action: "close",
                        body: {
                          close_reason: closeReason,
                          ...(closeNote.trim() ? { close_note: closeNote.trim() } : {}),
                        },
                      },
                      {
                        onSuccess: () => {
                          setCloseOpen(false);
                          setCloseNote("");
                          setCloseReason("wont_fix");
                        },
                      },
                    );
                  }}
                  data-testid="button-confirm-close-proposal"
                >
                  <IconX className="h-4 w-4" aria-hidden />
                  Close handoff
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
