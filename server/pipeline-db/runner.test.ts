import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import Database from "better-sqlite3";
import { clearSiteSqliteCacheForTests } from "../db";
import {
  ensurePipelineDb,
  ensurePipelineDbForSites,
  getPipelineSchemaVersion,
  resetPipelineDbCache,
} from "./runner";
import { PIPELINE_SCHEMA_VERSION } from "./migrations";
import { emitEvent, listEvents } from "../events/event-store";

const TEST_PREFIX = "site_pipeline-db-test";

function siteDir(site: string): string {
  return path.join("data", site.replace(/\//g, "-"));
}

function dbPath(site: string): string {
  return path.join(siteDir(site), "app.db");
}

function rmSite(site: string): void {
  const dir = siteDir(site);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

describe("pipeline-db runner", () => {
  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
  });

  afterEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
  });

  it("migrates a fresh site to current schema version", () => {
    const site = `${TEST_PREFIX}-fresh-${Date.now()}`;
    rmSite(site);
    const version = ensurePipelineDb(site, { skipBackup: true });
    expect(version).toBe(PIPELINE_SCHEMA_VERSION);
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    rmSite(site);
  });

  it("adds agent_session_id when upgrading from v6-shaped DB", () => {
    const site = `${TEST_PREFIX}-v6-session-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
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
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 6);
      CREATE TABLE pipeline_state (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE leases (
        resource TEXT PRIMARY KEY,
        holder TEXT NOT NULL,
        token INTEGER NOT NULL DEFAULT 1,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_triggered_by ON events(triggered_by_event_id);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const e = emitEvent({
      site,
      type: "agent_session_started",
      agent_session_id: "sess-test-1",
      payload: { label: "test" },
    });
    expect(e.agent_session_id).toBe("sess-test-1");
    expect(e.published).toBe(true);
    expect(listEvents({ site, agentSessionId: "sess-test-1", limit: 5 })).toHaveLength(1);
    rmSite(site);
  });

  it("adds content_proposals tables when upgrading from v7-shaped DB", () => {
    const site = `${TEST_PREFIX}-v7-proposals-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
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
        created_at INTEGER NOT NULL,
        agent_session_id TEXT
      );
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 7);
      CREATE TABLE pipeline_state (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE leases (
        resource TEXT PRIMARY KEY,
        holder TEXT NOT NULL,
        token INTEGER NOT NULL DEFAULT 1,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_triggered_by ON events(triggered_by_event_id);
      CREATE INDEX IF NOT EXISTS idx_events_agent_session
        ON events(site, agent_session_id, created_at);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const proposals = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content_proposals'")
      .get();
    const entries = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content_proposal_entries'")
      .get();
    db.close();
    expect(proposals).toBeDefined();
    expect(entries).toBeDefined();
    rmSite(site);
  });

  it("rewrites mcp attribution on system job follow-ups when upgrading from v8", () => {
    const site = `${TEST_PREFIX}-v8-system-attr-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    const mcpAttr = JSON.stringify([
      { author: "claude", actor: { type: "mcp", client: "Cursor", model: "claude-4-sonnet" } },
    ]);
    const now = Date.now();
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
        created_at INTEGER NOT NULL,
        agent_session_id TEXT
      );
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 8);
      CREATE TABLE pipeline_state (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE leases (
        resource TEXT PRIMARY KEY,
        holder TEXT NOT NULL,
        token INTEGER NOT NULL DEFAULT 1,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE content_proposals (
        id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        fingerprint TEXT NOT NULL DEFAULT '',
        documentation_json TEXT NOT NULL DEFAULT '{}',
        related_issue_ids_json TEXT NOT NULL DEFAULT '[]',
        proposer_username TEXT NOT NULL,
        proposer_actor_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        claim_json TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        search_text TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE content_proposal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL,
        entry_key TEXT NOT NULL,
        locale TEXT NOT NULL,
        variant TEXT,
        status TEXT NOT NULL,
        ops_json TEXT NOT NULL DEFAULT '[]',
        baseline_context_json TEXT NOT NULL DEFAULT '{}',
        last_error TEXT,
        applied_at INTEGER,
        applied_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_triggered_by ON events(triggered_by_event_id);
      CREATE INDEX IF NOT EXISTS idx_events_agent_session
        ON events(site, agent_session_id, created_at);
    `);
    raw
      .prepare(
        `INSERT INTO events (
          type, site, resource_json, payload_json, triggered_by_event_id,
          attribution_json, published, created_at, agent_session_id
        ) VALUES (?, ?, '{}', '{}', 7, ?, 1, ?, 'sess-keep')`,
      )
      .run("index_snapshot_ready", site, mcpAttr, now);
    raw
      .prepare(
        `INSERT INTO events (
          type, site, resource_json, payload_json, triggered_by_event_id,
          attribution_json, published, created_at
        ) VALUES (?, ?, '{}', '{}', 8, ?, 1, ?)`,
      )
      .run("validation_results_ready", site, mcpAttr, now);
    raw
      .prepare(
        `INSERT INTO events (
          type, site, resource_json, payload_json,
          attribution_json, published, created_at
        ) VALUES (?, ?, '{}', '{}', ?, 1, ?)`,
      )
      .run(
        "entry_locale_saved",
        site,
        mcpAttr,
        now,
      );
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);

    const snapshot = listEvents({ site, type: "index_snapshot_ready", limit: 1 })[0]!;
    expect(snapshot.attribution[0]?.actor).toEqual({ type: "system", source: "index-refresh" });
    expect(snapshot.triggeredByEventId).toBe(7);
    expect(snapshot.agent_session_id).toBe("sess-keep");

    const validation = listEvents({ site, type: "validation_results_ready", limit: 1 })[0]!;
    expect(validation.attribution[0]?.actor).toEqual({
      type: "system",
      source: "on-save-validation",
    });
    expect(validation.triggeredByEventId).toBe(8);

    const write = listEvents({ site, type: "entry_locale_saved", limit: 1 })[0]!;
    expect(write.attribution[0]?.actor?.type).toBe("mcp");

    expect(listEvents({ site, actors: ["agents"], limit: 10 }).map((e) => e.type)).toEqual([
      "entry_locale_saved",
    ]);
    rmSite(site);
  });

  it("migrates legacy events without trigger columns", () => {
    const site = `${TEST_PREFIX}-legacy-v0-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        site TEXT NOT NULL,
        resource_json TEXT NOT NULL DEFAULT '{}',
        cause TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        published INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      INSERT INTO events (type, site, created_at) VALUES ('content_file_written', '${site}', ${Date.now()});
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    const e = emitEvent({ site, type: "validation_results_ready", triggeredByEventId: 1 });
    expect(e.triggeredByEventId).toBe(1);
    expect(listEvents({ site, triggeredBy: 1, limit: 10 }).length).toBe(1);
    rmSite(site);
  });

  it("preserves attribution when rebuilding from author column", () => {
    const site = `${TEST_PREFIX}-author-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        site TEXT NOT NULL,
        resource_json TEXT NOT NULL DEFAULT '{}',
        cause TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        author TEXT,
        published INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      INSERT INTO events (type, site, author, created_at)
      VALUES ('content_file_written', '${site}', 'jane.doe', ${Date.now()});
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    const rows = listEvents({ site, limit: 10 });
    expect(rows[0]?.attribution[0]?.author).toBe("jane.doe");
    rmSite(site);
  });

  it("is idempotent on double apply", () => {
    const site = `${TEST_PREFIX}-idempotent-${Date.now()}`;
    rmSite(site);
    ensurePipelineDb(site, { skipBackup: true });
    resetPipelineDbCache();
    const version = ensurePipelineDb(site, { skipBackup: true });
    expect(version).toBe(PIPELINE_SCHEMA_VERSION);
    rmSite(site);
  });

  it("dry-run migrates copy only and leaves live db unchanged", () => {
    const site = `${TEST_PREFIX}-dryrun-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        site TEXT NOT NULL,
        resource_json TEXT NOT NULL DEFAULT '{}',
        cause TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        published INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `);
    raw.close();

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-db-test-"));
    try {
      fs.mkdirSync(path.join(workDir, site), { recursive: true });
      fs.copyFileSync(dbPath(site), path.join(workDir, site, "app.db"));

      ensurePipelineDbForSites([site], { dryRun: true, workDir, skipBackup: true });
      expect(getPipelineSchemaVersion(site, workDir)).toBe(PIPELINE_SCHEMA_VERSION);
      const live = new Database(dbPath(site), { readonly: true });
      const versionTable = live
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pipeline_schema_version'")
        .get();
      live.close();
      expect(versionTable).toBeUndefined();
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
      rmSite(site);
    }
  });

  it("fails fast when migration cannot write", () => {
    const site = `${TEST_PREFIX}-readonly-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    fs.writeFileSync(dbPath(site), "");
    fs.chmodSync(dbPath(site), 0o444);
    try {
      expect(() => ensurePipelineDbForSites([site], { skipBackup: true })).toThrow();
    } finally {
      fs.chmodSync(dbPath(site), 0o644);
      rmSite(site);
    }
  });
});
