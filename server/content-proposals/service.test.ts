import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { clearSiteSqliteCacheForTests } from "../db";
import { ensurePipelineDb, resetPipelineDbCache } from "../pipeline-db/runner";
import { fingerprintEdits, fingerprintNotes } from "./fingerprint";
import {
  createProposalService,
  listOpenProposalsForVariant,
  PROPOSAL_CLAIM_TTL_MS,
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

  it("blocks four-eyes apply and acknowledge", async () => {
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
    const ackSelf = await svc.update(notes.proposal.id, "acknowledge", { username: "alice" });
    expect(ackSelf.ok).toBe(false);
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

  it("acknowledges notes by a different user", async () => {
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
    const ack = await svc.update(created.proposal.id, "acknowledge", { username: "bob" });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.proposal.status).toBe("finished");
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
      expect(second.code).toBe("proposal_exists");
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

    const rejected = await svc.update(created.proposal.id, "reject", { username: "casey" });
    expect(rejected.ok).toBe(true);
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

      const withdrawn = await svc.update(created.proposal.id, "withdraw", { username: "alice" });
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
});
