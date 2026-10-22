import { describe, expect, it } from "vitest";
import {
  compareByAttention,
  deriveProposalAttention,
  hasActiveForeignClaim,
  attentionRank,
} from "./attention";

describe("deriveProposalAttention", () => {
  it("returns null for closed statuses", () => {
    expect(
      deriveProposalAttention({
        status: "finished",
        escalated: false,
        open_blocker_count: 0,
      }),
    ).toBeNull();
    expect(
      deriveProposalAttention({
        status: "rejected",
        escalated: true,
        open_blocker_count: 1,
      }),
    ).toBeNull();
  });

  it("escalated wins over blockers", () => {
    expect(
      deriveProposalAttention({
        status: "open",
        escalated: true,
        open_blocker_count: 2,
        resolved_blocker_count: 1,
      }),
    ).toBe("escalated");
  });

  it("maps blocked, awaiting_rereview, and no_feedback", () => {
    expect(
      deriveProposalAttention({
        status: "partial",
        escalated: false,
        open_blocker_count: 1,
        resolved_blocker_count: 3,
      }),
    ).toBe("blocked");
    expect(
      deriveProposalAttention({
        status: "open",
        escalated: false,
        open_blocker_count: 0,
        resolved_blocker_count: 2,
      }),
    ).toBe("awaiting_rereview");
    expect(
      deriveProposalAttention({
        status: "open",
        escalated: false,
        open_blocker_count: 0,
        blockers: [],
      }),
    ).toBe("no_feedback");
  });

  it("author content with no open blockers is awaiting_rereview", () => {
    expect(
      deriveProposalAttention({
        status: "open",
        escalated: false,
        open_blocker_count: 0,
        author_content_at: 20,
        reviewer_action_at: null,
      }),
    ).toBe("awaiting_rereview");
    expect(
      deriveProposalAttention({
        status: "open",
        escalated: false,
        open_blocker_count: 1,
        author_content_at: 50,
        reviewer_action_at: 10,
      }),
    ).toBe("blocked");
    expect(
      deriveProposalAttention({
        status: "open",
        escalated: false,
        open_blocker_count: 0,
        resolved_blocker_count: 0,
        author_content_at: 10,
        reviewer_action_at: 20,
      }),
    ).toBe("no_feedback");
    expect(
      deriveProposalAttention({
        status: "open",
        escalated: false,
        open_blocker_count: 0,
        resolved_blocker_count: 1,
        author_content_at: 10,
        reviewer_action_at: 20,
      }),
    ).toBe("awaiting_rereview");
  });
});

describe("compareByAttention", () => {
  const now = Date.now();
  const future = new Date(now + 60_000).toISOString();

  it("reviewer order: escalated before awaiting_rereview before no_feedback before blocked", () => {
    const rows = [
      { id: "b", updated_at: 1, attention: "blocked" as const },
      { id: "a", updated_at: 1, attention: "awaiting_rereview" as const },
      { id: "e", updated_at: 1, attention: "escalated" as const },
      { id: "n", updated_at: 1, attention: "no_feedback" as const },
    ];
    const sorted = [...rows].sort((x, y) => compareByAttention(x, y, "reviewer", "me", now));
    expect(sorted.map((r) => r.id)).toEqual(["e", "a", "n", "b"]);
  });

  it("reviewer order: predecessor_applied first; blockers and stale drafts still win the bucket", () => {
    const rows = [
      { id: "e", updated_at: 1, attention: "escalated" as const },
      { id: "p", updated_at: 1, attention: "predecessor_applied" as const },
      { id: "n", updated_at: 1, attention: "no_feedback" as const },
    ];
    const sorted = [...rows].sort((x, y) => compareByAttention(x, y, "reviewer", "me", now));
    expect(sorted.map((r) => r.id)).toEqual(["p", "e", "n"]);
    const base = { status: "open", escalated: false, open_blocker_count: 0, predecessor_applied: true };
    expect(deriveProposalAttention(base)).toBe("predecessor_applied");
    expect(deriveProposalAttention({ ...base, open_blocker_count: 1 })).toBe("blocked");
    expect(deriveProposalAttention({ ...base, needs_author: true })).toBe("needs_author");
    expect(deriveProposalAttention({ ...base, status: "finished" })).toBeNull();
  });

  it("author order: blocked before awaiting_rereview", () => {
    const rows = [
      { id: "a", updated_at: 1, attention: "awaiting_rereview" as const },
      { id: "b", updated_at: 1, attention: "blocked" as const },
    ];
    const sorted = [...rows].sort((x, y) => compareByAttention(x, y, "author", "me", now));
    expect(sorted.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("demotes active foreign claims within a bucket", () => {
    const free = {
      id: "free",
      updated_at: 1,
      attention: "no_feedback" as const,
      claim: null,
    };
    const foreign = {
      id: "foreign",
      updated_at: 99,
      attention: "no_feedback" as const,
      claim: { by: "other", expiresAt: future },
    };
    const mine = {
      id: "mine",
      updated_at: 50,
      attention: "no_feedback" as const,
      claim: { by: "me", expiresAt: future },
    };
    const sorted = [foreign, free, mine].sort((x, y) =>
      compareByAttention(x, y, "reviewer", "me", now),
    );
    expect(sorted.map((r) => r.id)).toEqual(["mine", "free", "foreign"]);
  });

  it("hasActiveForeignClaim treats expired as free", () => {
    expect(
      hasActiveForeignClaim(
        { by: "other", expiresAt: new Date(now - 1000).toISOString() },
        "me",
        now,
      ),
    ).toBe(false);
  });

  it("closed rank trails open buckets", () => {
    expect(attentionRank(null, "reviewer")).toBeGreaterThan(attentionRank("blocked", "reviewer"));
  });
});
