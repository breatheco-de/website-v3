import {
  formatIssueActorLine,
  type IssueActorRef,
} from "@/lib/formatIssueActor";
import { sameAgentIdentity } from "@shared/agent-identity";

export type ProposalClaimLike = {
  by: string;
  expiresAt: string;
  actor?: IssueActorRef | Record<string, unknown> | null;
};

function asIssueActor(raw: unknown): IssueActorRef | null {
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
  if (category === "content.field") return "Field";
  return category;
}

/** Short id for display; copy actions should still use the full UUID. */
export function shortProposalId(id: string): string {
  const compact = id.replace(/-/g, "");
  const head = compact.slice(0, 8) || id.slice(0, 8);
  return head ? `${head}…` : id;
}

export function formatProposalRelativeUpdatedAt(
  updatedAtMs: number,
  nowMs: number = Date.now(),
): string {
  const diff = nowMs - updatedAtMs;
  if (diff < 60_000) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `about ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
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
};

/**
 * Build attribution lines for list/detail.
 * Collapse propose+claim when same staff author and same agent identity (username + role).
 * Expired claims stay visible (not a lock).
 */
export function proposalAttributionLines(opts: {
  proposerUsername: string;
  proposerActor?: unknown;
  claim?: ProposalClaimLike | null;
  nowMs?: number;
}): ProposalAttributionLines {
  const now = opts.nowMs ?? Date.now();
  const proposerActor = asIssueActor(opts.proposerActor);
  const proposeLine = `Proposed by ${formatIssueActorLine(opts.proposerUsername, proposerActor)}`;

  const claim = opts.claim;
  if (!claim?.by) {
    return { lines: [proposeLine], expiredLine: null };
  }

  const claimActor = asIssueActor(claim.actor);
  const claimFmt = formatIssueActorLine(claim.by, claimActor);
  const expiresAt = new Date(claim.expiresAt).getTime();
  const active = Number.isFinite(expiresAt) && expiresAt > now;

  if (!active) {
    return {
      lines: [proposeLine],
      expiredLine: `Claim expired · ${claimFmt}`,
    };
  }

  if (
    sameAgentIdentity(opts.proposerUsername, proposerActor, claim.by, claimActor)
  ) {
    return {
      lines: [`Proposed & claimed by ${claimFmt}`],
      expiredLine: null,
    };
  }

  return {
    lines: [proposeLine, `Claimed by ${claimFmt}`],
    expiredLine: null,
  };
}
