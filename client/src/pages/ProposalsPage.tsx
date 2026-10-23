import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams, useSearch } from "wouter";
import {
  IconAlertTriangle,
  IconArrowsSort,
  IconBan,
  IconBug,
  IconCheck,
  IconChevronLeft,
  IconCircleCheck,
  IconCircleX,
  IconCloudDownload,
  IconExternalLink,
  IconFilter,
  IconInbox,
  IconInfoCircle,
  IconLayoutList,
  IconLink,
  IconLoader2,
  IconLock,
  IconLockOpen,
  IconMessage,
  IconSearch,
  IconTable,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getDebugUserName, useDebugAuth } from "@/hooks/useDebugAuth";
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
  ACCEPT_NEXT_STEP_MIN,
  CLOSE_NOTE_MIN,
  IDEA_PARK_CLOSE_REASON_OPTIONS,
  PROPOSAL_CLOSE_REASON_OPTIONS,
  closeNoteRequired,
  type ProposalCloseReasonValue,
} from "@/lib/proposalCloseReason";
import {
  PROPOSAL_REJECT_KIND_OPTIONS,
  REJECT_NOTE_MIN,
  rejectKindLabel,
  type ProposalRejectKindValue,
} from "@/lib/proposalRejectKind";
import { minLengthHint } from "@/lib/minLengthHint";
import { ProposalListFiltersDialog } from "@/components/agents/ProposalListFiltersDialog";
import { ProposalKpiStrip } from "@/components/agents/ProposalKpiStrip";
import {
  ProposalListCard,
  ProposalListCardSkeleton,
  ProposalCategoryTags,
} from "@/components/agents/ProposalListCard";
import { ProposalDetailMetaCard } from "@/components/agents/ProposalDetailMetaCard";
import { ProposalFieldDiff } from "@/components/agents/ProposalFieldDiff";
import {
  ProposalSituationCallout,
  type ReviewContextPayload,
} from "@/components/agents/SituationReviewBadge";
import { filedIdeaDemand } from "@/lib/review-situation-summary";
import { EntryActivityBadge } from "@/components/pipeline/EntryActivityBadge";
import { RelatedEntryPopover } from "@/components/agents/RelatedEntryPopover";
import { ProposalEntryCard, proposalEntryBlockId } from "@/components/agents/ProposalEntryCard";
import { ImplementsIdeaCard, type ImplementsIdeaSummary } from "@/components/agents/ImplementsIdeaCard";
import { entryPreviewHref } from "@/lib/variable-usage-href";
import { EscalatedBadge } from "@/components/agents/EscalatedBadge";
import { ProposalV1Badges } from "@/components/agents/ProposalDraftBadges";
import {
  ProposalDraftEntryDetails,
  type DraftEntryV1,
} from "@/components/agents/ProposalDraftEntryDetails";
import {
  ProposalOutcomeReview,
  type OutcomeHistoryEntry,
  type OutcomeVerdict,
} from "@/components/agents/ProposalOutcomeReview";
import { BlockersBadge } from "@/components/agents/BlockersBadge";
import { ProposalMarkdown } from "@/components/agents/ProposalMarkdown";
import {
  IdeaTargetEntryCard,
  type IdeaContentTypeStrategyPayload,
} from "@/components/agents/IdeaTargetEntryCard";
import {
  ProposalKindBadge,
  ProposalStatusLabel,
} from "@/components/agents/ProposalExplainBadges";
import { EventWebhooksKpiButton } from "@/components/pipeline/EventWebhooksDialog";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import { AskActivityGateCopy } from "@/components/DebugBubble/SolveWithAiAgentDropdown";
import { ValidationIssueDetailModal } from "@/components/diagnostics/ValidationIssueDetailModal";
import { buildEntryKey } from "@/lib/entryKeyToPageUrl";
import { ENTRY_ACTIVITY_WINDOW_DAYS } from "@shared/event-log-filters";
import { TEXT_LIMITS_EXCEEDED_CODE, type TextLimitViolation } from "@shared/component-text-limits";
import { TextLimitsIssue } from "@/components/TextLimitsIssue";
import { IdeaSeoTargetPanel, type IdeaSeoTarget } from "@/components/agents/IdeaSeoTargetPanel";
import { apiFetch, apiRequestWithAuth } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { assessSlugLocaleMatch, slugLocaleMismatchHint } from "@shared/slug-locale-heuristic";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { outcomesBackHref } from "@/lib/agents-tab";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  canApproveInDrawer,
  proposalDraftPreviewHref,
  sameDraft,
  type ProposalPreviewEntry,
} from "@/lib/proposal-drawer";
import { proposalStatusUi } from "@/lib/proposalStatusUi";
import {
  asIssueActor,
  formatProposalRelativeUpdatedAt,
  proposalEntryProgress,
  shortProposalId,
} from "@/lib/proposalCardMeta";
import { formatIssueActorLine } from "@/lib/formatIssueActor";
import { McpCopyButton } from "@/components/mcp/McpSetupUi";
import {
  PROPOSAL_ACTOR_TYPE_OPTIONS,
  PROPOSAL_ATTENTION_OPTIONS,
  PROPOSAL_KIND_OPTIONS,
  PROPOSAL_SORT_PRESETS,
  PROPOSAL_STATUS_OPTIONS,
  clearProposalListFilters,
  countActiveProposalFilters,
  parseProposalListPerspective,
  parseProposalListSearch,
  proposalListApiSearchParams,
  proposalSortFromPreset,
  proposalSortPresetValue,
  serializeProposalListSearch,
  toProposalListApiQuery,
  withProposalListPerspective,
  type ProposalListFilters,
  type ProposalListPerspective,
  type ProposalListStats,
} from "@/pages/proposals-list-filters";
import {
  ProposalBulkActionsBar,
  ProposalBulkDeleteDialog,
  ProposalListTable,
} from "@/components/agents/ProposalListTable";
import {
  summarizeProposalBulkDelete,
  type ProposalBulkDeleteResult,
} from "@/lib/proposalBulkDelete";

export const AGENTS_PROPOSALS_BASE = "/private/agents/proposals";

const ENTRY_CARDS_COLLAPSED_COUNT = 4;

const REJECT_UNDO_MS = 10_000;

function proposalsListHref(search: string): string {
  const qs = search.startsWith("?") ? search.slice(1) : search;
  return qs ? `${AGENTS_PROPOSALS_BASE}?${qs}` : AGENTS_PROPOSALS_BASE;
}

type EntryRow = Omit<DraftEntryV1, "ops"> & {
  id: number;
  contentType: string;
  slug: string;
  locale: string;
  variant: string | null;
  status: string;
  last_error: string | null;
  ops: Array<{ field_path: string; value?: unknown; op?: "set" | "remove" }>;
  baseline_context: { values: Record<string, unknown>; note?: string };
  created_draft?: boolean;
};

const ACCEPTED_ENTRY_NOT_CREATABLE_COPY =
  "This page type can't be created from an idea. Someone must create the page in the CMS before edits can follow.";

const ACCEPTED_ENTRY_NEEDS_LAYOUT_COPY =
  "This page builds its own layout, so the follow-up proposal must include the whole page layout (every section), not only text fields.";

type ProposalWarning = {
  code?: string;
  message: string;
  details?: {
    placeholders?: Array<{ name: string; missing: number; total: number }>;
    waiting_ideas?: Array<{ id: string; title: string }>;
    entry_key?: string;
    locale?: string;
    fields?: string[];
  };
};

/** "Published. This page is free again, and 1 idea was waiting on it: …" */
function plainWaitingIdeas(w: ProposalWarning): string {
  const ideas = w.details?.waiting_ideas ?? [];
  if (!ideas.length) return w.message;
  const titles = ideas.map((i) => `"${i.title}"`).join(", ");
  return ideas.length === 1
    ? `Published. This page is free again, and 1 idea was waiting on it: ${titles}. Open it from the Ideas list to accept it.`
    : `Published. This page is free again, and ${ideas.length} ideas were waiting on it: ${titles}. Open them from the Ideas list to accept one.`;
}

/** "12 of 80 pages have no value for hero_image — those pages will show an empty spot." */
function plainPlaceholderGaps(w: ProposalWarning): string[] {
  return (w.details?.placeholders ?? []).map(
    (g) =>
      `${g.missing} of ${g.total} page${g.total === 1 ? "" : "s"} have no value for ${g.name} — those pages will show an empty spot.`,
  );
}

function plainWarningTitle(warnings: ProposalWarning[]): string {
  const byCode = (code: string) => warnings.find((w) => w.code === code);
  if (byCode("accepted_entry_not_creatable")) return ACCEPTED_ENTRY_NOT_CREATABLE_COPY;
  if (byCode("accepted_entry_needs_layout")) return ACCEPTED_ENTRY_NEEDS_LAYOUT_COPY;
  const waiting = byCode("idea_page_released_waiting_ideas");
  if (waiting) return plainWaitingIdeas(waiting);
  const gaps = byCode("template_placeholders_unfilled");
  if (gaps) return plainPlaceholderGaps(gaps).join(" ") || gaps.message;
  return warnings[0]!.message;
}

/** "sections[2].image.src: …" → "Section 3: …" for staff toasts. */
function plainSectionIssue(details?: { property_path?: string; message?: string }): string {
  const match = /^sections\[(\d+)\]/.exec(details?.property_path ?? "");
  const where = match ? `Section ${Number(match[1]) + 1}` : "A section";
  const what = details?.message ? `: ${details.message}` : " is not valid";
  return `${where}${what}. Fix it in the proposal and resubmit — nothing was saved.`;
}

type BlockerRow = {
  id: number;
  body: string;
  staff_summary?: string | null;
  status: string;
  author: string;
  created_at: number;
  resolve_note: string | null;
  resolved_by: string | null;
  author_actor?: Record<string, unknown> | null;
  resolved_by_actor?: Record<string, unknown> | null;
};

type RelatedEntryRef = {
  contentType: string;
  slug: string;
  locale?: string;
};

