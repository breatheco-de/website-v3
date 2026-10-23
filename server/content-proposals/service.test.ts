import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { clearSiteSqliteCacheForTests, getSiteSqlite } from "../db";
import { ensurePipelineDb, resetPipelineDbCache } from "../pipeline-db/runner";
import { listEvents } from "../events/event-store";
import { fingerprintEdits, fingerprintNotes } from "./fingerprint";
import { discardSeededAttachedEntry, seedAttachedLocaleFiles } from "./seed-attached-entry";
import {
  createProposalService,
  listOpenProposalsForEntry,
  listOpenProposalsForVariant,
  parseProposalSort,
  parseProposerActorType,
  PROPOSAL_CLAIM_TTL_MS,
  proposalQueryTerms,
  toProposalSummary,
  type ProposalEntryInput,
} from "./service";

const SITE = `site_proposal-test-${Date.now()}`;

function rmSite(): void {
  const dir = path.join("data", SITE.replace(/\//g, "-"));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function sampleEntry(overrides: Partial<ProposalEntryInput> = {}): ProposalEntryInput {
  return {
    contentType: "blog",
    slug: "hello",
    locale: "es",
    updates: [{ field_path: "call_to_action.title", value: "New title" }],
    ...overrides,
  };
}

function makeService(opts?: {
  issueExists?: (id: string) => boolean;
  liveValues?: Record<string, unknown>;
  applyOk?: boolean;
  applyError?: string;
}) {
  const live = { ...(opts?.liveValues ?? { "call_to_action.title": "Old title" }) };
  return createProposalService({
    site: SITE,
    issueExists: opts?.issueExists ?? (() => true),
    captureBaseline: (entry) => {
      const values: Record<string, unknown> = {};
      for (const u of entry.updates) values[u.field_path] = live[u.field_path];
      return { values };
    },
    applyUpdates: async (entry) => {
      if (opts?.applyOk === false) return { ok: false, error: opts.applyError ?? "fail" };
      for (const u of entry.ops) {
        live[u.field_path] = u.reset ? undefined : u.value;
      }
      return { ok: true };
    },
  });
}

describe("content proposals", () => {
  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
    ensurePipelineDb(SITE, { skipBackup: true });
  });

  afterEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
  });

  it("fingerprints edits ignoring prose and notes by issue+summary", () => {
    const a = fingerprintEdits({
      site: "s",
      category: "content.field",
      entries: [sampleEntry()],
    });
    const b = fingerprintEdits({
      site: "s",
      category: "content.field",
      entries: [sampleEntry({ updates: [{ field_path: "call_to_action.title", value: "New title" }] })],
    });
    expect(a).toBe(b);
    const n1 = fingerprintNotes({
      site: "s",
      category: "content.field",
      relatedIssueIds: ["b", "a"],
      summary: "Tried X then Y because Z ".repeat(8),
    });
    const n2 = fingerprintNotes({
      site: "s",
      category: "content.field",
      relatedIssueIds: ["a", "b"],
      summary: "  tried x then y because z ".repeat(8),
    });
    expect(n1).toBe(n2);
  });

  it("rejects unknown issue ids", async () => {
    const svc = makeService({ issueExists: () => false });
    const res = await svc.create(
      {
        title: "Fix CTA",
        summary: "I could not complete the issue so here is the plan of what I tried and recommend next. ".repeat(2),
        related_issue_ids: ["missing"],
      },
      { username: "alice" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("unknown_issue_id");
  });

  it("returns existing open proposal on same fingerprint", async () => {
    const svc = makeService();
    const payload = {
      title: "CTA",
      summary: "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2),
      entries: [sampleEntry()],
    };
    const first = await svc.create(payload, { username: "alice" });
    const second = await svc.create(payload, { username: "bob" });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.duplicate).toBe(true);
      expect(second.proposal.id).toBe(first.proposal.id);
    }
  });

  it("blocks four-eyes apply; close allows proposer with a reason", async () => {
    const svc = makeService();
    const created = await svc.create(
      {
        title: "CTA",
        summary: "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2),
        entries: [sampleEntry()],
      },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const self = await svc.update(created.proposal.id, "apply", { username: "alice" });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.code).toBe("four_eyes");

    const notes = await svc.create(
      {
        title: "Handoff",
        summary: "Tried updating meta then hit a permission wall; recommend setting the title from H1. ".repeat(2),
        related_issue_ids: ["abc"],
      },
      { username: "alice" },
    );
    expect(notes.ok).toBe(true);
    if (!notes.ok) return;
    expect(notes.proposal.no_auto_retry).toBe(true);
    const closeSelf = await svc.update(notes.proposal.id, "close", {
      username: "alice",
      close_reason: "wont_fix",
    });
    expect(closeSelf.ok).toBe(true);
    if (!closeSelf.ok) return;
    expect(closeSelf.proposal.status).toBe("finished");
    expect(closeSelf.proposal.close_reason).toBe("wont_fix");
  });

  it("applies remaining entries, skips done, marks stale, and rolls up partial then finished", async () => {
    const live: Record<string, unknown> = {
      "call_to_action.title": "Old A",
      "meta.page_title": "Old B",
    };
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: (entry) => {
        const values: Record<string, unknown> = {};
        for (const u of entry.updates) values[u.field_path] = live[u.field_path];
        return { values };
      },
      applyUpdates: async (entry) => {
        if (entry.slug === "b") return { ok: false, error: "boom" };
        for (const u of entry.ops) live[u.field_path] = u.value;
        return { ok: true };
      },
    });
    const created = await svc.create(
      {
        title: "Two posts",
        summary: "Align CTA and SEO title across two related blog posts in Spanish locale. ".repeat(2),
        entries: [
          sampleEntry({ slug: "a", updates: [{ field_path: "call_to_action.title", value: "New A" }] }),
          {
            contentType: "blog",
            slug: "b",
            locale: "es",
            updates: [{ field_path: "meta.page_title", value: "New B" }],
          },
        ],
      },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const first = await svc.update(created.proposal.id, "apply", { username: "bob" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.proposal.status).toBe("partial");
    expect(first.proposal.entries.find((e) => e.slug === "a")?.status).toBe("done");
    expect(first.proposal.entries.find((e) => e.slug === "b")?.status).toBe("failed");

    const svc2 = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: (entry) => {
        const values: Record<string, unknown> = {};
        for (const u of entry.updates) values[u.field_path] = live[u.field_path];
        return { values };
      },
      applyUpdates: async (entry) => {
        for (const u of entry.ops) live[u.field_path] = u.value;
        return { ok: true };
      },
    });
    const second = await svc2.update(created.proposal.id, "apply", { username: "bob" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.proposal.status).toBe("finished");
    expect(second.proposal.entries.every((e) => e.status === "done")).toBe(true);
  });

  it("marks context_stale when live diverged", async () => {
    let liveTitle = "Old title";
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: (entry) => {
        const values: Record<string, unknown> = {};
        for (const u of entry.updates) values[u.field_path] = liveTitle;
        return { values };
      },
      applyUpdates: async () => ({ ok: true }),
    });
    const created = await svc.create(
      {
        title: "CTA",
        summary: "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2),
        entries: [sampleEntry()],
      },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    liveTitle = "Someone else changed it";
    const applied = await svc.update(created.proposal.id, "apply", { username: "bob" });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.proposal.entries[0]?.status).toBe("failed");
    expect(applied.proposal.entries[0]?.last_error).toMatch(/context_stale/);
  });

  it("soft-blocks similar proposals until confirm_distinct", async () => {
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: { "call_to_action.title": "Old title" } }),
      applyUpdates: async () => ({ ok: true }),
      findSimilar: async () => [{ id: "other", title: "Nearby", score: 0.9 }],
    });
    const payload = {
      title: "CTA",
      summary: "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2),
      entries: [sampleEntry()],
    };
    const blocked = await svc.create(payload, { username: "alice" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("similar_proposals");
    const created = await svc.create({ ...payload, confirm_distinct: true }, { username: "alice" });
    expect(created.ok).toBe(true);
  });

  it("closes notes with reason; acknowledge alias requires same fields", async () => {
    const svc = makeService();
    const created = await svc.create(
      {
        title: "Handoff",
        summary: "Tried updating meta then hit a permission wall; recommend setting the title from H1. ".repeat(2),
      },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.proposal.kind).toBe("notes");
    const missing = await svc.update(created.proposal.id, "acknowledge", { username: "bob" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("close_reason_required");

    const ack = await svc.update(created.proposal.id, "acknowledge", {
      username: "bob",
      close_reason: "fixed_elsewhere",
      close_note: "Shipped via edits proposal abc-123 after manual cluster fix.",
    });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.proposal.status).toBe("finished");
    expect(ack.proposal.close_reason).toBe("fixed_elsewhere");
    expect(ack.proposal.closed_by).toBe("bob");
  });

  it("blocks duplicate notes on same issue when no_auto_retry; edits still allowed", async () => {
    const svc = makeService();
    const summary =
      "Tried updating meta then hit a permission wall; recommend setting the title from H1. ".repeat(2);
    const first = await svc.create(
      { title: "Handoff A", summary, related_issue_ids: ["iss-1"] },
      { username: "alice" },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await svc.create(
      {
        title: "Handoff B",
        summary: `${summary} Different wording to bypass fingerprint.`,
        related_issue_ids: ["iss-1"],
      },
      { username: "bob" },
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("notes_no_auto_retry");
      expect(second.existing_proposal?.id).toBe(first.proposal.id);
    }
    const edits = await svc.create(
      {
        title: "Fix",
        summary: "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2),
        related_issue_ids: ["iss-1"],
        entries: [sampleEntry()],
      },
      { username: "bob" },
    );
    expect(edits.ok).toBe(true);
  });

  it("allows freestanding duplicate-ish notes without related issues", async () => {
    const svc = makeService();
    const summary =
      "Tried updating meta then hit a permission wall; recommend setting the title from H1. ".repeat(2);
    const first = await svc.create({ title: "Handoff A", summary }, { username: "alice" });
    const second = await svc.create(
      { title: "Handoff B", summary: `${summary} Extra.` },
      { username: "bob" },
    );
    expect(first.ok && second.ok).toBe(true);
  });

  it("MCP must claim before clearing no_auto_retry; staff UI need not", async () => {
    const svc = makeService();
    const created = await svc.create(
      {
        title: "Handoff",
        summary: "Tried updating meta then hit a permission wall; recommend setting the title from H1. ".repeat(2),
        related_issue_ids: ["iss-2"],
      },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const mcpDenied = await svc.update(created.proposal.id, "set_no_auto_retry", {
      username: "bob",
      actor: { type: "mcp", client: "cursor" },
      no_auto_retry: false,
    });
    expect(mcpDenied.ok).toBe(false);
    if (!mcpDenied.ok) expect(mcpDenied.code).toBe("not_claimant");

    await svc.update(created.proposal.id, "claim", {
      username: "bob",
      actor: { type: "mcp", client: "cursor" },
    });
    const mcpOk = await svc.update(created.proposal.id, "set_no_auto_retry", {
      username: "bob",
      actor: { type: "mcp", client: "cursor" },
      no_auto_retry: false,
    });
    expect(mcpOk.ok).toBe(true);
    if (!mcpOk.ok) return;
    expect(mcpOk.proposal.no_auto_retry).toBe(false);

    const staffOk = await svc.update(created.proposal.id, "set_no_auto_retry", {
      username: "carol",
      actor: { type: "ui" },
      no_auto_retry: true,
    });
    expect(staffOk.ok).toBe(true);
    if (!staffOk.ok) return;
    expect(staffOk.proposal.no_auto_retry).toBe(true);
  });

  it("stats by_kind_status is a full zero matrix on an empty site", () => {
    const s = makeService().stats();
    expect(s.total).toBe(0);
    expect(s.by_kind_status).toEqual({
      idea: { open: 0, finished: 0, rejected: 0 },
      edits: { open: 0, finished: 0, rejected: 0 },
      notes: { open: 0, finished: 0, rejected: 0 },
    });
  });

  it("stats counts by status and kind; list supports offset", async () => {
    const svc = makeService();
    const summary =
      "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2);
    for (let i = 0; i < 3; i++) {
      const created = await svc.create(
        {
          title: `CTA ${i}`,
          summary,
          entries: [sampleEntry({ slug: `post-${i}` })],
        },
        { username: "alice" },
      );
      expect(created.ok).toBe(true);
    }
    const notes = await svc.create(
      {
        title: "Handoff",
        summary: "Tried updating meta then hit a permission wall; recommend setting the title from H1. ".repeat(2),
      },
      { username: "alice" },
    );
    expect(notes.ok).toBe(true);

    const s = svc.stats();
    expect(s.total).toBe(4);
    expect(s.by_kind.edits).toBe(3);
    expect(s.by_kind.notes).toBe(1);
    expect(s.by_status.open).toBe(4);
    expect(s.by_kind_status.edits.open).toBe(3);
    expect(s.by_kind_status.notes.open).toBe(1);
    expect(s.by_kind_status.idea.open).toBe(0);
    expect(s.by_kind_status.idea).toEqual({ open: 0, finished: 0, rejected: 0 });
    expect(s.by_kind_status.edits.finished).toBe(0);
    expect(s.by_kind_status.edits.rejected).toBe(0);
    expect(s.by_kind_status.notes.finished).toBe(0);
    expect(s.by_kind_status.notes.rejected).toBe(0);

    const page = svc.list({ kind: "edits", limit: 2, offset: 0 });
    expect(page.total).toBe(3);
    expect(page.proposals).toHaveLength(2);
    const page2 = svc.list({ kind: "edits", limit: 2, offset: 2 });
    expect(page2.proposals).toHaveLength(1);
  });

  it("list sorts by created_at asc with id tie-break", async () => {
    const svc = makeService();
    const summary =
      "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2);
    for (let i = 0; i < 3; i++) {
      const created = await svc.create(
        {
          title: `Order ${i}`,
          summary,
          entries: [sampleEntry({ slug: `order-${i}` })],
        },
        { username: "alice" },
      );
      expect(created.ok).toBe(true);
    }
    const asc = svc.list({ kind: "edits", sort: "created_at", sortDir: "asc", limit: 10 });
    expect(asc.proposals).toHaveLength(3);
    expect(asc.proposals[0]!.created_at).toBeLessThanOrEqual(asc.proposals[1]!.created_at);
    expect(asc.proposals[1]!.created_at).toBeLessThanOrEqual(asc.proposals[2]!.created_at);
    const desc = svc.list({ kind: "edits", sort: "updated_at", sortDir: "desc", limit: 10 });
    expect(desc.proposals[0]!.updated_at).toBeGreaterThanOrEqual(desc.proposals[1]!.updated_at);
  });

  it("list query matches proposal id and proposer username", async () => {
    const svc = makeService();
    const summary =
      "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2);
    const byAlice = await svc.create(
      { title: "Alpha", summary, entries: [sampleEntry({ slug: "q-alpha" })] },
      { username: "alice" },
    );
    const byBob = await svc.create(
      { title: "Beta", summary, entries: [sampleEntry({ slug: "q-beta" })] },
      { username: "Bob.Builder" },
    );
    expect(byAlice.ok && byBob.ok).toBe(true);
    if (!byAlice.ok || !byBob.ok) return;
    const aliceId = byAlice.proposal.id;

    const full = svc.list({ query: aliceId, limit: 10 });
    expect(full.proposals.map((p) => p.id)).toEqual([aliceId]);
    const prefix = svc.list({ query: aliceId.slice(0, 8).toUpperCase(), limit: 10 });
    expect(prefix.proposals.map((p) => p.id)).toContain(aliceId);

    const author = svc.list({ query: "builder", limit: 10 });
    expect(author.proposals.map((p) => p.id)).toEqual([byBob.proposal.id]);

    const acrossFields = svc.list({ query: "  beta   BOB ", limit: 10 });
    expect(acrossFields.proposals.map((p) => p.id)).toEqual([byBob.proposal.id]);
    const reordered = svc.list({ query: `${aliceId.slice(0, 6)} alpha`, limit: 10 });
    expect(reordered.proposals.map((p) => p.id)).toEqual([aliceId]);
    expect(svc.list({ query: "alpha bob", limit: 10 }).total).toBe(0);
    expect(svc.list({ query: "q_alpha", limit: 10 }).total).toBe(0);
  });

  it("proposalQueryTerms splits, dedupes, and caps terms", () => {
    expect(proposalQueryTerms(undefined)).toEqual([]);
    expect(proposalQueryTerms("   ")).toEqual([]);
    expect(proposalQueryTerms("Alice  CTA alice")).toEqual(["alice", "cta"]);
    expect(proposalQueryTerms("a b c d e f g h i j")).toHaveLength(8);
  });

  it("list attention sort, filter, status bias, and summary fields", async () => {
    const svc = makeService();
    const summary =
      "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2);
    const body =
      "The CTA is too vague for this locale. Fixed looks like a concrete next step. Why: conversion. ".repeat(
        2,
      );

    const none = await svc.create(
      {
        title: "No feedback",
        summary,
        entries: [sampleEntry({ slug: "att-none" })],
      },
      { username: "alice" },
    );
    expect(none.ok).toBe(true);
    if (!none.ok) return;

    const blocked = await svc.create(
      {
        title: "Blocked",
        summary,
        entries: [sampleEntry({ slug: "att-blocked" })],
      },
      { username: "alice" },
    );
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    const addB = await svc.update(blocked.proposal.id, "add_blocker", {
      username: "blake",
      body,
    });
    expect(addB.ok).toBe(true);

    const rereview = await svc.create(
      {
        title: "Rereview",
        summary,
        entries: [sampleEntry({ slug: "att-rereview" })],
      },
      { username: "alice" },
    );
    expect(rereview.ok).toBe(true);
    if (!rereview.ok) return;
    const addR = await svc.update(rereview.proposal.id, "add_blocker", {
      username: "blake",
      body,
    });
    expect(addR.ok).toBe(true);
    const bid = svc.get(rereview.proposal.id)!.blockers[0]!.id;
    await svc.update(rereview.proposal.id, "claim", { username: "alice" });
    const resolved = await svc.update(rereview.proposal.id, "resolve_blocker", {
      username: "alice",
      blocker_id: bid,
      resolve_note: "Updated the CTA copy to match the review feedback.",
    });
    expect(resolved.ok).toBe(true);

    const stats = svc.stats();
    expect(stats.by_attention.no_feedback).toBeGreaterThanOrEqual(1);
    expect(stats.by_attention.blocked).toBeGreaterThanOrEqual(1);
    expect(stats.by_attention.awaiting_rereview).toBeGreaterThanOrEqual(1);

    const reviewer = svc.list({
      sort: "attention",
      attention_perspective: "reviewer",
      limit: 20,
    });
    expect(reviewer.status_bias_applied).toBe(true);
    expect(reviewer.attention_perspective).toBe("reviewer");
    const titles = reviewer.proposals.map((p) => p.title);
    const iRereview = titles.indexOf("Rereview");
    const iNone = titles.indexOf("No feedback");
    const iBlocked = titles.indexOf("Blocked");
    expect(iRereview).toBeGreaterThanOrEqual(0);
    expect(iNone).toBeGreaterThan(iRereview);
    expect(iBlocked).toBeGreaterThan(iNone);

    const author = svc.list({
      sort: "attention",
      attention_perspective: "author",
      limit: 20,
    });
    const authorTitles = author.proposals.map((p) => p.title);
    expect(authorTitles.indexOf("Blocked")).toBeLessThan(authorTitles.indexOf("Rereview"));

    const onlyRereview = svc.list({
      attention: "awaiting_rereview",
      sort: "attention",
      limit: 20,
    });
    expect(onlyRereview.proposals.every((p) => p.title === "Rereview")).toBe(true);

    const finishedOnly = svc.list({
      status: "finished",
      sort: "attention",
      limit: 20,
    });
    expect(finishedOnly.status_bias_applied).toBe(false);
    expect(finishedOnly.total).toBe(0);

    const chrono = svc.list({ kind: "edits", sort: "updated_at", limit: 20 });
    expect(chrono.status_bias_applied).toBe(false);

    const summaryRow = toProposalSummary(svc.get(rereview.proposal.id)!);
    expect(summaryRow.attention).toBe("awaiting_rereview");
    expect(summaryRow.resolved_blocker_count).toBe(1);
    expect(summaryRow.open_blocker_count).toBe(0);
  });

  it("author revise moves unblocked edits to re-check and leaves open blockers blocked", async () => {
    const svc = makeService();
    const summary =
      "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2);
    const author = { username: "alice", actor: { type: "mcp" as const, role: "content" } };

    const clean = await svc.create(
      {
        title: "Rewrite first",
        summary,
        entries: [sampleEntry({ slug: "att-rewrite" })],
      },
      author,
    );
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    expect(toProposalSummary(clean.proposal).attention).toBe("no_feedback");

    const revised = await svc.update(clean.proposal.id, "revise_entries", {
      ...author,
      entries: [
        sampleEntry({
          slug: "att-rewrite",
          updates: [{ field_path: "call_to_action.title", value: "Newer title" }],
        }),
      ],
    });
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    expect(toProposalSummary(revised.proposal).attention).toBe("awaiting_rereview");

    const held = await svc.create(
      {
        title: "Held rewrite",
        summary,
        entries: [sampleEntry({ slug: "att-held" })],
      },
      author,
    );
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    const body =
      "The CTA is too vague for this locale. Fixed looks like a concrete next step. Why: conversion. ".repeat(
        2,
      );
    expect(
      (
        await svc.update(held.proposal.id, "add_blocker", {
          username: "blake",
          body,
        })
      ).ok,
    ).toBe(true);
    const heldRevise = await svc.update(held.proposal.id, "revise_entries", {
      ...author,
      entries: [
        sampleEntry({
          slug: "att-held",
          updates: [{ field_path: "call_to_action.title", value: "Still held" }],
        }),
      ],
    });
    expect(heldRevise.ok).toBe(true);
    if (!heldRevise.ok) return;
    expect(toProposalSummary(heldRevise.proposal).attention).toBe("blocked");

    expect(svc.stats().needs_review_edits).toBeGreaterThanOrEqual(1);
    const queue = svc.list({ needs_review: true, status: "finished", kind: "notes", limit: 20 });
    const titles = queue.proposals.map((p) => p.title);
    expect(titles).toContain("Rewrite first");
    expect(titles).not.toContain("Held rewrite");
    expect(queue.proposals.every((p) => p.kind === "edits")).toBe(true);
    expect(queue.status_bias_applied).toBe(true);
  });

  it("parseProposerActorType accepts enums and rejects invalid", () => {
    expect(parseProposerActorType(undefined)).toEqual({ ok: true, type: undefined });
    expect(parseProposerActorType("")).toEqual({ ok: true, type: undefined });
    expect(parseProposerActorType("ui")).toEqual({ ok: true, type: "ui" });
    expect(parseProposerActorType("mcp")).toEqual({ ok: true, type: "mcp" });
    expect(parseProposerActorType("staff").ok).toBe(false);
  });

  it("list filters by proposer_username, actor type/role, and agent_session_id", async () => {
    const svc = makeService();
    const summary =
      "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2);

    const staff = await svc.create(
      {
        title: "Staff CTA",
        summary,
        entries: [sampleEntry({ slug: "staff-post" })],
      },
      { username: "Alice@4geeks.com", actor: { type: "ui" } },
    );
    expect(staff.ok).toBe(true);

    const copyEditor = await svc.create(
      {
        title: "Copy editor CTA",
        summary,
        entries: [sampleEntry({ slug: "copy-post" })],
        agent_session_id: "sess-copy-1",
      },
      {
        username: "bob@4geeks.com",
        actor: { type: "mcp", role: "copy_editor", model: "claude/sonnet-4.5", client: "Cursor" },
      },
    );
    expect(copyEditor.ok).toBe(true);

    const seo = await svc.create(
      {
        title: "SEO CTA",
        summary,
        entries: [sampleEntry({ slug: "seo-post" })],
        agent_session_id: "sess-seo-1",
      },
      {
        username: "carol@4geeks.com",
        actor: { type: "mcp", role: "seo_specialist", model: "claude/sonnet-4.5", client: "Cursor" },
      },
    );
    expect(seo.ok).toBe(true);

    const byUser = svc.list({ proposer_username: "alice@4geeks.com" });
    expect(byUser.total).toBe(1);
    expect(byUser.proposals[0]!.proposer_username).toBe("Alice@4geeks.com");
    expect(svc.list({ proposer_username: "alice" }).total).toBe(0);

    const staffOnly = svc.list({ proposer_actor_type: "ui" });
    expect(staffOnly.total).toBe(1);
    expect(staffOnly.proposals[0]!.id).toBe(staff.ok ? staff.proposal.id : "");

    const byRole = svc.list({ proposer_actor_role: "copy_editor" });
    expect(byRole.total).toBe(1);
    expect(byRole.proposals[0]!.id).toBe(copyEditor.ok ? copyEditor.proposal.id : "");

    const roleAndType = svc.list({
      proposer_actor_type: "mcp",
      proposer_actor_role: "seo_specialist",
    });
    expect(roleAndType.total).toBe(1);
    expect(roleAndType.proposals[0]!.id).toBe(seo.ok ? seo.proposal.id : "");

    const bySession = svc.list({ agent_session_id: "sess-copy-1" });
    expect(bySession.total).toBe(1);
    expect(bySession.proposals[0]!.created_agent_session_id).toBe("sess-copy-1");
    expect(svc.list({ agent_session_id: "sess-missing" }).total).toBe(0);

    const combined = svc.list({
      status: "open",
      proposer_username: "bob@4geeks.com",
    });
    expect(combined.total).toBe(1);
    expect(combined.proposals[0]!.id).toBe(copyEditor.ok ? copyEditor.proposal.id : "");
  });

  it("listRecentProposers uses updated_at window and dedupes case-insensitively", async () => {
    const svc = makeService();
    const summary =
      "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2);

    const recent = await svc.create(
      {
        title: "Recent proposer",
        summary,
        entries: [sampleEntry({ slug: "recent-post" })],
      },
      { username: "Alice@4geeks.com", actor: { type: "ui" } },
    );
    expect(recent.ok).toBe(true);

    const alsoRecent = await svc.create(
      {
        title: "Also recent",
        summary,
        entries: [sampleEntry({ slug: "also-recent" })],
      },
      { username: "bob@4geeks.com", actor: { type: "mcp", role: "copy_editor" } },
    );
    expect(alsoRecent.ok).toBe(true);

    const stale = await svc.create(
      {
        title: "Stale proposer",
        summary,
        entries: [sampleEntry({ slug: "stale-post" })],
      },
      { username: "carol@4geeks.com", actor: { type: "ui" } },
    );
    expect(stale.ok).toBe(true);

    const db = getSiteSqlite(SITE);
    const staleMs = Date.now() - 40 * 24 * 60 * 60 * 1000;
    db.prepare(`UPDATE content_proposals SET updated_at = ? WHERE id = ?`).run(
      staleMs,
      stale.ok ? stale.proposal.id : "",
    );

    // Same person, different casing — should collapse to one entry.
    const dupCase = await svc.create(
      {
        title: "Dup case",
        summary,
        entries: [sampleEntry({ slug: "dup-case" })],
      },
      { username: "alice@4geeks.com", actor: { type: "ui" } },
    );
    expect(dupCase.ok).toBe(true);

    const proposers = svc.listRecentProposers({ days: 30 });
    expect(proposers.map((u) => u.toLowerCase()).sort()).toEqual([
      "alice@4geeks.com",
      "bob@4geeks.com",
    ]);
    expect(proposers.some((u) => u.toLowerCase() === "carol@4geeks.com")).toBe(false);
  });

  it("enforces one open proposal per variant", async () => {
    const svc = makeService({
      liveValues: { "call_to_action.title": "Old" },
    });
    const fps = new Map<string, string>([["agent-fix", "fp1"]]);
    const svcFp = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: (entry) => {
        const values: Record<string, unknown> = {};
        for (const u of entry.updates ?? []) values[u.field_path] = "Old";
        return { values };
      },
      applyUpdates: async () => ({ ok: true }),
      readVariantFingerprint: ({ variant }) => {
        const fp = fps.get(variant);
        if (!fp) return { fingerprint: "", error: "missing" };
        return { fingerprint: fp };
      },
    });
    const summary =
      "Prepare a clearer CTA on the agent-fix draft for this Spanish blog post review. ".repeat(2);
    const first = await svcFp.create(
      {
        title: "Draft CTA",
        summary,
        entries: [
          sampleEntry({
            variant: "agent-fix",
            updates: [{ field_path: "call_to_action.title", value: "New" }],
          }),
        ],
      },
      { username: "alice" },
    );
    expect(first.ok).toBe(true);
    const second = await svcFp.create(
      {
        title: "Draft CTA 2",
        summary: summary + "x",
        confirm_distinct: true,
        entries: [
          sampleEntry({
            variant: "agent-fix",
            updates: [{ field_path: "call_to_action.title", value: "Other" }],
          }),
        ],
      },
      { username: "bob" },
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(["competing_entry_edits", "proposal_exists"]).toContain(second.code);
      expect(second.existing_proposal?.id).toBe(first.ok ? first.proposal.id : "");
    }
  });

  it("allows draft_backed empty ops and blocks apply while blockers open; reject ignores blockers", async () => {
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: {} }),
      applyUpdates: async () => ({ ok: true }),
      readVariantFingerprint: () => ({ fingerprint: "abc123" }),
      promoteEntry: async () => ({ ok: true }),
    });
    const summary =
      "Ship the prepared agent-fix draft for the Spanish blog after review and four-eyes approve. ".repeat(2);
    const created = await svc.create(
      {
        title: "Go live",
        summary,
        promote_on_apply: true,
        agent_session_id: "sess-1",
        entries: [{ contentType: "blog", slug: "hello", locale: "es", variant: "agent-fix", updates: [] }],
      },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.proposal.review_mode).toBe("draft_backed");
    expect(created.proposal.entries[0]?.ops).toEqual([]);

    const short = await svc.update(created.proposal.id, "add_blocker", {
      username: "blake",
      body: "too short",
    });
    expect(short.ok).toBe(false);

    const body =
      "On draft agent-fix (es), hero CTA still goes to Coding Bootcamp. Must use AI Flex because leads go to the wrong funnel.";
    const blocked = await svc.update(created.proposal.id, "add_blocker", {
      username: "blake",
      body,
    });
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    expect(blocked.proposal.open_blocker_count).toBe(1);

    const applyBlocked = await svc.update(created.proposal.id, "apply", { username: "casey" });
    expect(applyBlocked.ok).toBe(false);
    if (!applyBlocked.ok) expect(applyBlocked.code).toBe("proposal_blocked");

    const rejected = await svc.update(created.proposal.id, "reject", {
      username: "casey",
      confirm_reject: true,
      reject_kind: "bad_idea",
      close_note:
        "This approach is fundamentally wrong for brand and SEO and must not ship even if polished.",
    });
    expect(rejected.ok).toBe(true);
    if (rejected.ok) {
      expect(rejected.proposal.status).toBe("rejected");
      expect(rejected.proposal.close_reason).toBe("bad_idea");
      expect(rejected.proposal.close_note).toContain("fundamentally wrong");
    }
  });

  it("claimant-only resolve; expired claim hints claim first; soft apply into variant", async () => {
    const live: Record<string, unknown> = { "call_to_action.title": "Old" };
    const fps = new Map([["agent-fix", "fp-stable"]]);
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: (entry) => {
        const values: Record<string, unknown> = {};
        for (const u of entry.updates ?? []) values[u.field_path] = live[u.field_path];
        return { values };
      },
      applyUpdates: async (entry) => {
        for (const u of entry.ops) live[u.field_path] = u.value;
        return { ok: true };
      },
      readVariantFingerprint: ({ variant }) => ({ fingerprint: fps.get(variant) ?? "" }),
    });
    const summary =
      "Patch the CTA title on the agent-fix draft for this Spanish blog before go-live. ".repeat(2);
    const created = await svc.create(
      {
        title: "Soft draft",
        summary,
        agent_session_id: "sess-a",
        entries: [
          sampleEntry({
            variant: "agent-fix",
            updates: [{ field_path: "call_to_action.title", value: "New" }],
          }),
        ],
      },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.proposal.review_mode).toBe("soft_variant");

    const body =
      "On draft agent-fix, CTA title is too vague. Must say Enroll now for AI Flex because conversion copy must match the product.";
    await svc.update(created.proposal.id, "add_blocker", { username: "blake", body });

    const resolveNoClaim = await svc.update(created.proposal.id, "resolve_blocker", {
      username: "alice",
      blocker_id: created.proposal.blockers[0]?.id ?? 1,
      resolve_note: "Updated CTA title to Enroll now for AI Flex on the draft.",
    });
    // blocker id from refreshed proposal
    const afterBlock = svc.get(created.proposal.id)!;
    const bid = afterBlock.blockers[0]!.id;
    const stillNo = await svc.update(created.proposal.id, "resolve_blocker", {
      username: "alice",
      blocker_id: bid,
      resolve_note: "Updated CTA title to Enroll now for AI Flex on the draft.",
    });
    expect(stillNo.ok).toBe(false);
    if (!stillNo.ok) expect(stillNo.code).toBe("not_claimant");

    await svc.update(created.proposal.id, "claim", { username: "alice" });
    const resolved = await svc.update(created.proposal.id, "resolve_blocker", {
      username: "alice",
      blocker_id: bid,
      resolve_note: "Updated CTA title to Enroll now for AI Flex on the draft.",
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.warnings?.some((w) => w.code === "blockers_cleared_repreview")).toBe(true);
    }

    const applied = await svc.update(created.proposal.id, "apply", { username: "bob" });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.proposal.status).toBe("finished");
      expect(applied.proposal.closed_at).toBeTypeOf("number");
      expect(applied.proposal.closed_by).toBe("bob");
      expect(live["call_to_action.title"]).toBe("New");
    }
    void resolveNoClaim;
  });

  it("expired claim cannot resolve until reclaim; withdraw ignores open blockers", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    try {
      const svc = createProposalService({
        site: SITE,
        issueExists: () => true,
        captureBaseline: () => ({ values: {} }),
        applyUpdates: async () => ({ ok: true }),
        readVariantFingerprint: () => ({ fingerprint: "fp" }),
      });
      const summary =
        "Soft suggestion on agent-fix draft for Spanish blog CTA copy review after feedback. ".repeat(2);
      const created = await svc.create(
        {
          title: "Expire claim",
          summary,
          entries: [
            sampleEntry({
              variant: "agent-fix",
              updates: [{ field_path: "call_to_action.title", value: "New" }],
            }),
          ],
        },
        { username: "alice" },
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const body =
        "On draft agent-fix, CTA title is too vague. Must say Enroll now for AI Flex because conversion copy must match the product.";
      await svc.update(created.proposal.id, "add_blocker", { username: "blake", body });
      await svc.update(created.proposal.id, "claim", { username: "alice" });
      const bid = svc.get(created.proposal.id)!.blockers[0]!.id;

      vi.setSystemTime(now + PROPOSAL_CLAIM_TTL_MS + 1000);
      const expired = await svc.update(created.proposal.id, "resolve_blocker", {
        username: "alice",
        blocker_id: bid,
        resolve_note: "Updated CTA title to Enroll now for AI Flex on the draft.",
      });
      expect(expired.ok).toBe(false);
      if (!expired.ok) {
        expect(expired.code).toBe("not_claimant");
        expect(expired.claim_expired).toBe(true);
      }

      const withdrawn = await svc.update(created.proposal.id, "withdraw", {
        username: "alice",
        close_note: "Pulling back while open blockers remain; will refile later.",
      });
      expect(withdrawn.ok).toBe(true);
      if (withdrawn.ok) expect(withdrawn.proposal.status).toBe("withdrawn");
    } finally {
      vi.useRealTimers();
    }
  });

  it("listOpenProposalsForVariant returns open proposals referencing a draft", async () => {
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: {} }),
      applyUpdates: async () => ({ ok: true }),
      readVariantFingerprint: () => ({ fingerprint: "fp" }),
    });
    const summary =
      "List helper finds open proposals that still reference agent-fix for delete warnings. ".repeat(2);
    const created = await svc.create(
      {
        title: "Open on variant",
        summary,
        entries: [
          sampleEntry({
            variant: "agent-fix",
            updates: [{ field_path: "call_to_action.title", value: "New" }],
          }),
        ],
      },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const listed = listOpenProposalsForVariant(SITE, "blog", "hello", "es", "agent-fix");
    expect(listed.some((p) => p.id === created.proposal.id)).toBe(true);
    expect(listOpenProposalsForVariant(SITE, "blog", "hello", "es", "other").length).toBe(0);
  });

  it("listOpenProposalsForEntry reports open blockers per proposal", async () => {
    const svc = makeService();
    const created = await svc.create(
      {
        title: "Entry list with blocker",
        summary: "Entry list helper should carry the open blocker count for the robot button. ".repeat(2),
        entries: [sampleEntry()],
      },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(listOpenProposalsForEntry(SITE, "blog", "hello")[0]?.open_blocker_count).toBe(0);
    const blocked = await svc.update(created.proposal.id, "add_blocker", {
      username: "blake",
      body: "Hero CTA still points at the old bootcamp page; it must point at AI Flex so leads reach the right funnel.",
    });
    expect(blocked.ok).toBe(true);
    const rows = listOpenProposalsForEntry(SITE, "blog", "hello");
    expect(rows.find((r) => r.id === created.proposal.id)?.open_blocker_count).toBe(1);
  });

  it("promote apply requires confirm_end_experiment when siblings have traffic", async () => {
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: {} }),
      applyUpdates: async () => ({ ok: true }),
      readVariantFingerprint: () => ({ fingerprint: "fp" }),
      promoteEntry: async (_e, _a, opts) => {
        if (!opts.confirm_end_experiment) {
          return {
            ok: false,
            code: "confirm_end_experiment",
            error: "need confirm",
            traffic_siblings: [{ slug: "hero-b", locale: "es", allocation: 30 }],
          };
        }
        return { ok: true };
      },
    });
    const summary =
      "Promote agent-fix over live and end the hero-b experiment after four-eyes review. ".repeat(2);
    const created = await svc.create(
      {
        title: "Promote",
        summary,
        promote_on_apply: true,
        entries: [{ contentType: "blog", slug: "hello", locale: "es", variant: "agent-fix" }],
      },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const need = await svc.update(created.proposal.id, "apply", { username: "bob" });
    expect(need.ok).toBe(false);
    if (!need.ok) {
      expect(need.code).toBe("confirm_end_experiment");
      expect(need.traffic_siblings?.[0]?.slug).toBe("hero-b");
    }
    const done = await svc.update(created.proposal.id, "apply", {
      username: "bob",
      confirm_end_experiment: true,
    });
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.proposal.status).toBe("finished");
  });

  it("persists proposer and claim actor provenance", async () => {
    const svc = makeService();
    const summary =
      "Store MCP client and model on the proposal so staff can see which agent acted on behalf of which human. ".repeat(
        1,
      );
    const created = await svc.create(
      {
        title: "Actor provenance",
        summary,
        entries: [sampleEntry()],
      },
      {
        username: "alice@4geeks.com",
        actor: { type: "mcp", client: "Cursor", model: "claude-4-sonnet" },
      },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.proposal.proposer_username).toBe("alice@4geeks.com");
    expect(created.proposal.proposer_actor).toEqual({
      type: "mcp",
      client: "Cursor",
      model: "claude-4-sonnet",
    });

    const claimed = await svc.update(created.proposal.id, "claim", {
      username: "alice@4geeks.com",
      actor: { type: "mcp", client: "Cursor", model: "claude-4-sonnet" },
    });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.proposal.claim?.by).toBe("alice@4geeks.com");
    expect(claimed.proposal.claim?.actor).toEqual({
      type: "mcp",
      client: "Cursor",
      model: "claude-4-sonnet",
    });

    // Same user can refresh claim with a different actor (UI).
    const staffClaim = await svc.update(created.proposal.id, "claim", {
      username: "alice@4geeks.com",
      actor: { type: "ui" },
    });
    expect(staffClaim.ok).toBe(true);
    if (!staffClaim.ok) return;
    expect(staffClaim.proposal.claim?.actor).toEqual({ type: "ui" });
  });

  it("creates idea, accepts with next_step (four-eyes), parks with tracked_elsewhere", async () => {
    const svc = makeService();
    const summary =
      "Pitch a new Miami spoke landing for the AI bootcamp with a short brief for later edits work. ".repeat(
        2,
      );
    const mcpAlice = {
      username: "alice",
      actor: {
        type: "mcp" as const,
        client: "Cursor",
        role: "copy_editor",
        model: "claude/sonnet-4.5",
      },
    };
    const mcpBob = {
      username: "bob",
      actor: {
        type: "mcp" as const,
        client: "Cursor",
        role: "seo_specialist",
        model: "claude/sonnet-4.5",
      },
    };
    const created = await svc.create(
      {
        kind: "idea",
        title: "New Miami AI spoke",
        summary,
        related_entries: [{ contentType: "landing", slug: "miami-ai-bootcamp-new" }],
      },
      mcpAlice,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.proposal.kind).toBe("idea");
    expect(created.proposal.related_entries?.[0]?.slug).toBe("miami-ai-bootcamp-new");

    const withSituations = await svc.create(
      {
        kind: "idea",
        title: "Idea with illegal situations",
        summary:
          "Pitch that wrongly declares review situations which are edits-only on this API. ".repeat(2),
        review_situations: ["body_copy_edit"],
      },
      mcpAlice,
    );
    expect(withSituations.ok).toBe(false);
    if (!withSituations.ok) expect(withSituations.code).toBe("review_situations_idea_labels_only");

    const withTwoLabels = await svc.create(
      {
        kind: "idea",
        title: "Idea with two demand labels",
        summary:
          "Pitch that wrongly declares two demand labels which must be at most one. ".repeat(2),
        review_situations: ["anticipated_demand", "broken_url"],
      },
      mcpAlice,
    );
    expect(withTwoLabels.ok).toBe(false);
    if (!withTwoLabels.ok) expect(withTwoLabels.code).toBe("review_situations_idea_one_label");

    const withDemand = await svc.create(
      {
        kind: "idea",
        title: "Anticipated demand brief",
        summary:
          "New tutor product launch; lasting how-to queries after the announcement fades. ".repeat(2),
        review_situations: ["anticipated_demand"],
      },
      mcpAlice,
    );
    expect(withDemand.ok).toBe(true);
    if (!withDemand.ok) return;
    expect(withDemand.proposal.review_situations).toEqual(["anticipated_demand"]);

    const incompleteStillCreates = await svc.create(
      {
        kind: "idea",
        title: "Thin brief",
        summary:
          "Just a cluster hole story without goal evidence or kill line but still long enough. ".repeat(2),
      },
      mcpAlice,
    );
    expect(incompleteStillCreates.ok).toBe(true);

    const setDefaultOnIdea = await svc.update(created.proposal.id, "set_review_situations", {
      ...mcpAlice,
      review_situations: ["idea_opportunity_harm"],
    });
    expect(setDefaultOnIdea.ok).toBe(false);
    if (!setDefaultOnIdea.ok) {
      expect(setDefaultOnIdea.code).toBe("review_situations_idea_labels_only");
    }

    const setDemandOnIdea = await svc.update(created.proposal.id, "set_review_situations", {
      ...mcpAlice,
      review_situations: ["broken_url"],
    });
    expect(setDemandOnIdea.ok).toBe(true);
    if (!setDemandOnIdea.ok) return;
    expect(setDemandOnIdea.proposal.review_situations).toEqual(["broken_url"]);

    const clearDemand = await svc.update(created.proposal.id, "set_review_situations", {
      ...mcpAlice,
      review_situations: [],
    });
    expect(clearDemand.ok).toBe(true);
    if (!clearDemand.ok) return;
    expect(clearDemand.proposal.review_situations ?? []).toEqual([]);

    const selfAccept = await svc.update(created.proposal.id, "accept", {
      ...mcpAlice,
      next_step: "Draft the landing hero and CTA in a follow-up edits proposal.",
    });
    expect(selfAccept.ok).toBe(false);
    if (!selfAccept.ok) expect(selfAccept.code).toBe("four_eyes");

    const short = await svc.update(created.proposal.id, "accept", {
      ...mcpBob,
      next_step: "too short",
    });
    expect(short.ok).toBe(false);

    const accepted = await svc.update(created.proposal.id, "accept", {
      ...mcpBob,
      next_step: "Open an edits proposal for landing/miami-ai-bootcamp-new after research.",
      accepted_entry: {
        contentType: "landing",
        slug: "miami-ai-bootcamp-new",
        locale: "en",
      },
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.proposal.status).toBe("finished");
    expect(accepted.proposal.close_reason).toBe("accepted");
    expect(accepted.proposal.close_note).toContain("edits proposal");
    expect(accepted.proposal.accepted_entry).toEqual({
      contentType: "landing",
      slug: "miami-ai-bootcamp-new",
      locale: "en",
    });
    expect(svc.stats().stalled_ideas).toBe(1);

    const park = await svc.create(
      {
        kind: "idea",
        title: "Duplicate-ish pitch B",
        summary:
          "Another brief about a catalog config change we may track in Linear instead of here. ".repeat(2),
      },
      mcpAlice,
    );
    expect(park.ok).toBe(true);
    if (!park.ok) return;
    const closed = await svc.update(park.proposal.id, "close", {
      ...mcpAlice,
      close_reason: "tracked_elsewhere",
      close_note: "Already tracked as LINEAR-123 for the catalog work.",
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.proposal.close_reason).toBe("tracked_elsewhere");
  });

  it("blocks idea accept while blockers open; same role cannot four-eyes", async () => {
    const svc = makeService();
    const summary =
      "Brief for updating scholarship FAQ structure before any YAML changes are filed. ".repeat(2);
    const aliceCopy = {
      username: "alice",
      actor: {
        type: "mcp" as const,
        role: "copy_editor",
        model: "claude/sonnet-4.5",
        client: "Cursor",
      },
    };
    const aliceSeo = {
      username: "alice",
      actor: {
        type: "mcp" as const,
        role: "seo_specialist",
        model: "claude/opus-4",
        client: "Cursor",
      },
    };
    const created = await svc.create(
      { kind: "idea", title: "Scholarship FAQ brief", summary },
      aliceCopy,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const sameRole = await svc.update(created.proposal.id, "accept", {
      username: "alice",
      actor: {
        type: "mcp",
        role: "copy_editor",
        model: "claude/fable-1.5",
        client: "Cursor",
      },
      next_step: "File an edits proposal after the FAQ outline is approved by staff.",
    });
    expect(sameRole.ok).toBe(false);
    if (!sameRole.ok) expect(sameRole.code).toBe("four_eyes");

    const blocked = await svc.update(created.proposal.id, "add_blocker", {
      ...aliceSeo,
      body:
        "Needs clearer acceptance criteria for which locales ship first and why ES is out of scope. ".repeat(
          2,
        ),
    });
    expect(blocked.ok).toBe(true);

    const withBlocker = await svc.update(created.proposal.id, "accept", {
      ...aliceSeo,
      next_step: "File an edits proposal after the FAQ outline is approved by staff.",
    });
    expect(withBlocker.ok).toBe(false);
    if (!withBlocker.ok) expect(withBlocker.code).toBe("proposal_blocked");
  });

  it("toProposalSummary strips ops/baselines and aggregates unique field_paths", async () => {
    const svc = makeService({
      liveValues: {
        "seo.main_keyword": "old",
        "meta.page_title": "Old title",
      },
    });
    const summary =
      "Bulk SEO keyword updates across location landing pages for a regional campaign review. ".repeat(
        2,
      );
    const created = await svc.create(
      {
        title: "Location SEO keywords",
        summary,
        entries: [
          {
            contentType: "landing",
            slug: "miami",
            locale: "en",
            updates: [
              { field_path: "seo.main_keyword", value: "miami bootcamp" },
              { field_path: "meta.page_title", value: "Miami" },
            ],
          },
          {
            contentType: "landing",
            slug: "chicago",
            locale: "en",
            updates: [{ field_path: "seo.main_keyword", value: "chicago bootcamp" }],
          },
        ],
      },
      { username: "alice", actor: { type: "ui" } },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const slim = toProposalSummary(created.proposal);
    expect(slim.detail).toBe("summary");
    expect(slim.entry_count).toBe(2);
    expect(slim.field_paths).toEqual(["meta.page_title", "seo.main_keyword"]);
    expect(slim.entries).toHaveLength(2);
    for (const e of slim.entries) {
      expect(e).toMatchObject({
        contentType: "landing",
        locale: "en",
        status: "pending",
      });
      expect(e).not.toHaveProperty("ops");
      expect(e).not.toHaveProperty("baseline_context");
    }
    expect(slim).not.toHaveProperty("blockers");
    expect(slim).not.toHaveProperty("documentation");
    expect(slim).not.toHaveProperty("search_text");
    expect(slim).not.toHaveProperty("fingerprint");
    expect(created.proposal.entries[0]!.ops.length).toBeGreaterThan(0);
    expect(created.proposal.entries[0]!.baseline_context.values).toBeTruthy();
  });

  it("rejects without confirm_reject / kind / note; withdraw requires note; revise and supersedes", async () => {
    const live: Record<string, unknown> = { "meta.title": "Old" };
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: (entry) => {
        const values: Record<string, unknown> = {};
        for (const u of entry.updates ?? []) values[u.field_path] = live[u.field_path];
        return { values };
      },
      applyUpdates: async (entry) => {
        for (const u of entry.ops) live[u.field_path] = u.value;
        return { ok: true };
      },
      resolveRecentActivity: () => ({
        ok: true,
        activity: [],
        gateWriteCount: 0,
      }),
    });
    const summary = "Soft title tweak for blog hello after review of live meta. ".repeat(2);
    const created = await svc.create(
      {
        title: "Title tweak",
        summary,
        entries: [
          sampleEntry({
            locale: "en",
            updates: [{ field_path: "meta.title", value: "New" }],
          }),
        ],
      },
      { username: "alice", actor: { type: "mcp", role: "content" } },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const noConfirm = await svc.update(created.proposal.id, "reject", { username: "casey" });
    expect(noConfirm.ok).toBe(false);
    if (!noConfirm.ok) expect(noConfirm.code).toBe("confirm_reject");

    const noKind = await svc.update(created.proposal.id, "reject", {
      username: "casey",
      confirm_reject: true,
      close_note: "x".repeat(80),
    });
    expect(noKind.ok).toBe(false);
    if (!noKind.ok) expect(noKind.code).toBe("reject_kind_required");

    const shortNote = await svc.update(created.proposal.id, "reject", {
      username: "casey",
      confirm_reject: true,
      reject_kind: "bad_idea",
      close_note: "too short",
    });
    expect(shortNote.ok).toBe(false);
    if (!shortNote.ok) expect(shortNote.code).toBe("reject_note_too_short");

    const body =
      "On soft meta.title, proposed New is fine but value should be Newer for brand. Must match H1.";
    await svc.update(created.proposal.id, "add_blocker", { username: "blake", body });

    const foreignClaim = await svc.update(created.proposal.id, "claim", {
      username: "blake",
      actor: { type: "mcp", role: "reviewer" },
    });
    expect(foreignClaim.ok).toBe(true);

    const reviseBlocked = await svc.update(created.proposal.id, "revise_entries", {
      username: "alice",
      actor: { type: "mcp", role: "content" },
      entries: [
        sampleEntry({
          locale: "en",
          updates: [{ field_path: "meta.title", value: "Newer" }],
        }),
      ],
    });
    expect(reviseBlocked.ok).toBe(false);
    if (!reviseBlocked.ok) expect(reviseBlocked.code).toBe("claimed");

    await svc.update(created.proposal.id, "release", { username: "blake" });

    const revised = await svc.update(created.proposal.id, "revise_entries", {
      username: "alice",
      actor: { type: "mcp", role: "content" },
      entries: [
        sampleEntry({
          locale: "en",
          updates: [{ field_path: "meta.title", value: "Newer" }],
        }),
      ],
    });
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    expect(revised.proposal.entries[0]?.ops[0]?.value).toBe("Newer");
    expect(revised.proposal.open_blocker_count).toBe(1);

    const rejected = await svc.update(created.proposal.id, "reject", {
      username: "casey",
      confirm_reject: true,
      reject_kind: "harmful",
      close_note:
        "Shipping this keyword change would mislead local pack users and must not go live.",
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.proposal.close_reason).toBe("harmful");

    const replacement = await svc.create(
      {
        title: "Better title",
        summary: "Replacement after harmful reject with city-only chip and skip remote. ".repeat(2),
        supersedes_proposal_id: created.proposal.id,
        entries: [
          sampleEntry({
            locale: "en",
            updates: [{ field_path: "meta.title", value: "Best" }],
          }),
        ],
      },
      { username: "dana" },
    );
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) return;
    expect(replacement.proposal.supersedes_proposal_id).toBe(created.proposal.id);
    const old = svc.get(created.proposal.id)!;
    expect(old.replaced_by_proposal_id).toBe(replacement.proposal.id);

    const secondLink = await svc.create(
      {
        title: "Another",
        summary: "Second replacement attempt should fail because predecessor already linked. ".repeat(2),
        supersedes_proposal_id: created.proposal.id,
        entries: [
          sampleEntry({
            slug: "other",
            locale: "en",
            updates: [{ field_path: "meta.title", value: "X" }],
          }),
        ],
      },
      { username: "erin" },
    );
    expect(secondLink.ok).toBe(false);
    if (!secondLink.ok) expect(secondLink.code).toBe("supersedes_already_replaced");

    const forWithdraw = await svc.create(
      {
        title: "Withdraw me",
        summary: "Will withdraw with a note after filing for the withdraw-note gate. ".repeat(2),
        entries: [
          sampleEntry({
            slug: "withdraw-me",
            locale: "en",
            updates: [{ field_path: "meta.title", value: "W" }],
          }),
        ],
      },
      { username: "alice" },
    );
    expect(forWithdraw.ok).toBe(true);
    if (!forWithdraw.ok) return;
    const noNote = await svc.update(forWithdraw.proposal.id, "withdraw", { username: "alice" });
    expect(noNote.ok).toBe(false);
    if (!noNote.ok) expect(noNote.code).toBe("withdraw_note_required");
    const withdrawn = await svc.update(forWithdraw.proposal.id, "withdraw", {
      username: "alice",
      close_note: "Filing again with a corrected scope after review feedback.",
    });
    expect(withdrawn.ok).toBe(true);
    if (withdrawn.ok) {
      expect(withdrawn.proposal.status).toBe("withdrawn");
      expect(withdrawn.proposal.close_reason).toBe("withdrawn");
    }
  });

  it("MCP withdraw requires same proposer username; staff may withdraw others", async () => {
    const svc = makeService();
    const summary =
      "Author-only withdraw gate: same username may close even under a different MCP role. ".repeat(2);
    const note = "Withdrawing after scope change; will file a corrected proposal next.";

    const created = await svc.create(
      {
        title: "Author withdraw gate",
        summary,
        entries: [sampleEntry({ slug: "author-withdraw-gate" })],
      },
      { username: "alesanchezr", actor: { type: "mcp", role: "copy_editor", model: "xai/grok-4" } },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const otherMcp = await svc.update(created.proposal.id, "withdraw", {
      username: "KrilinZ",
      asStaff: false,
      actor: { type: "mcp", role: "copy_editor", model: "anthropic/claude" },
      close_note: note,
    });
    expect(otherMcp.ok).toBe(false);
    if (!otherMcp.ok) expect(otherMcp.code).toBe("not_proposer");

    const sameUserDifferentRole = await svc.update(created.proposal.id, "withdraw", {
      username: "alesanchezr",
      asStaff: false,
      actor: { type: "mcp", role: "seo_specialist", model: "openai/gpt-5" },
      close_note: note,
    });
    expect(sameUserDifferentRole.ok).toBe(true);
    if (sameUserDifferentRole.ok) {
      expect(sameUserDifferentRole.proposal.status).toBe("withdrawn");
      expect(sameUserDifferentRole.proposal.closed_by).toBe("alesanchezr");
    }

    const forStaff = await svc.create(
      {
        title: "Staff withdraw gate",
        summary,
        entries: [sampleEntry({ slug: "staff-withdraw-gate" })],
      },
      { username: "alesanchezr", actor: { type: "mcp", role: "copy_editor" } },
    );
    expect(forStaff.ok).toBe(true);
    if (!forStaff.ok) return;

    const staffOther = await svc.update(forStaff.proposal.id, "withdraw", {
      username: "editor@4geeks.com",
      asStaff: true,
      actor: { type: "ui" },
      close_note: note,
    });
    expect(staffOther.ok).toBe(true);
    if (staffOther.ok) {
      expect(staffOther.proposal.status).toBe("withdrawn");
      expect(staffOther.proposal.closed_by).toBe("editor@4geeks.com");
    }
  });

  it("honors proposal settings for withdraw disabled, any author, and four-eyes off", async () => {
    const summary =
      "Policy knobs from Agents Rules: withdraw disabled, any author, and four-eyes toggle. ".repeat(2);
    const note = "Withdrawing under site policy test for Agents Rules page coverage.";

    const disabledSvc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: {} }),
      applyUpdates: async () => ({ ok: true }),
      getProposalSettings: () => ({
        withdraw: { mcp: "disabled", staff: "any_editor" },
        four_eyes: { enabled: true, staff_ui_exempt: false },
        hold: { stewards_only: true },
        claim: { staff_ui_takeover: true },
      }),
    });
    const blocked = await disabledSvc.create(
      {
        title: "Withdraw disabled",
        summary,
        entries: [sampleEntry({ slug: "withdraw-disabled" })],
      },
      { username: "alice", actor: { type: "mcp", role: "copy_editor" } },
    );
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    const disabled = await disabledSvc.update(blocked.proposal.id, "withdraw", {
      username: "alice",
      actor: { type: "mcp", role: "copy_editor" },
      close_note: note,
    });
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.code).toBe("withdraw_disabled");

    const anyAuthorSvc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: {} }),
      applyUpdates: async () => ({ ok: true }),
      getProposalSettings: () => ({
        withdraw: { mcp: "any_create_author", staff: "any_editor" },
        four_eyes: { enabled: true, staff_ui_exempt: false },
        hold: { stewards_only: true },
        claim: { staff_ui_takeover: true },
      }),
    });
    const open = await anyAuthorSvc.create(
      {
        title: "Any author withdraw",
        summary,
        entries: [sampleEntry({ slug: "any-author-withdraw" })],
      },
      { username: "alice", actor: { type: "mcp", role: "copy_editor" } },
    );
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    const otherOk = await anyAuthorSvc.update(open.proposal.id, "withdraw", {
      username: "bob",
      actor: { type: "mcp", role: "seo_specialist" },
      close_note: note,
    });
    expect(otherOk.ok).toBe(true);

    const fourOff = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: (entry) => {
        const values: Record<string, unknown> = {};
        for (const u of entry.updates) values[u.field_path] = "Old";
        return { values };
      },
      applyUpdates: async () => ({ ok: true }),
      getProposalSettings: () => ({
        withdraw: { mcp: "proposer_only", staff: "any_editor" },
        four_eyes: { enabled: false, staff_ui_exempt: false },
        hold: { stewards_only: true },
        claim: { staff_ui_takeover: true },
      }),
    });
    const selfApply = await fourOff.create(
      {
        title: "Self apply allowed",
        summary,
        entries: [
          sampleEntry({
            slug: "self-apply",
            locale: "en",
            updates: [{ field_path: "meta.title", value: "New" }],
          }),
        ],
      },
      { username: "alice", actor: { type: "mcp", role: "copy_editor" } },
    );
    expect(selfApply.ok).toBe(true);
    if (!selfApply.ok) return;
    const applied = await fourOff.update(selfApply.proposal.id, "apply", {
      username: "alice",
      actor: { type: "mcp", role: "copy_editor" },
    });
    expect(applied.ok).toBe(true);
  });

  it("escalates with note, clears claim, freezes MCP, keeps note after deescalate", async () => {
    const svc = makeService();
    const summary =
      "Update the landing CTA copy so the product name matches the live funnel offer. ".repeat(2);
    const created = await svc.create(
      {
        title: "CTA product name",
        summary,
        entries: [sampleEntry()],
      },
      { username: "alice", actor: { type: "mcp", role: "copy_editor" } },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await svc.update(created.proposal.id, "claim", {
      username: "blake",
      actor: { type: "mcp", role: "proposal_reviewer" },
      report: "Reviewing the CTA product naming suggestion before apply. ".repeat(2),
    });
    expect(svc.get(created.proposal.id)?.claim?.by).toBe("blake");

    const short = await svc.update(created.proposal.id, "escalate", {
      username: "steward",
      actor: { type: "ui" },
      escalated_note: "too short",
    });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.code).toBe("escalated_note_required");

    const note =
      "Grok added a blocker that invents a product claim we do not make — pause agents until review rules are fixed.";
    const escalated = await svc.update(created.proposal.id, "escalate", {
      username: "steward",
      actor: { type: "ui" },
      escalated_note: note,
    });
    expect(escalated.ok).toBe(true);
    if (!escalated.ok) return;
    expect(escalated.proposal.status).toBe("open");
    expect(escalated.proposal.escalated).toBe(true);
    expect(escalated.proposal.escalated_note).toBe(note);
    expect(escalated.proposal.escalated_by).toBe("steward");
    expect(escalated.proposal.claim).toBeNull();
    expect(svc.stats().escalated_count).toBe(1);

    const mcpBlocked = await svc.update(created.proposal.id, "add_blocker", {
      username: "grok",
      actor: { type: "mcp", role: "proposal_reviewer" },
      body:
        "On live es blog hello, CTA should mention Coding Bootcamp because the form currently misroutes leads to the wrong product funnel.",
    });
    expect(mcpBlocked.ok).toBe(false);
    if (!mcpBlocked.ok) expect(mcpBlocked.code).toBe("escalated");

    const mcpEscalate = await svc.update(created.proposal.id, "deescalate", {
      username: "grok",
      actor: { type: "mcp", role: "proposal_reviewer" },
    });
    expect(mcpEscalate.ok).toBe(false);
    if (!mcpEscalate.ok) expect(mcpEscalate.code).toBe("steward_ui_only");

    const staffStill = await svc.update(created.proposal.id, "add_blocker", {
      username: "casey",
      actor: { type: "ui" },
      body:
        "On live es blog hello, CTA should mention Coding Bootcamp because the form currently misroutes leads to the wrong product funnel.",
    });
    expect(staffStill.ok).toBe(true);
    if (staffStill.ok) expect(staffStill.proposal.open_blocker_count).toBe(1);

    const released = await svc.update(created.proposal.id, "deescalate", {
      username: "steward",
      actor: { type: "ui" },
    });
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.proposal.escalated).toBe(false);
    expect(released.proposal.escalated_note).toBe(note);
    expect(released.proposal.status).toBe("open");

    const listed = svc.list({ escalated: true });
    expect(listed.total).toBe(0);
    const withHistory = svc.list({ status: "open" });
    expect(withHistory.proposals.some((p) => p.id === created.proposal.id && p.escalated_note === note)).toBe(
      true,
    );
  });

  it("outcome review: closed-only, staff-only, bad needs notes, history, clear, lesson, filters", async () => {
    const svc = makeService();
    const summary =
      "Update the landing CTA copy so the product name matches the live funnel offer. ".repeat(2);
    const created = await svc.create(
      { title: "CTA outcome", summary, entries: [sampleEntry()] },
      { username: "alice", actor: { type: "mcp", role: "copy_editor" } },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.proposal.id;
    const steward = { username: "steward", actor: { type: "ui" as const } };
    const wentWrong = "Agent applied copy that named the wrong product on a selling page.";
    const expected = "Reviewer should have blocked until the product name matched the funnel.";

    const whileOpen = await svc.update(id, "review_outcome", { ...steward, outcome_review: "good" });
    expect(whileOpen.ok).toBe(false);
    if (!whileOpen.ok) expect(whileOpen.code).toBe("not_closed");

    const withdrawn = await svc.update(id, "withdraw", {
      username: "alice",
      close_note: "Pulling back to refile with a corrected product name scope.",
    });
    expect(withdrawn.ok).toBe(true);

    const mcp = await svc.update(id, "review_outcome", {
      username: "grok",
      actor: { type: "mcp", role: "proposal_reviewer" },
      outcome_review: "good",
    });
    expect(mcp.ok).toBe(false);
    if (!mcp.ok) expect(mcp.code).toBe("steward_ui_only");

    const badNoNotes = await svc.update(id, "review_outcome", {
      ...steward,
      outcome_review: "bad",
      outcome_review_note: "short",
    });
    expect(badNoNotes.ok).toBe(false);
    if (!badNoNotes.ok) expect(badNoNotes.code).toBe("outcome_review_note_required");

    const lessonTooEarly = await svc.update(id, "set_outcome_lesson", {
      ...steward,
      outcome_lesson_captured: true,
    });
    expect(lessonTooEarly.ok).toBe(false);
    if (!lessonTooEarly.ok) expect(lessonTooEarly.code).toBe("not_bad");

    const good = await svc.update(id, "review_outcome", { ...steward, outcome_review: "good" });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.proposal.outcome_review).toBe("good");
    expect(good.proposal.outcome_review_history).toEqual([]);
    expect(good.proposal.status).toBe("withdrawn");

    const bad = await svc.update(id, "review_outcome", {
      ...steward,
      outcome_review: "bad",
      outcome_review_note: wentWrong,
      outcome_review_expected: expected,
    });
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    expect(bad.proposal.outcome_review).toBe("bad");
    expect(bad.proposal.outcome_review_note).toBe(wentWrong);
    expect(bad.proposal.outcome_review_expected).toBe(expected);
    expect(bad.proposal.outcome_review_by).toBe("steward");
    expect(bad.proposal.outcome_review_history).toHaveLength(1);
    expect(bad.proposal.outcome_review_history[0]).toMatchObject({
      outcome: "good",
      replaced_with: "bad",
      replaced_by: "steward",
    });

    expect(svc.list({ outcome_review: "bad_open" }).proposals.map((p) => p.id)).toEqual([id]);
    expect(svc.list({ outcome_review: "none" }).total).toBe(0);

    const lesson = await svc.update(id, "set_outcome_lesson", {
      ...steward,
      outcome_lesson_captured: true,
      outcome_lesson_note: "Added a selling-page product name checklist item.",
    });
    expect(lesson.ok).toBe(true);
    if (!lesson.ok) return;
    expect(lesson.proposal.outcome_lesson_captured_by).toBe("steward");
    expect(lesson.proposal.outcome_lesson_note).toBe(
      "Added a selling-page product name checklist item.",
    );
    expect(svc.list({ outcome_review: "bad_open" }).total).toBe(0);
    expect(svc.list({ outcome_review: "bad" }).total).toBe(1);

    const editedBad = await svc.update(id, "review_outcome", {
      ...steward,
      outcome_review: "bad",
      outcome_review_note: wentWrong,
      outcome_review_expected: `${expected} Also check the CTA link.`,
    });
    expect(editedBad.ok).toBe(true);
    if (editedBad.ok) expect(editedBad.proposal.outcome_lesson_captured_at).not.toBeNull();

    const toGood = await svc.update(id, "review_outcome", { ...steward, outcome_review: "good" });
    expect(toGood.ok).toBe(true);
    if (toGood.ok) {
      expect(toGood.proposal.outcome_lesson_captured_at).toBeNull();
      expect(toGood.proposal.outcome_review_expected).toBeNull();
    }

    const cleared = await svc.update(id, "review_outcome", { ...steward, outcome_review: "clear" });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.proposal.outcome_review).toBeNull();
    expect(cleared.proposal.outcome_review_note).toBeNull();
    expect(cleared.proposal.outcome_review_history).toHaveLength(4);
    expect(cleared.proposal.outcome_review_history.at(-1)?.replaced_with).toBe("cleared");
    expect(svc.list({ outcome_review: "none" }).proposals.map((p) => p.id)).toEqual([id]);

    const clearAgain = await svc.update(id, "review_outcome", { ...steward, outcome_review: "clear" });
    expect(clearAgain.ok).toBe(false);
    if (!clearAgain.ok) expect(clearAgain.code).toBe("not_reviewed");

    const events = listEvents({ site: SITE, type: "proposal_outcome_reviewed", limit: 50 }).filter(
      (e) => e.payload?.proposal_id === id,
    );
    expect(events).toHaveLength(5);
    const lessonEvents = listEvents({
      site: SITE,
      type: "proposal_outcome_lesson_set",
      limit: 50,
    }).filter((e) => e.payload?.proposal_id === id);
    expect(lessonEvents).toHaveLength(1);
  });

  it("outcomes tab: by_outcome counts, any/none skip system closures, outcome_recent order", async () => {
    const svc = makeService();
    const steward = { username: "steward", actor: { type: "ui" as const } };
    const summary =
      "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2);
    const wentWrong = "Agent applied copy that named the wrong product on a selling page.";
    const ids: Record<string, string> = {};
    for (const key of ["good", "badLesson", "badOpen", "unreviewed", "open", "stale", "legacyGood"]) {
      const created = await svc.create(
        { title: `Outcome ${key}`, summary, entries: [sampleEntry({ slug: `outcome-${key}` })] },
        { username: "alice" },
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      ids[key] = created.proposal.id;
      if (key === "open") continue;
      const withdrawn = await svc.update(created.proposal.id, "withdraw", {
        username: "alice",
        close_note: "Pulling back to refile with a corrected product name scope.",
      });
      expect(withdrawn.ok).toBe(true);
    }

    const review = async (id: string, outcome: "good" | "bad") => {
      const res = await svc.update(id, "review_outcome", {
        ...steward,
        outcome_review: outcome,
        ...(outcome === "bad"
          ? {
              outcome_review_note: wentWrong,
              outcome_review_expected: "Reviewer should have blocked until the product name matched the funnel.",
            }
          : {}),
      });
      expect(res.ok).toBe(true);
    };
    await review(ids.good, "good");
    await review(ids.badLesson, "bad");
    await review(ids.badOpen, "bad");
    await review(ids.legacyGood, "good");
    const lesson = await svc.update(ids.badLesson, "set_outcome_lesson", {
      ...steward,
      outcome_lesson_captured: true,
    });
    expect(lesson.ok).toBe(true);

    const db = getSiteSqlite(SITE);
    const setCloseReason = db.prepare(`UPDATE content_proposals SET close_reason = ? WHERE id = ?`);
    setCloseReason.run("abandoned_stale", ids.stale);
    setCloseReason.run("legacy_version", ids.legacyGood);

    const t = Date.now() - 60_000;
    const setTimes = db.prepare(
      `UPDATE content_proposals SET outcome_review_at = ?, closed_at = ?, updated_at = ? WHERE id = ?`,
    );
    setTimes.run(t + 1000, t, t, ids.good);
    setTimes.run(t + 2000, t, t, ids.badOpen);
    setTimes.run(t + 3000, t, t, ids.badLesson);
    setTimes.run(t + 4000, t, t, ids.legacyGood);
    setTimes.run(null, t + 5000, t, ids.unreviewed);

    expect(svc.stats().by_outcome).toEqual({ good: 2, bad: 2, bad_open: 1, none: 1 });

    expect(svc.list({ outcome_review: "none" }).proposals.map((p) => p.id)).toEqual([ids.unreviewed]);

    const any = svc.list({ outcome_review: "any", sort: "outcome_recent", sort_dir: "desc" });
    expect(any.total).toBe(5);
    expect(any.proposals.map((p) => p.id)).toEqual([
      ids.unreviewed,
      ids.legacyGood,
      ids.badLesson,
      ids.badOpen,
      ids.good,
    ]);

    const page2 = svc.list({ outcome_review: "any", sort: "outcome_recent", sort_dir: "desc", limit: 2, offset: 2 });
    expect(page2.total).toBe(5);
    expect(page2.proposals.map((p) => p.id)).toEqual([ids.badLesson, ids.badOpen]);

    expect(parseProposalSort("outcome_recent", "desc")).toEqual({
      ok: true,
      sort: "outcome_recent",
      sortDir: "desc",
    });
  });

  it("idea follow-through: accept locks entry, implements gates, stalled resurfaces after reject", async () => {
    const svc = makeService({
      liveValues: { "meta.title": "Old" },
    });
    const summary =
      "Brief for a new Grok explainer blog post covering product basics for beginners. ".repeat(2);
    const alice = {
      username: "alice",
      actor: {
        type: "mcp" as const,
        role: "copy_editor",
        model: "claude/sonnet",
        client: "Cursor",
      },
    };
    const bob = {
      username: "bob",
      actor: {
        type: "mcp" as const,
        role: "seo_specialist",
        model: "claude/sonnet",
        client: "Cursor",
      },
    };
    const idea = await svc.create(
      {
        kind: "idea",
        title: "What is Grok",
        summary,
        related_entries: [{ contentType: "blog", slug: "what-is-grok", locale: "en" }],
      },
      alice,
    );
    expect(idea.ok).toBe(true);
    if (!idea.ok) return;

    const missingEntry = await svc.update(idea.proposal.id, "accept", {
      ...bob,
      next_step: "Draft the post body and SERP title in a follow-up edits proposal.",
    });
    expect(missingEntry.ok).toBe(false);
    if (!missingEntry.ok) expect(missingEntry.code).toBe("accepted_entry_required");

    const accepted = await svc.update(idea.proposal.id, "accept", {
      ...bob,
      next_step: "Draft the post body and SERP title in a follow-up edits proposal.",
      accepted_entry: { contentType: "blog", slug: "what-is-grok", locale: "en" },
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(svc.stats().stalled_ideas).toBe(1);
    expect(svc.list({ stalled: true }).total).toBe(1);

    const withoutLink = await svc.create(
      {
        title: "Grok draft edits",
        summary: "Implement the accepted Grok brief with a clearer title and intro for EN. ".repeat(2),
        entries: [
          sampleEntry({
            slug: "what-is-grok",
            locale: "en",
            updates: [{ field_path: "meta.title", value: "What is Grok?" }],
          }),
        ],
      },
      alice,
    );
    expect(withoutLink.ok).toBe(false);
    if (!withoutLink.ok) expect(withoutLink.code).toBe("implements_required");

    const edits = await svc.create(
      {
        title: "Grok draft edits",
        summary: "Implement the accepted Grok brief with a clearer title and intro for EN. ".repeat(2),
        implements_proposal_id: idea.proposal.id,
        entries: [
          sampleEntry({
            slug: "what-is-grok",
            locale: "en",
            updates: [{ field_path: "meta.title", value: "What is Grok?" }],
          }),
        ],
      },
      alice,
    );
    expect(edits.ok).toBe(true);
    if (!edits.ok) return;
    expect(edits.proposal.implements_proposal_id).toBe(idea.proposal.id);
    expect(svc.stats().stalled_ideas).toBe(0);

    const second = await svc.create(
      {
        title: "Grok draft edits 2",
        summary: "Second attempt should join the open implements proposal instead of duplicating. ".repeat(2),
        implements_proposal_id: idea.proposal.id,
        confirm_distinct: true,
        entries: [
          sampleEntry({
            slug: "what-is-grok",
            locale: "en",
            updates: [{ field_path: "meta.title", value: "Other" }],
          }),
        ],
      },
      bob,
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("idea_already_in_progress");

    const rejected = await svc.update(edits.proposal.id, "reject", {
      ...bob,
      confirm_reject: true,
      reject_kind: "bad_idea",
      close_note:
        "This draft invents product claims we do not make and should not ship as written for this brief.",
    });
    expect(rejected.ok).toBe(true);
    expect(svc.stats().stalled_ideas).toBe(1);

    const retry = await svc.create(
      {
        title: "Grok draft edits retry",
        summary: "Retry after reject with a faithful title that matches approved facts only. ".repeat(2),
        implements_proposal_id: idea.proposal.id,
        confirm_distinct: true,
        entries: [
          sampleEntry({
            slug: "what-is-grok",
            locale: "en",
            updates: [{ field_path: "meta.title", value: "What is Grok" }],
          }),
        ],
      },
      alice,
    );
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;

    const applied = await svc.update(retry.proposal.id, "apply", { ...bob });
    expect(applied.ok).toBe(true);
    expect(svc.stats().stalled_ideas).toBe(0);
    expect(svc.list({ stalled: true }).total).toBe(0);
  });

  describe("accepted-idea page lock release", () => {
    const alice = {
      username: "alice",
      actor: { type: "mcp" as const, role: "copy_editor", model: "claude/sonnet", client: "Cursor" },
    };
    const bob = {
      username: "bob",
      actor: { type: "mcp" as const, role: "seo_specialist", model: "claude/sonnet", client: "Cursor" },
    };
    const PAGE = { contentType: "blog", slug: "best-ai-coding-agents", locale: "en" };
    const NEXT_STEP = "Refresh the comparison table and bump Last verified in a follow-up edit.";
    type Svc = ReturnType<typeof makeService>;

    const fileIdea = async (svc: Svc, title: string, related: Array<Record<string, string>> = [PAGE]) => {
      const res = await svc.create(
        {
          kind: "idea",
          title,
          summary: `${title}: refresh the best AI coding agents hub with the newest model release and pricing. `.repeat(2),
          related_entries: related as Array<{ contentType: string; slug: string; locale?: string }>,
          confirm_distinct: true,
        },
        alice,
      );
      if (!res.ok) throw new Error(`${res.code}: ${res.error}`);
      return res.proposal.id;
    };
    const accept = (svc: Svc, id: string) =>
      svc.update(id, "accept", { ...bob, next_step: NEXT_STEP, accepted_entry: PAGE });
    const fileEdits = (svc: Svc, title: string, implementsId?: string) =>
      svc.create(
        {
          title,
          summary: `${title}: add the new model row and update the verified date on the hub. `.repeat(2),
          ...(implementsId ? { implements_proposal_id: implementsId } : {}),
          confirm_distinct: true,
          entries: [sampleEntry({ ...PAGE, updates: [{ field_path: "meta.title", value: title }] })],
        },
        alice,
      );
    const takenDetails = (res: Awaited<ReturnType<Svc["update"]>>) => {
      expect(res.ok).toBe(false);
      if (res.ok) return null;
      expect(res.code).toBe("accepted_entry_taken");
      return res.details as { holder_id: string; open_edit_id: string | null; releases_when: string };
    };

    it("holds the page until the holder's edit is applied, then frees it and lists waiting ideas (Grok → Sol)", async () => {
      const svc = makeService({ liveValues: { "meta.title": "Old" } });
      const grok = await fileIdea(svc, "Grok 4.7 refresh");
      expect((await accept(svc, grok)).ok).toBe(true);

      const sol = await fileIdea(svc, "GPT-6.1 Sol refresh");
      const otherLocale = await fileIdea(svc, "Spanish refresh", [{ ...PAGE, locale: "es" }]);
      const anyLocale = await fileIdea(svc, "Any-locale refresh", [{ contentType: PAGE.contentType, slug: PAGE.slug }]);

      const noEdit = takenDetails(await accept(svc, sol));
      expect(noEdit).toEqual({ holder_id: grok, open_edit_id: null, releases_when: "holder_edit_applied" });
      expect(svc.get(sol)!.status).toBe("open");

      const first = await fileEdits(svc, "Grok draft", grok);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(takenDetails(await accept(svc, sol))?.open_edit_id).toBe(first.proposal.id);

      const rejected = await svc.update(first.proposal.id, "reject", {
        ...bob,
        confirm_reject: true,
        reject_kind: "bad_idea",
        close_note: "This draft invents benchmark numbers we cannot source and must not ship as written for the hub.",
      });
      expect(rejected.ok).toBe(true);
      expect(takenDetails(await accept(svc, sol))?.holder_id).toBe(grok);
      expect(svc.stats().stalled_ideas).toBe(1);

      const standaloneWhileHeld = await fileEdits(svc, "Unlinked fix");
      expect(standaloneWhileHeld.ok).toBe(false);
      if (!standaloneWhileHeld.ok) expect(standaloneWhileHeld.code).toBe("implements_required");

      const retry = await fileEdits(svc, "Grok draft retry", grok);
      expect(retry.ok).toBe(true);
      if (!retry.ok) return;
      const applied = await svc.update(retry.proposal.id, "apply", { ...bob });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      const w = applied.warnings?.find((x) => x.code === "idea_page_released_waiting_ideas") as
        | { details?: { waiting_ideas?: Array<{ id: string }>; next_actions?: Array<Record<string, unknown>>; released_entry?: unknown } }
        | undefined;
      expect(w?.details?.waiting_ideas?.map((i) => i.id)).toEqual([sol, anyLocale]);
      expect(w?.details?.waiting_ideas?.some((i) => i.id === otherLocale)).toBe(false);
      expect(w?.details?.next_actions?.[0]).toMatchObject({ tool: "list_proposals", args_hint: { proposal_id: sol } });
      expect(w?.details?.released_entry).toEqual(PAGE);
      const finished = listEvents({ site: SITE, type: "proposal_finished", limit: 50 }).find(
        (e) => e.payload?.proposal_id === retry.proposal.id,
      );
      expect(finished?.payload?.waiting_idea_ids).toEqual([sol, anyLocale]);
      expect(svc.stats().stalled_ideas).toBe(0);

      const unlinked = await fileEdits(svc, "Unlinked fix after release");
      expect(unlinked.ok).toBe(true);
      if (!unlinked.ok) return;
      const withdrawn = await svc.update(unlinked.proposal.id, "withdraw", {
        ...alice,
        close_note: "Withdrawing so the accepted Sol idea can own the next refresh.",
      });
      expect(withdrawn.ok).toBe(true);

      const solAccepted = await accept(svc, sol);
      expect(solAccepted.ok).toBe(true);
      expect(svc.stats().stalled_ideas).toBe(1);

      const viaOldIdea = await fileEdits(svc, "Late Grok follow-up", grok);
      expect(viaOldIdea.ok).toBe(false);
      if (!viaOldIdea.ok) {
        expect(viaOldIdea.code).toBe("implements_required");
        expect(viaOldIdea.duplicate_of).toBe(sol);
      }
    });

    it("after release, edits may still implement the old idea while no newer idea holds the page", async () => {
      const svc = makeService({ liveValues: { "meta.title": "Old" } });
      const grok = await fileIdea(svc, "Grok 4.7 refresh");
      expect((await accept(svc, grok)).ok).toBe(true);
      const first = await fileEdits(svc, "Grok draft", grok);
      if (!first.ok) throw new Error(first.error);
      const applied = await svc.update(first.proposal.id, "apply", { ...bob });
      expect(applied.ok).toBe(true);
      if (applied.ok) expect(applied.warnings?.some((x) => x.code === "idea_page_released_waiting_ideas") ?? false).toBe(false);

      const followUp = await fileEdits(svc, "Sol folded into Grok idea", grok);
      expect(followUp.ok).toBe(true);
      if (!followUp.ok) return;
      const sol = await fileIdea(svc, "GPT-6.1 Sol refresh");
      expect(takenDetails(await accept(svc, sol))?.open_edit_id).toBe(followUp.proposal.id);
    });

    it("two simultaneous accepts for the same freed page: exactly one reserves it", async () => {
      const svc = makeService();
      const a = await fileIdea(svc, "Grok 4.7 refresh");
      const b = await fileIdea(svc, "GPT-6.1 Sol refresh");
      const results = await Promise.all([accept(svc, a), accept(svc, b)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const loser = results.find((r) => !r.ok);
      expect(loser && !loser.ok ? loser.code : null).toBe("accepted_entry_taken");
    });
  });

  it("stores author and resolver actors on blockers and clears the resolver on reopen", async () => {
    const svc = makeService();
    const summary =
      "Patch the CTA title on the Spanish blog so the product name is explicit. ".repeat(2);
    const body =
      "On live es blog hello, CTA should mention Coding Bootcamp because the form currently misroutes leads to the wrong product funnel.";
    const created = await svc.create(
      { title: "Actor blocker", summary, entries: [sampleEntry()] },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const author = { type: "mcp" as const, model: "xai/grok-4", role: "copy_editor", client: "Cursor" };
    const added = await svc.update(created.proposal.id, "add_blocker", {
      username: "blake",
      actor: author,
      body,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.proposal.blockers[0]!.author).toBe("blake");
    expect(added.proposal.blockers[0]!.author_actor).toEqual(author);
    expect(added.proposal.blockers[0]!.resolved_by_actor).toEqual({});

    const resolver = {
      type: "mcp" as const,
      model: "claude/sonnet-4.5",
      role: "copy_editor",
      client: "Cursor",
    };
    const bid = added.proposal.blockers[0]!.id;
    await svc.update(created.proposal.id, "claim", { username: "alice", actor: resolver });
    const resolved = await svc.update(created.proposal.id, "resolve_blocker", {
      username: "alice",
      actor: resolver,
      blocker_id: bid,
      resolve_note: "Updated CTA title to name Coding Bootcamp on the Spanish blog.",
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.proposal.blockers[0]!.resolved_by).toBe("alice");
    expect(resolved.proposal.blockers[0]!.resolved_by_actor).toEqual(resolver);
    expect(resolved.proposal.blockers[0]!.author_actor).toEqual(author);

    const reopened = await svc.update(created.proposal.id, "reopen_blocker", {
      username: "alice",
      actor: resolver,
      blocker_id: bid,
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.proposal.blockers[0]!.status).toBe("open");
    expect(reopened.proposal.blockers[0]!.resolved_by).toBeNull();
    expect(reopened.proposal.blockers[0]!.resolve_note).toBeNull();
    expect(reopened.proposal.blockers[0]!.resolved_by_actor).toEqual({});
    expect(reopened.proposal.blockers[0]!.author_actor).toEqual(author);

    const staff = await svc.update(created.proposal.id, "add_blocker", {
      username: "casey",
      actor: { type: "ui" },
      body,
    });
    expect(staff.ok).toBe(true);
    if (!staff.ok) return;
    const uiBlocker = staff.proposal.blockers.find((b) => b.author === "casey");
    expect(uiBlocker?.author_actor).toEqual({ type: "ui" });
  });

  it("stamps reviewer_action_by on non-author add/resolve/reopen and never for the author", async () => {
    const svc = makeService();
    const summary =
      "Patch the CTA title on the Spanish blog so the product name is explicit. ".repeat(2);
    const body =
      "On live es blog hello, CTA should mention Coding Bootcamp because the form currently misroutes leads to the wrong product funnel.";
    const resolveNote = "Updated CTA title to name Coding Bootcamp on the Spanish blog.";
    const authorActor = { type: "mcp" as const, role: "copy_editor", model: "claude/sonnet-4.5" };
    const created = await svc.create(
      { title: "Reviewer stamp", summary, entries: [sampleEntry()] },
      { username: "alice", actor: authorActor },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.proposal.id;

    const selfAdd = await svc.update(id, "add_blocker", { username: "alice", actor: authorActor, body });
    expect(selfAdd.ok).toBe(true);
    if (!selfAdd.ok) return;
    expect(selfAdd.proposal.reviewer_action_at).toBeNull();
    expect(selfAdd.proposal.reviewer_action_by).toBeNull();
    expect(toProposalSummary(selfAdd.proposal).reviewer_action_by).toBeNull();

    const reviewerActor = { type: "ui" as const };
    const added = await svc.update(id, "add_blocker", { username: "blake", actor: reviewerActor, body });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.proposal.reviewer_action_by).toBe("blake");
    expect(added.proposal.reviewer_action_by_actor).toEqual(reviewerActor);
    expect(added.proposal.reviewer_action_at).not.toBeNull();
    const summaryRow = toProposalSummary(added.proposal);
    expect(summaryRow.reviewer_action_by).toBe("blake");
    expect(summaryRow.reviewer_action_at).toBe(added.proposal.reviewer_action_at);

    const blakeBlocker = added.proposal.blockers.find((b) => b.author === "blake")!;
    await svc.update(id, "claim", { username: "alice", actor: authorActor });
    const authorResolve = await svc.update(id, "resolve_blocker", {
      username: "alice",
      actor: authorActor,
      blocker_id: blakeBlocker.id,
      resolve_note: resolveNote,
    });
    expect(authorResolve.ok).toBe(true);
    if (!authorResolve.ok) return;
    expect(authorResolve.proposal.reviewer_action_by).toBe("blake");
    expect(authorResolve.proposal.reviewer_action_at).toBe(added.proposal.reviewer_action_at);

    const reopened = await svc.update(id, "reopen_blocker", {
      username: "casey",
      actor: { type: "mcp", role: "seo_specialist" },
      blocker_id: blakeBlocker.id,
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.proposal.reviewer_action_by).toBe("casey");
    expect(reopened.proposal.reviewer_action_by_actor).toEqual({ type: "mcp", role: "seo_specialist" });
    const caseyAt = reopened.proposal.reviewer_action_at;

    await svc.update(id, "resolve_blocker", {
      username: "alice",
      actor: authorActor,
      blocker_id: blakeBlocker.id,
      resolve_note: resolveNote,
    });
    const selfReopen = await svc.update(id, "reopen_blocker", {
      username: "alice",
      actor: authorActor,
      blocker_id: blakeBlocker.id,
    });
    expect(selfReopen.ok).toBe(true);
    if (!selfReopen.ok) return;
    expect(selfReopen.proposal.reviewer_action_by).toBe("casey");
    expect(selfReopen.proposal.reviewer_action_at).toBe(caseyAt);
  });

  it("list filters by reviewer_username: last feedback or finished/rejected closer", async () => {
    const svc = makeService();
    const summary =
      "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2);
    const body =
      "On live es blog hello, CTA should mention Coding Bootcamp because the form currently misroutes leads to the wrong product funnel.";
    const mk = async (slug: string) => {
      const r = await svc.create(
        { title: `Reviewer filter ${slug}`, summary, entries: [sampleEntry({ slug })] },
        { username: "alice", actor: { type: "ui" } },
      );
      if (!r.ok) throw new Error("create failed");
      return r.proposal.id;
    };

    const openReviewed = await mk("open-reviewed");
    await svc.update(openReviewed, "add_blocker", { username: "Blake", actor: { type: "ui" }, body });

    const replaced = await mk("replaced");
    await svc.update(replaced, "add_blocker", { username: "blake", actor: { type: "ui" }, body });
    await svc.update(replaced, "add_blocker", { username: "dana", actor: { type: "ui" }, body });

    const rejected = await mk("rejected");
    const rej = await svc.update(rejected, "reject", {
      username: "blake",
      actor: { type: "ui" },
      confirm_reject: true,
      reject_kind: "bad_idea",
      close_note:
        "This approach is fundamentally wrong for brand and SEO and must not ship even if polished.",
    });
    expect(rej.ok).toBe(true);

    const withdrawn = await mk("withdrawn");
    const wd = await svc.update(withdrawn, "withdraw", {
      username: "alice",
      actor: { type: "ui" },
      close_note: "No longer needed after the campaign ended last week.",
    });
    expect(wd.ok).toBe(true);

    const ids = (u: string) =>
      svc
        .list({ reviewer_username: u })
        .proposals.map((p) => p.id)
        .sort();
    expect(ids("blake")).toEqual([openReviewed, rejected].sort());
    expect(ids("BLAKE")).toEqual([openReviewed, rejected].sort());
    expect(ids("dana")).toEqual([replaced]);
    expect(ids("alice")).toEqual([]);

    const reviewers = svc.listRecentReviewers({ days: 30 });
    expect(reviewers.map((u) => u.toLowerCase()).sort()).toEqual(["blake", "dana"]);
  });
});

const ATTACHED_FIELDS = ["title", "description", "content", "category"] as const;

function attachedUpdates(omit?: string) {
  return ATTACHED_FIELDS.filter((field) => field !== omit).map((field) => ({
    field_path: field,
    value: field === "content" ? "Body of the new post." : `value-${field}`,
  }));
}

describe("attached entry from an accepted idea", () => {
  const alice = {
    username: "alice",
    actor: { type: "mcp" as const, role: "copy_editor" },
  };
  const bob = {
    username: "bob",
    actor: { type: "mcp" as const, role: "seo_specialist" },
  };
  const summary =
    "Implement the accepted brief as a new attached blog post with the required fields filled. ".repeat(2);

  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
    ensurePipelineDb(SITE, { skipBackup: true });
  });

  afterEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
  });

  function makeAttached(opts?: {
    live?: "missing" | "exists";
    draftExists?: boolean;
    shape?: "attached_file" | "database" | "other" | "page_file";
    applyOk?: boolean;
    prepareCode?: string;
    validateSections?: (sections: unknown) => Array<{ property_path: string; message: string }>;
  }) {
    let live: "missing" | "exists" = opts?.live ?? "missing";
    const prepared: string[] = [];
    const discarded: string[] = [];
    const stamped: string[] = [];
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: { title: "Already there" } }),
      applyUpdates: async () =>
        opts?.applyOk === false ? { ok: false, error: "apply boom" } : { ok: true },
      resolveExistence: (entry) => ({
        live,
        draftExists: Boolean(entry.variant?.trim()) && (opts?.draftExists ?? false),
      }),
      inspectMissingTarget: () =>
        opts?.shape === "database"
          ? { shape: "database" }
          : opts?.shape === "other"
            ? { shape: "other" }
            : opts?.shape === "page_file"
              ? { shape: "page_file", requiredFields: ["meta.page_title"] }
              : { shape: "attached_file", requiredFields: [...ATTACHED_FIELDS] },
      ...(opts?.validateSections ? { validateSections: opts.validateSections } : {}),
      prepareCreatesEntry: async (entry) => {
        prepared.push(entry.slug);
        if (opts?.prepareCode) {
          return { ok: false, code: opts.prepareCode, error: "needs confirm" };
        }
        return { ok: true, seeded: true };
      },
      discardSeededEntry: (entry) => {
        discarded.push(entry.slug);
      },
      stampPublishedAt: () => {
        stamped.push("stamped");
        return { ok: true };
      },
    });
    return {
      svc,
      prepared,
      discarded,
      stamped,
      setLive: (next: "missing" | "exists") => {
        live = next;
      },
    };
  }

  async function acceptIdea(
    svc: ReturnType<typeof makeAttached>["svc"],
    slug = "what-is-grok",
    contentType = "blog",
  ) {
    const idea = await svc.create(
      {
        kind: "idea",
        title: "New attached post",
        summary,
        related_entries: [{ contentType, slug, locale: "en" }],
        idea_funnel: { stage: "awareness", products: "all" },
      },
      alice,
    );
    expect(idea.ok).toBe(true);
    if (!idea.ok) throw new Error("idea");
    const accepted = await svc.update(idea.proposal.id, "accept", {
      ...bob,
      next_step: "File field edits for this reserved slug. Apply will create the files.",
      accepted_entry: { contentType, slug, locale: "en" },
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error("accept");
    return idea.proposal.id;
  }

  it("creates edits for a reserved attached slug with no YAML", async () => {
    const { svc } = makeAttached();
    const ideaId = await acceptIdea(svc);
    const stalled = svc.list({ stalled: true });
    expect(stalled.proposals[0]?.attached_create_entry).toEqual({
      contentType: "blog",
      slug: "what-is-grok",
      locale: "en",
    });

    const without = await svc.create(
      {
        title: "Grok post",
        summary,
        review_situations: ["new_public_content"],
        entries: [sampleEntry({ slug: "what-is-grok", locale: "en", updates: attachedUpdates() })],
      },
      alice,
    );
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.code).toBe("implements_required");

    const edits = await svc.create(
      {
        title: "Grok post",
        summary,
        implements_proposal_id: ideaId,
        review_situations: ["new_public_content"],
        entries: [sampleEntry({ slug: "what-is-grok", locale: "en", updates: attachedUpdates() })],
      },
      alice,
    );
    expect(edits.ok).toBe(true);
    if (!edits.ok) return;
    expect(edits.proposal.entries[0]?.baseline_context.creates_entry).toBe(true);
    expect(edits.proposal.entries[0]?.baseline_context.values).toEqual({});
    expect(edits.review_context?.damage_class).toBe("new_public_content");
    expect(svc.list({ stalled: true }).total).toBe(0);
  });

  it("refuses sections, missing required fields, drafts, and database rows", async () => {
    const { svc } = makeAttached();
    const ideaId = await acceptIdea(svc);

    const sections = await svc.create(
      {
        title: "Grok sections",
        summary,
        implements_proposal_id: ideaId,
        entries: [
          sampleEntry({
            slug: "what-is-grok",
            locale: "en",
            updates: [...attachedUpdates(), { field_path: "sections[0].title", value: "Hero" }],
          }),
        ],
      },
      alice,
    );
    expect(sections.ok).toBe(false);
    if (!sections.ok) expect(sections.code).toBe("attached_sections_refused");

    const missing = await svc.create(
      {
        title: "Grok missing",
        summary,
        implements_proposal_id: ideaId,
        entries: [
          sampleEntry({ slug: "what-is-grok", locale: "en", updates: attachedUpdates("category") }),
        ],
      },
      alice,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("required_fields_missing");
      expect(missing.error).toContain("category");
    }
    expect(svc.get(ideaId)?.close_reason).toBe("accepted");

    const draft = await svc.create(
      {
        title: "Grok draft",
        summary,
        implements_proposal_id: ideaId,
        entries: [
          sampleEntry({
            slug: "what-is-grok",
            locale: "en",
            variant: "draft",
            updates: attachedUpdates(),
          }),
        ],
      },
      alice,
    );
    expect(draft.ok).toBe(false);
    if (!draft.ok) expect(draft.code).toBe("attached_no_draft");
  });

  it("refuses a missing database row and still accepts field updates on an existing row", async () => {
    const missingDb = makeAttached({ shape: "database" });
    const ideaId = await acceptIdea(missingDb.svc, "cohort-1", "program");
    const refused = await missingDb.svc.create(
      {
        title: "New cohort",
        summary,
        implements_proposal_id: ideaId,
        entries: [
          sampleEntry({
            contentType: "program",
            slug: "cohort-1",
            locale: "en",
            updates: [{ field_path: "title", value: "Cohort" }],
          }),
        ],
      },
      alice,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("database_entry_required");
    expect(missingDb.svc.get(ideaId)?.close_reason).toBe("accepted");

    const existing = makeAttached({ shape: "database", live: "exists" });
    const updated = await existing.svc.create(
      {
        title: "Override title",
        summary,
        entries: [
          sampleEntry({
            contentType: "program",
            slug: "cohort-live",
            locale: "en",
            updates: [{ field_path: "title", value: "Cohort" }],
          }),
        ],
      },
      alice,
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.proposal.entries[0]?.baseline_context.creates_entry).toBeUndefined();
  });

  it("accepting a database-backed idea with no page succeeds with accepted_entry_not_creatable", async () => {
    const { svc } = makeAttached({ shape: "database" });
    const idea = await svc.create(
      {
        kind: "idea",
        title: "New cohort page",
        summary,
        related_entries: [{ contentType: "program", slug: "cohort-9", locale: "en" }],
        idea_funnel: { stage: "awareness", products: "all" },
      },
      alice,
    );
    if (!idea.ok) throw new Error("idea");
    const accepted = await svc.update(idea.proposal.id, "accept", {
      ...bob,
      next_step: "Create the cohort row in the CMS, then file edits.",
      accepted_entry: { contentType: "program", slug: "cohort-9", locale: "en" },
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect((accepted as { warnings?: Array<{ code: string }> }).warnings?.map((w) => w.code)).toEqual([
      "accepted_entry_not_creatable",
    ]);
    const got = svc.get(idea.proposal.id)!;
    expect(got.accepted_entry_create_mode).toBe("manual");
    expect(got.attached_create_entry).toBeNull();
  });

  it("accepting a blog idea stays warning-free (attached mode)", async () => {
    const { svc } = makeAttached();
    const ideaId = await acceptIdea(svc);
    const got = svc.get(ideaId)!;
    expect(got.accepted_entry_create_mode).toBe("attached");
    expect(got.attached_create_entry).toEqual({ contentType: "blog", slug: "what-is-grok", locale: "en" });
  });

  describe("new section-built page (page_file)", () => {
    const heroSections = [{ type: "hero", version: "1.0", title: "AI Engineering Interview Kit" }];
    const pageUpdates = (sections: unknown = heroSections) => [
      { field_path: "meta.page_title", value: "AI Engineering Interview Kit" },
      { field_path: "sections", value: sections },
    ];
    const kitEntry = (overrides: Partial<ProposalEntryInput> = {}) =>
      sampleEntry({
        contentType: "downloadable",
        slug: "ai-engineering-interview-kit",
        locale: "en",
        updates: pageUpdates(),
        ...overrides,
      });

    it("creates edits for a reserved downloadable when a full sections array is sent", async () => {
      const { svc } = makeAttached({ shape: "page_file" });
      const ideaId = await acceptIdea(svc, "ai-engineering-interview-kit", "downloadable");
      const accepted = svc.get(ideaId)!;
      expect(accepted.accepted_entry_create_mode).toBe("page");
      expect(accepted.attached_create_entry).toEqual({
        contentType: "downloadable",
        slug: "ai-engineering-interview-kit",
        locale: "en",
      });

      const without = await svc.create(
        { title: "Kit page", summary, review_situations: ["new_public_content"], entries: [kitEntry()] },
        alice,
      );
      expect(without.ok).toBe(false);
      if (!without.ok) expect(without.code).toBe("implements_required");

      const edits = await svc.create(
        {
          title: "Kit page",
          summary,
          implements_proposal_id: ideaId,
          review_situations: ["new_public_content"],
          entries: [kitEntry()],
        },
        alice,
      );
      expect(edits.ok).toBe(true);
      if (!edits.ok) return;
      expect(edits.proposal.entries[0]?.baseline_context.creates_entry).toBe(true);
    });

    it("refuses missing or partial sections, a variant, and missing required fields", async () => {
      const { svc } = makeAttached({ shape: "page_file" });
      const ideaId = await acceptIdea(svc, "ai-engineering-interview-kit", "downloadable");
      const attempt = (e: ProposalEntryInput, extra: Record<string, unknown> = {}) =>
        svc.create(
          { title: "Kit page", summary, implements_proposal_id: ideaId, entries: [e], ...extra },
          alice,
        );

      const noSections = await attempt(
        kitEntry({ updates: [{ field_path: "meta.page_title", value: "Kit" }] }),
      );
      expect(noSections.ok).toBe(false);
      if (!noSections.ok) expect(noSections.code).toBe("sections_required");

      const partial = await attempt(
        kitEntry({
          updates: [
            { field_path: "meta.page_title", value: "Kit" },
            { field_path: "sections[0].title", value: "Hero" },
          ],
        }),
      );
      expect(partial.ok).toBe(false);
      if (!partial.ok) expect(partial.code).toBe("sections_required");

      const empty = await attempt(kitEntry({ updates: pageUpdates([]) }));
      expect(empty.ok).toBe(false);
      if (!empty.ok) expect(empty.code).toBe("sections_required");

      const variant = await attempt(kitEntry({ variant: "draft" }));
      expect(variant.ok).toBe(false);
      if (!variant.ok) expect(variant.code).toBe("page_create_no_draft");

      const missing = await attempt(
        kitEntry({ updates: [{ field_path: "sections", value: heroSections }] }),
      );
      expect(missing.ok).toBe(false);
      if (!missing.ok) {
        expect(missing.code).toBe("required_fields_missing");
        expect(missing.error).toContain("meta.page_title");
      }
      expect(svc.get(ideaId)?.close_reason).toBe("accepted");
    });

    it("without any accepted idea, returns entry_not_found that asks for an idea and full sections", async () => {
      const { svc } = makeAttached({ shape: "page_file" });
      const res = await svc.create({ title: "Kit page", summary, entries: [kitEntry()] }, alice);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("entry_not_found");
        expect(res.error).toContain("sections");
      }
    });

    it("refuses sections that fail the component registry and saves nothing", async () => {
      const { svc } = makeAttached({
        shape: "page_file",
        validateSections: () => [
          { property_path: "sections[0].type", message: "Unknown component 'heroo'" },
          { property_path: "sections[1].title", message: "Required" },
        ],
      });
      const ideaId = await acceptIdea(svc, "ai-engineering-interview-kit", "downloadable");
      const res = await svc.create(
        { title: "Kit page", summary, implements_proposal_id: ideaId, entries: [kitEntry()] },
        alice,
      );
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.code).toBe("invalid_sections");
      expect(res.error).toContain("sections[0].type");
      expect(res.error).toContain("+1 more");
      const details = (res as { details?: { property_path?: string; issues?: unknown[] } }).details;
      expect(details?.property_path).toBe("sections[0].type");
      expect(details?.issues).toHaveLength(2);
      expect(svc.list({ kind: "edits" }).total).toBe(0);
    });

    it("an idea on a type that cannot be created points at a human for the page", async () => {
      const { svc } = makeAttached({ shape: "other" });
      const ideaId = await acceptIdea(svc, "custom-shell", "landing");
      const res = await svc.create(
        {
          title: "Shell page",
          summary,
          implements_proposal_id: ideaId,
          entries: [kitEntry({ contentType: "landing", slug: "custom-shell" })],
        },
        alice,
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("entry_not_found");
        expect(res.error).toContain("cannot be created from a proposal");
      }
    });
  });

  it("still allows a detached draft, a template variant, and a second-locale promote", async () => {
    const detached = makeAttached({ shape: "other", draftExists: true });
    const draftOk = await detached.svc.create(
      {
        title: "Detached draft",
        summary,
        entries: [
          sampleEntry({
            slug: "custom-shell",
            locale: "en",
            variant: "draft",
            updates: [{ field_path: "title", value: "Custom" }],
          }),
        ],
      },
      alice,
    );
    expect(draftOk.ok).toBe(true);

    const template = makeAttached({ shape: "other", draftExists: true });
    const shell = await template.svc.create(
      {
        title: "Shell variant",
        summary,
        entries: [
          sampleEntry({
            slug: "template",
            locale: "en",
            variant: "b",
            updates: [{ field_path: "title", value: "Shell" }],
          }),
        ],
      },
      alice,
    );
    expect(shell.ok).toBe(true);

    const second = makeAttached({ live: "exists", draftExists: true });
    const promote = await second.svc.create(
      {
        title: "Spanish promote",
        summary,
        promote_on_apply: true,
        review_situations: ["locale_translation"],
        entries: [
          sampleEntry({
            slug: "what-is-grok",
            locale: "es",
            variant: "draft",
            updates: [],
          }),
        ],
      },
      alice,
    );
    expect(promote.ok).toBe(true);
  });

  it("apply seeds then stamps, deletes the new folder only when a later step fails, and stays stale if the file appears", async () => {
    const happy = makeAttached();
    const ideaId = await acceptIdea(happy.svc);
    const edits = await happy.svc.create(
      {
        title: "Grok post",
        summary,
        implements_proposal_id: ideaId,
        review_situations: ["new_public_content"],
        entries: [sampleEntry({ slug: "what-is-grok", locale: "en", updates: attachedUpdates() })],
      },
      alice,
    );
    expect(edits.ok).toBe(true);
    if (!edits.ok) return;
    const applied = await happy.svc.update(edits.proposal.id, "apply", bob);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(happy.prepared).toEqual(["what-is-grok"]);
    expect(happy.stamped).toEqual(["stamped"]);
    expect(happy.discarded).toEqual([]);
    expect(applied.proposal.entries[0]?.status).toBe("done");

    const boom = makeAttached({ applyOk: false });
    const ideaBoom = await acceptIdea(boom.svc, "boom-slug");
    const boomEdits = await boom.svc.create(
      {
        title: "Boom post",
        summary,
        implements_proposal_id: ideaBoom,
        entries: [sampleEntry({ slug: "boom-slug", locale: "en", updates: attachedUpdates() })],
      },
      alice,
    );
    expect(boomEdits.ok).toBe(true);
    if (!boomEdits.ok) return;
    const failed = await boom.svc.update(boomEdits.proposal.id, "apply", bob);
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(boom.discarded).toEqual(["boom-slug"]);
    expect(failed.proposal.entries[0]?.status).toBe("failed");

    const raced = makeAttached();
    const ideaRace = await acceptIdea(raced.svc, "raced-slug");
    const raceEdits = await raced.svc.create(
      {
        title: "Raced post",
        summary,
        implements_proposal_id: ideaRace,
        entries: [sampleEntry({ slug: "raced-slug", locale: "en", updates: attachedUpdates() })],
      },
      alice,
    );
    expect(raceEdits.ok).toBe(true);
    if (!raceEdits.ok) return;
    raced.setLive("exists");
    const stale = await raced.svc.update(raceEdits.proposal.id, "apply", bob);
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(raced.prepared).toEqual([]);
    expect(stale.proposal.entries[0]?.last_error ?? "").toContain("context_stale");
  });

  it("does not block a normal edits proposal as new content when the live page disappears", async () => {
    const { svc, setLive } = makeAttached({ live: "exists", shape: "other" });
    const created = await svc.create(
      {
        title: "Existing post",
        summary,
        entries: [sampleEntry({ slug: "hello", locale: "en", updates: [{ field_path: "title", value: "Hi" }] })],
      },
      alice,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    setLive("missing");
    const applied = await svc.update(created.proposal.id, "apply", bob);
    expect(applied.ok).toBe(false);
    if (!applied.ok) expect(applied.code).toBe("target_missing");
  });

  it("refuses bundling a selling page with the reserved attached post", async () => {
    const { svc } = makeAttached();
    const ideaId = await acceptIdea(svc);
    const mixed = await svc.create(
      {
        title: "Mixed bundle",
        summary,
        implements_proposal_id: ideaId,
        entries: [
          sampleEntry({
            contentType: "program",
            slug: "bootcamp",
            locale: "en",
            updates: [{ field_path: "title", value: "Bootcamp" }],
          }),
          sampleEntry({ slug: "what-is-grok", locale: "en", updates: attachedUpdates() }),
        ],
      },
      alice,
    );
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(["implements_entry_mismatch", "mixed_risk_bundle"]).toContain(mixed.code);
  });

  it("seeds one locale and discards only that new folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "attached-seed-"));
    try {
      const seeded = seedAttachedLocaleFiles({
        contentType: "blog",
        slug: "fresh-post",
        locale: "en",
        contentRoot: root,
        author: "alice",
        funnel: { stage: "awareness", products: "all" },
      });
      const common = yaml.load(fs.readFileSync(seeded.commonPath, "utf-8")) as {
        slug: string;
        funnel?: { stage: string; products: unknown };
      };
      const locale = yaml.load(fs.readFileSync(seeded.localePath, "utf-8")) as {
        slug: string;
        sections: unknown[];
      };
      expect(common.slug).toBe("fresh-post");
      expect(common.funnel).toEqual({ stage: "awareness", products: "all" });
      expect(locale.sections).toEqual([]);
      expect(fs.existsSync(path.join(path.dirname(seeded.localePath), "es.yml"))).toBe(false);
      expect(fs.existsSync(path.join(root, "blog", "template.en.yml"))).toBe(false);
      discardSeededAttachedEntry({
        contentType: "blog",
        slug: "fresh-post",
        locale: "en",
        contentRoot: root,
      });
      expect(fs.existsSync(path.dirname(seeded.localePath))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("new-URL idea funnel: warn on create, refuse accept until set, freeze after accept", async () => {
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: {} }),
      applyUpdates: async () => ({ ok: true }),
      resolveExistence: () => ({ live: "missing", draftExists: false }),
    });
    const summary =
      "New article pitch for a Grok explainer covering product basics for beginners who search. ".repeat(
        2,
      );
    const alice = {
      username: "alice",
      actor: {
        type: "mcp" as const,
        role: "copy_editor",
        model: "claude/sonnet",
        client: "Cursor",
      },
    };
    const bob = {
      username: "bob",
      actor: {
        type: "mcp" as const,
        role: "seo_specialist",
        model: "claude/sonnet",
        client: "Cursor",
      },
    };

    const created = await svc.create(
      {
        kind: "idea",
        title: "New article: What is Grok",
        summary,
        related_entries: [{ contentType: "blog", slug: "what-is-grok", locale: "en" }],
      },
      alice,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ctx = await svc.classifyLive(created.proposal);
    expect(ctx?.agent_preview.warnings.some((w) => w.code === "idea_funnel_missing")).toBe(true);

    const blockedAccept = await svc.update(created.proposal.id, "accept", {
      ...bob,
      next_step: "Draft the post body and SERP title in a follow-up edits proposal.",
      accepted_entry: { contentType: "blog", slug: "what-is-grok", locale: "en" },
    });
    expect(blockedAccept.ok).toBe(false);
    if (!blockedAccept.ok) expect(blockedAccept.code).toBe("idea_funnel_required");

    const badAll = await svc.update(created.proposal.id, "set_idea_funnel", {
      ...alice,
      idea_funnel: { stage: "consideration", products: "all" },
    });
    expect(badAll.ok).toBe(false);
    if (!badAll.ok) expect(badAll.code).toBe("idea_funnel_all_stage");

    const setFunnel = await svc.update(created.proposal.id, "set_idea_funnel", {
      ...alice,
      idea_funnel: { stage: "awareness", products: "all" },
    });
    expect(setFunnel.ok).toBe(true);
    if (!setFunnel.ok) return;
    expect(setFunnel.proposal.idea_funnel).toEqual({ stage: "awareness", products: "all" });

    const accepted = await svc.update(created.proposal.id, "accept", {
      ...bob,
      next_step: "Draft the post body and SERP title in a follow-up edits proposal.",
      accepted_entry: { contentType: "blog", slug: "what-is-grok", locale: "en" },
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    const frozen = await svc.update(created.proposal.id, "set_idea_funnel", {
      ...alice,
      idea_funnel: {
        stage: "decision",
        products: [{ product: "full-stack" }],
      },
    });
    expect(frozen.ok).toBe(false);
    if (!frozen.ok) expect(frozen.code).toBe("idea_funnel_frozen");
  });

  it("idea content types: refuse unknown on create; set_related_entries for proposer only while open", async () => {
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: {} }),
      applyUpdates: async () => ({ ok: true }),
      resolveExistence: () => ({ live: "missing", draftExists: false }),
      knownContentTypes: () => ["blog", "landing"],
      strategyForContentType: (ct) => (ct === "landing" ? { purpose: "Convert paid traffic" } : null),
    });
    const summary =
      "New landing pitch for an AI bootcamp page that converts paid search visitors in Miami. ".repeat(2);
    const alice = {
      username: "alice",
      actor: { type: "mcp" as const, role: "copy_editor", model: "claude/sonnet", client: "Cursor" },
    };
    const bob = {
      username: "bob",
      actor: { type: "mcp" as const, role: "seo_specialist", model: "claude/sonnet", client: "Cursor" },
    };

    const refused = await svc.create(
      {
        kind: "idea",
        title: "New landing: AI Miami",
        summary,
        related_entries: [{ contentType: "landings", slug: "ai-miami", locale: "en" }],
      },
      alice,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe("unknown_content_type");
      expect((refused as { details?: { valid_types?: string[] } }).details?.valid_types).toEqual(["blog", "landing"]);
    }

    const created = await svc.create({ kind: "idea", title: "New landing: AI Miami", summary }, alice);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = await svc.classifyLive(created.proposal);
    expect(before?.agent_preview.warnings.some((w) => w.code === "idea_content_type_missing")).toBe(true);

    const unknown = await svc.update(created.proposal.id, "set_related_entries", {
      ...alice,
      related_entries: [{ contentType: "landings", slug: "ai-miami", locale: "en" }],
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.code).toBe("unknown_content_type");

    const notProposer = await svc.update(created.proposal.id, "set_related_entries", {
      ...bob,
      related_entries: [{ contentType: "landing", slug: "ai-miami", locale: "en" }],
    });
    expect(notProposer.ok).toBe(false);
    if (!notProposer.ok) expect(notProposer.code).toBe("not_proposer");

    const set = await svc.update(created.proposal.id, "set_related_entries", {
      ...alice,
      related_entries: [{ contentType: "landing", slug: "ai-miami", locale: "en" }],
    });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(set.proposal.related_entries).toEqual([{ contentType: "landing", slug: "ai-miami", locale: "en" }]);
    expect(svc.contentTypeStrategiesFor(set.proposal)).toEqual([
      { contentType: "landing", role: "pitched", purpose: "Convert paid traffic" },
    ]);
    const after = await svc.classifyLive(set.proposal);
    expect(after?.agent_preview.warnings.some((w) => w.code === "idea_content_type_missing")).toBe(false);
    expect(after?.agent_preview.think_items.some((t) => t.id === "content_type_fit")).toBe(true);

    const withdrawn = await svc.update(created.proposal.id, "withdraw", {
      ...alice,
      close_note: "Superseded by a broader campaign brief.",
    });
    expect(withdrawn.ok).toBe(true);
    const closed = await svc.update(created.proposal.id, "set_related_entries", {
      ...alice,
      related_entries: [],
    });
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.code).toBe("closed");
  });

  it("proposal_idea_funnel_set: fires on create with funnel, skips unchanged saves, carries actor", async () => {
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: {} }),
      applyUpdates: async () => ({ ok: true }),
      resolveExistence: () => ({ live: "missing", draftExists: false }),
    });
    const summary =
      "New article pitch for a Grok explainer covering product basics for beginners who search. ".repeat(
        2,
      );
    const alice = {
      username: "alice",
      actor: { type: "mcp" as const, role: "copy_editor", model: "grok-4", client: "Cursor" },
    };
    const funnelEvents = (proposalId: string) =>
      listEvents({ site: SITE, type: "proposal_idea_funnel_set", limit: 50 }).filter(
        (e) => e.payload?.proposal_id === proposalId,
      );

    const withFunnel = await svc.create(
      {
        kind: "idea",
        title: "New article: Grok for career changers",
        summary,
        related_entries: [{ contentType: "blog", slug: "grok-career", locale: "en" }],
        idea_funnel: {
          stage: "consideration",
          products: [{ product: "ai-engineering" }, { product: "full-stack" }],
        },
      },
      alice,
    );
    expect(withFunnel.ok).toBe(true);
    if (!withFunnel.ok) return;
    const onCreate = funnelEvents(withFunnel.proposal.id);
    expect(onCreate).toHaveLength(1);
    expect(onCreate[0]?.attribution?.[0]?.actor).toMatchObject({ type: "mcp", model: "grok-4" });
    const created = listEvents({ site: SITE, type: "proposal_created", limit: 50 }).find(
      (e) => e.payload?.proposal_id === withFunnel.proposal.id,
    );
    expect(created).toBeDefined();
    expect(onCreate[0]!.id).toBeGreaterThan(created!.id);

    const bare = await svc.create(
      {
        kind: "idea",
        title: "New article: Grok basics",
        summary: summary.replace("career", "basics") + " Different angle.",
        related_entries: [{ contentType: "blog", slug: "grok-basics", locale: "en" }],
      },
      alice,
    );
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(funnelEvents(bare.proposal.id)).toHaveLength(0);

    const beforeUpdatedAt = withFunnel.proposal.updated_at;
    const same = await svc.update(withFunnel.proposal.id, "set_idea_funnel", {
      ...alice,
      idea_funnel: {
        stage: "consideration",
        products: [{ product: "full-stack" }, { product: "ai-engineering" }],
      },
    });
    expect(same.ok).toBe(true);
    if (!same.ok) return;
    expect(same.proposal.updated_at).toBe(beforeUpdatedAt);
    expect(funnelEvents(withFunnel.proposal.id)).toHaveLength(1);

    const changed = await svc.update(withFunnel.proposal.id, "set_idea_funnel", {
      ...alice,
      idea_funnel: { stage: "decision", products: [{ product: "ai-engineering" }] },
    });
    expect(changed.ok).toBe(true);
    const afterChange = funnelEvents(withFunnel.proposal.id);
    expect(afterChange).toHaveLength(2);
    expect(afterChange[0]?.attribution?.[0]?.actor).toMatchObject({ type: "mcp", model: "grok-4" });
  });

  it("creates_entry apply seeds idea funnel and refuses conflicting ops", async () => {
    let seededFunnel: unknown = null;
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: {} }),
      applyUpdates: async () => ({ ok: true }),
      resolveExistence: () => ({ live: "missing", draftExists: false }),
      inspectMissingTarget: () => ({
        shape: "attached_file",
        requiredFields: ["title"],
      }),
      prepareCreatesEntry: async (entry, opts) => {
        seededFunnel = opts.ideaFunnel ?? null;
        return { ok: true, seeded: true };
      },
      discardSeededEntry: () => {},
      stampPublishedAt: () => ({ ok: true }),
    });
    const summary =
      "New article pitch for a funnel seed test covering product basics for beginners. ".repeat(2);
    const alice = {
      username: "alice",
      actor: {
        type: "mcp" as const,
        role: "copy_editor",
        model: "claude/sonnet",
        client: "Cursor",
      },
    };
    const bob = {
      username: "bob",
      actor: {
        type: "mcp" as const,
        role: "seo_specialist",
        model: "claude/sonnet",
        client: "Cursor",
      },
    };
    const idea = await svc.create(
      {
        kind: "idea",
        title: "New article funnel seed",
        summary,
        related_entries: [{ contentType: "blog", slug: "funnel-seed-post", locale: "en" }],
        idea_funnel: { stage: "awareness", products: "all" },
      },
      alice,
    );
    expect(idea.ok).toBe(true);
    if (!idea.ok) return;
    const accepted = await svc.update(idea.proposal.id, "accept", {
      ...bob,
      next_step: "Create the attached post with implements_proposal_id next.",
      accepted_entry: { contentType: "blog", slug: "funnel-seed-post", locale: "en" },
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    const conflict = await svc.create(
      {
        title: "Conflict funnel create",
        summary: "Implement accepted idea but with a conflicting funnel stage on the new post. ".repeat(
          2,
        ),
        implements_proposal_id: idea.proposal.id,
        review_situations: ["new_public_content"],
        entries: [
          {
            contentType: "blog",
            slug: "funnel-seed-post",
            locale: "en",
            updates: [
              { field_path: "title", value: "Funnel seed" },
              { field_path: "funnel.stage", value: "decision" },
              { field_path: "funnel.products", value: [{ product: "full-stack" }] },
            ],
          },
        ],
      },
      alice,
    );
    expect(conflict.ok).toBe(true);
    if (!conflict.ok) return;
    const applyConflict = await svc.update(conflict.proposal.id, "apply", { ...bob });
    expect(applyConflict.ok).toBe(true);
    if (!applyConflict.ok) return;
    const failed = applyConflict.proposal.entries[0];
    expect(failed?.status).toBe("failed");
    expect(failed?.last_error).toMatch(/idea_funnel_conflict/);

    await svc.update(conflict.proposal.id, "withdraw", {
      ...alice,
      close_note: "Withdrawing conflicting packet so the matching create can apply cleanly.",
    });

    const okCreate = await svc.create(
      {
        title: "Matching funnel create",
        summary: "Implement accepted idea and let apply auto-seed the frozen idea funnel. ".repeat(2),
        implements_proposal_id: idea.proposal.id,
        review_situations: ["new_public_content"],
        entries: [
          {
            contentType: "blog",
            slug: "funnel-seed-post",
            locale: "en",
            updates: [{ field_path: "title", value: "Funnel seed" }],
          },
        ],
      },
      alice,
    );
    expect(okCreate.ok).toBe(true);
    if (!okCreate.ok) return;
    const applied = await svc.update(okCreate.proposal.id, "apply", { ...bob });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(seededFunnel).toEqual({ stage: "awareness", products: "all" });
    expect(applied.proposal.entries[0]?.status).toBe("done");
  });

  it("legacy creates_entry apply seeds the idea SEO target as seo.* ops", async () => {
    const appliedOps: Array<Array<{ field_path: string; value?: unknown }>> = [];
    const HUB = "/en/blog/ai/hub-ai";
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: {} }),
      applyUpdates: async (entry) => {
        appliedOps.push(entry.ops);
        return { ok: true };
      },
      resolveExistence: () => ({ live: "missing", draftExists: false }),
      inspectMissingTarget: () => ({ shape: "attached_file", requiredFields: ["title"] }),
      prepareCreatesEntry: async () => ({ ok: true, seeded: true }),
      discardSeededEntry: () => {},
      stampPublishedAt: () => ({ ok: true }),
      seoTarget: {
        isMonitored: () => true,
        resolveHub: (p) => ({ path: p, live: true, locale: "en", is_hub: true }),
        keywordOwner: () => null,
        selfPath: () => null,
        memberInfo: () => ({ live: true, monitored: true, pillar_path: null }),
      },
    });
    const summary = "New article pitch for an SEO seed test covering basics for beginners who search. ".repeat(2);
    const alice = { username: "alice", actor: { type: "mcp" as const, role: "copy_editor", model: "m", client: "c" } };
    const bob = { username: "bob", actor: { type: "mcp" as const, role: "seo_specialist", model: "m", client: "c" } };
    const idea = await svc.create(
      {
        kind: "idea",
        title: "New article SEO seed",
        summary,
        related_entries: [{ contentType: "blog", slug: "seo-seed-post", locale: "en" }],
        idea_funnel: { stage: "awareness", products: "all" },
        idea_seo_target: { main_keyword: "seo seed", cluster: { mode: "join", pillar_path: HUB } },
      },
      alice,
    );
    expect(idea.ok).toBe(true);
    if (!idea.ok) return;
    const accepted = await svc.update(idea.proposal.id, "accept", {
      ...bob,
      next_step: "Create the attached post with implements_proposal_id next.",
      accepted_entry: { contentType: "blog", slug: "seo-seed-post", locale: "en" },
    });
    expect(accepted.ok).toBe(true);
    const create = await svc.create(
      {
        title: "Seed create",
        summary: "Implement accepted idea and let apply seed the frozen SEO target. ".repeat(2),
        implements_proposal_id: idea.proposal.id,
        review_situations: ["new_public_content"],
        entries: [{ contentType: "blog", slug: "seo-seed-post", locale: "en", updates: [{ field_path: "title", value: "Seed" }] }],
      },
      alice,
    );
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    const applied = await svc.update(create.proposal.id, "apply", { ...bob });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.proposal.entries[0]?.status).toBe("done");
    expect(appliedOps[0]).toEqual([
      { field_path: "seo.main_keyword", value: "seo seed" },
      { field_path: "seo.pillar_path", value: HUB },
      { field_path: "seo.is_pillar", value: false },
      { field_path: "title", value: "Seed" },
    ]);
  });
});

