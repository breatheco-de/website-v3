import { useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "wouter";
import {
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconLink,
  IconRocket,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { proposalStatusUi } from "@/lib/proposalStatusUi";
import {
  formatProposalRelativeUpdatedAt,
  proposalAttributionLines,
  proposalEntryProgress,
  shortProposalId,
} from "@/lib/proposalCardMeta";
import { AttentionBadge } from "@/components/agents/AttentionBadge";
import { BlockersBadge } from "@/components/agents/BlockersBadge";
import { EscalatedBadge } from "@/components/agents/EscalatedBadge";
import { ProposalV1Badges } from "@/components/agents/ProposalDraftBadges";
import {
  ProposalCategoryBadge,
  ProposalKindBadge,
  ProposalProgressLabel,
  ProposalStatusLabel,
} from "@/components/agents/ProposalExplainBadges";
import { SituationSnapshotBadge, resolveSituationDisplay } from "@/components/agents/SituationReviewBadge";

/** Wouter Link navigates unless defaultPrevented — use on badge / action clicks inside the card. */
function preventProposalCardNavigation(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

export type ProposalCardData = {
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
  resolved_blocker_count?: number;
  attention?: string | null;
  escalated?: boolean;
  escalated_note?: string | null;
  proposer_username: string;
  proposer_actor?: Record<string, unknown>;
  related_issue_ids: string[];
  entries: Array<{ status: string; variant: string | null }>;
  claim?: { by: string; expiresAt: string; actor?: Record<string, unknown> } | null;
  reviewer_action_at?: number | null;
  reviewer_action_by?: string | null;
  reviewer_action_by_actor?: Record<string, unknown>;
  closed_by?: string | null;
  close_reason?: string | null;
  system_version?: string | null;
  all_or_nothing?: boolean;
  stale_since?: string | null;
  stale_flagged_at?: string | null;
  blocked_flagged_at?: string | null;
  reverts_proposal_id?: string | null;
  applies_after_proposal_id?: string | null;
  dependent_overdue_flagged_at?: string | null;
  created_at: number;
  updated_at?: number;
  review_context_snapshot?: Record<string, unknown> | null;
};

/** Category badge (Edits only) + optional tag chips. */
export function ProposalCategoryTags({
  category,
  kind,
  tags,
  maxTags,
  testIdPrefix,
  stopLinkNavigation = false,
}: {
  category?: string;
  /** Ideas and Handoffs default to a category they never use, so only Edits show it. */
  kind?: string;
  tags?: string[];
  /** Cap visible tags; remaining shown as +N. Omit to show all. */
  maxTags?: number;
  testIdPrefix?: string;
  stopLinkNavigation?: boolean;
}) {
  const tagList = Array.isArray(tags) ? tags.filter((t) => typeof t === "string" && t.trim()) : [];
  const visible = maxTags != null ? tagList.slice(0, maxTags) : tagList;
  const overflow = maxTags != null ? Math.max(0, tagList.length - maxTags) : 0;
  const showCategory = Boolean(category) && kind === "edits";
  if (!showCategory && visible.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      data-testid={testIdPrefix ? `${testIdPrefix}-category-tags` : undefined}
    >
      {showCategory ? (
        <ProposalCategoryBadge
          category={category!}
          stopLinkNavigation={stopLinkNavigation}
          testIdSuffix={testIdPrefix ? `-${testIdPrefix}` : ""}
          badgeTestId={testIdPrefix ? `${testIdPrefix}-category` : undefined}
        />
      ) : null}
      {visible.map((tag) => (
        <Badge key={tag} variant="outline" className="font-normal font-mono text-[11px]">
          {tag}
        </Badge>
      ))}
      {overflow > 0 ? (
        <span className="text-[11px] text-muted-foreground" data-testid={testIdPrefix ? `${testIdPrefix}-tags-more` : undefined}>
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

/** Dot-separated meta line shared by the proposal list card and detail header. */
export function ProposalMetaRow({
  items,
  className,
}: {
  items: Array<{ key: string; node: ReactNode }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-muted-foreground",
        className,
      )}
    >
      {items.map((item, i) => (
        <span key={item.key} className="inline-flex items-center gap-2">
          {i > 0 ? (
            <span aria-hidden className="text-muted-foreground/40">
              ·
            </span>
          ) : null}
          {item.node}
        </span>
      ))}
    </div>
  );
}

/** Compact id chip; click copies the full proposal id without opening the card. */
function ProposalIdCopyBadge({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const shortId = shortProposalId(id);

  function handleClick(e: MouseEvent) {
    preventProposalCardNavigation(e);
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      toast({ title: "Copied proposal id" });
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`Copy id ${id}`}
      aria-label={`Copy proposal id ending in ${shortId}`}
      className="inline-flex shrink-0"
      data-testid={`badge-proposal-id-${id}`}
    >
      <Badge
        variant="outline"
        className="cursor-pointer gap-1 font-mono text-[10px] font-normal tabular-nums hover-elevate"
      >
        {copied ? (
          <IconCheck className="h-3 w-3 shrink-0" aria-hidden />
        ) : (
          <IconCopy className="h-3 w-3 shrink-0" aria-hidden />
        )}
        {shortId}
      </Badge>
    </button>
  );
}

export function ProposalListCard({
  proposal: p,
  href,
}: {
  proposal: ProposalCardData;
  href: string;
}) {
  const ui = proposalStatusUi(p.status);
  const StatusIcon = ui.icon;
  const attribution = proposalAttributionLines({
    proposerUsername: p.proposer_username,
    proposerActor: p.proposer_actor,
    claim: p.claim,
    status: p.status,
    closeReason: p.close_reason,
    closedBy: p.closed_by,
    reviewer: p.reviewer_action_by,
    reviewerActor: p.reviewer_action_by_actor,
    reviewerAt: p.reviewer_action_at,
  });
  const progress = p.kind === "edits" ? proposalEntryProgress(p.entries ?? []) : null;
  const blockers = p.open_blocker_count ?? 0;
  const issueCount = p.related_issue_ids?.length ?? 0;
  const goLive = p.review_mode === "draft_backed" || Boolean(p.promote_on_apply);
  const isTerminal =
    p.status === "finished" || p.status === "rejected" || p.status === "withdrawn";
  const showSituationChip = !isTerminal && Boolean(p.review_context_snapshot);
  const situationLine = !isTerminal
    ? resolveSituationDisplay({
        snapshot: p.review_context_snapshot,
        kind: p.kind,
      })?.staff_summary?.situation_description
    : null;
  const explainSuffix = `-${p.id}`;

  const meta: Array<{ key: string; node: ReactNode }> = [
    {
      key: "status",
      node: (
        <ProposalStatusLabel
          status={p.status}
          kind={p.kind}
          label={ui.label}
          className={ui.className}
          stopLinkNavigation
          testIdSuffix={explainSuffix}
        />
      ),
    },
    {
      key: "kind",
      node: (
        <ProposalKindBadge
          kind={p.kind}
          appearance="meta"
          stopLinkNavigation
          testIdSuffix={explainSuffix}
        />
      ),
    },
  ];
  if (progress) {
    meta.push({
      key: "progress",
      node: (
        <ProposalProgressLabel
          progress={progress}
          stopLinkNavigation
          testIdSuffix={explainSuffix}
        />
      ),
    });
  }
  if (issueCount > 0) {
    meta.push({
      key: "issues",
      node: (
        <span className="inline-flex items-center gap-1">
          <IconLink className="h-3 w-3 shrink-0" aria-hidden />
          {issueCount} linked issue{issueCount === 1 ? "" : "s"}
        </span>
      ),
    });
  }
  for (const line of attribution.lines) {
    meta.push({ key: `attr-${line}`, node: <span className="truncate">{line}</span> });
  }
  if (attribution.reviewLine) {
    meta.push({
      key: "review",
      node: (
        <span
          className="truncate"
          title={attribution.reviewLine.title}
          data-testid={`text-proposal-review-${p.id}`}
        >
          {attribution.reviewLine.text}
        </span>
      ),
    });
  }
  if (attribution.expiredLine) {
    meta.push({
      key: "expired",
      node: <span className="text-muted-foreground/70">{attribution.expiredLine}</span>,
    });
  }
  meta.push({
    key: "updated",
    node: <span>{formatProposalRelativeUpdatedAt(p.updated_at ?? p.created_at)}</span>,
  });

  return (
    <Link
      href={href}
      onClick={(e) => {
        // Wouter navigates unless defaultPrevented. Badge clicks set data-stop-card-nav.
        const target = e.target as HTMLElement | null;
        if (target?.closest("[data-stop-card-nav]")) {
          e.preventDefault();
        }
      }}
      className="group block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      data-testid={`link-proposal-${p.id}`}
    >
      <Card
        className={cn(
          "flex items-start gap-3 border-l-2 px-4 py-3 cursor-pointer hover-elevate",
          "transition-shadow duration-brand ease-brand group-hover:shadow-md",
          ui.accentClassName,
        )}
        data-testid={`card-proposal-${p.id}`}
      >
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            ui.chipClassName,
          )}
          aria-hidden
        >
          <StatusIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-6 text-foreground">
              {p.title}
            </h3>
            <div className="flex shrink-0 items-center gap-1.5">
              <div
                className="flex shrink-0 items-center gap-1.5"
                data-stop-card-nav
                onClick={preventProposalCardNavigation}
              >
                <ProposalIdCopyBadge id={p.id} />
                {showSituationChip ? (
                  <SituationSnapshotBadge
                    snapshot={p.review_context_snapshot}
                    kind={p.kind}
                    stopLinkNavigation
                    testIdSuffix={`-${p.id}`}
                  />
                ) : null}
                {goLive ? (
                  <Badge variant="secondary" className="gap-1 font-normal">
                    <IconRocket className="h-3 w-3 shrink-0" aria-hidden />
                    Go-live draft
                  </Badge>
                ) : null}
                {blockers > 0 ? (
                  <BlockersBadge
                    count={blockers}
                    stopLinkNavigation
                    testIdSuffix={`-${p.id}`}
                    flaggedAt={p.escalated ? null : p.blocked_flagged_at}
                  />
                ) : null}
                {p.attention === "awaiting_rereview" ||
                p.attention === "no_feedback" ||
                p.attention === "predecessor_applied" ? (
                  <AttentionBadge
                    attention={p.attention}
                    resolvedBlockerCount={p.resolved_blocker_count ?? 0}
                    stopLinkNavigation
                    testIdSuffix={`-${p.id}`}
                  />
                ) : null}
                {p.escalated ? (
                  <EscalatedBadge stopLinkNavigation testIdSuffix={`-${p.id}`} />
                ) : null}
                <ProposalV1Badges p={p} stopLinkNavigation />
              </div>
              <IconChevronRight
                className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-foreground"
                aria-hidden
              />
            </div>
          </div>
          {p.summary ? (
            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{p.summary}</p>
          ) : null}
          {situationLine ? (
            <p
              className="line-clamp-1 text-[11px] leading-4 text-muted-foreground/90"
              data-testid={`text-proposal-situation-${p.id}`}
            >
              <span className="font-medium text-muted-foreground">Situation · </span>
              {situationLine}
            </p>
          ) : null}
          <ProposalCategoryTags
            category={p.category}
            kind={p.kind}
            tags={p.tags}
            maxTags={2}
            testIdPrefix={`proposal-${p.id}`}
            stopLinkNavigation
          />
          <ProposalMetaRow items={meta} />
        </div>
      </Card>
    </Link>
  );
}

export function ProposalListCardSkeleton() {
  return (
    <Card className="flex items-start gap-3 border-l-2 border-l-muted px-4 py-3">
      <Skeleton className="mt-0.5 h-8 w-8 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </Card>
  );
}
