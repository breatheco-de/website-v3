import type Database from "better-sqlite3";
import type { PipelineMigration } from "./types";
import { indexExists, tableExists, tableHasColumn } from "./types";

export const PIPELINE_SCHEMA_VERSION = 6;

export const PIPELINE_MIGRATIONS: PipelineMigration[] = [
  {
    version: 1,
    name: "events_core",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS events (
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
    },
  },
  {
    version: 2,
    name: "events_attribution",
    up(db) {
      if (!tableExists(db, "events")) return;
      if (tableHasColumn(db, "events", "attribution_json")) return;

      if (tableHasColumn(db, "events", "author")) {
        db.exec("BEGIN");
        try {
          db.exec(`
            CREATE TABLE events_new (
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
            INSERT INTO events_new (id, type, site, resource_json, cause, payload_json, attribution_json, published, created_at)
            SELECT id, type, site, resource_json, cause, payload_json,
              CASE WHEN author IS NOT NULL AND author != '' THEN json_array(json_object('author', author)) ELSE '[]' END,
              published, created_at
            FROM events;
            DROP TABLE events;
            ALTER TABLE events_new RENAME TO events;
          `);
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      } else {
        db.exec(
          "ALTER TABLE events ADD COLUMN attribution_json TEXT NOT NULL DEFAULT '[]'",
        );
      }
    },
  },
  {
    version: 3,
    name: "events_triggers",
    up(db) {
      if (!tableExists(db, "events")) return;
      if (!tableHasColumn(db, "events", "triggered_by_event_id")) {
        db.exec("ALTER TABLE events ADD COLUMN triggered_by_event_id INTEGER");
      }
      if (!tableHasColumn(db, "events", "triggered_by_event_ids_json")) {
        db.exec("ALTER TABLE events ADD COLUMN triggered_by_event_ids_json TEXT");
      }
    },
  },
  {
    version: 4,
    name: "events_indexes",
    up(db) {
      if (!tableExists(db, "events")) return;
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_events_unpublished ON events(published, created_at);
        CREATE INDEX IF NOT EXISTS idx_events_site_type ON events(site, type, created_at);
        CREATE INDEX IF NOT EXISTS idx_events_triggered_by ON events(triggered_by_event_id);
      `);
    },
  },
  {
    version: 5,
    name: "pipeline_state",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pipeline_state (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 6,
    name: "leases",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS leases (
          resource TEXT PRIMARY KEY,
          holder TEXT NOT NULL,
          token INTEGER NOT NULL DEFAULT 1,
          expires_at INTEGER NOT NULL
        );
      `);
    },
  },
];

/** Conservative legacy baseline when pipeline_schema_version is missing. */
export function detectLegacyBaseline(db: Database.Database): number {
  if (!tableExists(db, "events")) return 0;

  const hasAttribution = tableHasColumn(db, "events", "attribution_json");
  const hasAuthor = tableHasColumn(db, "events", "author");
  const hasTriggers = tableHasColumn(db, "events", "triggered_by_event_id");
  const hasPipelineState = tableExists(db, "pipeline_state");
  const hasLeases = tableExists(db, "leases");
  const hasTriggerIndex = indexExists(db, "idx_events_triggered_by");

  if (hasLeases && hasPipelineState && hasTriggers && hasAttribution && hasTriggerIndex) {
    return 6;
  }
  if (hasPipelineState && hasTriggers && hasAttribution && hasTriggerIndex) return 5;
  if (hasTriggers && hasAttribution && hasTriggerIndex) return 4;
  if (hasTriggers && hasAttribution) return 3;
  if (hasAttribution || hasAuthor) return 1;
  return 1;
}