describe("blocked inactivity sweep", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const BLOCKER_BODY =
    "Hero CTA still points to the Coding Bootcamp. Must point to AI Flex because this is a decision-stage page.";
  const SUMMARY = "Replace the live CTA title with a clearer next step for this Spanish blog post. ".repeat(2);

  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
    ensurePipelineDb(SITE, { skipBackup: true });
  });

  afterEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
  });

  async function blockedProposal(svc: ReturnType<typeof makeService>, slug = "hello"): Promise<string> {
    const created = await svc.create(
      { title: `CTA ${slug}`, summary: SUMMARY, entries: [sampleEntry({ slug })] },
      { username: "alice" },
    );
    if (!created.ok) throw new Error(created.error);
    const blocked = await svc.update(created.proposal.id, "add_blocker", { username: "blake", body: BLOCKER_BODY });
    if (!blocked.ok) throw new Error(blocked.error);
    return created.proposal.id;
  }

  /** Moves every activity timestamp of a proposal `days` into the past. */
  function backdate(id: string, days: number): void {
    const db = getSiteSqlite(SITE);
    const t = Date.now() - days * DAY;
    db.prepare(`UPDATE content_proposal_blockers SET created_at = ? WHERE proposal_id = ?`).run(t, id);
    db.prepare(
      `UPDATE content_proposals
       SET updated_at = ?,
           reviewer_action_at = CASE WHEN reviewer_action_at IS NULL THEN NULL ELSE ? END,
           author_content_at = CASE WHEN author_content_at IS NULL THEN NULL ELSE ? END
       WHERE id = ?`,
    ).run(t, t, t, id);
  }

  it("flags after 10 idle days and withdraws as abandoned_blocked after 30", async () => {
    const svc = makeService();
    const id = await blockedProposal(svc);
    const t0 = Date.now();

    expect((await svc.blockedSweep({ now: t0 + 9 * DAY })).flagged).toEqual([]);
    expect(svc.get(id)!.blocked_flagged_at).toBeNull();

    expect((await svc.blockedSweep({ now: t0 + 11 * DAY })).flagged).toEqual([id]);
    const flagged = svc.get(id)!;
    expect(flagged.blocked_flagged_at).toBeTruthy();
    expect(toProposalSummary(flagged).blocked_flagged_at).toBe(flagged.blocked_flagged_at);
    expect((await svc.blockedSweep({ now: t0 + 12 * DAY })).flagged).toEqual([]);

    expect((await svc.blockedSweep({ now: t0 + 31 * DAY })).closed).toEqual([id]);
    const closed = svc.get(id)!;
    expect(closed.status).toBe("withdrawn");
    expect(closed.close_reason).toBe("abandoned_blocked");
    expect(closed.claim).toBeNull();
    expect(closed.close_note).toContain("30 days");
    expect(closed.close_note).not.toContain("published");

    const types = listEvents({ site: SITE, limit: 200 })
      .filter((e) => (e.payload as { proposal_id?: string }).proposal_id === id)
      .map((e) => e.type);
    expect(types).toContain("proposal_blocked_flagged");
    expect(types).toContain("proposal_closed_abandoned_blocked");
  });

  it("closes on the first sweep without a prior flag when already idle 30+ days", async () => {
    const svc = makeService();
    const id = await blockedProposal(svc);
    backdate(id, 31);
    const report = await svc.blockedSweep();
    expect(report.flagged).toEqual([]);
    expect(report.closed).toEqual([id]);
    expect(svc.get(id)!.close_reason).toBe("abandoned_blocked");
  });

  it("claim and release do not reset the clock", async () => {
    const svc = makeService();
    const id = await blockedProposal(svc);
    backdate(id, 31);
    await svc.update(id, "claim", { username: "alice" });
    await svc.update(id, "release", { username: "alice" });
    expect(svc.get(id)!.updated_at).toBeGreaterThan(Date.now() - DAY);
    expect((await svc.blockedSweep()).closed).toEqual([id]);
  });

  it("an author rewrite after the flag clears it and restarts the clock", async () => {
    const svc = makeService();
    const id = await blockedProposal(svc);
    backdate(id, 11);
    const t = Date.now();
    expect((await svc.blockedSweep({ now: t })).flagged).toEqual([id]);

    const db = getSiteSqlite(SITE);
    db.prepare(`UPDATE content_proposals SET author_content_at = ? WHERE id = ?`).run(t + 1000, id);

    const report = await svc.blockedSweep({ now: t + 2000 });
    expect(report.cleared).toEqual([id]);
    expect(report.flagged).toEqual([]);
    expect(svc.get(id)!.blocked_flagged_at).toBeNull();
    expect((await svc.blockedSweep({ now: t + 25 * DAY })).closed).toEqual([]);
  });

  it("resolving every blocker clears the flag and the proposal is never closed", async () => {
    const svc = makeService();
    const id = await blockedProposal(svc);
    backdate(id, 11);
    expect((await svc.blockedSweep()).flagged).toEqual([id]);

    await svc.update(id, "claim", { username: "alice" });
    const bid = svc.get(id)!.blockers[0]!.id;
    const resolved = await svc.update(id, "resolve_blocker", {
      username: "alice",
      blocker_id: bid,
      resolve_note: "Pointed the hero CTA at AI Flex on the draft as requested.",
    });
    expect(resolved.ok).toBe(true);

    const report = await svc.blockedSweep({ now: Date.now() + 60 * DAY });
    expect(report.cleared).toEqual([id]);
    expect(report.closed).toEqual([]);
    const after = svc.get(id)!;
    expect(after.status).toBe("open");
    expect(after.blocked_flagged_at).toBeNull();
  });

  it("partial proposals close with a note that published pages stay live", async () => {
    const svc = makeService();
    const id = await blockedProposal(svc);
    const db = getSiteSqlite(SITE);
    db.prepare(`UPDATE content_proposals SET status = 'partial' WHERE id = ?`).run(id);
    db.prepare(`UPDATE content_proposal_entries SET status = 'done' WHERE proposal_id = ?`).run(id);
    backdate(id, 31);

    expect((await svc.blockedSweep()).closed).toEqual([id]);
    const closed = svc.get(id)!;
    expect(closed.status).toBe("withdrawn");
    expect(closed.close_note).toContain("Pages already published stay live");
    expect(closed.entries[0]?.status).toBe("done");
  });

  it("skips escalated, closed, and zero-open-blocker proposals", async () => {
    const svc = makeService();
    const escalated = await blockedProposal(svc, "escalated");
    const rejected = await blockedProposal(svc, "rejected");
    const plain = await svc.create(
      { title: "No blockers", summary: SUMMARY, entries: [sampleEntry({ slug: "plain" })] },
      { username: "alice" },
    );
    if (!plain.ok) throw new Error(plain.error);
    const db = getSiteSqlite(SITE);
    db.prepare(`UPDATE content_proposals SET escalated = 1 WHERE id = ?`).run(escalated);
    db.prepare(`UPDATE content_proposals SET status = 'rejected' WHERE id = ?`).run(rejected);
    for (const id of [escalated, rejected, plain.proposal.id]) backdate(id, 60);

    const report = await svc.blockedSweep();
    expect(report.checked).toBe(0);
    expect(report.closed).toEqual([]);
    expect(svc.get(escalated)!.status).toBe("open");
    expect(svc.get(rejected)!.status).toBe("rejected");
    expect(svc.get(plain.proposal.id)!.status).toBe("open");
  });

  it("outcome_review none excludes abandoned_blocked closures", async () => {
    const svc = makeService();
    const id = await blockedProposal(svc);
    backdate(id, 31);
    await svc.blockedSweep();
    expect(svc.list({ outcome_review: "none" }).proposals.map((p) => p.id)).not.toContain(id);
  });
});

