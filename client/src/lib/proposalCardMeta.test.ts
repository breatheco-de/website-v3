import { describe, expect, it } from "vitest";
import {
  formatProposalRelativeUpdatedAt,
  proposalAttributionLines,
  proposalCategoryLabel,
  proposalEntryProgress,
  shortProposalId,
} from "./proposalCardMeta";
import { PROPOSAL_STATUS_UI, proposalStatusUi } from "./proposalStatusUi";

describe("proposalCardMeta", () => {
  it("maps category to staff labels", () => {
    expect(proposalCategoryLabel("content.seo")).toBe("SEO");
    expect(proposalCategoryLabel("content.field")).toBe("Page content");
    expect(proposalCategoryLabel("other")).toBe("other");
  });

  it("shortens proposal ids for display", () => {
    expect(shortProposalId("e6a1b7a7-4001-425c-9dba-eb8e3ad78f25")).toBe("d78f25");
    expect(shortProposalId("e6a1b7a7-4001-425c-9dba-eb8e3ad78f25", 8)).toBe("3ad78f25");
  });

  it("formats relative updated_at", () => {
    const now = Date.parse("2026-09-09T20:00:00.000Z");
    expect(formatProposalRelativeUpdatedAt(now, now)).toBe("just now");
    expect(formatProposalRelativeUpdatedAt(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(formatProposalRelativeUpdatedAt(now - (2 * 60 + 15) * 60_000, now)).toBe(
      "2 hours 15 minutes ago",
    );
    expect(formatProposalRelativeUpdatedAt(now - 3 * 60 * 60_000, now)).toBe("3 hours ago");
    expect(
      formatProposalRelativeUpdatedAt(now - ((1 * 24 + 5) * 60 + 23) * 60_000, now),
    ).toBe("1 day 5 hours 23 minutes ago");
    expect(
      formatProposalRelativeUpdatedAt(now - ((2 * 24 + 0) * 60 + 10) * 60_000, now),
    ).toBe("2 days 10 minutes ago");
  });

  it("builds entry progress with failed cue", () => {
    expect(
      proposalEntryProgress([
        { status: "done" },
        { status: "failed" },
        { status: "pending" },
      ]),
    ).toEqual({ done: 1, total: 3, failed: 1, label: "1/3 · 1 failed" });
    expect(proposalEntryProgress([{ status: "done" }, { status: "done" }])).toEqual({
      done: 2,
      total: 2,
      failed: 0,
      label: "2/2 done",
    });
  });

  it("collapses propose+claim when same author and agent", () => {
    const actor = { type: "mcp" as const, client: "Cursor", model: "claude-4" };
    const lines = proposalAttributionLines({
      proposerUsername: "alice",
      proposerActor: actor,
      claim: {
        by: "alice",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        actor,
      },
      nowMs: Date.now(),
    });
    expect(lines.lines).toEqual([
      "Proposed & claimed by alice · via claude-4",
    ]);
    expect(lines.expiredLine).toBeNull();
  });

  it("keeps two lines when agent role differs", () => {
    const lines = proposalAttributionLines({
      proposerUsername: "alice",
      proposerActor: {
        type: "mcp",
        client: "Cursor",
        role: "copy_editor",
        model: "claude/sonnet-4.5",
      },
      claim: {
        by: "alice",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        actor: {
          type: "mcp",
          client: "Cursor",
          role: "seo_specialist",
          model: "claude/sonnet-4.5",
        },
      },
      nowMs: Date.now(),
    });
    expect(lines.lines).toHaveLength(2);
    expect(lines.lines[0]).toContain("Proposed by");
    expect(lines.lines[1]).toContain("Claimed by");
  });

  it("collapses propose+claim when same role even if model differs", () => {
    const lines = proposalAttributionLines({
      proposerUsername: "alice",
      proposerActor: {
        type: "mcp",
        client: "Cursor",
        role: "copy_editor",
        model: "claude/sonnet-4.5",
      },
      claim: {
        by: "alice",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        actor: {
          type: "mcp",
          client: "Cursor",
          role: "copy_editor",
          model: "claude/fable-1.5",
        },
      },
      nowMs: Date.now(),
    });
    expect(lines.lines).toHaveLength(1);
    expect(lines.lines[0]).toContain("Proposed & claimed by");
    expect(lines.lines[0]).toContain("copy_editor");
  });

  it("shows claim expired with last claimant", () => {
    const lines = proposalAttributionLines({
      proposerUsername: "alice",
      proposerActor: { type: "ui" },
      claim: {
        by: "blake",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        actor: { type: "mcp", client: "Cursor", model: "claude-4" },
      },
      nowMs: Date.now(),
    });
    expect(lines.lines).toEqual(["Proposed by alice"]);
    expect(lines.expiredLine).toBe("Claim expired · blake · via claude-4");
  });

  it("falls back to via MCP when type mcp but client/model missing", () => {
    const lines = proposalAttributionLines({
      proposerUsername: "alice",
      proposerActor: { type: "mcp" },
      nowMs: Date.now(),
    });
    expect(lines.lines[0]).toBe("Proposed by alice · via MCP");
  });

  describe("review line", () => {
    const now = Date.parse("2026-09-24T20:00:00.000Z");
    const base = { proposerUsername: "alice", proposerActor: { type: "ui" }, nowMs: now };

    it("shows last feedback with relative time on open proposals", () => {
      const out = proposalAttributionLines({
        ...base,
        status: "open",
        reviewer: "blake",
        reviewerActor: { type: "ui" },
        reviewerAt: now - 2 * 60 * 60_000,
      });
      expect(out.reviewLine?.text).toBe("Last feedback from blake · 2 hours ago");
      expect(out.reviewLine?.title).toMatch(/other than the author/);
    });

    it("shows no feedback line on open proposals without a reviewer", () => {
      const out = proposalAttributionLines({ ...base, status: "partial", reviewer: null });
      expect(out.reviewLine).toBeNull();
    });

    it("merges last feedback into the claim line when reviewer is the active claimant", () => {
      const actor = { type: "mcp" as const, role: "seo_specialist" };
      const out = proposalAttributionLines({
        ...base,
        status: "open",
        claim: { by: "blake", expiresAt: new Date(now + 60_000).toISOString(), actor },
        reviewer: "blake",
        reviewerActor: actor,
        reviewerAt: now - 5 * 60_000,
      });
      expect(out.reviewLine).toBeNull();
      expect(out.lines).toEqual([
        "Proposed by alice",
        "Claimed by blake · via MCP as seo_specialist · last feedback 5 minutes ago",
      ]);
    });

    it("says Applied for finished edits with no close reason", () => {
      expect(
        proposalAttributionLines({ ...base, status: "finished", closedBy: "casey" }).reviewLine?.text,
      ).toBe("Applied by casey");
      expect(proposalAttributionLines({ ...base, status: "finished" }).reviewLine?.text).toBe(
        "Applied",
      );
    });

    it("says Accepted for accepted ideas", () => {
      expect(
        proposalAttributionLines({
          ...base,
          status: "finished",
          closeReason: "accepted",
          closedBy: "casey",
        }).reviewLine?.text,
      ).toBe("Accepted by casey");
    });

    it("says Closed with the reason for park/close reasons", () => {
      expect(
        proposalAttributionLines({
          ...base,
          status: "finished",
          closeReason: "wont_fix",
          closedBy: "casey",
        }).reviewLine?.text,
      ).toBe("Closed by casey · won’t fix");
      expect(
        proposalAttributionLines({ ...base, status: "finished", closeReason: "fixed_elsewhere" })
          .reviewLine?.text,
      ).toBe("Closed · fixed elsewhere");
      expect(
        proposalAttributionLines({
          ...base,
          status: "finished",
          closeReason: "tracked_elsewhere",
          closedBy: "casey",
        }).reviewLine?.text,
      ).toBe("Closed by casey · tracked elsewhere");
      expect(
        proposalAttributionLines({ ...base, status: "finished", closeReason: "other", closedBy: "casey" })
          .reviewLine?.text,
      ).toBe("Closed by casey · other");
    });

    it("says Rejected for any reject kind and ignores last feedback on closed proposals", () => {
      const out = proposalAttributionLines({
        ...base,
        status: "rejected",
        closeReason: "bad_idea",
        closedBy: "casey",
        reviewer: "blake",
        reviewerAt: now,
      });
      expect(out.reviewLine?.text).toBe("Rejected by casey");
    });

    it("shows nothing for withdrawn proposals", () => {
      const out = proposalAttributionLines({
        ...base,
        status: "withdrawn",
        closeReason: "withdrawn",
        closedBy: "alice",
        reviewer: "blake",
        reviewerAt: now,
      });
      expect(out.reviewLine).toBeNull();
    });
  });
});

describe("proposalStatusUi", () => {
  it("covers every ProposalStatus", () => {
    for (const status of Object.keys(PROPOSAL_STATUS_UI)) {
      const ui = proposalStatusUi(status);
      expect(ui.label).toBeTruthy();
      expect(ui.icon).toBeTruthy();
      expect(ui.className).toBeTruthy();
    }
  });

  it("falls back for unknown status", () => {
    expect(proposalStatusUi("weird").label).toBe("weird");
  });
});
