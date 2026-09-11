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
    expect(proposalCategoryLabel("content.field")).toBe("Field");
    expect(proposalCategoryLabel("other")).toBe("other");
  });

  it("shortens proposal ids for display", () => {
    expect(shortProposalId("e6a1b7a7-4001-425c-9dba-eb8e3ad78f25")).toBe("e6a1b7a7…");
  });

  it("formats relative updated_at", () => {
    const now = Date.parse("2026-09-09T20:00:00.000Z");
    expect(formatProposalRelativeUpdatedAt(now, now)).toBe("just now");
    expect(formatProposalRelativeUpdatedAt(now - 5 * 60_000, now)).toBe("5 minutes ago");
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
    expect(lines.lines).toEqual(["Proposed & claimed by alice · via Cursor (claude-4)"]);
    expect(lines.expiredLine).toBeNull();
  });

  it("keeps two lines when agent identity differs", () => {
    const lines = proposalAttributionLines({
      proposerUsername: "alice",
      proposerActor: { type: "mcp", client: "Cursor", model: "claude-4" },
      claim: {
        by: "alice",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        actor: { type: "mcp", client: "Cursor", model: "gpt-5" },
      },
      nowMs: Date.now(),
    });
    expect(lines.lines).toHaveLength(2);
    expect(lines.lines[0]).toContain("Proposed by");
    expect(lines.lines[1]).toContain("Claimed by");
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
    expect(lines.expiredLine).toBe("Claim expired · blake · via Cursor (claude-4)");
  });

  it("uses via MCP when type mcp but client/model missing", () => {
    const lines = proposalAttributionLines({
      proposerUsername: "alice",
      proposerActor: { type: "mcp" },
      nowMs: Date.now(),
    });
    expect(lines.lines[0]).toBe("Proposed by alice · via MCP");
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