describe("attach_variant and agent-invented session ids", () => {
  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
    ensurePipelineDb(SITE, { skipBackup: true });
  });

  afterEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
  });

  const seo = { type: "mcp" as const, client: "Cursor", role: "seo_specialist", model: "cursor/auto" };
  const summary = "Patch the CTA title on the Spanish blog before the agent attaches its prepared draft. ".repeat(2);

  async function createWithSession(svc: ReturnType<typeof makeService>, agentSessionId: string, slug: string) {
    const created = await svc.create(
      { title: "Attach later", summary, agent_session_id: agentSessionId, entries: [sampleEntry({ slug })] },
      { username: "alice", actor: seo },
    );
    if (!created.ok) throw new Error(created.error);
    return created.proposal.id;
  }

  it("legacy invented id: same proposer can attach from a new server-issued session", async () => {
    const svc = makeService();
    const id = await createWithSession(svc, "new", "legacy-same");
    const res = await svc.update(id, "attach_variant", {
      username: "alice",
      actor: seo,
      agent_session_id: "d2b2f51c-9fc3-4f86-93bd-03951f678da2",
      variant: "agent-fix",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.proposal.entries[0]!.variant).toBe("agent-fix");
  });

  it("legacy invented id: another role cannot attach", async () => {
    const svc = makeService();
    const id = await createWithSession(svc, "new", "legacy-other");
    const res = await svc.update(id, "attach_variant", {
      username: "alice",
      actor: { ...seo, role: "copy_editor" },
      agent_session_id: "new",
      variant: "agent-fix",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("session_mismatch");
  });

  it("server-issued id: a different session of the same proposer still cannot attach", async () => {
    const svc = makeService();
    const id = await createWithSession(svc, "11111111-2222-4333-8444-555555555555", "uuid-strict");
    const res = await svc.update(id, "attach_variant", {
      username: "alice",
      actor: seo,
      agent_session_id: "d2b2f51c-9fc3-4f86-93bd-03951f678da2",
      variant: "agent-fix",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("session_mismatch");
  });
});
