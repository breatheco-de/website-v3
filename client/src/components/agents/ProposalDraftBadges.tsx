import { useState, type MouseEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Badge that opens a short plain-English explanation, with optional advanced lines. */
export function ExplainBadge({
  label,
  title,
  body,
  advanced,
  variant = "outline",
  className,
  testId,
  stopLinkNavigation = false,
}: {
  label: ReactNode;
  title: string;
  body: string;
  advanced?: string[];
  variant?: "outline" | "secondary" | "destructive";
  className?: string;
  testId: string;
  stopLinkNavigation?: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const stop = stopLinkNavigation
    ? (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      }
    : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex shrink-0" data-testid={testId} onClick={stop}>
          <Badge variant={variant} className={cn("cursor-pointer font-normal hover-elevate", className)}>
            {label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 text-sm" align="start" onClick={stop}>
        <p className="font-medium text-foreground">{title}</p>
        <p className="leading-5 text-muted-foreground">{body}</p>
        {advanced?.length ? (
          <>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide advanced" : "Read more (advanced)"}
            </button>
            {showAdvanced ? (
              <div className="space-y-1 border-t pt-2 text-xs leading-5 text-muted-foreground">
                {advanced.map((line) => (
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

export type ProposalV1BadgeData = {
  id: string;
  kind: string;
  status: string;
  system_version?: string | null;
  all_or_nothing?: boolean;
  stale_since?: string | null;
  stale_flagged_at?: string | null;
  close_reason?: string | null;
  reverts_proposal_id?: string | null;
  co_authors?: Array<{ username: string }>;
  applies_after_proposal_id?: string | null;
  applied_before_proposal_ids?: string[];
  dependent_overdue_flagged_at?: string | null;
};

const STALE_CLOSE_AFTER_FLAG_DAYS = 20;

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** List card + detail header badges for proposals v1.0 (draft is the source of truth). */
export function ProposalV1Badges({
  p,
  stopLinkNavigation = false,
  revertsDeleted = false,
}: {
  p: ProposalV1BadgeData;
  stopLinkNavigation?: boolean;
  /** The proposal being reverted no longer exists (staff deleted it). */
  revertsDeleted?: boolean;
}) {
  const suffix = `-${p.id}`;
  const open = p.status === "open" || p.status === "partial";
  const badges: ReactNode[] = [];
  if (!p.system_version && p.kind === "edits") {
    badges.push(
      <ExplainBadge
        key="legacy"
        label={open ? "Legacy" : "Legacy (closed)"}
        title="Filed before proposals 1.0"
        body="This proposal was filed before drafts became the source of truth. It is read-only: it can be withdrawn or rejected, but not approved. File a new proposal to make this change."
        advanced={["No system_version. Actions other than withdraw / reject / release / outcome review return legacy_version."]}
        testId={`badge-proposal-legacy${suffix}`}
        stopLinkNavigation={stopLinkNavigation}
      />,
    );
  }
  if (p.all_or_nothing) {
    badges.push(
      <ExplainBadge
        key="aon"
        label="All or nothing"
        title="Publishes every page or none"
        body="Approving publishes all pages together. If any page cannot be published, nothing is published and the proposal stays open with the reason."
        advanced={["Apply checks every entry first; a failure returns all_or_nothing_blocked with the pending list."]}
        testId={`badge-proposal-all-or-nothing${suffix}`}
        stopLinkNavigation={stopLinkNavigation}
      />,
    );
  }
  if (open && p.stale_since) {
    badges.push(
      <ExplainBadge
        key="stale"
        label={
          p.stale_flagged_at
            ? `Out of date · closes ${shortDate(new Date(Date.parse(p.stale_flagged_at) + STALE_CLOSE_AFTER_FLAG_DAYS * 86_400_000).toISOString())}`
            : "Out of date"
        }
        title="The live page changed after this draft was made"
        body={
          p.stale_flagged_at
            ? "Nobody has updated this proposal for 10 days since the live page moved on. It will close automatically if nobody updates it. Drafts it created are deleted then; drafts that existed before are kept."
            : "Someone published a newer version of the page, or the language it was translated from changed. It waits for the author to update it — reviewers do not need to act yet."
        }
        advanced={[`stale_since ${p.stale_since}. Attention bucket: needs_author. Cleared when the author revises or the draft is rebuilt.`]}
        variant="secondary"
        testId={`badge-proposal-stale${suffix}`}
        stopLinkNavigation={stopLinkNavigation}
      />,
    );
  }
  if (p.close_reason === "abandoned_stale") {
    badges.push(
      <ExplainBadge
        key="abandoned"
        label="Closed for inactivity"
        title="Closed automatically: draft out of date"
        body="The draft was out of date for 30 days without activity, so the proposal was closed. Drafts it created were deleted; drafts that existed before were kept. Pages already published stay live."
        testId={`badge-proposal-abandoned${suffix}`}
        stopLinkNavigation={stopLinkNavigation}
      />,
    );
  }
  if (p.close_reason === "abandoned_blocked") {
    badges.push(
      <ExplainBadge
        key="abandoned-blocked"
        label="Closed for inactivity"
        title="Closed automatically: change requests not addressed"
        body="Change requests on this proposal stayed open for 30 days and nobody worked on them, so it was closed. Pages already published stay live. Drafts it created were deleted; drafts that existed before were kept."
        advanced={[
          "close_reason abandoned_blocked. Activity = draft rewrite, adding / resolving / reopening a change request, or a reviewer action — claiming or releasing does not count.",
          "To continue, file a new proposal (optionally with supersedes_proposal_id pointing here).",
        ]}
        testId={`badge-proposal-abandoned-blocked${suffix}`}
        stopLinkNavigation={stopLinkNavigation}
      />,
    );
  }
  if (p.reverts_proposal_id) {
    badges.push(
      <ExplainBadge
        key="revert"
        label="Revert"
        title="Undoes an earlier proposal"
        body={`Approving puts back the values that were live before proposal ${
          revertsDeleted ? "(Deleted proposal)" : p.reverts_proposal_id.slice(0, 8)
        } was applied. Fields changed again since then were left out.`}
        testId={`badge-proposal-revert${suffix}`}
        stopLinkNavigation={stopLinkNavigation}
      />,
    );
  }
  if (open && p.applies_after_proposal_id) {
    badges.push(
      <ExplainBadge
        key="applies-after"
        label={`Publishes after ${p.applies_after_proposal_id.slice(0, 8)}`}
        title="Waits for another proposal"
        body={`This proposal can only be approved after proposal ${p.applies_after_proposal_id.slice(0, 8)} is fully live — for example, a hub link that needs its new page to exist first. Approving that one does not approve this one.`}
        advanced={[
          `applies_after_proposal_id ${p.applies_after_proposal_id}. Apply returns predecessor_not_applied until that proposal is finished (partly published does not count).`,
          "If that proposal is rejected or withdrawn, this one gets a predecessor_closed blocker: unlink it or close this one.",
        ]}
        testId={`badge-proposal-applies-after${suffix}`}
        stopLinkNavigation={stopLinkNavigation}
      />,
    );
  }
  if (open && p.dependent_overdue_flagged_at) {
    badges.push(
      <ExplainBadge
        key="dependent-overdue"
        label={`Overdue since ${shortDate(p.dependent_overdue_flagged_at)}`}
        title="The page it waits on is already live"
        body="The proposal this one waits on was published more than 48 hours ago, and this one is still not approved — for example, a new page its hub does not link to yet. Review it now. It does not close by itself."
        advanced={[
          `dependent_overdue_flagged_at ${p.dependent_overdue_flagged_at}. Set by the daily sweep 48 hours after the predecessor finished. Never escalates or pauses agent work; cleared on apply or close.`,
        ]}
        variant="destructive"
        testId={`badge-proposal-dependent-overdue${suffix}`}
        stopLinkNavigation={stopLinkNavigation}
      />,
    );
  }
  if (p.applied_before_proposal_ids?.length) {
    const n = p.applied_before_proposal_ids.length;
    badges.push(
      <ExplainBadge
        key="applied-before"
        label={`${n} wait${n === 1 ? "s" : ""} on this`}
        title="Other proposals publish after this one"
        body={`${n} proposal${n === 1 ? " is" : "s are"} set to publish after this one. Approving this one does not approve them — approve them right after this one is live.`}
        advanced={[`applied_before_proposal_ids: ${p.applied_before_proposal_ids.join(", ")}`]}
        testId={`badge-proposal-applied-before${suffix}`}
        stopLinkNavigation={stopLinkNavigation}
      />,
    );
  }
  if (p.co_authors?.length) {
    badges.push(
      <ExplainBadge
        key="coauthors"
        label={`Changed after review by ${p.co_authors.map((c) => c.username).join(", ")}`}
        title="Edited directly in the draft"
        body="Someone edited the draft outside the proposal. They count as co-authors, so they cannot be the one who approves it."
        advanced={["Apply by a co-author returns four_eyes_co_author."]}
        testId={`badge-proposal-coauthors${suffix}`}
        stopLinkNavigation={stopLinkNavigation}
      />,
    );
  }
  return badges.length ? <>{badges}</> : null;
}
