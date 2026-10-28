/**
 * Versioned schema for data/<site>/visits.db (the site's own anonymous visit counts).
 * Forward-only, add-only steps tracked in PRAGMA user_version; same rules as
 * .cursor/rules/pipeline-sqlite-migrations.mdc: never edit a shipped step, add columns
 * before indexing them.
 */

import type Database from "better-sqlite3";

export type VisitsMigration = { version: number; up: string };

export const VISITS_MIGRATIONS: VisitsMigration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS fp_page_views (
        view_key TEXT PRIMARY KEY,
        arrived_at INTEGER NOT NULL,
        day TEXT NOT NULL,
        nav_type TEXT NOT NULL,
        counted_visit INTEGER NOT NULL DEFAULT 1,
        summary_received INTEGER NOT NULL DEFAULT 0,
        low_quality INTEGER NOT NULL DEFAULT 0,
        never_visible INTEGER NOT NULL DEFAULT 0,
        path TEXT NOT NULL,
        content_type TEXT,
        page_version TEXT,
        entrance INTEGER NOT NULL DEFAULT 0,
        channel TEXT NOT NULL DEFAULT 'direct',
        source TEXT,
        medium TEXT,
        campaign TEXT,
        utm_id TEXT,
        utm_term TEXT,
        utm_content TEXT,
        click_id_type TEXT,
        referrer_host TEXT,
        device TEXT,
        country TEXT,
        engaged INTEGER NOT NULL DEFAULT 0,
        seconds INTEGER NOT NULL DEFAULT 0,
        max_scroll INTEGER NOT NULL DEFAULT 0,
        interacted INTEGER NOT NULL DEFAULT 0,
        cta_clicks INTEGER NOT NULL DEFAULT 0,
        task_clicks INTEGER NOT NULL DEFAULT 0,
        form_starts INTEGER NOT NULL DEFAULT 0,
        video_starts INTEGER NOT NULL DEFAULT 0,
        video_completes INTEGER NOT NULL DEFAULT 0,
        prev_path TEXT,
        next_path TEXT,
        reached_decision INTEGER NOT NULL DEFAULT 0,
        lead_later INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS fp_page_views_path_day ON fp_page_views (path, day);
      CREATE INDEX IF NOT EXISTS fp_page_views_prev_day ON fp_page_views (prev_path, day);
      CREATE INDEX IF NOT EXISTS fp_page_views_day ON fp_page_views (day);

      CREATE TABLE IF NOT EXISTS fp_type_windows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_type TEXT NOT NULL,
        enabled_at INTEGER NOT NULL,
        disabled_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS fp_type_windows_type ON fp_type_windows (content_type);

      CREATE TABLE IF NOT EXISTS fp_path_credits (
        day TEXT NOT NULL,
        path TEXT NOT NULL,
        kind TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, path, kind)
      );

      CREATE TABLE IF NOT EXISTS fp_transitions (
        day TEXT NOT NULL,
        from_path TEXT NOT NULL,
        to_path TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, from_path, to_path)
      );
      CREATE INDEX IF NOT EXISTS fp_transitions_from_day ON fp_transitions (from_path, day);

      CREATE TABLE IF NOT EXISTS fp_daily (
        day TEXT NOT NULL,
        path TEXT NOT NULL,
        channel TEXT NOT NULL,
        device TEXT NOT NULL,
        sessions INTEGER NOT NULL DEFAULT 0,
        engaged INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, path, channel, device)
      );
    `,
  },
];

export const VISITS_SCHEMA_VERSION = VISITS_MIGRATIONS[VISITS_MIGRATIONS.length - 1]!.version;

export function getVisitsSchemaVersion(db: Database.Database): number {
  return Number(db.pragma("user_version", { simple: true })) || 0;
}

/** Apply every step above the stored version, each in its own transaction. Returns the final version. */
export function runVisitsMigrations(db: Database.Database): number {
  let current = getVisitsSchemaVersion(db);
  for (const step of VISITS_MIGRATIONS) {
    if (step.version <= current) continue;
    db.transaction(() => {
      db.exec(step.up);
      db.pragma(`user_version = ${step.version}`);
    })();
    current = step.version;
  }
  return current;
}
