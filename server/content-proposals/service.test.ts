import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { clearSiteSqliteCacheForTests } from "../db";
import { ensurePipelineDb, resetPipelineDbCache } from "../pipeline-db/runner";
import { fingerprintEdits, fingerprintNotes } from "./fingerprint";
import { createProposalService, type ProposalEntryInput } from "./service";

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
    if (ack.ok) expect(ack.proposal.status).toBe("finished");
  });
});
