import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { clearSiteSqliteCacheForTests } from "../db";
import { resetPipelineDbCache } from "../pipeline-db/runner";
import {
  emitEvent,
  getCurrentGeneration,
  getLatestWriteGeneration,
  getLastSnapshotGeneration,
  getWriteEventsBetween,
  getLatestWriteForEntry,
  listOpenWritesForEntry,
  getUnpublishedEvents,
  getUnpublishedCount,
  getOldestUnpublishedAgeMs,
  markEventsPublished,
  listEvents,
  clearAllEvents,
  listAgentSessions,
  getAgentSessionDetail,
} from "./event-store";
import { singleAttribution } from "./types";

const TEST_SITE = "site_test-events";

describe("event-store", () => {
  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    const dbPath = path.join("data", TEST_SITE.replace(/\//g, "-"), "app.db");
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  });

  afterEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    const dbPath = path.join("data", TEST_SITE.replace(/\//g, "-"), "app.db");
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it("uses rowid as generation", () => {
    const e1 = emitEvent({ site: TEST_SITE, type: "entry_locale_saved", payload: { n: 1 } });
    const e2 = emitEvent({ site: TEST_SITE, type: "entry_locale_saved", payload: { n: 2 } });
    expect(e2.id).toBeGreaterThan(e1.id);
    expect(getCurrentGeneration(TEST_SITE)).toBe(e2.id);
  });

  it("tracks latest write generation separately from pipeline events", () => {
    const site = `${TEST_SITE}-writes-${Date.now()}`;
    const write = emitEvent({ site, type: "entry_locale_saved" });
    emitEvent({ site, type: "validation_results_ready", payload: { entryKey: "blog/a/en" } });
    emitEvent({ site, type: "index_snapshot_ready", payload: { generation: write.id } });
    expect(getLatestWriteGeneration(site)).toBe(write.id);
    expect(getCurrentGeneration(site)).toBeGreaterThan(write.id);
  });

  it("tracks unpublished dispatch events only", () => {
    const site = `${TEST_SITE}-unpub-${Date.now()}`;
    emitEvent({ site, type: "entry_locale_saved" });
    const pending = getUnpublishedEvents(site);
    expect(pending.length).toBe(1);
    markEventsPublished(site, [pending[0]!.id]);
    expect(getUnpublishedEvents(site).length).toBe(0);
  });

  it("auto-publishes audit events and excludes them from backlog metrics", () => {
    const site = `${TEST_SITE}-audit-${Date.now()}`;
    const audit = emitEvent({
      site,
      type: "validation_results_ready",
      payload: { entryKey: "page/foo/en", skipped: true },
    });
    expect(audit.published).toBe(true);
    expect(getUnpublishedEvents(site)).toHaveLength(0);
    expect(getUnpublishedCount(site)).toBe(0);
    expect(getOldestUnpublishedAgeMs(site)).toBeNull();

    emitEvent({ site, type: "entry_locale_saved" });
    expect(getUnpublishedCount(site)).toBe(1);
  });

  it("ignores legacy unpublished audit rows in backlog queries", () => {
    const site = `${TEST_SITE}-legacy-audit-${Date.now()}`;
    const dbPath = path.join("data", site, "app.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        site TEXT NOT NULL,
        resource_json TEXT NOT NULL DEFAULT '{}',
        cause TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        triggered_by_event_id INTEGER,
        triggered_by_event_ids_json TEXT,
        attribution_json TEXT NOT NULL DEFAULT '[]',
        published INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      INSERT INTO events (type, site, published, created_at)
      VALUES ('validation_results_ready', '${site}', 0, ${Date.now() - 10 * 60 * 1000});
    `);
    raw.close();

    expect(getUnpublishedCount(site)).toBe(0);
    expect(getOldestUnpublishedAgeMs(site)).toBeNull();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("lists events with filters", () => {
    emitEvent({ site: TEST_SITE, type: "entry_locale_saved", cause: "test-cause" });
    const listed = listEvents({ site: TEST_SITE, cause: "test-cause", limit: 10 });
    expect(listed.length).toBe(1);
    expect(listed[0]?.cause).toBe("test-cause");
  });

  it("stores attribution and triggered_by fields", () => {
    const parent = emitEvent({
      site: TEST_SITE,
      type: "entry_locale_saved",
      attribution: singleAttribution("jane.doe", { type: "ui" }),
    });
    const child = emitEvent({
      site: TEST_SITE,
      type: "validation_results_ready",
      triggeredByEventId: parent.id,
      attribution: parent.attribution,
      payload: { entryKey: "page/foo/en" },
    });
    expect(child.triggeredByEventId).toBe(parent.id);
    expect(child.attribution[0]?.author).toBe("jane.doe");
  });

  it("lists events by triggeredBy parent id", () => {
    const site = `${TEST_SITE}-trigger-${Date.now()}`;
    const w1 = emitEvent({ site, type: "entry_locale_saved" });
    const w2 = emitEvent({ site, type: "entry_locale_saved" });
    emitEvent({
      site,
      type: "index_snapshot_ready",
      triggeredByEventIds: [w1.id, w2.id],
      payload: { generation: w2.id },
    });
    const byW1 = listEvents({ site, triggeredBy: w1.id, limit: 10 });
    expect(byW1.some((e) => e.type === "index_snapshot_ready")).toBe(true);
  });

  it("getWriteEventsBetween returns write ids in range", () => {
    const site = `${TEST_SITE}-range-${Date.now()}`;
    const w1 = emitEvent({ site, type: "entry_locale_saved" });
    emitEvent({ site, type: "validation_results_ready", payload: {} });
    const w2 = emitEvent({ site, type: "entry_locale_saved" });
    const writes = getWriteEventsBetween(site, w1.id, w2.id);
    expect(writes.map((w) => w.id)).toEqual([w2.id]);
  });

  it("getLastSnapshotGeneration reads latest snapshot payload", () => {
    const site = `${TEST_SITE}-snap-${Date.now()}`;
    expect(getLastSnapshotGeneration(site)).toBe(0);
    const w = emitEvent({ site, type: "entry_locale_saved" });
    emitEvent({ site, type: "index_snapshot_ready", payload: { generation: w.id } });
    expect(getLastSnapshotGeneration(site)).toBe(w.id);
  });

  it("getLatestWriteForEntry matches resource", () => {
    const site = `${TEST_SITE}-entry-${Date.now()}`;
    emitEvent({
      site,
      type: "entry_locale_saved",
      resource: { contentType: "page", slug: "foo", locale: "en" },
    });
    const latest = getLatestWriteForEntry(site, {
      contentType: "page",
      slug: "foo",
      locale: "en",
    });
    expect(latest?.resource.slug).toBe("foo");
  });

  it("listOpenWritesForEntry excludes writes with matching ready", () => {
    const site = `${TEST_SITE}-open-${Date.now()}`;
    const resource = { contentType: "blog", slug: "a", locale: "en" };
    const w1 = emitEvent({ site, type: "entry_locale_saved", resource });
    const w2 = emitEvent({ site, type: "entry_locale_saved", resource });
    emitEvent({
      site,
      type: "validation_results_ready",
      triggeredByEventId: w2.id,
      payload: { entryKey: "blog/a/en" },
    });
    const open = listOpenWritesForEntry(site, resource);
    expect(open.map((e) => e.id)).toEqual([w1.id]);
  });

  it("clears all events for a site", () => {
    const site = `${TEST_SITE}-clear-${Date.now()}`;
    emitEvent({ site, type: "entry_locale_saved" });
    emitEvent({ site, type: "index_snapshot_ready", payload: { generation: 1 } });
    expect(listEvents({ site, limit: 10 }).length).toBe(2);
    const deleted = clearAllEvents(site);
    expect(deleted).toBe(2);
    expect(listEvents({ site, limit: 10 }).length).toBe(0);
  });

  it("stores and filters agent_session_id; unscopedOnly", () => {
    const site = `${TEST_SITE}-sess-${Date.now()}`;
    emitEvent({
      site,
      type: "entry_locale_saved",
      agent_session_id: "sess-a",
      payload: { report: "x".repeat(80), path: "a.yml" },
    });
    emitEvent({ site, type: "entry_locale_saved", payload: { path: "b.yml" } });
    expect(listEvents({ site, agentSessionId: "sess-a", limit: 10 })).toHaveLength(1);
    expect(listEvents({ site, unscopedOnly: true, limit: 10 })).toHaveLength(1);
  });

  it("filters by kinds (OR), actors, and exact type wins over kinds", () => {
    const site = `${TEST_SITE}-kinds-${Date.now()}`;
    emitEvent({
      site,
      type: "validation_issue_completed",
      attribution: singleAttribution("claude", { type: "mcp", client: "Cursor", model: "claude-4-sonnet" }),
    });
    emitEvent({
      site,
      type: "entry_locale_saved",
      attribution: singleAttribution("jane", { type: "ui" }),
    });
    emitEvent({
      site,
      type: "index_snapshot_ready",
      attribution: singleAttribution("index", { type: "system", source: "index-refresh" }),
      payload: { generation: 1 },
    });

    const completes = listEvents({
      site,
      types: ["validation_issue_completed"],
      limit: 10,
    });
    expect(completes).toHaveLength(1);
    expect(completes[0]!.type).toBe("validation_issue_completed");

    const kindOr = listEvents({
      site,
      types: ["validation_issue_completed", "entry_locale_saved"],
      limit: 10,
    });
    expect(kindOr).toHaveLength(2);

    const people = listEvents({ site, actors: ["people"], limit: 10 });
    expect(people).toHaveLength(1);
    expect(people[0]!.type).toBe("entry_locale_saved");

    const agentsOrSystem = listEvents({ site, actors: ["agents", "system"], limit: 10 });
    expect(agentsOrSystem).toHaveLength(2);

    // Exact type wins: kinds would include completes, but type is a write
    const typeWins = listEvents({
      site,
      type: "entry_locale_saved",
      types: ["validation_issue_completed"],
      limit: 10,
    });
    expect(typeWins).toHaveLength(1);
    expect(typeWins[0]!.type).toBe("entry_locale_saved");
  });

  it("actors filter uses system executor on follow-ups, not parent mcp attribution", () => {
    const site = `${TEST_SITE}-system-followup-${Date.now()}`;
    const write = emitEvent({
      site,
      type: "entry_locale_saved",
      attribution: singleAttribution("claude", { type: "mcp", client: "Cursor", model: "claude-4-sonnet" }),
    });
    emitEvent({
      site,
      type: "index_snapshot_ready",
      triggeredByEventIds: [write.id],
      attribution: singleAttribution(undefined, { type: "system", source: "index-refresh" }),
      payload: { generation: write.id },
    });

    expect(listEvents({ site, actors: ["agents"], limit: 10 }).map((e) => e.type)).toEqual([
      "entry_locale_saved",
    ]);
    const systemRows = listEvents({ site, actors: ["system"], limit: 10 });
    expect(systemRows).toHaveLength(1);
    expect(systemRows[0]!.type).toBe("index_snapshot_ready");
    expect(listEvents({ site, triggeredBy: write.id, limit: 10 })[0]!.type).toBe("index_snapshot_ready");
  });

  it("filters by agent id with batch scan and __other__", () => {
    const site = `${TEST_SITE}-agent-${Date.now()}`;
    emitEvent({
      site,
      type: "entry_locale_saved",
      attribution: singleAttribution("a", { type: "mcp", client: "Cursor", model: "claude-4-sonnet" }),
    });
    emitEvent({
      site,
      type: "entry_locale_saved",
      attribution: singleAttribution("b", { type: "mcp", client: "Cursor", model: "gemini-2.5-pro" }),
    });
    emitEvent({
      site,
      type: "entry_locale_saved",
      attribution: singleAttribution("jane", { type: "ui" }),
    });

    const claude = listEvents({ site, agent: "claude", limit: 10 });
    expect(claude).toHaveLength(1);
    expect(claude[0]!.attribution[0]?.actor).toMatchObject({ model: "claude-4-sonnet" });

    const other = listEvents({ site, agent: "__other__", limit: 10 });
    expect(other).toHaveLength(1);
    expect(other[0]!.attribution[0]?.actor?.type).toBe("ui");
  });

  it("combines session filter with kinds", () => {
    const site = `${TEST_SITE}-sess-kind-${Date.now()}`;
    const sid = "sess-kind-1";
    emitEvent({
      site,
      type: "validation_issue_completed",
      agent_session_id: sid,
      attribution: singleAttribution("a", { type: "mcp", client: "Cursor", model: "claude-4" }),
    });
    emitEvent({
      site,
      type: "entry_locale_saved",
      agent_session_id: sid,
      attribution: singleAttribution("a", { type: "mcp", client: "Cursor", model: "claude-4" }),
    });
    emitEvent({
      site,
      type: "validation_issue_completed",
      agent_session_id: "other-sess",
      attribution: singleAttribution("a", { type: "mcp", client: "Cursor", model: "claude-4" }),
    });

    const rows = listEvents({
      site,
      agentSessionId: sid,
      types: ["validation_issue_completed"],
      limit: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agent_session_id).toBe(sid);
  });

  it("auto-publishes agent_session audit events", () => {
    const site = `${TEST_SITE}-sess-audit-${Date.now()}`;
    const started = emitEvent({
      site,
      type: "agent_session_started",
      agent_session_id: "sess-b",
      payload: { label: "test" },
    });
    expect(started.published).toBe(true);
    expect(getUnpublishedCount(site)).toBe(0);
  });

  it("listAgentSessions and getAgentSessionDetail rollup from events", () => {
    const site = `${TEST_SITE}-sess-list-${Date.now()}`;
    const sid = "sess-c";
    const actorAttr = singleAttribution("demo-agent", {
      type: "mcp",
      client: "Cursor",
      model: "claude-4-sonnet",
    });
    emitEvent({
      site,
      type: "agent_session_started",
      agent_session_id: sid,
      attribution: actorAttr,
      payload: {},
    });
    emitEvent({
      site,
      type: "entry_locale_saved",
      agent_session_id: sid,
      attribution: actorAttr,
      payload: { report: "r".repeat(80), path: "site_x/pages/foo/en.yml" },
    });
    emitEvent({
      site,
      type: "validation_issue_completed",
      agent_session_id: sid,
      attribution: actorAttr,
      payload: { report: "fixed ".padEnd(80, "x"), entryKey: "page/foo/en" },
    });
    emitEvent({
      site,
      type: "agent_session_summarized",
      agent_session_id: sid,
      attribution: actorAttr,
      payload: { report: "summary ".padEnd(80, "y") },
    });
    // bulk sync must not appear as a session write even if somehow tagged — we never tag it
    emitEvent({ site, type: "site_bulk_synced", payload: { count: 3 } });

    const sessions = listAgentSessions(site, { limit: 10 });
    expect(sessions.some((s) => s.agent_session_id === sid)).toBe(true);
    const row = sessions.find((s) => s.agent_session_id === sid)!;
    expect(row.write_count).toBe(1);
    expect(row.issue_complete_count).toBe(1);
    expect(row.attribution.some((a) => a.actor?.type === "mcp" && a.author === "demo-agent")).toBe(
      true,
    );

    const detail = getAgentSessionDetail(site, sid);
    expect(detail).not.toBeNull();
    expect(detail!.summary.write_count).toBe(1);
    expect(detail!.summary.issue_complete_count).toBe(1);
    expect(detail!.summary.attribution.some((a) => a.actor?.type === "mcp")).toBe(true);
    expect(detail!.files.some((f) => f.includes("en.yml"))).toBe(true);
    expect(detail!.headline?.startsWith("summary")).toBe(true);
  });

});
