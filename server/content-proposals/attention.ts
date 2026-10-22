/**
 * Derived proposal attention for list triage (not a stored status).
 */

export const PROPOSAL_ATTENTION_VALUES = [
  "predecessor_applied",
  "escalated",
  "awaiting_rereview",
  "no_feedback",
  "blocked",
  "needs_author",
] as const;

export type ProposalAttention = (typeof PROPOSAL_ATTENTION_VALUES)[number];

export type AttentionPerspective = "reviewer" | "author";

export const ATTENTION_PERSPECTIVES = ["reviewer", "author"] as const;

/** predecessor_applied first: the page it waits on is already live, so the gap is public. */
const REVIEWER_RANK: Record<ProposalAttention, number> = {
  predecessor_applied: 0,
  escalated: 1,
  awaiting_rereview: 2,
  no_feedback: 3,
  blocked: 4,
  needs_author: 5,
};

const AUTHOR_RANK: Record<ProposalAttention, number> = {
  escalated: 0,
  blocked: 1,
  awaiting_rereview: 2,
  predecessor_applied: 3,
  no_feedback: 3,
  needs_author: 1,
};

/** Closed / non-open rows trail open attention buckets. */
const CLOSED_RANK = 100;

export function isProposalAttention(raw: string): raw is ProposalAttention {
  return (PROPOSAL_ATTENTION_VALUES as readonly string[]).includes(raw);
}

export function parseProposalAttention(
  raw?: string | null,
):
  | { ok: true; attention: ProposalAttention | undefined }
  | { ok: false; error: string } {
  if (raw == null || String(raw).trim() === "") {
    return { ok: true, attention: undefined };
  }
  const trimmed = String(raw).trim();
  if (isProposalAttention(trimmed)) {
    return { ok: true, attention: trimmed };
  }
  return {
    ok: false,
    error: `Invalid attention '${trimmed}'. Allowed: ${PROPOSAL_ATTENTION_VALUES.join(", ")}`,
  };
}

export function parseAttentionPerspective(
  raw?: string | null,
):
  | { ok: true; perspective: AttentionPerspective | undefined }
  | { ok: false; error: string } {
  if (raw == null || String(raw).trim() === "") {
    return { ok: true, perspective: undefined };
  }
  const trimmed = String(raw).trim();
  if (trimmed === "reviewer" || trimmed === "author") {
    return { ok: true, perspective: trimmed };
  }
  return {
    ok: false,
    error: `Invalid attention_perspective '${trimmed}'. Allowed: reviewer, author`,
  };
}

export function resolvedBlockerCount(
  blockers: Array<{ status: string }> | null | undefined,
): number {
  if (!blockers?.length) return 0;
  return blockers.filter((b) => b.status === "resolved").length;
}

export type AttentionDeriveInput = {
  status: string;
  escalated: boolean;
  open_blocker_count: number;
  blockers?: Array<{ status: string }> | null;
  resolved_blocker_count?: number;
  /** Last author rewrite or author-marked blocker fix. Null until that happens after deploy. */
  author_content_at?: number | null;
  /** Last reviewer disposition that is not an author content stamp. */
  reviewer_action_at?: number | null;
  /** v1.0: live or the translation source moved and the draft could not be rebuilt (stale_since set). */
  needs_author?: boolean;
  /** applies_after_proposal_id points at a fully applied (finished) proposal. */
  predecessor_applied?: boolean;
};

/** Author changed the packet and no later reviewer action has landed. */
export function isAuthorContentPendingReview(
  authorContentAt: number | null | undefined,
  reviewerActionAt: number | null | undefined,
): boolean {
  if (authorContentAt == null || !Number.isFinite(authorContentAt)) return false;
  if (reviewerActionAt == null || !Number.isFinite(reviewerActionAt)) return true;
  return authorContentAt > reviewerActionAt;
}

/**
 * Returns null for finished/rejected/withdrawn (and any non open|partial).
 * Escalated wins, then open blockers, then stale drafts. A proposal whose applies_after
 * predecessor is fully applied is predecessor_applied (ready to ship now). Ready for re-check
 * is a resolved blocker or an author content update with nothing still waiting on the author.
 */
export function deriveProposalAttention(input: AttentionDeriveInput): ProposalAttention | null {
  if (input.status !== "open" && input.status !== "partial") {
    return null;
  }
  if (input.escalated) return "escalated";
  const open = input.open_blocker_count ?? 0;
  if (open > 0) return "blocked";
  if (input.needs_author) return "needs_author";
  if (input.predecessor_applied) return "predecessor_applied";
  const resolved =
    input.resolved_blocker_count ?? resolvedBlockerCount(input.blockers);
  if (
    isAuthorContentPendingReview(input.author_content_at, input.reviewer_action_at) ||
    resolved > 0
  ) {
    return "awaiting_rereview";
  }
  return "no_feedback";
}

export function attentionRank(
  attention: ProposalAttention | null,
  perspective: AttentionPerspective,
): number {
  if (attention == null) return CLOSED_RANK;
  const table = perspective === "author" ? AUTHOR_RANK : REVIEWER_RANK;
  return table[attention];
}

export type ClaimLike = {
  by: string;
  expiresAt: string;
} | null;

/** Active claim held by someone other than caller. Expired → not foreign. */
export function hasActiveForeignClaim(
  claim: ClaimLike | undefined,
  callerUsername: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!claim?.by?.trim() || !claim.expiresAt) return false;
  const expires = new Date(claim.expiresAt).getTime();
  if (!Number.isFinite(expires) || expires <= nowMs) return false;
  const caller = callerUsername?.trim().toLowerCase();
  if (!caller) return true;
  return claim.by.trim().toLowerCase() !== caller;
}

export type AttentionSortable = {
  id: string;
  updated_at: number;
  attention: ProposalAttention | null;
  claim?: ClaimLike;
};

/**
 * Rank → foreign-claim demotion → updated_at desc → id.
 */
export function compareByAttention(
  a: AttentionSortable,
  b: AttentionSortable,
  perspective: AttentionPerspective,
  callerUsername?: string | null,
  nowMs: number = Date.now(),
): number {
  const ra = attentionRank(a.attention, perspective);
  const rb = attentionRank(b.attention, perspective);
  if (ra !== rb) return ra - rb;

  const fa = hasActiveForeignClaim(a.claim ?? null, callerUsername, nowMs) ? 1 : 0;
  const fb = hasActiveForeignClaim(b.claim ?? null, callerUsername, nowMs) ? 1 : 0;
  if (fa !== fb) return fa - fb;

  if (a.updated_at !== b.updated_at) return b.updated_at - a.updated_at;
  return a.id.localeCompare(b.id);
}

export function emptyAttentionCounts(): Record<ProposalAttention, number> {
  return {
    predecessor_applied: 0,
    escalated: 0,
    awaiting_rereview: 0,
    no_feedback: 0,
    blocked: 0,
    needs_author: 0,
  };
}
