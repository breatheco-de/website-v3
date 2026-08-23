/**
 * Per-site event outbox stored in data/<site>/app.db.
 * Event rowid (AUTOINCREMENT) is the generation counter.
 */

import { getSiteSqlite } from "../db";
import type {
  ContentEvent,
  EmitEventOpts,
  EventAttribution,
  EventResource,
  EventType,
} from "./types";
import { INDEX_WRITE_EVENT_TYPES, singleAttribution, unionAttribution } from "./types";

const TABLE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
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
`;

// Indexes reference columns that migrateSchema may need to add first,
// so they must run after migration (see ensureSchema ordering).
const INDEX_SCHEMA = `
  CREATE INDEX IF NOT EXISTS idx_events_unpublished ON events(published, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_site_type ON events(site, type, created_at);
  CREATE INDEX IF NOT EXISTS idx_events_triggered_by ON events(triggered_by_event_id);
`;

const _schemaReady = new Set<string>();

function tableHasColumn(db: ReturnType<typeof getSiteSqlite>, name: string): boolean {
  const cols = db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>;
  return cols.some((c) => c.name === name);
}

function migrateSchema(db: ReturnType<typeof getSiteSqlite>): void {
  if (!tableHasColumn(db, "attribution_json") && tableHasColumn(db, "author")) {
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
    return;
  }
  const addColumns: Record<string, string> = {
    triggered_by_event_id: "ALTER TABLE events ADD COLUMN triggered_by_event_id INTEGER",
    triggered_by_event_ids_json: "ALTER TABLE events ADD COLUMN triggered_by_event_ids_json TEXT",
    attribution_json: "ALTER TABLE events ADD COLUMN attribution_json TEXT NOT NULL DEFAULT '[]'",
  };
  for (const [column, sql] of Object.entries(addColumns)) {
    if (!tableHasColumn(db, column)) db.exec(sql);
  }
}

function ensureSchema(site: string): void {
  if (_schemaReady.has(site)) return;
  const db = getSiteSqlite(site);
  db.exec(TABLE_SCHEMA);
  migrateSchema(db);
  db.exec(INDEX_SCHEMA);
  _schemaReady.add(site);
}

function parseResource(json: string): EventResource {
  try {
    return JSON.parse(json) as EventResource;
  } catch {
    return {};
  }
}

function parsePayload(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseAttribution(json: string | null | undefined): EventAttribution[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is EventAttribution => typeof x === "object" && x !== null,
    );
  } catch {
    return [];
  }
}

function parseTriggeredByEventIds(json: string | null | undefined): number[] | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const ids = parsed.filter((x): x is number => typeof x === "number");
    return ids.length > 0 ? ids : undefined;
  } catch {
    return undefined;
  }
}

function rowToEvent(row: Record<string, unknown>): ContentEvent {
  return {
    id: row.id as number,
    type: row.type as EventType,
    site: row.site as string,
    resource: parseResource(row.resource_json as string),
    attribution: parseAttribution(row.attribution_json as string),
    cause: (row.cause as string) || undefined,
    payload: parsePayload(row.payload_json as string),
    triggeredByEventId: (row.triggered_by_event_id as number | null) ?? undefined,
    triggeredByEventIds: parseTriggeredByEventIds(row.triggered_by_event_ids_json as string),
    published: (row.published as number) === 1,
    created_at: row.created_at as number,
  };
}

export type EmitResult = ContentEvent;

/** Insert an event row; returned id is the generation. */
export function emitEvent(opts: EmitEventOpts): EmitResult {
  ensureSchema(opts.site);
  const db = getSiteSqlite(opts.site);
  const now = Date.now();
  const attribution = opts.attribution ?? [];
  const triggeredByEventIdsJson =
    opts.triggeredByEventIds && opts.triggeredByEventIds.length > 0
      ? JSON.stringify(opts.triggeredByEventIds)
      : null;
  const stmt = db.prepare(`
    INSERT INTO events (
      type, site, resource_json, cause, payload_json,
      triggered_by_event_id, triggered_by_event_ids_json, attribution_json,
      published, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  const info = stmt.run(
    opts.type,
    opts.site,
    JSON.stringify(opts.resource ?? {}),
    opts.cause ?? null,
    JSON.stringify(opts.payload ?? {}),
    opts.triggeredByEventId ?? null,
    triggeredByEventIdsJson,
    JSON.stringify(attribution),
    now,
  );
  const event: ContentEvent = {
    id: Number(info.lastInsertRowid),
    type: opts.type,
    site: opts.site,
    resource: opts.resource ?? {},
    attribution,
    cause: opts.cause,
    payload: opts.payload ?? {},
    triggeredByEventId: opts.triggeredByEventId,
    triggeredByEventIds: opts.triggeredByEventIds,
    published: false,
    created_at: now,
  };
  _wakeDispatcher();
  return event;
}

/** Current generation = max event id for a site. */
export function getCurrentGeneration(site: string): number {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const row = db.prepare("SELECT COALESCE(MAX(id), 0) AS max_id FROM events").get() as { max_id: number };
  return row.max_id;
}

/** Latest write generation = max id among content-changing events (saves, bulk sync, redirects). */
export function getLatestWriteGeneration(site: string): number {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const placeholders = INDEX_WRITE_EVENT_TYPES.map(() => "?").join(", ");
  const row = db
    .prepare(`SELECT COALESCE(MAX(id), 0) AS max_id FROM events WHERE type IN (${placeholders})`)
    .get(...INDEX_WRITE_EVENT_TYPES) as { max_id: number };
  return row.max_id;
}

/** Generation covered by the most recent index_snapshot_ready event (0 if none). */
export function getLastSnapshotGeneration(site: string): number {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const row = db
    .prepare(
      `SELECT payload_json FROM events WHERE site = ? AND type = 'index_snapshot_ready' ORDER BY id DESC LIMIT 1`,
    )
    .get(site) as { payload_json: string } | undefined;
  if (!row) return 0;
  const payload = parsePayload(row.payload_json);
  const generation = payload.generation;
  return typeof generation === "number" ? generation : 0;
}

/** Write events with id in (fromExclusive, toInclusive]. */
export function getWriteEventsBetween(
  site: string,
  fromExclusive: number,
  toInclusive: number,
): ContentEvent[] {
  ensureSchema(site);
  if (toInclusive <= fromExclusive) return [];
  const db = getSiteSqlite(site);
  const placeholders = INDEX_WRITE_EVENT_TYPES.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT * FROM events WHERE site = ? AND type IN (${placeholders}) AND id > ? AND id <= ? ORDER BY id ASC`,
    )
    .all(site, ...INDEX_WRITE_EVENT_TYPES, fromExclusive, toInclusive) as Record<string, unknown>[];
  return rows.map(rowToEvent);
}

export function getEventById(site: string, id: number): ContentEvent | null {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const row = db.prepare("SELECT * FROM events WHERE site = ? AND id = ?").get(site, id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToEvent(row) : null;
}

/** Latest content_file_written matching entry resource fields. */
export function getLatestWriteForEntry(
  site: string,
  resource: Pick<EventResource, "contentType" | "slug" | "locale">,
): ContentEvent | null {
  ensureSchema(site);
  const { contentType, slug, locale } = resource;
  if (!contentType || !slug || !locale) return null;
  const db = getSiteSqlite(site);
  const rows = db
    .prepare(
      `SELECT * FROM events WHERE site = ? AND type = 'content_file_written'
       AND json_extract(resource_json, '$.contentType') = ?
       AND json_extract(resource_json, '$.slug') = ?
       AND json_extract(resource_json, '$.locale') = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .all(site, contentType, slug, locale) as Record<string, unknown>[];
  const row = rows[0];
  return row ? rowToEvent(row) : null;
}

export { unionAttribution, singleAttribution };

export function markEventsPublished(site: string, ids: number[]): void {
  if (ids.length === 0) return;
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE events SET published = 1 WHERE id IN (${placeholders})`).run(...ids);
}

export function getUnpublishedEvents(site: string, limit = 100): ContentEvent[] {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const rows = db
    .prepare("SELECT * FROM events WHERE published = 0 ORDER BY id ASC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
  return rows.map(rowToEvent);
}

export type ListEventsOpts = {
  site: string;
  type?: EventType;
  since?: number;
  cause?: string;
  before?: number;
  triggeredBy?: number;
  limit?: number;
};

export function listEvents(opts: ListEventsOpts): ContentEvent[] {
  ensureSchema(opts.site);
  const db = getSiteSqlite(opts.site);
  const clauses = ["site = ?"];
  const params: unknown[] = [opts.site];
  if (opts.type) {
    clauses.push("type = ?");
    params.push(opts.type);
  }
  if (opts.since) {
    clauses.push("created_at >= ?");
    params.push(opts.since);
  }
  if (opts.cause) {
    clauses.push("cause = ?");
    params.push(opts.cause);
  }
  if (opts.before) {
    clauses.push("id < ?");
    params.push(opts.before);
  }
  if (opts.triggeredBy != null) {
    clauses.push(
      `(triggered_by_event_id = ? OR EXISTS (
        SELECT 1 FROM json_each(triggered_by_event_ids_json) WHERE value = ?
      ))`,
    );
    params.push(opts.triggeredBy, opts.triggeredBy);
  }
  const limit = opts.limit ?? 50;
  params.push(limit);
  const rows = db
    .prepare(`SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`)
    .all(...params) as Record<string, unknown>[];
  return rows.map(rowToEvent);
}

export function getUnpublishedCount(site: string): number {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const row = db.prepare("SELECT COUNT(*) AS cnt FROM events WHERE published = 0").get() as { cnt: number };
  return row.cnt;
}

export function getOldestUnpublishedAgeMs(site: string): number | null {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const row = db
    .prepare("SELECT MIN(created_at) AS oldest FROM events WHERE published = 0")
    .get() as { oldest: number | null };
  if (!row.oldest) return null;
  return Date.now() - row.oldest;
}

export function pruneOldEvents(site: string, maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const cutoff = Date.now() - maxAgeMs;
  const info = db.prepare("DELETE FROM events WHERE created_at < ? AND published = 1").run(cutoff);
  return info.changes;
}

/** Remove every event row for a site (staff clear-log action). */
export function clearAllEvents(site: string): number {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const info = db.prepare("DELETE FROM events").run();
  return info.changes;
}

type DispatcherWakeFn = () => void;
let _dispatcherWake: DispatcherWakeFn | null = null;

export function setDispatcherWake(fn: DispatcherWakeFn): void {
  _dispatcherWake = fn;
}

function _wakeDispatcher(): void {
  _dispatcherWake?.();
}

/** Hourly prune for all known sites (call from server boot). */
export function startEventPruneTimer(sites: string[]): void {
  const run = () => {
    for (const site of sites) {
      try {
        pruneOldEvents(site);
      } catch {
        /* non-fatal */
      }
    }
  };
  run();
  setInterval(run, 60 * 60 * 1000).unref();
}
