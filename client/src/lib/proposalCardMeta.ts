import {
  formatIssueActorLine,
  type IssueActorRef,
} from "@/lib/formatIssueActor";
import { sameAgentIdentity } from "@shared/agent-identity";
import { PROPOSAL_CLOSE_REASON_OPTIONS } from "@/lib/proposalCloseReason";

export type ProposalClaimLike = {
  by: string;
  expiresAt: string;
  actor?: IssueActorRef | Record<string, unknown> | null;
};

export function asIssueActor(raw: unknown): IssueActorRef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (type !== "ui" && type !== "mcp" && type !== "system") return null;
  return {
    type,
    ...(typeof o.client === "string" ? { client: o.client } : {}),
    ...(typeof o.model === "string" ? { model: o.model } : {}),
    ...(typeof o.role === "string" ? { role: o.role } : {}),
    ...(typeof o.source === "string" ? { source: o.source } : {}),
  };
}

/** Staff-facing category labels for proposal chips. */
export function proposalCategoryLabel(category: string): string {
  if (category === "content.seo") return "SEO";
  if (category === "content.field") return "Page content";
  return category;
}

/** Short id for display (last chars of UUID); copy actions should still use the full id. */
export function shortProposalId(id: string, length = 6): string {
  const compact = id.replace(/-/g, "");
  const tail = compact.slice(-length) || id.slice(-length);
  return tail || id;
}

function pluralUnit(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * Staff-facing relative time with day/hour/minute parts (no vague "about N hours").
 * Examples: "just now", "5 minutes ago", "2 hours 15 minutes ago", "1 day 5 hours 23 minutes ago"
 */
export function formatProposalRelativeUpdatedAt(
  updatedAtMs: number,
  nowMs: number = Date.now(),
): string {
  const diff = Math.max(0, nowMs - updatedAtMs);
  if (diff < 60_000) return "just now";

  const totalMins = Math.floor(diff / 60_000);
  if (totalMins < 60) return `${pluralUnit(totalMins, "minute")} ago`;

  const totalHours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (totalHours < 24) {
    const parts = [pluralUnit(totalHours, "hour")];
    if (mins > 0) parts.push(pluralUnit(mins, "minute"));
    return `${parts.join(" ")} ago`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const parts = [pluralUnit(days, "day")];
  if (hours > 0) parts.push(pluralUnit(hours, "hour"));
  if (mins > 0) parts.push(pluralUnit(mins, "minute"));
  return `${parts.join(" ")} ago`;
}

export function proposalEntryProgress(entries: Array<{ status: string }>): {
  done: number;
  total: number;
  failed: number;
  label: string;
} | null {
  if (entries.length === 0) return null;
  const done = entries.filter((e) => e.status === "done").length;
  const failed = entries.filter((e) => e.status === "failed").length;
  const total = entries.length;
  const label =
    failed > 0 ? `${done}/${total} · ${failed} failed` : `${done}/${total} done`;
  return { done, total, failed, label };
}

export type ProposalAttributionLines = {
  /** Primary propose / propose+claim line(s) */
  lines: string[];
  /** Muted expired-claim line, if any */
  expiredLine: string | null;
  /** Last feedback (open/partial) or closer (finished/rejected) line; null when nothing to show. */
  reviewLine: { text: string; title: string } | null;
};

export const PROPOSAL_LAST_FEEDBACK_TITLE =
  "Last person other than the author who added, resolved, or reopened a needs-changes note.";

const CLOSE_REASON_LABEL: Record<string, string> = Object.fromEntries(
  PROPOSAL_CLOSE_REASON_OPTIONS.map((o) => [o.value, o.label.toLowerCase()]),
);

function closerLine(opts: {
  status?: string;
  closeReason?: string | null;
  closedBy?: string | null;
}): { text: string; title: string } | null {
  const by = opts.closedBy?.trim() || "";
  const withBy = (verb: string) => (by ? `${verb} by ${by}` : verb);
  if (opts.status === "rejected") {
    return { text: withBy("Rejected"), title: "Who rejected this proposal." };
  }
  if (opts.status !== "finished") return null;
  const reason = opts.closeReason?.trim() || "";
  if (!reason) return { text: withBy("Applied"), title: "Who applied the last change." };
  if (reason === "accepted") return { text: withBy("Accepted"), title: "Who accepted this idea." };
  const label = CLOSE_REASON_LABEL[reason] ?? reason.replace(/_/g, " ");
  return { text: `${withBy("Closed")} · ${label}`, title: "Who closed this proposal, and why." };
}

/**
 * Build attribution lines for list/detail.
 * Collapse propose+claim when same staff author and same agent identity (username + role).
 * Expired claims stay visible (not a lock).
 * Closed proposals show the closer instead of last feedback; withdrawn shows neither.
 */
export function proposalAttributionLines(opts: {
  proposerUsername: string;
  proposerActor?: unknown;
  claim?: ProposalClaimLike | null;
  status?: string;
  closeReason?: string | null;
  closedBy?: string | null;
  reviewer?: string | null;
  reviewerActor?: unknown;
  reviewerAt?: number | null;
  nowMs?: number;
}): ProposalAttributionLines {
  const now = opts.nowMs ?? Date.now();
  const proposerActor = asIssueActor(opts.proposerActor);
  const proposeLine = `Proposed by ${formatIssueActorLine(opts.proposerUsername, proposerActor)}`;

  const isOpen = !opts.status || opts.status === "open" || opts.status === "partial";
  const reviewer = isOpen ? opts.reviewer?.trim() || "" : "";
  const reviewerActor = asIssueActor(opts.reviewerActor);
  const feedbackWhen =
    opts.reviewerAt != null && Number.isFinite(opts.reviewerAt)
      ? formatProposalRelativeUpdatedAt(opts.reviewerAt, now)
      : null;
  const feedbackLine = reviewer
    ? {
        text: `Last feedback from ${formatIssueActorLine(reviewer, reviewerActor)}${feedbackWhen ? ` · ${feedbackWhen}` : ""}`,
        title: PROPOSAL_LAST_FEEDBACK_TITLE,
      }
    : null;
  const reviewLine = isOpen ? feedbackLine : closerLine(opts);

  const claim = opts.claim;
  if (!claim?.by) {
    return { lines: [proposeLine], expiredLine: null, reviewLine };
  }

  const claimActor = asIssueActor(claim.actor);
  const claimFmt = formatIssueActorLine(claim.by, claimActor);
  const expiresAt = new Date(claim.expiresAt).getTime();
  const active = Number.isFinite(expiresAt) && expiresAt > now;

  if (!active) {
    return {
      lines: [proposeLine],
      expiredLine: `Claim expired · ${claimFmt}`,
      reviewLine,
    };
  }

  if (
    sameAgentIdentity(opts.proposerUsername, proposerActor, claim.by, claimActor)
  ) {
    return {
      lines: [`Proposed & claimed by ${claimFmt}`],
      expiredLine: null,
      reviewLine,
    };
  }

  if (feedbackLine && sameAgentIdentity(reviewer, reviewerActor, claim.by, claimActor)) {
    return {
      lines: [
        proposeLine,
        `Claimed by ${claimFmt}${feedbackWhen ? ` · last feedback ${feedbackWhen}` : " · last feedback"}`,
      ],
      expiredLine: null,
      reviewLine: null,
    };
  }

  return {
    lines: [proposeLine, `Claimed by ${claimFmt}`],
    expiredLine: null,
    reviewLine,
  };
}
