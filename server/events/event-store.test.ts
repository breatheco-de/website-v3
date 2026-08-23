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
  getUnpublishedEvents,
  getUnpublishedCount,
  getOldestUnpublishedAgeMs,
  markEventsPublished,
  listEvents,
  clearAllEvents,
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
    const e1 = emitEvent({ site: TEST_SITE, type: "content_file_written", payload: { n: 1 } });
    const e2 = emitEvent({ site: TEST_SITE, type: "content_file_written", payload: { n: 2 } });
    expect(e2.id).toBeGreaterThan(e1.id);
    expect(getCurrentGeneration(TEST_SITE)).toBe(e2.id);
  });

  it("tracks latest write generation separately from pipeline events", () => {
    const site = `${TEST_SITE}-writes-${Date.now()}`;
    const write = emitEvent({ site, type: "content_file_written" });
    emitEvent({ site, type: "validation_results_ready", payload: { entryKey: "blog/a/en" } });
    emitEvent({ site, type: "index_snapshot_ready", payload: { generation: write.id } });
    expect(getLatestWriteGeneration(site)).toBe(write.id);
    expect(getCurrentGeneration(site)).toBeGreaterThan(write.id);
  });

  it("tracks unpublished dispatch events only", () => {
    const site = `${TEST_SITE}-unpub-${Date.now()}`;
    emitEvent({ site, type: "content_file_written" });
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

    emitEvent({ site, type: "content_file_written" });
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
    emitEvent({ site: TEST_SITE, type: "content_file_written", cause: "test-cause" });
    const listed = listEvents({ site: TEST_SITE, cause: "test-cause", limit: 10 });
    expect(listed.length).toBe(1);
    expect(listed[0]?.cause).toBe("test-cause");
  });

  it("stores attribution and triggered_by fields", () => {
    const parent = emitEvent({
      site: TEST_SITE,
      type: "content_file_written",
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
    const w1 = emitEvent({ site, type: "content_file_written" });
    const w2 = emitEvent({ site, type: "content_file_written" });
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
    const w1 = emitEvent({ site, type: "content_file_written" });
    emitEvent({ site, type: "validation_results_ready", payload: {} });
    const w2 = emitEvent({ site, type: "content_file_written" });
    const writes = getWriteEventsBetween(site, w1.id, w2.id);
    expect(writes.map((w) => w.id)).toEqual([w2.id]);
  });

  it("getLastSnapshotGeneration reads latest snapshot payload", () => {
    const site = `${TEST_SITE}-snap-${Date.now()}`;
    expect(getLastSnapshotGeneration(site)).toBe(0);
    const w = emitEvent({ site, type: "content_file_written" });
    emitEvent({ site, type: "index_snapshot_ready", payload: { generation: w.id } });
    expect(getLastSnapshotGeneration(site)).toBe(w.id);
  });

  it("getLatestWriteForEntry matches resource", () => {
    const site = `${TEST_SITE}-entry-${Date.now()}`;
    emitEvent({
      site,
      type: "content_file_written",
      resource: { contentType: "page", slug: "foo", locale: "en" },
    });
    const latest = getLatestWriteForEntry(site, {
      contentType: "page",
      slug: "foo",
      locale: "en",
    });
    expect(latest?.resource.slug).toBe("foo");
  });

  it("clears all events for a site", () => {
    const site = `${TEST_SITE}-clear-${Date.now()}`;
    emitEvent({ site, type: "content_file_written" });
    emitEvent({ site, type: "index_snapshot_ready", payload: { generation: 1 } });
    expect(listEvents({ site, limit: 10 }).length).toBe(2);
    const deleted = clearAllEvents(site);
    expect(deleted).toBe(2);
    expect(listEvents({ site, limit: 10 }).length).toBe(0);
  });
});
