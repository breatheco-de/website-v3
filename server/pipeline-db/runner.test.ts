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

  it("adds successor link columns when upgrading from v13-shaped DB", () => {
    const site = `${TEST_PREFIX}-v13-successor-${Date.now()}`;
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
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 13);
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
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        rationale TEXT,
        documentation_json TEXT NOT NULL DEFAULT '{}',
        related_issue_ids_json TEXT NOT NULL DEFAULT '[]',
        proposer_username TEXT NOT NULL,
        proposer_actor_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        claim_json TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        search_text TEXT NOT NULL DEFAULT '',
        created_agent_session_id TEXT,
        promote_on_apply INTEGER NOT NULL DEFAULT 0,
        no_auto_retry INTEGER NOT NULL DEFAULT 0,
        close_reason TEXT,
        close_note TEXT,
        closed_by TEXT,
        closed_at INTEGER,
        related_entries_json TEXT NOT NULL DEFAULT '[]',
        review_context_snapshot_json TEXT
      );
      CREATE TABLE content_proposal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL,
        entry_key TEXT NOT NULL,
        locale TEXT NOT NULL,
        variant TEXT,
        variant_fingerprint TEXT,
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
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'supersedes_proposal_id'").get(),
    ).toBeDefined();
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'replaced_by_proposal_id'").get(),
    ).toBeDefined();
    db.close();
    rmSite(site);
  });

  it("adds escalated columns when upgrading from v14-shaped DB", () => {
    const site = `${TEST_PREFIX}-v14-escalated-${Date.now()}`;
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
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 14);
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
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        rationale TEXT,
        documentation_json TEXT NOT NULL DEFAULT '{}',
        related_issue_ids_json TEXT NOT NULL DEFAULT '[]',
        proposer_username TEXT NOT NULL,
        proposer_actor_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        claim_json TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        search_text TEXT NOT NULL DEFAULT '',
        created_agent_session_id TEXT,
        promote_on_apply INTEGER NOT NULL DEFAULT 0,
        no_auto_retry INTEGER NOT NULL DEFAULT 0,
        close_reason TEXT,
        close_note TEXT,
        closed_by TEXT,
        closed_at INTEGER,
        related_entries_json TEXT NOT NULL DEFAULT '[]',
        review_context_snapshot_json TEXT,
        supersedes_proposal_id TEXT,
        replaced_by_proposal_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_triggered_by ON events(triggered_by_event_id);
      CREATE INDEX IF NOT EXISTS idx_events_agent_session
        ON events(site, agent_session_id, created_at);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'escalated'").get(),
    ).toBeDefined();
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'escalated_note'").get(),
    ).toBeDefined();
    db.close();
    rmSite(site);
  });

  it("adds decision_debug_json when upgrading from v15-shaped DB", () => {
    const site = `${TEST_PREFIX}-v15-decision-debug-${Date.now()}`;
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
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 15);
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
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        rationale TEXT,
        documentation_json TEXT NOT NULL DEFAULT '{}',
        related_issue_ids_json TEXT NOT NULL DEFAULT '[]',
        proposer_username TEXT NOT NULL,
        proposer_actor_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        claim_json TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        search_text TEXT NOT NULL DEFAULT '',
        created_agent_session_id TEXT,
        promote_on_apply INTEGER NOT NULL DEFAULT 0,
        no_auto_retry INTEGER NOT NULL DEFAULT 0,
        close_reason TEXT,
        close_note TEXT,
        closed_by TEXT,
        closed_at INTEGER,
        related_entries_json TEXT NOT NULL DEFAULT '[]',
        review_context_snapshot_json TEXT,
        supersedes_proposal_id TEXT,
        replaced_by_proposal_id TEXT,
        escalated INTEGER NOT NULL DEFAULT 0,
        escalated_at INTEGER,
        escalated_by TEXT,
        escalated_note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_triggered_by ON events(triggered_by_event_id);
      CREATE INDEX IF NOT EXISTS idx_events_agent_session
        ON events(site, agent_session_id, created_at);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    expect(
      db
        .prepare(
          "SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'decision_debug_json'",
        )
        .get(),
    ).toBeDefined();
    db.close();
    rmSite(site);
  });

  it("adds review_situations_json when upgrading from v16-shaped DB", () => {
    const site = `${TEST_PREFIX}-v16-situations-${Date.now()}`;
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
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 16);
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
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        rationale TEXT,
        documentation_json TEXT NOT NULL DEFAULT '{}',
        related_issue_ids_json TEXT NOT NULL DEFAULT '[]',
        proposer_username TEXT NOT NULL,
        proposer_actor_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        claim_json TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        search_text TEXT NOT NULL DEFAULT '',
        created_agent_session_id TEXT,
        promote_on_apply INTEGER NOT NULL DEFAULT 0,
        no_auto_retry INTEGER NOT NULL DEFAULT 0,
        close_reason TEXT,
        close_note TEXT,
        closed_by TEXT,
        closed_at INTEGER,
        related_entries_json TEXT NOT NULL DEFAULT '[]',
        review_context_snapshot_json TEXT,
        supersedes_proposal_id TEXT,
        replaced_by_proposal_id TEXT,
        escalated INTEGER NOT NULL DEFAULT 0,
        escalated_at INTEGER,
        escalated_by TEXT,
        escalated_note TEXT,
        decision_debug_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_triggered_by ON events(triggered_by_event_id);
      CREATE INDEX IF NOT EXISTS idx_events_agent_session
        ON events(site, agent_session_id, created_at);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    expect(
      db
        .prepare(
          "SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'review_situations_json'",
        )
        .get(),
    ).toBeDefined();
    db.close();
    rmSite(site);
  });

  it("adds event_webhook_deliveries when upgrading from v17-shaped DB", () => {
    const site = `${TEST_PREFIX}-v17-webhooks-${Date.now()}`;
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
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 17);
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
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='event_webhook_deliveries'").get(),
    ).toEqual({ name: "event_webhook_deliveries" });
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('event_webhook_deliveries') WHERE name = 'hook_id'").get(),
    ).toBeDefined();
    db.close();
    rmSite(site);
  });

  it("adds proposal_kpi_daily when upgrading from v18-shaped DB", () => {
    const site = `${TEST_PREFIX}-v18-kpi-${Date.now()}`;
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
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 18);
      CREATE TABLE pipeline_state (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE leases (
        resource TEXT PRIMARY KEY,
        holder TEXT NOT NULL,
        token INTEGER NOT NULL DEFAULT 1,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE event_webhook_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site TEXT NOT NULL,
        event_type TEXT NOT NULL,
        hook_id TEXT NOT NULL,
        event_ids_json TEXT NOT NULL DEFAULT '[]',
        url_host TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        http_status INTEGER,
        error TEXT,
        duration_ms INTEGER,
        batch_size INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'live',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_triggered_by ON events(triggered_by_event_id);
      CREATE INDEX IF NOT EXISTS idx_events_agent_session
        ON events(site, agent_session_id, created_at);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='proposal_kpi_daily'").get(),
    ).toEqual({ name: "proposal_kpi_daily" });
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('proposal_kpi_daily') WHERE name = 'count'").get(),
    ).toBeDefined();
    db.close();
    rmSite(site);
  });

  it("adds idea follow-through columns when upgrading from v19-shaped DB", () => {
    const site = `${TEST_PREFIX}-v19-followthrough-${Date.now()}`;
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
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 19);
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
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        rationale TEXT,
        documentation_json TEXT NOT NULL DEFAULT '{}',
        related_issue_ids_json TEXT NOT NULL DEFAULT '[]',
        proposer_username TEXT NOT NULL,
        proposer_actor_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        claim_json TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        search_text TEXT NOT NULL DEFAULT '',
        created_agent_session_id TEXT,
        promote_on_apply INTEGER NOT NULL DEFAULT 0,
        no_auto_retry INTEGER NOT NULL DEFAULT 0,
        close_reason TEXT,
        close_note TEXT,
        closed_by TEXT,
        closed_at INTEGER,
        related_entries_json TEXT NOT NULL DEFAULT '[]',
        review_context_snapshot_json TEXT,
        supersedes_proposal_id TEXT,
        replaced_by_proposal_id TEXT,
        escalated INTEGER NOT NULL DEFAULT 0,
        escalated_at INTEGER,
        escalated_by TEXT,
        escalated_note TEXT,
        decision_debug_json TEXT,
        review_situations_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE proposal_kpi_daily (
        site TEXT NOT NULL,
        day TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (site, day, kind, status)
      );
      CREATE INDEX IF NOT EXISTS idx_events_triggered_by ON events(triggered_by_event_id);
      CREATE INDEX IF NOT EXISTS idx_events_agent_session
        ON events(site, agent_session_id, created_at);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'accepted_entry_json'").get(),
    ).toBeDefined();
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'implements_proposal_id'").get(),
    ).toBeDefined();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_content_proposals_implements'").get(),
    ).toEqual({ name: "idx_content_proposals_implements" });
    db.close();
    rmSite(site);
  });

  it("adds blocker actor columns when upgrading from v20-shaped DB", () => {
    const site = `${TEST_PREFIX}-v20-blocker-actor-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 20);
      CREATE TABLE content_proposal_blockers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'blocker',
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        author TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        resolved_by TEXT,
        resolve_note TEXT,
        agent_session_id TEXT
      );
      INSERT INTO content_proposal_blockers (
        proposal_id, kind, body, status, author, created_at
      ) VALUES ('prop-1', 'blocker', 'Needs a clearer CTA', 'open', 'alesanchezr', 1);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('content_proposal_blockers') WHERE name = 'author_actor_json'").get(),
    ).toBeDefined();
    expect(
      db
        .prepare(
          "SELECT 1 FROM pragma_table_info('content_proposal_blockers') WHERE name = 'resolved_by_actor_json'",
        )
        .get(),
    ).toBeDefined();
    const row = db
      .prepare(
        `SELECT author, author_actor_json, resolved_by_actor_json FROM content_proposal_blockers WHERE proposal_id = 'prop-1'`,
      )
      .get() as { author: string; author_actor_json: string | null; resolved_by_actor_json: string | null };
    expect(row.author).toBe("alesanchezr");
    expect(row.author_actor_json).toBeNull();
    expect(row.resolved_by_actor_json).toBeNull();
    db.close();
    rmSite(site);
  });

  it("adds attention stamp columns when upgrading from v21-shaped DB", () => {
    const site = `${TEST_PREFIX}-v21-attention-stamps-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 21);
      CREATE TABLE content_proposals (
        id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO content_proposals (id, site, status, updated_at)
      VALUES ('prop-1', 'site_test', 'open', 1);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'author_content_at'").get(),
    ).toBeDefined();
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'reviewer_action_at'").get(),
    ).toBeDefined();
    const row = db
      .prepare(`SELECT author_content_at, reviewer_action_at FROM content_proposals WHERE id = 'prop-1'`)
      .get() as { author_content_at: number | null; reviewer_action_at: number | null };
    expect(row.author_content_at).toBeNull();
    expect(row.reviewer_action_at).toBeNull();
    db.close();
    rmSite(site);
  });

  it("adds outcome review columns when upgrading from v23-shaped DB", () => {
    const site = `${TEST_PREFIX}-v23-outcome-review-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 23);
      CREATE TABLE content_proposals (
        id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        idea_funnel_json TEXT
      );
      INSERT INTO content_proposals (id, site, status, updated_at)
      VALUES ('prop-1', 'site_test', 'finished', 1);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    for (const col of [
      "outcome_review",
      "outcome_review_note",
      "outcome_review_expected",
      "outcome_review_at",
      "outcome_review_by",
      "outcome_review_history_json",
      "outcome_lesson_captured_at",
      "outcome_lesson_captured_by",
      "outcome_lesson_note",
    ]) {
      expect(
        db.prepare(`SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = ?`).get(col),
      ).toBeDefined();
    }
    const row = db
      .prepare(
        `SELECT outcome_review, outcome_review_history_json FROM content_proposals WHERE id = 'prop-1'`,
      )
      .get() as { outcome_review: string | null; outcome_review_history_json: string };
    expect(row.outcome_review).toBeNull();
    expect(row.outcome_review_history_json).toBe("[]");
    db.close();
    rmSite(site);
  });

  it("adds reviewer_action_by and backfills from blockers when upgrading from v24-shaped DB", () => {
    const site = `${TEST_PREFIX}-v24-reviewer-by-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 24);
      CREATE TABLE content_proposals (
        id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        status TEXT NOT NULL,
        proposer_username TEXT NOT NULL,
        proposer_actor_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL,
        author_content_at INTEGER,
        reviewer_action_at INTEGER
      );
      CREATE TABLE content_proposal_blockers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'blocker',
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        author TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        resolved_by TEXT,
        resolve_note TEXT,
        agent_session_id TEXT,
        author_actor_json TEXT,
        resolved_by_actor_json TEXT
      );
      INSERT INTO content_proposals (id, site, status, proposer_username, proposer_actor_json, updated_at, reviewer_action_at)
      VALUES
        ('prop-reviewed', 'site_test', 'open', 'author@x.com', '{"type":"mcp","role":"copy_editor"}', 1, 300),
        ('prop-self', 'site_test', 'open', 'author@x.com', '{"type":"mcp","role":"copy_editor"}', 1, 200),
        ('prop-unreviewed', 'site_test', 'open', 'author@x.com', '{}', 1, NULL);
      INSERT INTO content_proposal_blockers (proposal_id, body, status, author, created_at, resolved_at, resolved_by, author_actor_json, resolved_by_actor_json)
      VALUES
        ('prop-reviewed', 'Needs a clearer CTA', 'resolved', 'reviewer@x.com', 100, 250, 'author@x.com', '{"type":"ui"}', '{"type":"mcp","role":"copy_editor"}'),
        ('prop-reviewed', 'Wrong locale link', 'open', 'second@x.com', 280, NULL, NULL, '{"type":"mcp","role":"seo"}', NULL),
        ('prop-self', 'Self note on my own proposal', 'open', 'author@x.com', 150, NULL, NULL, '{"type":"mcp","role":"copy_editor"}', NULL),
        ('prop-unreviewed', 'Reviewer note', 'open', 'reviewer@x.com', 50, NULL, NULL, '{"type":"ui"}', NULL);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const rows = db
      .prepare(
        `SELECT id, reviewer_action_at, reviewer_action_by, reviewer_action_by_actor_json FROM content_proposals ORDER BY id`,
      )
      .all() as Array<{
      id: string;
      reviewer_action_at: number | null;
      reviewer_action_by: string | null;
      reviewer_action_by_actor_json: string | null;
    }>;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId["prop-reviewed"]!.reviewer_action_by).toBe("second@x.com");
    expect(JSON.parse(byId["prop-reviewed"]!.reviewer_action_by_actor_json!)).toEqual({
      type: "mcp",
      role: "seo",
    });
    expect(byId["prop-reviewed"]!.reviewer_action_at).toBe(300);
    expect(byId["prop-self"]!.reviewer_action_by).toBeNull();
    expect(byId["prop-unreviewed"]!.reviewer_action_by).toBeNull();
    db.close();
    rmSite(site);
  });

  it("adds draft-first v1 columns and draft_bases when upgrading from v25-shaped DB", () => {
    const site = `${TEST_PREFIX}-v25-draft-first-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 25);
      CREATE TABLE content_proposals (
        id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        status TEXT NOT NULL,
        proposer_username TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE content_proposal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL,
        content_type TEXT NOT NULL,
        slug TEXT NOT NULL,
        locale TEXT NOT NULL,
        ops_json TEXT NOT NULL DEFAULT '[]'
      );
      INSERT INTO content_proposals (id, site, status, proposer_username, updated_at)
      VALUES ('legacy-1', 'site_test', 'open', 'author@x.com', 1);
      INSERT INTO content_proposal_entries (proposal_id, content_type, slug, locale)
      VALUES ('legacy-1', 'blog', 'post-a', 'en');
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const proposal = db
      .prepare(
        `SELECT system_version, co_authors_json, stale_since, stale_flagged_at, all_or_nothing, reverts_proposal_id
         FROM content_proposals WHERE id = 'legacy-1'`,
      )
      .get() as Record<string, unknown>;
    expect(proposal.system_version).toBeNull();
    expect(proposal.co_authors_json).toBe("[]");
    expect(proposal.all_or_nothing).toBe(0);
    expect(proposal.stale_since).toBeNull();
    const entry = db
      .prepare(
        `SELECT created_draft, derived_ops_json, derived_for_key, published_diff_json, pre_apply_snapshot_json
         FROM content_proposal_entries WHERE proposal_id = 'legacy-1'`,
      )
      .get() as Record<string, unknown>;
    expect(entry.created_draft).toBe(0);
    expect(entry.derived_ops_json).toBeNull();
    const cols = (db.prepare("PRAGMA table_info(draft_bases)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        "content_type",
        "slug",
        "locale",
        "variant",
        "locale_hash",
        "common_hash",
        "snapshot_json",
        "source_snapshot_json",
        "created_at",
      ]),
    );
    db.close();
    rmSite(site);
  });

  it("adds idea SEO target columns when upgrading from v26-shaped DB", () => {
    const site = `${TEST_PREFIX}-v26-idea-seo-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 26);
      CREATE TABLE content_proposals (
        id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        idea_funnel_json TEXT,
        system_version TEXT
      );
      INSERT INTO content_proposals (id, site, status, updated_at, idea_funnel_json)
      VALUES ('idea-1', 'site_test', 'finished', 1, '{"stage":"awareness","products":"all"}');
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const row = db
      .prepare(
        `SELECT idea_funnel_json, idea_seo_target_json, seo_target_override_json FROM content_proposals WHERE id = 'idea-1'`,
      )
      .get() as Record<string, unknown>;
    expect(row.idea_funnel_json).toBe('{"stage":"awareness","products":"all"}');
    expect(row.idea_seo_target_json).toBeNull();
    expect(row.seo_target_override_json).toBeNull();
    db.close();
    rmSite(site);
  });

  it("adds lead_submissions and consent_daily when upgrading from v27-shaped DB", () => {
    const site = `${TEST_PREFIX}-v27-leads-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 27);
      CREATE TABLE content_proposals (
        id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        idea_seo_target_json TEXT,
        seo_target_override_json TEXT,
        system_version TEXT
      );
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const leadCols = (db.prepare("PRAGMA table_info(lead_submissions)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(leadCols).toEqual(
      expect.arrayContaining([
        "submission_id",
        "created_at",
        "browser_hash",
        "form",
        "campaign_id",
        "ad_id",
        "landing_path",
        "experiment_id",
        "variant",
        "is_test",
        "is_repeat",
        "repeat_of",
        "consent_state",
      ]),
    );
    expect(leadCols).not.toContain("email");
    const consentCols = (db.prepare("PRAGMA table_info(consent_daily)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(consentCols).toEqual(
      expect.arrayContaining(["date", "country", "mode", "shown", "granted_explicit", "granted_implied", "denied"]),
    );
    db.close();
    rmSite(site);
  });

  it("adds site_facts_check_json when upgrading from v28-shaped DB", () => {
    const site = `${TEST_PREFIX}-v28-site-facts-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 28);
      CREATE TABLE content_proposals (
        id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        idea_seo_target_json TEXT,
        seo_target_override_json TEXT,
        system_version TEXT
      );
      INSERT INTO content_proposals (id, site, status, updated_at)
      VALUES ('p-1', 'site_test', 'open', 1);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const row = db
      .prepare(`SELECT status, site_facts_check_json FROM content_proposals WHERE id = 'p-1'`)
      .get() as Record<string, unknown>;
    expect(row.status).toBe("open");
    expect(row.site_facts_check_json).toBeNull();
    db.close();
    rmSite(site);
  });

  it("adds blocked_flagged_at when upgrading from v30-shaped DB", () => {
    const site = `${TEST_PREFIX}-v30-blocked-flag-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 30);
      CREATE TABLE content_proposals (
        id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        stale_since TEXT,
        stale_flagged_at TEXT,
        site_facts_check_json TEXT
      );
      INSERT INTO content_proposals (id, site, status, updated_at, stale_flagged_at)
      VALUES ('p-1', 'site_test', 'open', 1, '2026-01-01T00:00:00.000Z');
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const row = db
      .prepare(`SELECT status, stale_flagged_at, blocked_flagged_at FROM content_proposals WHERE id = 'p-1'`)
      .get() as Record<string, unknown>;
    expect(row.status).toBe("open");
    expect(row.stale_flagged_at).toBe("2026-01-01T00:00:00.000Z");
    expect(row.blocked_flagged_at).toBeNull();
    db.close();
    rmSite(site);
  });

  it("adds applies_after_proposal_id + index and dependent_overdue_flagged_at when upgrading from v36", () => {
    const site = `${TEST_PREFIX}-v36-applies-after-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 36);
      CREATE TABLE content_proposals (
        id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        supersedes_proposal_id TEXT,
        blocked_flagged_at TEXT
      );
      INSERT INTO content_proposals (id, site, status, updated_at) VALUES ('p-1', 'site_test', 'open', 1);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const row = db
      .prepare(
        `SELECT status, applies_after_proposal_id, dependent_overdue_flagged_at FROM content_proposals WHERE id = 'p-1'`,
      )
      .get() as Record<string, unknown>;
    expect(row.status).toBe("open");
    expect(row.applies_after_proposal_id).toBeNull();
    expect(row.dependent_overdue_flagged_at).toBeNull();
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_content_proposals_applies_after'`)
      .get();
    expect(idx).toBeTruthy();
    db.close();
    rmSite(site);
  });

  it("adds url_slug_override_json when upgrading from v38", () => {
    const site = `${TEST_PREFIX}-v38-url-slug-override-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 38);
      CREATE TABLE content_proposals (
        id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        seo_target_override_json TEXT,
        applies_after_proposal_id TEXT,
        dependent_overdue_flagged_at TEXT
      );
      INSERT INTO content_proposals (id, site, status, updated_at) VALUES ('p-1', 'site_test', 'open', 1);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const row = db
      .prepare(`SELECT status, url_slug_override_json FROM content_proposals WHERE id = 'p-1'`)
      .get() as Record<string, unknown>;
    expect(row.status).toBe("open");
    expect(row.url_slug_override_json).toBeNull();
    db.close();
    rmSite(site);
  });

  it("adds content_proposal_blockers.staff_summary when upgrading from v39", () => {
    const site = `${TEST_PREFIX}-v39-blocker-staff-summary-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 39);
      CREATE TABLE content_proposal_blockers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'blocker',
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        author TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        resolved_by TEXT,
        resolve_note TEXT,
        agent_session_id TEXT,
        author_actor_json TEXT,
        resolved_by_actor_json TEXT
      );
      INSERT INTO content_proposal_blockers (proposal_id, body, author, created_at)
        VALUES ('p-1', 'old technical blocker', 'agent', 1);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const row = db
      .prepare(`SELECT body, staff_summary FROM content_proposal_blockers WHERE proposal_id = 'p-1'`)
      .get() as Record<string, unknown>;
    expect(row.body).toBe("old technical blocker");
    expect(row.staff_summary).toBeNull();
    db.close();
    rmSite(site);
  });

  it("adds data_migration_runs when upgrading from v31-shaped DB", () => {
    const site = `${TEST_PREFIX}-v31-data-migration-runs-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 31);
      CREATE TABLE content_proposals (
        id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        blocked_flagged_at TEXT
      );
      INSERT INTO content_proposals (id, site, status, updated_at) VALUES ('p-1', 'site_test', 'open', 1);
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site));
    db.prepare(
      `INSERT INTO data_migration_runs (id, filename, mode, status, started_at, file_sha) VALUES ('r1', '003_x.ts', 'run', 'running', 1, 'abc')`,
    ).run();
    const row = db.prepare(`SELECT filename, status, file_sha FROM data_migration_runs WHERE id = 'r1'`).get();
    expect(row).toEqual({ filename: "003_x.ts", status: "running", file_sha: "abc" });
    expect((db.prepare(`SELECT status FROM content_proposals WHERE id = 'p-1'`).get() as { status: string }).status).toBe("open");
    db.close();
    rmSite(site);
  });

  it("adds traffic channel columns and index to lead_submissions when upgrading from v32", () => {
    const site = `${TEST_PREFIX}-v32-lead-channel-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 32);
      CREATE TABLE lead_submissions (
        submission_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        platform TEXT,
        landing_path TEXT,
        is_test INTEGER NOT NULL DEFAULT 0,
        is_repeat INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO lead_submissions (submission_id, created_at, platform, landing_path)
      VALUES ('s-1', 1, 'google', '/en/x');
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const row = db.prepare(`SELECT * FROM lead_submissions WHERE submission_id = 's-1'`).get() as Record<string, unknown>;
    expect(row.platform).toBe("google");
    expect(row.landing_path).toBe("/en/x");
    for (const col of [
      "channel",
      "first_channel",
      "last_organic_channel",
      "channel_landing_path",
      "referrer_host",
      "country",
      "traffic_status",
    ]) {
      expect(row).toHaveProperty(col, null);
    }
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_lead_submissions_channel_landing'`)
      .get();
    expect(idx).toBeTruthy();
    db.close();
    rmSite(site);
  });

  it("adds product columns and indexes to lead_submissions when upgrading from v34", () => {
    const site = `${TEST_PREFIX}-v34-lead-product-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 34);
      CREATE TABLE lead_submissions (
        submission_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        conversion_path TEXT,
        channel TEXT,
        is_test INTEGER NOT NULL DEFAULT 0,
        is_repeat INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO lead_submissions (submission_id, created_at, conversion_path, channel)
      VALUES ('s-1', 1, '/en/x', 'direct');
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const row = db.prepare(`SELECT * FROM lead_submissions WHERE submission_id = 's-1'`).get() as Record<string, unknown>;
    expect(row.conversion_path).toBe("/en/x");
    expect(row).toHaveProperty("product_id", null);
    expect(row).toHaveProperty("product_slug", null);
    for (const name of ["idx_lead_submissions_product_id", "idx_lead_submissions_product_slug"]) {
      const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`).get(name);
      expect(idx).toBeTruthy();
    }
    db.close();
    rmSite(site);
  });

  it("adds product and persona columns to lead_submissions when upgrading from v40", () => {
    const site = `${TEST_PREFIX}-v40-lead-persona-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 40);
      CREATE TABLE lead_submissions (
        submission_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        conversion_path TEXT,
        product_id TEXT,
        product_slug TEXT,
        is_test INTEGER NOT NULL DEFAULT 0,
        is_repeat INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO lead_submissions (submission_id, created_at, conversion_path, product_slug)
      VALUES ('s-1', 1, '/en/x', 'ai-engineering');
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const row = db.prepare(`SELECT * FROM lead_submissions WHERE submission_id = 's-1'`).get() as Record<string, unknown>;
    expect(row.product_slug).toBe("ai-engineering");
    expect(row).toHaveProperty("product", null);
    expect(row).toHaveProperty("persona", null);
    db.close();
    rmSite(site);
  });

  it("adds paid-landing platform and id columns to lead_submissions when upgrading from v29", () => {
    const site = `${TEST_PREFIX}-v29-lead-platform-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
    raw.exec(`
      CREATE TABLE pipeline_schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      );
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 29);
      CREATE TABLE lead_submissions (
        submission_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        platform TEXT,
        first_paid_host TEXT,
        last_paid_host TEXT,
        is_test INTEGER NOT NULL DEFAULT 0,
        is_repeat INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO lead_submissions (submission_id, created_at, platform, last_paid_host)
      VALUES ('s-1', 1, 'meta', 'example.com');
    `);
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    const row = db.prepare(`SELECT * FROM lead_submissions WHERE submission_id = 's-1'`).get() as Record<string, unknown>;
    expect(row.platform).toBe("meta");
    expect(row.last_paid_host).toBe("example.com");
    for (const prefix of ["first_paid", "last_paid"]) {
      for (const field of ["platform", "campaign_id", "adset_id", "ad_id"]) {
        expect(row).toHaveProperty(`${prefix}_${field}`, null);
      }
    }
    db.close();
    rmSite(site);
  });

  it("adds proposal collab columns and blockers when upgrading from v9-shaped DB", () => {
    const site = `${TEST_PREFIX}-v9-collab-${Date.now()}`;
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
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 9);
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
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        rationale TEXT,
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
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'promote_on_apply'").get(),
    ).toBeDefined();
    expect(
      db
        .prepare("SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'created_agent_session_id'")
        .get(),
    ).toBeDefined();
    expect(
      db
        .prepare("SELECT 1 FROM pragma_table_info('content_proposal_entries') WHERE name = 'variant_fingerprint'")
        .get(),
    ).toBeDefined();
    expect(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content_proposal_blockers'")
        .get(),
    ).toBeDefined();
    db.close();
    rmSite(site);
  });

  it("adds close/no_auto_retry columns and backfills open notes when upgrading from v10-shaped DB", () => {
    const site = `${TEST_PREFIX}-v10-close-${Date.now()}`;
    rmSite(site);
    fs.mkdirSync(siteDir(site), { recursive: true });
    const raw = new Database(dbPath(site));
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
      INSERT INTO pipeline_schema_version (id, version) VALUES (1, 10);
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
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        rationale TEXT,
        documentation_json TEXT NOT NULL DEFAULT '{}',
        related_issue_ids_json TEXT NOT NULL DEFAULT '[]',
        proposer_username TEXT NOT NULL,
        proposer_actor_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        claim_json TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        search_text TEXT NOT NULL DEFAULT '',
        created_agent_session_id TEXT,
        promote_on_apply INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE content_proposal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL,
        entry_key TEXT NOT NULL,
        locale TEXT NOT NULL,
        variant TEXT,
        variant_fingerprint TEXT,
        status TEXT NOT NULL,
        ops_json TEXT NOT NULL DEFAULT '[]',
        baseline_context_json TEXT NOT NULL DEFAULT '{}',
        last_error TEXT,
        applied_at INTEGER,
        applied_by TEXT
      );
      CREATE TABLE content_proposal_blockers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proposal_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'blocker',
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        author TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        resolved_by TEXT,
        resolve_note TEXT,
        agent_session_id TEXT
      );
    `);
    raw
      .prepare(
        `INSERT INTO content_proposals (
          id, site, fingerprint, status, kind, category, title, summary,
          documentation_json, related_issue_ids_json, proposer_username, proposer_actor_json,
          created_at, updated_at, tags_json, search_text, promote_on_apply
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "notes-open-1",
        site,
        "fp-notes",
        "open",
        "notes",
        "content.field",
        "Wall",
        "x".repeat(80),
        "{}",
        "[]",
        "alice",
        "{}",
        now,
        now,
        "[]",
        "wall",
        0,
      );
    raw
      .prepare(
        `INSERT INTO content_proposals (
          id, site, fingerprint, status, kind, category, title, summary,
          documentation_json, related_issue_ids_json, proposer_username, proposer_actor_json,
          created_at, updated_at, tags_json, search_text, promote_on_apply
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "edits-open-1",
        site,
        "fp-edits",
        "open",
        "edits",
        "content.field",
        "Edit",
        "y".repeat(80),
        "{}",
        "[]",
        "alice",
        "{}",
        now,
        now,
        "[]",
        "edit",
        0,
      );
    raw.close();

    ensurePipelineDb(site, { skipBackup: true });
    expect(getPipelineSchemaVersion(site)).toBe(PIPELINE_SCHEMA_VERSION);
    const db = new Database(dbPath(site), { readonly: true });
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'no_auto_retry'").get(),
    ).toBeDefined();
    expect(
      db.prepare("SELECT 1 FROM pragma_table_info('content_proposals') WHERE name = 'close_reason'").get(),
    ).toBeDefined();
    const notesFlag = db
      .prepare(`SELECT no_auto_retry AS n FROM content_proposals WHERE id = 'notes-open-1'`)
      .get() as { n: number };
    const editsFlag = db
      .prepare(`SELECT no_auto_retry AS n FROM content_proposals WHERE id = 'edits-open-1'`)
      .get() as { n: number };
    db.close();
    expect(notesFlag.n).toBe(1);
    expect(editsFlag.n).toBe(0);
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