type Proposal = {
  id: string;
  title: string;
  summary: string;
  rationale?: string | null;
  kind: string;
  status: string;
  category?: string;
  tags?: string[];
  review_mode?: string;
  promote_on_apply?: boolean;
  open_blocker_count?: number;
  resolved_blocker_count?: number;
  attention?: string | null;
  no_auto_retry?: boolean;
  escalated?: boolean;
  escalated_at?: number | null;
  escalated_by?: string | null;
  escalated_note?: string | null;
  close_reason?: string | null;
  close_note?: string | null;
  closed_by?: string | null;
  closed_at?: number | null;
  reviewer_action_at?: number | null;
  reviewer_action_by?: string | null;
  reviewer_action_by_actor?: Record<string, unknown>;
  supersedes_proposal_id?: string | null;
  replaced_by_proposal_id?: string | null;
  system_version?: string | null;
  all_or_nothing?: boolean;
  stale_since?: string | null;
  stale_flagged_at?: string | null;
  blocked_flagged_at?: string | null;
  reverts_proposal_id?: string | null;
  applies_after_proposal_id?: string | null;
  applied_before_proposal_ids?: string[];
  dependent_overdue_flagged_at?: string | null;
  co_authors?: Array<{ username: string }>;
  affected_entries?: {
    count: number;
    sample: Array<{ contentType: string; slug: string; locale: string; variant: string | null }>;
  } | null;
  accepted_entry?: { contentType: string; slug: string; locale: string; url_slug?: string } | null;
  accepted_entry_create_mode?: "attached" | "page" | "manual" | null;
  accepted_entry_layout_owner?: "shared_template" | "entry" | null;
  idea_funnel?: {
    stage: string;
    products: "all" | Array<{ product: string; persona?: string }>;
  } | null;
  idea_seo_target?: IdeaSeoTarget | null;
  seo_target_override?: { reason: string } | null;
  implements_proposal_id?: string | null;
  proposer_username: string;
  proposer_actor?: Record<string, unknown>;
  related_issue_ids: string[];
  related_entries?: RelatedEntryRef[];
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
  review_situations?: string[];
  review_context_snapshot?: Record<string, unknown> | null;
  decision_debug?: {
    captured_at?: number;
    action?: string;
    source?: string;
    actor?: { username?: string; type?: string; role?: string };
    agent_session_id?: string | null;
    review_context?: {
      damage_class?: string;
      undo_cost?: string;
      summary?: string;
      active_checklists?: string[];
      think_items?: Array<{ id: string; title: string; why: string; look_for: string[] }>;
      warnings?: Array<{ code: string; message: string }>;
    };
    discovery_path?: { goal?: string } | null;
  } | null;
  outcome_review?: OutcomeVerdict | null;
  outcome_review_note?: string | null;
  outcome_review_expected?: string | null;
  outcome_review_at?: number | null;
  outcome_review_by?: string | null;
  outcome_review_history?: OutcomeHistoryEntry[];
  outcome_lesson_captured_at?: number | null;
  outcome_lesson_captured_by?: string | null;
  outcome_lesson_note?: string | null;
};

function suggestedEntriesBesidesReserved(p: Proposal): RelatedEntryRef[] {
  const related = p.related_entries ?? [];
  const reserved = p.accepted_entry;
  if (!reserved) return related;
  return related.filter(
    (ref) =>
      !(
        ref.contentType === reserved.contentType &&
        ref.slug === reserved.slug &&
        (!ref.locale || ref.locale === reserved.locale)
      ),
  );
}

function headers(): Record<string, string> {
  return { "Content-Type": "application/json", ...getSessionHeaders() };
}

/** Template apply dialog: dry-run placeholder scan (non-blocking). */
function TemplatePlaceholderNotice({ proposalId }: { proposalId: string }) {
  const { data } = useQuery({
    queryKey: ["/api/admin/proposals", proposalId, "apply-dry-run"],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/proposals/${proposalId}/apply`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ dry_run: true }),
      });
      if (!res.ok) return null;
      return (await res.json()) as { warnings?: ProposalWarning[] };
    },
    staleTime: 30_000,
  });
  const lines = (data?.warnings ?? [])
    .filter((w) => w.code === "template_placeholders_unfilled")
    .flatMap(plainPlaceholderGaps);
  if (!lines.length) return null;
  return (
    <div
      className="space-y-1 rounded-md border border-card-border bg-muted/40 p-3 text-sm text-foreground"
      data-testid="apply-template-placeholders-notice"
    >
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <p className="text-xs text-muted-foreground">You can still publish; fill those fields later.</p>
    </div>
  );
}

const DISPLAY_FIELD_LABELS: Record<string, string> = {
  funnel: "funnel",
  authors: "authors",
  published_at: "publish date",
  detached: "template detach",
};

/** Apply dialog: pages whose language will show the shared value instead of its own old copy (non-blocking). */
function ApplyDisplayChangeNotice({ proposalId }: { proposalId: string }) {
  const { data } = useQuery({
    queryKey: ["/api/admin/proposals", proposalId, "apply-dry-run"],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/proposals/${proposalId}/apply`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ dry_run: true }),
      });
      if (!res.ok) return null;
      return (await res.json()) as { warnings?: ProposalWarning[] };
    },
    staleTime: 30_000,
  });
  const changes = (data?.warnings ?? []).filter((w) => w.code === "display_values_change");
  if (!changes.length) return null;
  return (
    <div
      className="space-y-1 rounded-md border border-card-border bg-muted/40 p-3 text-sm text-foreground"
      data-testid="apply-display-values-change-notice"
    >
      {changes.map((w) => {
        const d = w.details ?? {};
        const names = (d.fields ?? []).map((f) => DISPLAY_FIELD_LABELS[f] ?? f).join(", ");
        return (
          <p key={`${d.entry_key}|${d.locale}`}>
            {d.entry_key} ({d.locale}): publishing changes what visitors of this language see for {names}. These now
            come from the page-wide settings shared by every language.
          </p>
        );
      })}
      <p className="text-xs text-muted-foreground">You can still publish.</p>
    </div>
  );
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
    title: "Soft suggestion only",
    body: "Nothing is live until you apply. Approving writes the suggested field changes onto the live page for each open entry. There is no separate draft page to preview unless an entry lists a variant.",
    advanced: [
      "Default soft path: no draft_backed promote and no variant target.",
      "Apply is still four-eyes — the proposer cannot approve their own edits.",
    ],
  };
}

