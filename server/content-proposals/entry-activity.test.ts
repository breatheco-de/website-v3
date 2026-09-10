import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { clearSiteSqliteCacheForTests } from "../db";
import { ensurePipelineDb, resetPipelineDbCache } from "../pipeline-db/runner";
import { emitEvent } from "../events/event-store";
import { singleAttribution } from "../events/types";
import {
  resolveProposalEntryActivity,
  PROPOSAL_APPLY_EXCLUDE_WINDOW_MS,
} from "./entry-activity";
import { createProposalService, type ProposalEntryInput } from "./service";

const SITE = `site_proposal-activity-${Date.now()}`;

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

describe("resolveProposalEntryActivity", () => {
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

  it("counts live writes and named draft separately", () => {
    emitEvent({
      site: SITE,
      type: "entry_locale_saved",
      resource: { contentType: "blog", slug: "hello", locale: "es", layer: "live", path: "x/es.yml" },
      attribution: singleAttribution("alice", { type: "ui" }),
      payload: {},
    });
    emitEvent({
      site: SITE,
      type: "entry_locale_saved",
      resource: {
        contentType: "blog",
        slug: "hello",
        locale: "es",
        layer: "variant",
        path: "blog/hello/agent-fix.es.yml",
      },
      attribution: singleAttribution("bob", { type: "mcp", client: "cursor" }),
      payload: { layer: "variant" },
    });

    const liveOnly = resolveProposalEntryActivity({
      site: SITE,
      entries: [{ contentType: "blog", slug: "hello", locale: "es" }],
    });
    expect(liveOnly.ok).toBe(true);
    if (!liveOnly.ok) return;
    expect(liveOnly.gateWriteCount).toBe(1);
    expect(liveOnly.activity.map((a) => a.entryKey)).toEqual(["blog/hello/es"]);

    const withDraft = resolveProposalEntryActivity({
      site: SITE,
      entries: [{ contentType: "blog", slug: "hello", locale: "es", variant: "agent-fix" }],
    });
    expect(withDraft.ok).toBe(true);
    if (!withDraft.ok) return;
    expect(withDraft.gateWriteCount).toBe(2);
    expect(withDraft.activity.find((a) => a.entryKey.endsWith("@agent-fix"))?.writeCount).toBe(1);
  });

  it("excludes current agent session from gate count", () => {
    emitEvent({
      site: SITE,
      type: "entry_seo_changed",
      resource: { contentType: "blog", slug: "hello", locale: "es" },
      attribution: singleAttribution("agent", { type: "mcp", client: "cursor" }),
      agent_session_id: "sess-now",
      payload: { entryKey: "blog/hello/es" },
    });
    emitEvent({
      site: SITE,
      type: "entry_seo_changed",
      resource: { contentType: "blog", slug: "hello", locale: "es" },
      attribution: singleAttribution("agent", { type: "mcp", client: "cursor" }),
      agent_session_id: "sess-old",
      payload: { entryKey: "blog/hello/es" },
    });

    const gated = resolveProposalEntryActivity({
      site: SITE,
      entries: [{ contentType: "blog", slug: "hello", locale: "es" }],
      excludeAgentSessionId: "sess-now",
    });
    expect(gated.ok).toBe(true);
    if (!gated.ok) return;
    expect(gated.gateWriteCount).toBe(1);
  });

  it("excludes proposal apply window from gate count", () => {
    const appliedAt = Date.now() - 5_000;
    emitEvent({
      site: SITE,
      type: "entry_locale_saved",
      resource: { contentType: "blog", slug: "hello", locale: "es", layer: "live" },
      attribution: singleAttribution("bob", { type: "ui" }),
      payload: {},
      // created_at set by emit — use exclusion with now-aligned applied_at via injection
    });

    const listed = resolveProposalEntryActivity({
      site: SITE,
      entries: [{ contentType: "blog", slug: "hello", locale: "es" }],
      excludeProposalApplies: [
        {
          contentType: "blog",
          slug: "hello",
          locale: "es",
          applied_at: Date.now(),
          applied_by: "bob",
        },
      ],
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    // Event just emitted; applied_at=now and author bob → excluded within window
    expect(listed.gateWriteCount).toBe(0);
    expect(PROPOSAL_APPLY_EXCLUDE_WINDOW_MS).toBeGreaterThan(0);
    void appliedAt;
  });
});

describe("proposal create/apply recent activity gates", () => {
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

  it("soft-blocks create until confirm_recent_activity", async () => {
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: { "call_to_action.title": "Old" } }),
      applyUpdates: async () => ({ ok: true }),
      resolveRecentActivity: () => ({
        ok: true,
        activity: [{ entryKey: "blog/hello/es", writeCount: 2, windowDays: 14 }],
        gateWriteCount: 2,
        windowDays: 14,
      }),
    });
    const payload = {
      title: "CTR",
      summary: "Align title and description to the target query after reviewing Search Console. ".repeat(2),
      entries: [sampleEntry()],
    };
    const blocked = await svc.create(payload, { username: "alice" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("confirm_recent_activity");

    const created = await svc.create(
      { ...payload, confirm_recent_activity: true },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
  });

  it("fail-closes create when activity unavailable", async () => {
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: { "call_to_action.title": "Old" } }),
      applyUpdates: async () => ({ ok: true }),
      resolveRecentActivity: () => ({
        ok: false,
        code: "activity_unavailable",
        error: "db down",
      }),
    });
    const blocked = await svc.create(
      {
        title: "CTR",
        summary: "Align title and description to the target query after reviewing Search Console. ".repeat(2),
        entries: [sampleEntry()],
      },
      { username: "alice" },
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("activity_unavailable");
  });

  it("notes skip activity gate", async () => {
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: {} }),
      applyUpdates: async () => ({ ok: true }),
      resolveRecentActivity: () => {
        throw new Error("should not be called for notes");
      },
    });
    const created = await svc.create(
      {
        title: "Handoff",
        summary: "Tried the checklist and still blocked on the wall for this validation issue. ".repeat(2),
      },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
  });

  it("apply always re-checks activity even after create confirm", async () => {
    let gateCount = 0;
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: { "call_to_action.title": "Old" } }),
      applyUpdates: async () => ({ ok: true }),
      resolveRecentActivity: () => ({
        ok: true,
        activity: [{ entryKey: "blog/hello/es", writeCount: gateCount, windowDays: 14 }],
        gateWriteCount: gateCount,
        windowDays: 14,
      }),
    });
    const created = await svc.create(
      {
        title: "CTR",
        summary: "Align title and description to the target query after reviewing Search Console. ".repeat(2),
        entries: [sampleEntry()],
        confirm_recent_activity: true,
      },
      { username: "alice" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    gateCount = 3;
    const blocked = await svc.update(created.proposal.id, "apply", { username: "bob" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("confirm_recent_activity");

    const applied = await svc.update(created.proposal.id, "apply", {
      username: "bob",
      confirm_recent_activity: true,
    });
    expect(applied.ok).toBe(true);
  });
});