function DecisionDebugPanel({
  debug,
}: {
  debug: NonNullable<Proposal["decision_debug"]>;
}) {
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const think = debug.review_context?.think_items ?? [];
  return (
    <>
      <button
        type="button"
        className="inline-flex shrink-0"
        data-testid="badge-proposal-decision-debug"
        aria-label="Open decision debugger"
        onClick={() => setOpen(true)}
      >
        <Badge variant="outline" className="cursor-pointer gap-1 font-normal hover-elevate">
          <IconBug className="h-3.5 w-3.5" aria-hidden />
          Decision Debugger
        </Badge>
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setAdvanced(false);
        }}
      >
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          data-testid="dialog-proposal-decision-debug"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconBug className="h-4 w-4" aria-hidden />
              Decision Debugger
            </DialogTitle>
            <DialogDescription>
              Debug snapshot of the review checklist at decide time — it does not change the site.
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {debug.action ?? "—"}
            {debug.source ? ` · ${debug.source}` : ""}
            {debug.actor?.username ? ` · ${debug.actor.username}` : ""}
            {debug.review_context?.damage_class
              ? ` · ${debug.review_context.damage_class}`
              : ""}
          </p>
          <div
            className="space-y-2 border-t pt-2 text-xs text-muted-foreground"
            data-testid="panel-proposal-decision-debug-advanced"
          >
            <p>
              <span className="font-medium text-foreground">checklists:</span>{" "}
              {(debug.review_context?.active_checklists ?? []).join(", ") || "—"}
            </p>
            {think.length ? (
              <ul className="list-disc space-y-2 pl-4">
                {think.map((t) => (
                  <li key={t.id}>
                    <span className="font-medium text-foreground">{t.title}</span>
                    <ul className="mt-1 list-disc pl-4">
                      {t.look_for.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : null}
            <pre className="max-h-80 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[10px] leading-4">
              {JSON.stringify(debug, null, 2)}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
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
  return entryPreviewHref(entry);
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

const IDEA_PAGE_EXPLAIN = {
  suggested: {
    title: "Suggested page",
    body: "The page the person who filed this idea thinks it is about. It may not exist yet. This is only a suggestion: it does not reserve the page or stop other ideas from aiming at it.",
    use: "Check it fits the brief before accepting. Accept pre-fills this page as the one to reserve, and you can change it there.",
    advanced: [
      "Stored as related_entries. The proposer can replace it (set_related_entries) while the idea is open; it is frozen once the idea is accepted.",
      "A suggestion with no language matches every language of that page.",
      "When a reserved page frees up, open ideas that suggest it are listed as waiting so a reviewer can accept the next one. Nothing is accepted automatically.",
    ],
  },
  reserved: {
    title: "Reserved page",
    body: "The page and language the reviewer reserved for this idea when they accepted it. While reserved, no other idea can be accepted for it, and edit proposals for that page must be linked to this idea.",
    use: "File the follow-up edit proposal against this exact page and language. The reservation ends once one of those edits is applied.",
    advanced: [
      "Stored as accepted_entry { contentType, slug, locale }. A second accept for the same page is refused (accepted_entry_taken); unlinked edit proposals are refused (implements_required).",
      "Released when one implementing edit is applied and none are still open or partial. Rejected or withdrawn edits do not release it, and a later revert does not re-reserve it.",
      "Accepting does not publish or write YAML; the follow-up edit does.",
    ],
  },
} as const;

function IdeaPageInfoButton({ kind }: { kind: keyof typeof IDEA_PAGE_EXPLAIN }) {
  const [advanced, setAdvanced] = useState(false);
  const explain = IDEA_PAGE_EXPLAIN[kind];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          data-testid={`button-idea-${kind}-page-info`}
          aria-label={`${explain.title} — what this means`}
        >
          <IconInfoCircle className="h-3.5 w-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-3 text-sm"
        align="start"
        data-testid={`popover-idea-${kind}-page-info`}
      >
        <p className="font-medium text-foreground">{explain.title}</p>
        <p className="text-muted-foreground leading-5">{explain.body}</p>
        <p className="text-muted-foreground leading-5">
          <span className="font-medium text-foreground">How to use it: </span>
          {explain.use}
        </p>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          data-testid={`button-idea-${kind}-page-advanced`}
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pullProductionOpen, setPullProductionOpen] = useState(false);
  const [pullingProduction, setPullingProduction] = useState(false);
  const perspective = useMemo(() => parseProposalListPerspective(searchString), [searchString]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { hasCapability } = useDebugAuth();
  const canDeleteProposals = hasCapability("proposals_delete");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    setQInput(view.q);
  }, [view.q]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [searchString]);

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

  const writePerspective = (next: ProposalListPerspective) => {
    const qs = withProposalListPerspective(searchString, next);
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
    const user = view.filters.proposerUsername.trim();
    if (user) parts.push(`Proposer ${user}`);
    if (view.filters.proposerActorType !== "all") {
      parts.push(
        PROPOSAL_ACTOR_TYPE_OPTIONS.find((o) => o.value === view.filters.proposerActorType)?.label ??
          view.filters.proposerActorType,
      );
    }
    const role = view.filters.proposerActorRole.trim();
    if (role) parts.push(role);
    const session = view.filters.agentSessionId.trim();
    if (session) {
      parts.push(`Session ${session.length > 8 ? `${session.slice(0, 8)}…` : session}`);
    }
    const reviewer = view.filters.reviewerUsername.trim();
    if (reviewer) parts.push(`Reviewer ${reviewer}`);
    if (view.filters.escalatedOnly) parts.push("Escalated");
    if (view.filters.outcomeFocus === "bad") parts.push("Bad outcome (needs lesson)");
    if (view.filters.outcomeFocus === "missing") parts.push("Missing outcome review");
    if (view.filters.attention !== "all") {
      parts.push(
        PROPOSAL_ATTENTION_OPTIONS.find((o) => o.value === view.filters.attention)?.label ??
          view.filters.attention,
      );
    }
    return parts.join(" · ");
  }, [
    view.filters.status,
    view.filters.kind,
    view.filters.proposerUsername,
    view.filters.proposerActorType,
    view.filters.proposerActorRole,
    view.filters.agentSessionId,
    view.filters.reviewerUsername,
    view.filters.escalatedOnly,
    view.filters.outcomeFocus,
    view.filters.attention,
  ]);

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
  const selectionActive = perspective === "table" && selectedIds.size > 0;
  const proposalHref = (id: string) =>
    listSearch ? `${AGENTS_PROPOSALS_BASE}/${id}?${listSearch}` : `${AGENTS_PROPOSALS_BASE}/${id}`;

  const runBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const titles = new Map(proposals.map((p) => [p.id, p.title]));
    setBulkDeleting(true);
    try {
      const res = await apiRequestWithAuth("POST", "/api/admin/proposals/bulk-delete", { ids });
      const body = (await res.json()) as { results?: ProposalBulkDeleteResult[] };
      const summary = summarizeProposalBulkDelete(body.results ?? [], (id) => titles.get(id));
      setBulkDeleteOpen(false);
      setSelectedIds(new Set());
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/proposals"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/proposals/kpis"] });
      toast({
        title: summary.headline,
        description: summary.details.length ? summary.details.join(" ") : undefined,
        variant: summary.deleted === 0 && (summary.blocked || summary.failed) ? "destructive" : undefined,
      });
    } catch (err) {
      toast({
        title: "Could not delete proposals",
        description: err instanceof Error ? err.message : "Delete failed.",
        variant: "destructive",
      });
    } finally {
      setBulkDeleting(false);
    }
  };

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
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/proposals/kpis"] });
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
      <ProposalKpiStrip
        kindFilter={view.filters.kind}
        statusFilter={view.filters.status}
        stalledOnly={view.filters.stalledOnly}
        needsReviewOnly={view.filters.needsReviewOnly}
        stats={data?.stats}
        headers={headers}
        onKindClick={(kind) =>
          writeView({
            filters: { ...view.filters, kind },
            q: view.q,
          })
        }
        onStatusClick={(status) =>
          writeView({
            filters: { ...view.filters, status },
            q: view.q,
          })
        }
        onStalledClick={() =>
          writeView({
            filters: {
              ...view.filters,
              stalledOnly: !view.filters.stalledOnly,
              needsReviewOnly: false,
              kind: "idea",
              status: "finished",
              attention: "all",
            },
            q: view.q,
          })
        }
        onNeedsReviewClick={() => {
          const next = !view.filters.needsReviewOnly;
          writeView({
            filters: {
              ...view.filters,
              needsReviewOnly: next,
              ...(next
                ? {
                    kind: "edits" as const,
                    stalledOnly: false,
                    attention: "all" as const,
                    sort: "attention" as const,
                    sortDir: "desc" as const,
                  }
                : {}),
            },
            q: view.q,
          });
        }}
        trailing={
          <EventWebhooksKpiButton onClick={() => setLocation("/private/webhooks/hooks")} />
        }
      />
      {selectionActive ? (
        <ProposalBulkActionsBar
          count={selectedIds.size}
          canDelete={canDeleteProposals}
          deleting={bulkDeleting}
          onClear={() => setSelectedIds(new Set())}
          onDelete={() => setBulkDeleteOpen(true)}
        />
      ) : (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <IconSearch
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-9"
            placeholder="Search by title, author, or ID"
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 gap-1.5"
              title="List perspective"
              data-testid="button-list-perspective"
            >
              {perspective === "table" ? (
                <IconTable className="h-4 w-4" />
              ) : (
                <IconLayoutList className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">{perspective === "table" ? "Table" : "Cards"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(
              [
                { value: "cards", label: "Cards", Icon: IconLayoutList },
                { value: "table", label: "Table", Icon: IconTable },
              ] as const
            ).map(({ value, label, Icon }) => (
              <DropdownMenuItem
                key={value}
                className="gap-2"
                onClick={() => writePerspective(value)}
                data-testid={`menu-perspective-${value}`}
              >
                <IconCheck
                  className={cn("h-3.5 w-3.5", perspective === value ? "opacity-100" : "opacity-0")}
                />
                <Icon className="h-4 w-4" />
                {label}
              </DropdownMenuItem>
            ))}
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
      )}
      <ProposalBulkDeleteDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!bulkDeleting) setBulkDeleteOpen(open);
        }}
        count={selectedIds.size}
        deleting={bulkDeleting}
        onConfirm={() => void runBulkDelete()}
      />
      <ProposalListFiltersDialog
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={view.filters}
        stats={data?.stats}
        onApply={(dims) =>
          writeView({
            filters: { ...view.filters, ...dims },
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
          {perspective === "table" ? (
            proposals.length > 0 ? (
              <ProposalListTable
                proposals={proposals}
                selected={selectedIds}
                hrefFor={proposalHref}
                onToggle={(id, checked) =>
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (checked) next.add(id);
                    else next.delete(id);
                    return next;
                  })
                }
                onToggleAll={(checked) =>
                  setSelectedIds(checked ? new Set(proposals.map((p) => p.id)) : new Set())
                }
              />
            ) : null
          ) : (
            <div className="space-y-2.5">
              {proposals.map((p) => (
                <ProposalListCard key={p.id} proposal={p} href={proposalHref(p.id)} />
              ))}
            </div>
          )}
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
                      Try broader filters or clear the search to see everything.
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

function PortalInto({ target, children }: { target: HTMLElement | null; children: ReactNode }) {
  return target ? createPortal(children, target) : <>{children}</>;
}

type ProposalDetailPayload = {
  proposal: Proposal;
  review_context?: ReviewContextPayload | null;
  content_type_strategies?: IdeaContentTypeStrategyPayload[];
  deleted_refs?: string[];
  referenced_proposals?: Record<string, ImplementsIdeaSummary>;
};

export function ProposalDetailPanel({
  id,
  layout = "page",
  onClose,
  onProposalChange,
  onViewLive,
  onReloadPreview,
  previewEntry,
  actionBarTarget,
}: {
  id: string;
  /** `drawer`: compact digest for the draft preview drawer (phone-width). */
  layout?: "page" | "drawer";
  onClose?: () => void;
  /** Drawer: a follow-up proposal (revert) replaces this one without leaving the preview. */
  onProposalChange?: (id: string) => void;
  onViewLive?: () => void;
  /** Drawer: reload the page preview after the reviewer accepts a newer proposal version. */
  onReloadPreview?: () => void;
  previewEntry?: ProposalPreviewEntry;
  /** Drawer: element pinned under the scroll area that hosts the decision buttons. */
  actionBarTarget?: HTMLElement | null;
}) {
  const isDrawer = layout === "drawer";
  const { toast } = useToast();
  const qc = useQueryClient();
  const { roles } = useDebugAuth();
  const isSteward = roles.includes("platform_steward");
  const searchString = useSearch();
  const outcomesBack = outcomesBackHref(searchString);
  const backHref = outcomesBack ?? proposalsListHref(searchString);
  const [blockerBody, setBlockerBody] = useState("");
  const [resolveNotes, setResolveNotes] = useState<Record<number, string>>({});
  const [confirmExperiment, setConfirmExperiment] = useState(false);
  const [confirmBaseUnknown, setConfirmBaseUnknown] = useState(false);
  const [textLimitViolations, setTextLimitViolations] = useState<TextLimitViolation[] | null>(null);
  const [, setDetailLocation] = useLocation();
  const [advanced, setAdvanced] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [activityAck, setActivityAck] = useState(false);
  const [affectedAck, setAffectedAck] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState<ProposalCloseReasonValue>("wont_fix");
  const [closeNote, setCloseNote] = useState("");
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [acceptNextStep, setAcceptNextStep] = useState("");
  const [acceptContentType, setAcceptContentType] = useState("");
  const [acceptSlug, setAcceptSlug] = useState("");
  const [acceptLocale, setAcceptLocale] = useState("");
  const [acceptUrlSlug, setAcceptUrlSlug] = useState("");
  const [acceptSlugAck, setAcceptSlugAck] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectPending, setRejectPending] = useState(false);
  const [rejectKind, setRejectKind] = useState<ProposalRejectKindValue>("bad_idea");
  const [rejectNote, setRejectNote] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawNote, setWithdrawNote] = useState("");
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateNote, setEscalateNote] = useState("");
  const [deescalateOpen, setDeescalateOpen] = useState(false);
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

  const { data: liveData, isLoading, error: detailError } = useQuery({
    queryKey: ["/api/admin/proposals", id],
    refetchInterval: isDrawer ? 60_000 : false,
    refetchOnWindowFocus: isDrawer ? "always" : undefined,
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/proposals/${id}`, { headers: headers() });
      if (res.status === 410) {
        const body = (await res.json().catch(() => ({}))) as {
          deleted_by?: string;
          deleted_at?: string;
        };
        throw Object.assign(new Error("Proposal was deleted"), {
          deleted: { by: body.deleted_by ?? "staff", at: body.deleted_at ?? null },
        });
      }
      if (!res.ok) throw new Error("Not found");
      return res.json() as Promise<ProposalDetailPayload>;
    },
  });
  // Drawer renders the version the reviewer opened; newer server copies only raise the stale banner.
  const [snapshot, setSnapshot] = useState<ProposalDetailPayload | null>(null);
  const adoptNextRef = useRef(false);
  useEffect(() => {
    if (!isDrawer || !liveData) return;
    if (!snapshot || snapshot.proposal.id !== liveData.proposal.id || adoptNextRef.current) {
      adoptNextRef.current = false;
      setSnapshot(liveData);
    }
  }, [isDrawer, liveData, snapshot]);
  const data = isDrawer ? (snapshot ?? liveData) : liveData;
  const drawerStale = Boolean(
    isDrawer &&
      snapshot &&
      liveData &&
      liveData.proposal.id === snapshot.proposal.id &&
      (liveData.proposal.updated_at ?? 0) !== (snapshot.proposal.updated_at ?? 0),
  );
  const reloadDrawer = () => {
    if (liveData) setSnapshot(liveData);
    onReloadPreview?.();
  };
  const deletedInfo = (detailError as { deleted?: { by: string; at: string | null } } | null)
    ?.deleted;
  const deletedRefs = new Set(data?.deleted_refs ?? []);
  const referencedProposals = data?.referenced_proposals ?? {};
  const [entriesExpandedFor, setEntriesExpandedFor] = useState<string | null>(null);
  const showAllEntries = entriesExpandedFor === id;

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
      adoptNextRef.current = true;
      qc.invalidateQueries({ queryKey: ["/api/admin/proposals"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/entry-activity-count"] });
      qc.invalidateQueries({ queryKey: ["/api/versioning"] });
      toast({ title: "Updated" });
      if (json.warnings?.length) {
        toast({
          title: plainWarningTitle(json.warnings as ProposalWarning[]),
          variant: "default",
        });
      }
    },
    onError: (
      e: Error & {
        data?: { code?: string; traffic_siblings?: unknown; details?: { property_path?: string; message?: string } };
      },
    ) => {
      const code = e.data?.code;
      const plainByCode: Record<string, string> = {
        entry_not_found:
          "That page (or draft) does not exist yet — create the page/draft first, or file an idea instead of edits.",
        sections_required:
          "This new page or language has no sections yet. The proposal must include the whole page layout (translated, for a new language).",
        invalid_sections: plainSectionIssue(e.data?.details),
        empty_page:
          "This page would publish empty — it has no sections. Add sections before publishing.",
        mixed_risk_bundle:
          "This proposal mixes different risk levels (for example selling pages with other edits). Split into separate proposals.",
        competing_entry_edits:
          "Another open edits proposal already targets this same page. Join that one, or reject the weaker proposal first.",
        target_missing:
          "The page this proposal edits no longer exists — apply is blocked. Reject or withdraw, or restore the page and file fresh.",
        legacy_version:
          "This proposal was filed before proposals 1.0 and can only be withdrawn or rejected. File a new proposal for this change.",
        context_stale:
          "The live page changed after this draft was made. It went back to the author to update — nothing was published.",
        draft_missing:
          "The draft for this page no longer exists, so nothing was published. The author needs to revise the proposal.",
        four_eyes_co_author:
          "You edited this draft directly, so you count as a co-author. Someone else must approve it.",
        all_or_nothing_blocked:
          "This proposal publishes all pages or none, and at least one page cannot be published yet. Nothing was published.",
        competing_shared_fields:
          "Another open proposal already changes the same whole-page fields. Finish or close that one first.",
        draft_in_proposal:
          "That draft already belongs to another open proposal.",
        variant_has_traffic:
          "That version is receiving visitor traffic, so it cannot be used as a proposal draft.",
        revert_conflicts:
          "Some fields changed again after this proposal was applied, so they cannot be reverted automatically.",
        nothing_to_revert: "There is nothing left to revert on this proposal.",
        not_applied: "Only applied proposals can be reverted.",
        confirm_affected_entries:
          "The number of pages this template change reaches has changed. Reload and confirm again.",
        text_limits_exceeded:
          "Some text is longer than this section allows. Nothing was published — review it and shorten it, or publish anyway.",
        locale_url_slug_required:
          "This new language needs its own web address before it goes live. Ask the author to add a slug.",
        url_slug_required:
          "This page already exists in another language. Fill in the web address for this language, then accept.",
        idea_url_slug_conflict:
          "These edits use a different web address than the idea locked. The author must use the locked address or explain why.",
        slug_locale_mismatch:
          "This web address looks like another language. Pick one in this language, or tick “Keep it” if it is a name.",
        slug_already_owned_by_other_entry:
          "Another page already uses this web address in this language. Pick a different one.",
        invalid_locale_slug: "Web addresses use lowercase letters, numbers, and hyphens only.",
        idea_seo_target_required:
          "This new page needs an SEO target (keyword and topic hub) before it can be accepted.",
        idea_seo_target_frozen: "The SEO target locked when the idea was accepted.",
        idea_seo_target_standalone_not_allowed:
          "“No hub” is only for news or broken-URL ideas. Pick a hub, or make this page a hub.",
        idea_seo_target_hub_not_live:
          "That hub is not live, is in another language, or is not a hub. Pick a live hub in the same language.",
        idea_seo_target_hub_members_required:
          "Name at least one live post in the same language that will join this hub.",
        idea_seo_target_keyword_taken:
          "Another live page or accepted idea already targets this keyword. Pick a different keyword or improve that page.",
        idea_seo_target_conflict:
          "These edits change the idea's keyword or hub. Match the idea, or give a reason for the change.",
        idea_seo_target_hub_gone:
          "The idea's hub was deleted. Nothing was published — pick another live hub and give a reason.",
        locale_seo_target_required:
          "This new language needs its own keyword and a hub in the same language before it goes live.",
        seo_index_unavailable: "The SEO index could not be read. Nothing changed — try again shortly.",
      };
      const emptyPage = e.message.includes("EMPTY_PAGE") ? plainByCode.empty_page : undefined;
      toast({
        title: (code && plainByCode[code]) || emptyPage || e.message,
        variant: "destructive",
      });
      if (e.data?.code === "confirm_end_experiment") {
        setConfirmExperiment(true);
        setApplyOpen(true);
      }
      if (e.data?.code === "confirm_recent_activity") {
        setApplyOpen(true);
        setActivityAck(false);
      }
      if (e.data?.code === "draft_base_unknown") {
        setConfirmBaseUnknown(true);
        setApplyOpen(true);
      }
      if (e.data?.code === TEXT_LIMITS_EXCEEDED_CODE) {
        const entries = (e.data.details as { entries?: Array<{ locale?: string; violations?: TextLimitViolation[] }> } | undefined)
          ?.entries ?? [];
        setTextLimitViolations(
          entries.flatMap((entry) =>
            (entry.violations ?? []).map((v) =>
              entries.length > 1 && entry.locale ? { ...v, label: `${v.label} (${entry.locale})` } : v,
            ),
          ),
        );
        setApplyOpen(true);
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
    const note = rejectNote.trim();
    if (note.length < REJECT_NOTE_MIN) return;
    const kind = rejectKind;
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
      mutRef.current.mutate({
        action: "reject",
        body: {
          confirm_reject: true,
          reject_kind: kind,
          close_note: note,
        },
      });
      setRejectNote("");
    }, REJECT_UNDO_MS);
  };

  const p = data?.proposal;
  const reviewContext = data?.review_context ?? null;
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
  const progress = p && p.kind === "edits" ? proposalEntryProgress(p.entries ?? []) : null;
  // Resolve enabled when any staff holds claim — server enforces claimant match via session author.
  const canResolveUi = Boolean(claimActive);
  const isTerminal =
    p != null &&
    (p.status === "finished" || p.status === "rejected" || p.status === "withdrawn");
  const blockersOpen = (p?.open_blocker_count ?? 0) > 0;
  const showPrimaryEdits = Boolean(p && p.kind === "edits" && !isTerminal);
  const showPrimaryNotes = Boolean(p && p.kind === "notes" && p.status === "open");
  const showPrimaryIdeas = Boolean(p && p.kind === "idea" && p.status === "open");
  const showBlockersSection = Boolean(p && (p.kind === "edits" || p.kind === "idea"));
  const drawerApproveInline = !isDrawer || Boolean(p && canApproveInDrawer(p, previewEntry));
  const drawerEntry = isDrawer && previewEntry && p ? p.entries.find((e) => sameDraft(e, previewEntry)) : undefined;
  const otherDrafts = isDrawer && p ? p.entries.filter((e) => e !== drawerEntry) : [];
  const viewerUsername = getDebugUserName().trim();
  const isProposer =
    Boolean(viewerUsername) &&
    Boolean(p?.proposer_username) &&
    viewerUsername.toLowerCase() === p!.proposer_username.trim().toLowerCase();
  // Known identity: proposer sees Withdraw only; others see Reject (edits/ideas). Unknown: keep both.
  // Staff UI can always Accept ideas (UI identity ≠ MCP role).
  const viewerKnown = Boolean(viewerUsername);
  const showReject = Boolean(
    p &&
      (p.kind === "edits" || p.kind === "idea") &&
      !isTerminal &&
      (!viewerKnown || !isProposer),
  );
  const showWithdraw = Boolean(p && !isTerminal && (!viewerKnown || isProposer));
  const primaryActionLabel = !p
    ? ""
    : p.kind === "idea"
      ? "Accept idea"
      : p.kind === "notes"
        ? "Close this proposal"
        : p.promote_on_apply || p.review_mode === "draft_backed"
          ? confirmExperiment
            ? "Confirm end experiment & make draft live"
            : "Approve and make draft live"
          : "Apply changes";
  const closeReasonOptions =
    p?.kind === "idea" ? IDEA_PARK_CLOSE_REASON_OPTIONS : PROPOSAL_CLOSE_REASON_OPTIONS;
  const closeNoteOk =
    !closeNoteRequired(closeReason) || closeNote.trim().length >= CLOSE_NOTE_MIN;
  const closeNoteHint = closeNoteRequired(closeReason)
    ? minLengthHint(closeNote, CLOSE_NOTE_MIN)
    : null;
  const acceptNextStepOk = acceptNextStep.trim().length >= ACCEPT_NEXT_STEP_MIN;
  const acceptEntryOk =
    acceptContentType.trim().length > 0 &&
    acceptSlug.trim().length > 0 &&
    acceptLocale.trim().length > 0;
  const acceptNextStepHint =
    acceptNextStep.trim().length > 0 ? minLengthHint(acceptNextStep, ACCEPT_NEXT_STEP_MIN) : null;
  const acceptAddress = acceptUrlSlug.trim() || acceptSlug.trim();
  const acceptAddressCheck = acceptAddress ? assessSlugLocaleMatch(acceptAddress, acceptLocale) : null;
  const acceptAddressHint =
    acceptAddressCheck && !acceptAddressCheck.ok ? slugLocaleMismatchHint(acceptAddressCheck) : null;
  const blockerHint =
    blockerBody.trim().length > 0 ? minLengthHint(blockerBody, 80) : null;
  const rejectNoteOk = rejectNote.trim().length >= REJECT_NOTE_MIN;
  const rejectNoteHint =
    rejectNote.trim().length > 0 ? minLengthHint(rejectNote, REJECT_NOTE_MIN) : null;
  const withdrawNoteOk = withdrawNote.trim().length >= CLOSE_NOTE_MIN;
  const withdrawNoteHint =
    withdrawNote.trim().length > 0 ? minLengthHint(withdrawNote, CLOSE_NOTE_MIN) : null;
  const escalateNoteOk = escalateNote.trim().length >= CLOSE_NOTE_MIN;
  const escalateNoteHint =
    escalateNote.trim().length > 0 ? minLengthHint(escalateNote, CLOSE_NOTE_MIN) : null;
  const closeReasonLabel =
    p?.close_reason === "accepted"
      ? "Accepted"
      : PROPOSAL_CLOSE_REASON_OPTIONS.find((o) => o.value === p?.close_reason)?.label ??
        (p?.status === "rejected" ? rejectKindLabel(p.close_reason) : p?.close_reason);

  const drawerOrder = (n: number) => (isDrawer ? { order: n } : undefined);
  const drawerOutcome = isDrawer && p && isTerminal ? p.status : null;

  return (
    <div
      className={cn("@container", isDrawer ? "flex flex-col gap-4 [&>*]:order-5" : "space-y-5")}
      data-testid="panel-agents-proposal-detail"
      data-layout={layout}
    >
      {!isDrawer ? (
        <Button variant="ghost" asChild className="-ml-2 h-10 gap-1.5 px-3 text-sm text-muted-foreground">
          <Link href={backHref} data-testid="link-proposal-detail-back">
            <IconChevronLeft className="h-5 w-5" />
            {outcomesBack ? "All outcomes" : "All proposals"}
          </Link>
        </Button>
      ) : null}
      {isDrawer && p && !isTerminal ? (
        <div style={drawerOrder(0)} className="space-y-2" data-testid="proposal-drawer-intro">
          <p className="text-sm leading-6 text-muted-foreground">
            This draft is part of a proposal. Read why it was proposed, check blockers, then approve or ask for
            changes.
          </p>
          {drawerStale ? (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-away/40 bg-status-away/10 px-3 py-2 text-sm"
              data-testid="banner-proposal-drawer-stale"
            >
              <p className="text-foreground">
                This proposal was updated since you opened it. Reload to see the latest before approving.
              </p>
              <Button size="sm" variant="outline" onClick={reloadDrawer} data-testid="button-proposal-drawer-reload">
                Reload
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {drawerOutcome ? (
        <div
          style={drawerOrder(0)}
          className="space-y-3 rounded-md border border-card-border bg-muted/40 px-3 py-3 text-sm"
          data-testid="proposal-drawer-outcome"
        >
          {drawerOutcome === "finished" ? (
            <p className="flex items-start gap-2 text-foreground">
              <IconCircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-online" aria-hidden />
              Published. The draft is now live.
            </p>
          ) : (
            <p className="flex items-start gap-2 text-foreground">
              <IconBan className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              Proposal closed. This draft is no longer under review; it stays as a draft.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {drawerOutcome === "finished" && onViewLive ? (
              <Button size="sm" onClick={onViewLive} data-testid="button-proposal-drawer-view-live">
                <IconExternalLink className="h-4 w-4" aria-hidden />
                View live page
              </Button>
            ) : null}
            {onClose ? (
              <Button size="sm" variant="outline" onClick={onClose} data-testid="button-proposal-drawer-close">
                Close
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {isLoading && (
        <Card className="space-y-3 p-5" data-testid="loading-proposal-detail">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </Card>
      )}
      {deletedInfo ? (
        <div
          className="flex flex-col items-center gap-3 rounded-card border border-dashed border-card-border px-6 py-12 text-center"
          data-testid="proposal-deleted-state"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <IconBan className="h-5 w-5" aria-hidden />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium">Deleted proposal</p>
            <p className="text-xs text-muted-foreground">
              Deleted by {deletedInfo.by}
              {deletedInfo.at ? ` on ${new Date(deletedInfo.at).toLocaleString()}` : ""}. It can&apos;t
              be opened anymore.
            </p>
          </div>
        </div>
      ) : null}
      {p && mode && ui && (
        <>
          <Card className={cn("border-l-2", ui.accentClassName)} style={drawerOrder(1)}>
            <div className={cn("flex items-start gap-3", isDrawer ? "p-4" : "p-5")}>
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
                    className={cn("text-xs", ui.className)}
                  />
                  <ProposalKindBadge kind={p.kind} />
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
                    <BlockersBadge
                      count={p.open_blocker_count ?? 0}
                      labelMode="needs_changes"
                      flaggedAt={p.escalated ? null : p.blocked_flagged_at}
                    />
                  ) : null}
                  {p.escalated ? <EscalatedBadge /> : null}
                  <ProposalV1Badges
                    p={p}
                    revertsDeleted={Boolean(
                      p.reverts_proposal_id && deletedRefs.has(p.reverts_proposal_id),
                    )}
                  />
                </div>
                <h2
                  className={cn(
                    "font-semibold leading-tight tracking-tight",
                    isDrawer ? "text-base" : "text-xl",
                  )}
                >
                  {p.title}
                </h2>
                <div
                  className="flex flex-wrap items-center gap-2"
                  data-testid="proposal-identity-row"
                >
                  <ProposalCategoryTags
                    category={p.category}
                    kind={p.kind}
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
                {p.escalated ? (
                  <div
                    className="rounded-md border border-status-busy/30 bg-status-busy/5 px-3 py-2 text-sm text-foreground"
                    data-testid="banner-proposal-escalated"
                  >
                    <p className="font-medium text-status-busy">Agent work is paused</p>
                    <p className="mt-1 text-muted-foreground">
                      A steward must release this hold before agents can claim, add blockers, or
                      decide again. Staff can still Approve, Reject, or clear needs-change notes.
                      Open blockers still block Approve until someone resolves them.
                    </p>
                    {p.escalated_note ? (
                      <p className="mt-2 text-sm" data-testid="text-escalated-note">
                        <span className="font-medium">Why: </span>
                        {p.escalated_note}
                        {p.escalated_by ? (
                          <span className="text-muted-foreground"> — {p.escalated_by}</span>
                        ) : null}
                      </p>
                    ) : null}
                    <Collapsible className="mt-2">
                      <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                        Read more (advanced)
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-1 text-xs text-muted-foreground space-y-1">
                        <p>
                          Escalated is a flag on top of Open/Partial — the proposal status does not
                          change.
                        </p>
                        <p>
                          MCP agents fail every update while the flag is on; staff UI actions still
                          work.
                        </p>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                ) : p.escalated_note && !isTerminal ? (
                  <div
                    className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                    data-testid="banner-proposal-escalated-history"
                  >
                    <p className="font-medium text-foreground">Previous steward hold</p>
                    <p className="mt-1" data-testid="text-escalated-note-history">
                      {p.escalated_note}
                      {p.escalated_by ? ` — ${p.escalated_by}` : ""}
                    </p>
                  </div>
                ) : null}
                {!isTerminal ? (
                  <ProposalSituationCallout
                    reviewContext={reviewContext}
                    snapshot={p.review_context_snapshot}
                    kind={p.kind}
                    {...(p.kind === "edits" || p.kind === "idea"
                      ? {
                          filedSituations:
                            p.kind === "idea"
                              ? filedIdeaDemand(p.review_situations)
                              : (p.review_situations ?? []),
                          saving: mut.isPending,
                          onSaveSituations: (ids: string[]) =>
                            mut.mutate({
                              action: "set_review_situations",
                              body: { review_situations: ids },
                            }),
                        }
                      : {})}
                  />
                ) : null}
                {isTerminal && !isDrawer && p.decision_debug ? (
                  <DecisionDebugPanel debug={p.decision_debug} />
                ) : null}
                {isTerminal && !isDrawer ? (
                  <ProposalOutcomeReview
                    proposal={p}
                    isSteward={isSteward}
                    saving={mut.isPending}
                    onAction={(action, body, onSuccess) =>
                      mut.mutate({ action, body }, onSuccess ? { onSuccess } : undefined)
                    }
                  />
                ) : null}
                {p.kind === "edits" && p.implements_proposal_id ? (
                  <ImplementsIdeaCard
                    ideaId={p.implements_proposal_id}
                    ideaHref={`${AGENTS_PROPOSALS_BASE}/${p.implements_proposal_id}`}
                    idea={referencedProposals[p.implements_proposal_id]}
                    deleted={deletedRefs.has(p.implements_proposal_id)}
                  />
                ) : null}
                {p.kind === "edits" && p.entries.length > 0 && !isDrawer ? (
                  <div className="space-y-2">
                    <div
                      className="grid gap-2 @xl:grid-cols-2"
                      data-testid="proposal-related-entries"
                    >
                      {(showAllEntries
                        ? p.entries
                        : p.entries.slice(0, ENTRY_CARDS_COLLAPSED_COUNT)
                      ).map((e) => {
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
                        return (
                          <ProposalEntryCard
                            key={e.id}
                            entry={e}
                            liveKey={liveKey}
                            draftKey={draftKey}
                            liveActivity={activityByKey.get(liveKey)}
                            draftActivity={draftKey ? activityByKey.get(draftKey) : undefined}
                            previewHref={previewHref(e)}
                            windowDays={ENTRY_ACTIVITY_WINDOW_DAYS}
                          />
                        );
                      })}
                    </div>
                    {p.entries.length > ENTRY_CARDS_COLLAPSED_COUNT ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-primary"
                        data-testid="button-show-more-entries"
                        onClick={() => setEntriesExpandedFor(showAllEntries ? null : id)}
                      >
                        {showAllEntries
                          ? "Show fewer pages"
                          : `Show ${p.entries.length - ENTRY_CARDS_COLLAPSED_COUNT} more ${
                              p.entries.length - ENTRY_CARDS_COLLAPSED_COUNT === 1 ? "page" : "pages"
                            }`}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {p.kind === "idea" && suggestedEntriesBesidesReserved(p).length > 0 ? (
                  <div
                    className="flex flex-wrap items-center gap-1.5"
                    data-testid="proposal-idea-related-entries"
                  >
                    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                      {suggestedEntriesBesidesReserved(p).length > 1 ? "Suggested pages" : "Suggested page"}
                      <IdeaPageInfoButton kind="suggested" />
                    </span>
                    {suggestedEntriesBesidesReserved(p).map((ref, i) => (
                      <Badge
                        key={`${ref.contentType}/${ref.slug}/${ref.locale ?? ""}-${i}`}
                        variant="outline"
                        className="gap-1 font-mono font-normal max-w-full truncate"
                        data-testid={`badge-idea-related-entry-${i}`}
                      >
                        <IconLink className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="inline-flex items-center gap-1 truncate">
                          <span className="truncate">
                            {ref.contentType}/{ref.slug}
                          </span>
                          {ref.locale ? (
                            <span
                              className="inline-flex shrink-0 text-muted-foreground"
                              title={ref.locale}
                              aria-label={ref.locale}
                            >
                              ·{" "}
                              <LocaleFlag locale={ref.locale} className="w-3.5 h-2.5 rounded-sm" />
                            </span>
                          ) : null}
                        </span>
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {p.kind === "idea" ? (
                  <IdeaTargetEntryCard
                    strategies={data?.content_type_strategies ?? []}
                    acceptedEntry={p.accepted_entry ?? null}
                    pitchedTypes={Array.from(new Set((p.related_entries ?? []).map((r) => r.contentType)))}
                    createModeNote={
                      p.accepted_entry_create_mode === "manual"
                        ? ACCEPTED_ENTRY_NOT_CREATABLE_COPY
                        : p.accepted_entry_create_mode === "page"
                          ? ACCEPTED_ENTRY_NEEDS_LAYOUT_COPY
                          : null
                    }
                    reservedInfo={<IdeaPageInfoButton kind="reserved" />}
                    keywordsPanel={
                      <IdeaSeoTargetPanel
                        embedded
                        target={p.idea_seo_target}
                        editable={p.status === "open"}
                        locked={p.status === "finished" && p.close_reason === "accepted"}
                        reviewSituations={p.review_situations}
                        locale={p.accepted_entry?.locale ?? p.related_entries?.[0]?.locale ?? null}
                        pending={mut.isPending}
                        onSave={(target) =>
                          mut.mutate({ action: "set_idea_seo_target", body: { idea_seo_target: target } })
                        }
                      />
                    }
                    keywordsMissing={
                      !p.idea_seo_target && !(p.status === "finished" && p.close_reason === "accepted")
                    }
                    funnel={p.idea_funnel}
                    funnelLocked={p.status === "finished" && p.close_reason === "accepted"}
                    funnelEditable={p.status === "open"}
                    funnelPending={mut.isPending}
                    onFunnelSave={(idea_funnel) =>
                      mut.mutate({ action: "set_idea_funnel", body: { idea_funnel } })
                    }
                  />
                ) : null}
                {p.kind === "edits" && p.seo_target_override ? (
                  <div
                    className="rounded-md border border-card-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
                    data-testid="proposal-seo-target-override"
                  >
                    <span className="font-medium text-foreground">Changes the idea's SEO target.</span>{" "}
                    Reason: {p.seo_target_override.reason}
                  </div>
                ) : null}
                {!isDrawer ? (
                  <ProposalDetailMetaCard proposal={p} isTerminal={isTerminal} progress={progress} />
                ) : null}
              </div>
            </div>
            {!isTerminal ? (
              <PortalInto target={isDrawer ? actionBarTarget ?? null : null}>
              <div
                className={cn(
                  "flex flex-wrap items-center gap-2",
                  isDrawer ? "px-3 py-2.5" : "border-t border-card-border px-5 py-3",
                )}
                data-testid="proposal-action-bar"
              >
                {showPrimaryEdits && drawerApproveInline ? (
                  <Button
                    onClick={() => {
                      setActivityAck(false);
                      setApplyOpen(true);
                    }}
                    disabled={
                      mut.isPending ||
                      rejectPending ||
                      blockersOpen ||
                      Boolean(p.recent_activity_error) ||
                      drawerStale
                    }
                    title={drawerStale ? "Reload to see the latest version before approving." : undefined}
                    data-testid="button-apply-proposal"
                  >
                    <IconCheck className="h-4 w-4" aria-hidden />
                    {primaryActionLabel}
                  </Button>
                ) : null}
                {showPrimaryEdits && !drawerApproveInline ? (
                  <Button asChild variant="secondary" data-testid="link-approve-on-full-page">
                    <a href={`${AGENTS_PROPOSALS_BASE}/${p.id}`}>
                      <IconExternalLink className="h-4 w-4" aria-hidden />
                      {p.affected_entries
                        ? `Approve on the full proposal page (changes the shared layout on ${p.affected_entries.count} page${p.affected_entries.count === 1 ? "" : "s"})`
                        : `Approve on the full proposal page (publishes ${p.entries.length} draft${p.entries.length === 1 ? "" : "s"})`}
                    </a>
                  </Button>
                ) : null}
                {showPrimaryIdeas ? (
                  <Button
                    onClick={() => {
                      const rel = p?.related_entries?.[0];
                      setAcceptContentType(rel?.contentType ?? "");
                      setAcceptSlug(rel?.slug ?? "");
                      setAcceptLocale(rel?.locale ?? "");
                      setAcceptUrlSlug("");
                      setAcceptSlugAck(false);
                      setAcceptNextStep("");
                      setAcceptOpen(true);
                    }}
                    disabled={mut.isPending || rejectPending || blockersOpen}
                    data-testid="button-accept-idea"
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
                {showPrimaryIdeas ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCloseReason("wont_fix");
                      setCloseNote("");
                      setCloseOpen(true);
                    }}
                    disabled={mut.isPending || rejectPending}
                    data-testid="button-park-idea"
                  >
                    <IconX className="h-4 w-4" aria-hidden />
                    Close / park
                  </Button>
                ) : null}
                {isDrawer ? null : claimActive ? (
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
                {showPrimaryEdits || showPrimaryIdeas ? (
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
                {!isDrawer && isSteward && !isTerminal && !p.escalated ? (
                  <Button
                    variant="outline"
                    className="border-status-busy/40 text-status-busy"
                    onClick={() => {
                      setEscalateNote("");
                      setEscalateOpen(true);
                    }}
                    disabled={mut.isPending || rejectPending}
                    data-testid="button-escalate-proposal"
                  >
                    Escalate
                  </Button>
                ) : null}
                {!isDrawer && isSteward && p.escalated ? (
                  <Button
                    variant="outline"
                    onClick={() => setDeescalateOpen(true)}
                    disabled={mut.isPending || rejectPending}
                    data-testid="button-deescalate-proposal"
                  >
                    Release hold
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
                    onClick={() => setWithdrawOpen(true)}
                    disabled={mut.isPending || rejectPending}
                    data-testid="button-withdraw-proposal"
                  >
                    <IconBan className="h-4 w-4" aria-hidden />
                    Withdraw
                  </Button>
                ) : null}
                {blockersOpen && showReject ? (
                  <span className="text-xs text-muted-foreground">
                    {p.kind === "idea" ? "Accept" : "Approve"} is disabled while needs-changes items
                    are open. Reject Completely remains available.
                  </span>
                ) : blockersOpen ? (
                  <span className="text-xs text-muted-foreground">
                    {p.kind === "idea" ? "Accept" : "Approve"} is disabled while needs-changes items
                    are open.
                  </span>
                ) : null}
              </div>
              </PortalInto>
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

          {p.status === "finished" &&
          (p.kind === "notes" || p.kind === "idea") &&
          p.close_reason ? (
            <div
              className="flex items-start gap-2 rounded-md border border-card-border bg-muted/40 px-3 py-2.5 text-sm"
              data-testid="text-proposal-close-reason"
            >
              <IconCircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <p>
                {p.close_reason === "accepted" ? "Accepted" : `Closed as ${closeReasonLabel}`}
                {p.closed_by ? ` by ${p.closed_by}` : ""}
                {p.close_note ? `: ${p.close_note}` : ""}
              </p>
            </div>
          ) : null}

          {p.system_version &&
          p.kind === "edits" &&
          (p.status === "finished" || p.status === "partial") &&
          p.entries.some((e) => e.status === "done") ? (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-card-border bg-muted/40 px-3 py-2.5 text-sm"
              data-testid="panel-proposal-revert"
            >
              <p className="text-muted-foreground">
                Want to undo this? Revert opens a new proposal that puts back the values that were
                live before. Nothing changes until that proposal is approved.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={mut.isPending}
                onClick={() =>
                  mut.mutate(
                    { action: "revert" },
                    {
                      onSuccess: (json: { proposal?: { id?: string } }) => {
                        if (!json.proposal?.id) return;
                        if (isDrawer && onProposalChange) onProposalChange(json.proposal.id);
                        else setDetailLocation(`${AGENTS_PROPOSALS_BASE}/${json.proposal.id}`);
                      },
                    },
                  )
                }
                data-testid="button-revert-proposal"
              >
                Revert
              </Button>
            </div>
          ) : null}

          {p.applies_after_proposal_id || p.applied_before_proposal_ids?.length ? (
            <div
              className="space-y-1.5 rounded-md border border-card-border bg-muted/40 px-3 py-2.5 text-sm"
              data-testid="panel-proposal-chain"
            >
              {p.applies_after_proposal_id ? (
                <p>
                  Publishes after{" "}
                  <Link
                    href={`${AGENTS_PROPOSALS_BASE}/${p.applies_after_proposal_id}`}
                    className="text-primary underline-offset-2 hover:underline"
                    data-testid="link-applies-after-proposal"
                  >
                    proposal {p.applies_after_proposal_id.slice(0, 8)}
                  </Link>
                  . It cannot be approved until that one is fully live.
                </p>
              ) : null}
              {p.applied_before_proposal_ids?.length ? (
                <p>
                  {p.applied_before_proposal_ids.length === 1 ? "1 proposal waits" : `${p.applied_before_proposal_ids.length} proposals wait`}{" "}
                  on this one:{" "}
                  {p.applied_before_proposal_ids.map((depId, i) => (
                    <span key={depId}>
                      {i > 0 ? ", " : ""}
                      <Link
                        href={`${AGENTS_PROPOSALS_BASE}/${depId}`}
                        className="text-primary underline-offset-2 hover:underline"
                        data-testid={`link-applied-before-proposal-${depId}`}
                      >
                        {depId.slice(0, 8)}
                      </Link>
                    </span>
                  ))}
                  . Approving this one does not approve them — approve them right after it is live.
                </p>
              ) : null}
            </div>
          ) : null}

          {p.status === "rejected" && (p.close_reason || p.close_note) ? (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
              data-testid="text-proposal-reject-reason"
            >
              <IconCircleX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <div className="space-y-1">
                <p>
                  Rejected
                  {p.close_reason ? ` — ${rejectKindLabel(p.close_reason)}` : ""}
                  {p.closed_by ? ` by ${p.closed_by}` : ""}
                  {p.close_note ? `: ${p.close_note}` : ""}
                </p>
                {p.replaced_by_proposal_id && deletedRefs.has(p.replaced_by_proposal_id) ? (
                  <p
                    className="text-muted-foreground"
                    title={p.replaced_by_proposal_id}
                    data-testid="text-replaced-by-proposal-deleted"
                  >
                    Replacement: Deleted proposal
                  </p>
                ) : p.replaced_by_proposal_id ? (
                  <p>
                    <Link
                      href={`${AGENTS_PROPOSALS_BASE}/${p.replaced_by_proposal_id}`}
                      className="text-primary underline-offset-2 hover:underline"
                      data-testid="link-replaced-by-proposal"
                    >
                      Open replacement proposal
                    </Link>
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {p.status === "withdrawn" && p.close_note ? (
            <div
              className="flex items-start gap-2 rounded-md border border-card-border bg-muted/40 px-3 py-2.5 text-sm"
              data-testid="text-proposal-withdraw-note"
            >
              <IconBan className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <p>
                Withdrawn{p.closed_by ? ` by ${p.closed_by}` : ""}: {p.close_note}
              </p>
            </div>
          ) : null}

          {!isTerminal &&
          !isDrawer &&
          (p.kind === "notes" ||
            p.kind === "idea" ||
            p.review_mode === "draft_backed" ||
            p.promote_on_apply ||
            p.review_mode === "soft_variant" ||
            p.entries.some((e) => e.variant)) ? (
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
            ) : p.kind === "idea" ? (
              <p>
                This is a brief, not a publish. Accept greenlights the idea with a next step.
                Needs-change notes block Accept until cleared. A different agent role — or this staff
                UI — can Accept. Agents pick a role under MCP Server → Connection. Park (Close) if you
                are stopping tracking without greenlighting.
              </p>
            ) : p.review_mode === "draft_backed" || p.promote_on_apply ? (
              <p>
                This proposal includes a prepared draft. Preview that version before you approve or
                reject. Approving makes that draft the live page for this locale. Open needs-changes
                items block approve; clearing them still requires a fresh preview — resolving means the
                acceptance criteria were met, not “I disagree.”
              </p>
            ) : (
              <p>
                Soft suggestion on a draft. Approving writes the proposed field changes into that draft —
                it does not go live. Preview the draft before deciding.
              </p>
            )}
          </div>
          ) : null}

          <Card className={cn("space-y-2", isDrawer ? "p-4" : "p-5")} style={drawerOrder(2)}>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {isDrawer
                ? "What and why"
                : p.kind === "notes"
                  ? "Handoff note"
                  : p.kind === "idea"
                    ? "Idea brief"
                    : "Summary"}
            </h3>
            {p.kind === "edits" ? (
              <p className="text-xs leading-5 text-muted-foreground">
                Intent and why — exact field values are in Proposed changes below.
              </p>
            ) : null}
            <ProposalMarkdown text={p.summary} className="text-sm" />
            {p.rationale?.trim() ? (
              <div className="space-y-1 border-t border-card-border pt-3" data-testid="proposal-rationale">
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {p.kind === "idea" ? "Evidence and sources" : "Why"}
                </h4>
                <ProposalMarkdown text={p.rationale.trim()} className="text-sm text-muted-foreground" />
              </div>
            ) : null}
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

          {p.kind === "edits" && p.entries.length > 0 && (!isDrawer || drawerEntry || p.affected_entries) && (
            <div className="space-y-3" style={drawerOrder(3)}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {isDrawer ? "What this draft changes" : `Proposed changes (${p.entries.length})`}
              </h3>
              {p.affected_entries ? (
                <div
                  className="space-y-1.5 rounded-md border border-card-border bg-muted/40 px-3 py-2.5 text-sm"
                  data-testid="panel-proposal-affected-entries"
                >
                  <p className="font-medium text-foreground">
                    Affects {p.affected_entries.count} page{p.affected_entries.count === 1 ? "" : "s"} that use this template
                  </p>
                  <p className="text-xs text-muted-foreground">
                    This changes the shared template, so every attached page in that language changes when it is
                    published. Pages detached from the template are not affected.
                  </p>
                  {p.affected_entries.sample.length ? (
                    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {p.affected_entries.sample.map((a) => (
                        <li key={`${a.contentType}:${a.slug}:${a.locale}`}>
                          <a
                            href={entryPreviewHref(a)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            Preview {a.slug}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {(isDrawer ? (drawerEntry ? [drawerEntry] : []) : p.entries).map((e) => {
                const href = previewHref(e);
                return (
                  <Card key={e.id} id={proposalEntryBlockId(e.id)} className="scroll-mt-4">
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
                          <RelatedEntryPopover
                            contentType={e.contentType}
                            slug={e.slug}
                            locale={e.locale}
                            variant={e.variant}
                            previewHref={href}
                            testId={`popover-proposed-entry-${e.id}`}
                          >
                            <span
                              className="truncate hover:underline underline-offset-2"
                              data-testid={`text-proposed-entry-${e.id}`}
                            >
                              {e.contentType}/{e.slug}
                            </span>
                          </RelatedEntryPopover>
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
                        {href && !isDrawer && (
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
                      {e.ops.length === 0 && !e.draft_missing && (p.promote_on_apply || p.review_mode === "draft_backed") && (
                        <p className="text-xs text-muted-foreground">
                          No field-diff list — the attached draft is the change. Preview it before approve.
                        </p>
                      )}
                      {p.system_version ? (
                        <ProposalDraftEntryDetails entry={e} />
                      ) : (
                        e.ops.map((op) => (
                          <ProposalFieldDiff
                            key={op.field_path}
                            fieldPath={op.field_path}
                            current={e.baseline_context.values[op.field_path]}
                            proposed={op.value}
                          />
                        ))
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {showBlockersSection ? (
            <Card style={drawerOrder(4)}>
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
                      <span>by {formatIssueActorLine(b.author, asIssueActor(b.author_actor))}</span>
                      <span aria-hidden className="text-muted-foreground/40">
                        ·
                      </span>
                      <span>{formatProposalRelativeUpdatedAt(b.created_at)}</span>
                      {!b.staff_summary?.trim() ? (
                        <>
                          <span aria-hidden className="text-muted-foreground/40">
                            ·
                          </span>
                          <span data-testid={`text-blocker-agent-only-${b.id}`}>Written for agents</span>
                        </>
                      ) : null}
                    </div>
                    {b.staff_summary?.trim() ? (
                      <>
                        <ProposalMarkdown text={b.staff_summary} />
                        {b.body.trim() !== b.staff_summary.trim() ? (
                          <Collapsible>
                            <CollapsibleTrigger
                              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                              data-testid={`button-blocker-technical-${b.id}`}
                            >
                              Technical details (for the agent)
                            </CollapsibleTrigger>
                            <CollapsibleContent className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                              <ProposalMarkdown text={b.body} />
                            </CollapsibleContent>
                          </Collapsible>
                        ) : null}
                      </>
                    ) : (
                      <ProposalMarkdown text={b.body} />
                    )}
                    {b.resolved_by ? (
                      <p className="text-xs text-muted-foreground">
                        Resolved by {formatIssueActorLine(b.resolved_by, asIssueActor(b.resolved_by_actor))}
                      </p>
                    ) : null}
                    {b.resolve_note ? (
                      <ProposalMarkdown
                        text={b.resolve_note}
                        className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground"
                      />
                    ) : null}
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
                {!isTerminal ? (
                <div
                  ref={addBlockerFormRef}
                  id="proposal-ask-for-changes"
                  className="space-y-2 border-t border-card-border pt-3"
                >
                  <p className="text-xs text-muted-foreground">
                    Say what’s wrong and what needs to change before this can be approved. Write it so a
                    teammate who hasn’t seen the code understands it (min 80 characters).
                  </p>
                  <Textarea
                    ref={addBlockerInputRef}
                    placeholder={"The idea works, but the draft has one problem.\n\n1. On draft …, X is wrong. It must be Y because …"}
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
                ) : null}
              </div>
            </Card>
          ) : null}

          {isDrawer && otherDrafts.length > 0 ? (
            <div className="space-y-2" style={drawerOrder(6)} data-testid="proposal-drawer-other-drafts">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Other drafts in this proposal ({otherDrafts.length})
              </h3>
              <p className="text-xs text-muted-foreground">
                Approving publishes these together with the draft on screen.
              </p>
              <ul className="space-y-1 text-sm">
                {otherDrafts.map((e) => (
                  <li key={e.id} className="flex items-center gap-1.5 min-w-0">
                    <LocaleFlag locale={e.locale} className="w-3.5 h-2.5 shrink-0 rounded-sm" />
                    {e.variant ? (
                      <a
                        href={proposalDraftPreviewHref({ ...e, variant: e.variant }, p.id)}
                        className="truncate text-primary hover:underline"
                        data-testid={`link-proposal-drawer-other-draft-${e.id}`}
                      >
                        {e.contentType}/{e.slug} · {e.variant}
                      </a>
                    ) : (
                      <span className="truncate text-muted-foreground">
                        {e.contentType}/{e.slug} (live page edit)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Collapsible open={advanced} onOpenChange={setAdvanced} style={drawerOrder(7)}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-auto px-0 text-xs text-muted-foreground">
                {advanced ? "Hide advanced" : "Read more (advanced)"}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="text-xs text-muted-foreground space-y-1">
              {isDrawer ? (
                <div className="space-y-2 pb-2 text-sm">
                  <ProposalDetailMetaCard proposal={p} isTerminal={isTerminal} progress={progress} />
                  {mode ? (
                    <p className="text-xs">
                      Review mode: <span className="font-medium text-foreground">{mode.label}</span>
                      {previewEntry ? ` · draft file ${previewEntry.variant}.${previewEntry.locale}.yml` : ""}
                    </p>
                  ) : null}
                </div>
              ) : null}
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
                        {p.all_or_nothing ? (
                          <p>All pages publish together. If any page cannot be published, nothing is published.</p>
                        ) : null}
                        {confirmBaseUnknown ? (
                          <p className="text-destructive" data-testid="apply-base-unknown-warning">
                            Some drafts have no recorded starting point, so changes made to the live
                            page since then cannot be detected. Confirming publishes the draft as-is
                            and may undo those changes.
                          </p>
                        ) : null}
                        {textLimitViolations ? (
                          <TextLimitsIssue
                            message="Some text is longer than this section allows. Long text crowds the page, especially on phones."
                            violations={textLimitViolations}
                            footer="Ask the author to shorten it, or publish anyway."
                          />
                        ) : null}
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
                    {p.affected_entries ? (
                      <label
                        className="flex items-start gap-2 rounded-md border border-card-border bg-muted/40 p-3 text-sm text-foreground cursor-pointer"
                        data-testid="apply-affected-entries-ack"
                      >
                        <Checkbox
                          checked={affectedAck}
                          onCheckedChange={(v) => setAffectedAck(v === true)}
                          className="mt-0.5"
                          data-testid="checkbox-affected-entries-ack"
                        />
                        <span>
                          I understand this changes {p.affected_entries.count} page
                          {p.affected_entries.count === 1 ? "" : "s"} that use the template.
                        </span>
                      </label>
                    ) : null}
                    {p.affected_entries && applyOpen ? <TemplatePlaceholderNotice proposalId={p.id} /> : null}
                    {applyOpen ? <ApplyDisplayChangeNotice proposalId={p.id} /> : null}
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
                    (needsActivityAck && !activityAck) ||
                    (Boolean(p.affected_entries) && !affectedAck)
                  }
                  onClick={() => {
                    const body: Record<string, unknown> = {};
                    if (confirmExperiment) body.confirm_end_experiment = true;
                    if (needsActivityAck) body.confirm_recent_activity = true;
                    if (confirmBaseUnknown) body.confirm_base_unknown = true;
                    if (textLimitViolations) body.confirm_text_limits = true;
                    if (p.affected_entries) body.confirm_affected_entries = p.affected_entries.count;
                    mut.mutate(
                      {
                        action: "apply",
                        body,
                      },
                      {
                        onSuccess: () => {
                          setApplyOpen(false);
                          setActivityAck(false);
                          setConfirmBaseUnknown(false);
                          setTextLimitViolations(null);
                        },
                      },
                    );
                  }}
                  data-testid="button-confirm-apply-proposal"
                >
                  <IconCheck className="h-4 w-4" aria-hidden />
                  {textLimitViolations ? "Publish anyway" : primaryActionLabel}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={claimOpen} onOpenChange={setClaimOpen}>
            <AlertDialogContent data-testid="dialog-claim-proposal">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {p.kind === "notes"
                    ? "Claim this handoff?"
                    : p.kind === "idea"
                      ? "Claim this idea?"
                      : "Claim this proposal?"}
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
                    ) : p.kind === "idea" ? (
                      <>
                        <p>
                          You are saying you are working the needs-change notes on this brief right now
                          (about 30 minutes). While your claim is active, only you can mark those notes
                          done.
                        </p>
                        <p>
                          This does not Accept or park the idea, and it does not change the live site.
                        </p>
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
              if (!open) {
                setRejectNote("");
                setRejectKind("bad_idea");
              }
            }}
          >
            <AlertDialogContent data-testid="dialog-reject-proposal">
              <AlertDialogHeader>
                <AlertDialogTitle>Reject this proposal?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      Reject only when this work must not ship (bad idea, illegal/policy, harmful,
                      impossible, duplicate, or page gone). If the idea is fine but needs polishing,
                      cancel and use Needs changes instead.
                    </p>
                    <p>
                      The live site does not change. After you confirm, you have 10 seconds to undo.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-3 py-1">
                <div className="space-y-1">
                  <Label htmlFor="proposal-reject-kind">Why reject</Label>
                  <Select
                    value={rejectKind}
                    onValueChange={(v) => setRejectKind(v as ProposalRejectKindValue)}
                  >
                    <SelectTrigger id="proposal-reject-kind" data-testid="select-reject-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROPOSAL_REJECT_KIND_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="proposal-reject-note">Note (min {REJECT_NOTE_MIN})</Label>
                  <Textarea
                    id="proposal-reject-note"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Why this must not ship — not polish instructions"
                    rows={4}
                    data-testid="input-reject-note"
                  />
                  {rejectNoteHint ? (
                    <p className={rejectNoteHint.className} data-testid="text-reject-note-length-hint">
                      {rejectNoteHint.text}
                    </p>
                  ) : null}
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-reject-proposal">
                  Cancel
                </AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={mut.isPending || rejectPending || !rejectNoteOk}
                  onClick={scheduleReject}
                  data-testid="button-confirm-reject-proposal"
                >
                  <IconCircleX className="h-4 w-4" aria-hidden />
                  Reject
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Dialog
            open={withdrawOpen}
            onOpenChange={(open) => {
              setWithdrawOpen(open);
              if (!open) setWithdrawNote("");
            }}
          >
            <DialogContent data-testid="dialog-withdraw-proposal">
              <DialogHeader>
                <DialogTitle>Withdraw this proposal?</DialogTitle>
                <DialogDescription>
                  Pulls it off the open list. Live content does not change. Leave a short note so others
                  know why.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1">
                <Label htmlFor="proposal-withdraw-note">Note (min {CLOSE_NOTE_MIN})</Label>
                <Textarea
                  id="proposal-withdraw-note"
                  value={withdrawNote}
                  onChange={(e) => setWithdrawNote(e.target.value)}
                  rows={3}
                  data-testid="input-withdraw-note"
                />
                {withdrawNoteHint ? (
                  <p className={withdrawNoteHint.className} data-testid="text-withdraw-note-length-hint">
                    {withdrawNoteHint.text}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setWithdrawOpen(false)}
                  data-testid="button-cancel-withdraw-proposal"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={mut.isPending || !withdrawNoteOk}
                  onClick={() => {
                    mut.mutate(
                      {
                        action: "withdraw",
                        body: { close_note: withdrawNote.trim() },
                      },
                      { onSuccess: () => setWithdrawOpen(false) },
                    );
                  }}
                  data-testid="button-confirm-withdraw-proposal"
                >
                  Withdraw
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={escalateOpen}
            onOpenChange={(open) => {
              setEscalateOpen(open);
              if (!open) setEscalateNote("");
            }}
          >
            <DialogContent data-testid="dialog-escalate-proposal">
              <DialogHeader>
                <DialogTitle>Escalate — pause agents</DialogTitle>
                <DialogDescription>
                  Agents stop claiming, blocking, and deciding on this proposal until a steward
                  releases the hold. Staff can still Approve or Reject. Open blockers still block
                  Approve until someone resolves them.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1">
                <Label htmlFor="proposal-escalate-note">Why (min {CLOSE_NOTE_MIN})</Label>
                <Textarea
                  id="proposal-escalate-note"
                  value={escalateNote}
                  onChange={(e) => setEscalateNote(e.target.value)}
                  rows={4}
                  placeholder="What went wrong with an agent interaction, and what must change before agents continue."
                  data-testid="input-escalate-note"
                />
                {escalateNoteHint ? (
                  <p className={escalateNoteHint.className} data-testid="text-escalate-note-length-hint">
                    {escalateNoteHint.text}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEscalateOpen(false)}
                  data-testid="button-cancel-escalate-proposal"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={mut.isPending || !escalateNoteOk}
                  onClick={() => {
                    mut.mutate(
                      {
                        action: "escalate",
                        body: { escalated_note: escalateNote.trim() },
                      },
                      { onSuccess: () => setEscalateOpen(false) },
                    );
                  }}
                  data-testid="button-confirm-escalate-proposal"
                >
                  Pause agents
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog open={deescalateOpen} onOpenChange={setDeescalateOpen}>
            <AlertDialogContent data-testid="dialog-deescalate-proposal">
              <AlertDialogHeader>
                <AlertDialogTitle>Release agent hold?</AlertDialogTitle>
                <AlertDialogDescription>
                  Agents may claim, add blockers, and decide again. Your last note stays on the card
                  for context until this proposal is finished, rejected, or withdrawn.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-deescalate-proposal">
                  Cancel
                </AlertDialogCancel>
                <Button
                  type="button"
                  disabled={mut.isPending}
                  onClick={() => {
                    mut.mutate(
                      { action: "deescalate" },
                      { onSuccess: () => setDeescalateOpen(false) },
                    );
                  }}
                  data-testid="button-confirm-deescalate-proposal"
                >
                  Release hold
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
                <DialogTitle>
                  {p.kind === "idea" ? "Park this idea?" : "Close this handoff?"}
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    {p.kind === "idea" ? (
                      <>
                        <p>
                          Parking removes this brief from the open list without greenlighting it. Pick
                          a reason so the next person knows why it stopped being tracked.
                        </p>
                        <p>
                          This does not change the live site. To greenlight instead, cancel and use
                          Accept idea.
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          Closing removes this reminder from the open list and marks it finished. Pick a
                          reason so the next person knows why it stopped being tracked.
                        </p>
                        <p>
                          This does not change the live site or complete linked issues. If “No auto-retry”
                          was on, closing also ends that block so agents can open another handoff for the
                          same issue.
                        </p>
                      </>
                    )}
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
                      {closeReasonOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {closeReasonOptions.find((o) => o.value === closeReason)?.hint}
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
                  {p.kind === "idea" ? "Park idea" : "Close handoff"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={acceptOpen}
            onOpenChange={(open) => {
              setAcceptOpen(open);
              if (!open) {
                setAcceptNextStep("");
                setAcceptContentType("");
                setAcceptSlug("");
                setAcceptLocale("");
                setAcceptUrlSlug("");
                setAcceptSlugAck(false);
              }
            }}
          >
            <DialogContent data-testid="dialog-accept-idea">
              <DialogHeader>
                <DialogTitle>Accept this idea?</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      You’re greenlighting this brief and reserving the page (and locale) this work
                      will use. Accepting finishes the idea — it does not publish or write YAML.
                    </p>
                    <p>
                      You also pick the web address this language will use. If this page already exists
                      in another language, it needs its own address word.
                    </p>
                    <p>Open needs-change notes must be cleared first.</p>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="proposal-accept-content-type">Content type</Label>
                  <Input
                    id="proposal-accept-content-type"
                    value={acceptContentType}
                    onChange={(e) => setAcceptContentType(e.target.value)}
                    placeholder="blog"
                    data-testid="input-accept-content-type"
                  />
                </div>
                <div className="space-y-1 sm:col-span-1">
                  <Label htmlFor="proposal-accept-slug">Slug</Label>
                  <Input
                    id="proposal-accept-slug"
                    value={acceptSlug}
                    onChange={(e) => setAcceptSlug(e.target.value)}
                    placeholder="what-is-grok"
                    data-testid="input-accept-slug"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="proposal-accept-locale">Locale</Label>
                  <Input
                    id="proposal-accept-locale"
                    value={acceptLocale}
                    onChange={(e) => setAcceptLocale(e.target.value)}
                    placeholder="en"
                    data-testid="input-accept-locale"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="proposal-accept-url-slug">Web address for this language</Label>
                <Input
                  id="proposal-accept-url-slug"
                  value={acceptUrlSlug}
                  onChange={(e) => {
                    setAcceptUrlSlug(e.target.value);
                    setAcceptSlugAck(false);
                  }}
                  placeholder={acceptSlug.trim() || "que-es-grok"}
                  data-testid="input-accept-url-slug"
                />
                <p className="text-xs text-muted-foreground">
                  The last part of this language&apos;s URL. Required when the page already exists in
                  another language, so it gets its own address word. Leave empty for a brand-new page to
                  use the slug above.
                </p>
                {acceptAddressHint ? (
                  <div className="space-y-1" data-testid="text-accept-url-slug-hint">
                    <p className="text-xs text-status-away">{acceptAddressHint}</p>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={acceptSlugAck}
                        onCheckedChange={(v) => setAcceptSlugAck(v === true)}
                        data-testid="checkbox-accept-slug-ack"
                      />
                      Keep it, it&apos;s a name that works in every language
                    </label>
                  </div>
                ) : null}
                <Collapsible>
                  <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                    Read more (advanced)
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-1 text-xs text-muted-foreground space-y-1">
                    <p>
                      Stored as <code>accepted_entry.url_slug</code>. The follow-up edit&apos;s draft is
                      seeded with it as <code>slug:</code> in <code>{"{locale}"}.yml</code>.
                    </p>
                    <p>
                      Slug stays the folder name, the page&apos;s ID in every language. A different
                      address later needs a written reason on the edit.
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              </div>
              <div className="space-y-1">
                <Label htmlFor="proposal-accept-next-step">Next step</Label>
                <Textarea
                  id="proposal-accept-next-step"
                  value={acceptNextStep}
                  onChange={(e) => setAcceptNextStep(e.target.value)}
                  placeholder="What should happen next (min 20 characters)"
                  data-testid="input-accept-next-step"
                />
                {acceptNextStepHint ? (
                  <p className={acceptNextStepHint.className} data-testid="text-accept-next-step-hint">
                    {acceptNextStepHint.text}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setAcceptOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={
                    mut.isPending ||
                    blockersOpen ||
                    !acceptNextStepOk ||
                    !acceptEntryOk ||
                    (acceptAddressHint !== null && !acceptSlugAck)
                  }
                  onClick={() => {
                    mut.mutate(
                      {
                        action: "accept",
                        body: {
                          next_step: acceptNextStep.trim(),
                          accepted_entry: {
                            contentType: acceptContentType.trim(),
                            slug: acceptSlug.trim(),
                            locale: acceptLocale.trim(),
                            ...(acceptUrlSlug.trim() ? { url_slug: acceptUrlSlug.trim() } : {}),
                            ...(acceptSlugAck ? { slug_language_ack: true } : {}),
                          },
                        },
                      },
                      {
                        onSuccess: () => {
                          setAcceptOpen(false);
                          setAcceptNextStep("");
                          setAcceptContentType("");
                          setAcceptSlug("");
                          setAcceptLocale("");
                          setAcceptUrlSlug("");
                          setAcceptSlugAck(false);
                        },
                      },
                    );
                  }}
                  data-testid="button-confirm-accept-idea"
                >
                  <IconCheck className="h-4 w-4" aria-hidden />
                  Accept idea
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
