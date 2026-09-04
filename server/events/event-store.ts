/**
 * Per-site event outbox stored in data/<site>/app.db.
 * Event rowid (AUTOINCREMENT) is the generation counter.
 */

import {
  ENTRY_ACTIVITY_WRITE_TYPES,
  eventMatchesAgentFilter,
  type AgentFilterId,
  type EventActorId,
} from "@shared/event-log-filters";
import { getSiteSqlite } from "../db";
import { ensurePipelineDb } from "../pipeline-db/runner";
import type {
  ContentEvent,
  EmitEventOpts,
  EventAttribution,
  EventResource,
  EventType,
} from "./types";
import {
  AGENT_SESSION_WRITE_EVENT_TYPES,
  EVENT_TYPE_META,
  INDEX_WRITE_EVENT_TYPES,
  OUTBOX_DISPATCHABLE_EVENT_TYPES,
  singleAttribution,
  systemJobAttribution,
  unionAttribution,
} from "./types";

/** Stamp window: only recent writes without a SHA get commitSha (R2-4A). */
export const COMMIT_SHA_STAMP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Write types that carry payload.path and should receive commitSha after push. */
const COMMIT_SHA_STAMP_EVENT_TYPES: readonly string[] = [
  ...ENTRY_ACTIVITY_WRITE_TYPES,
  "site_redirects_changed",
  "registry_file_saved",
];

function dispatchTypePlaceholders(): string {
  return OUTBOX_DISPATCHABLE_EVENT_TYPES.map(() => "?").join(", ");
}

function ensureSchema(site: string): void {
  ensurePipelineDb(site);
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
  const agentSessionId =
    typeof row.agent_session_id === "string" && row.agent_session_id.trim()
      ? row.agent_session_id.trim()
      : undefined;
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
    agent_session_id: agentSessionId,
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
  const published = EVENT_TYPE_META[opts.type].outbox === "audit" ? 1 : 0;
  const agentSessionId =
    typeof opts.agent_session_id === "string" && opts.agent_session_id.trim()
      ? opts.agent_session_id.trim()
      : null;
  const stmt = db.prepare(`
    INSERT INTO events (
      type, site, resource_json, cause, payload_json,
      triggered_by_event_id, triggered_by_event_ids_json, attribution_json,
      agent_session_id, published, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    agentSessionId,
    published,
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
    agent_session_id: agentSessionId ?? undefined,
    published: published === 1,
    created_at: now,
  };
  if (published === 0) {
    _wakeDispatcher();
  }
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

/** Latest entry_locale_saved matching entry resource fields. */
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
      `SELECT * FROM events WHERE site = ? AND type = 'entry_locale_saved'
       AND json_extract(resource_json, '$.contentType') = ?
       AND json_extract(resource_json, '$.slug') = ?
       AND json_extract(resource_json, '$.locale') = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .all(site, contentType, slug, locale) as Record<string, unknown>[];
  const row = rows[0];
  return row ? rowToEvent(row) : null;
}

/**
 * entry_locale_saved rows for an entry that still lack a matching
 * validation_results_ready (triggered_by_event_id = write id). Newest first.
 */
export function listOpenWritesForEntry(
  site: string,
  resource: Pick<EventResource, "contentType" | "slug" | "locale">,
  limit = 20,
): ContentEvent[] {
  ensureSchema(site);
  const { contentType, slug, locale } = resource;
  if (!contentType || !slug || !locale) return [];
  const db = getSiteSqlite(site);
  const rows = db
    .prepare(
      `SELECT w.* FROM events w
       WHERE w.site = ? AND w.type = 'entry_locale_saved'
         AND json_extract(w.resource_json, '$.contentType') = ?
         AND json_extract(w.resource_json, '$.slug') = ?
         AND json_extract(w.resource_json, '$.locale') = ?
         AND NOT EXISTS (
           SELECT 1 FROM events r
           WHERE r.site = w.site
             AND r.type = 'validation_results_ready'
             AND r.triggered_by_event_id = w.id
         )
       ORDER BY w.id DESC LIMIT ?`,
    )
    .all(site, contentType, slug, locale, limit) as Record<string, unknown>[];
  return rows.map(rowToEvent);
}

export { unionAttribution, singleAttribution, systemJobAttribution };

export function markEventsPublished(site: string, ids: number[]): void {
  if (ids.length === 0) return;
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE events SET published = 1 WHERE id IN (${placeholders})`).run(...ids);
}

function normalizeEventPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

/**
 * After a successful content push, attach commitSha to matching write events
 * that still lack one and were created within 24h before the commit.
 * Returns number of rows updated.
 */
export function attachCommitShaToEvents(opts: {
  site: string;
  commitSha: string;
  paths: string[];
  committedAt?: number;
}): number {
  const commitSha = opts.commitSha.trim();
  if (!commitSha || !opts.site || opts.paths.length === 0) return 0;

  const committedAt = opts.committedAt ?? Date.now();
  const since = committedAt - COMMIT_SHA_STAMP_WINDOW_MS;
  const paths = [...new Set(opts.paths.map(normalizeEventPath).filter(Boolean))];
  if (paths.length === 0) return 0;

  ensureSchema(opts.site);
  const db = getSiteSqlite(opts.site);
  const typePlaceholders = COMMIT_SHA_STAMP_EVENT_TYPES.map(() => "?").join(", ");
  const pathPlaceholders = paths.map(() => "?").join(", ");

  const rows = db
    .prepare(
      `SELECT id, payload_json FROM events
       WHERE site = ?
         AND type IN (${typePlaceholders})
         AND created_at >= ?
         AND created_at <= ?
         AND json_extract(payload_json, '$.path') IN (${pathPlaceholders})
         AND (
           json_extract(payload_json, '$.commitSha') IS NULL
           OR json_extract(payload_json, '$.commitSha') = ''
         )`,
    )
    .all(opts.site, ...COMMIT_SHA_STAMP_EVENT_TYPES, since, committedAt, ...paths) as Array<{
    id: number;
    payload_json: string;
  }>;

  if (rows.length === 0) return 0;

  const update = db.prepare(`UPDATE events SET payload_json = ? WHERE id = ? AND site = ?`);
  const tx = db.transaction(() => {
    let n = 0;
    for (const row of rows) {
      const payload = parsePayload(row.payload_json);
      if (typeof payload.commitSha === "string" && payload.commitSha.trim()) continue;
      payload.commitSha = commitSha;
      update.run(JSON.stringify(payload), row.id, opts.site);
      n += 1;
    }
    return n;
  });
  return tx();
}

/**
 * Resolve site (content root name) from explicit contentRoot or first path prefix,
 * then stamp commitSha onto matching events.
 */
export function attachCommitShaForCommittedFiles(
  commitSha: string,
  paths: string[],
  contentRoot?: string,
): number {
  const site =
    (typeof contentRoot === "string" && contentRoot.replace(/\/$/, "").trim()) ||
    (() => {
      const first = paths.map(normalizeEventPath).find(Boolean);
      if (!first) return "";
      const top = first.split("/")[0] ?? "";
      return top.startsWith("site_") ? top : "";
    })();
  if (!site) return 0;
  return attachCommitShaToEvents({ site, commitSha, paths });
}

export function getUnpublishedEvents(site: string, limit = 100): ContentEvent[] {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const rows = db
    .prepare(
      `SELECT * FROM events WHERE published = 0 AND type IN (${dispatchTypePlaceholders()}) ORDER BY id ASC LIMIT ?`,
    )
    .all(...OUTBOX_DISPATCHABLE_EVENT_TYPES, limit) as Record<string, unknown>[];
  return rows.map(rowToEvent);
}

export type ListEventsOpts = {
  site: string;
  /** Exact event type — wins over `types` (kind expansion). */
  type?: EventType;
  /** OR of event types from kind chips. Ignored when `type` is set. */
  types?: string[];
  /** OR of actor buckets (people / agents / system). */
  actors?: EventActorId[];
  /** Agent id or Staff & system sentinel; matched in app after SQL filters. */
  agent?: AgentFilterId;
  /** Entry keys (`contentType/slug/locale`); match resource triple or payload.entryKey. */
  entries?: string[];
  since?: number;
  /** Inclusive upper bound on created_at (epoch ms). */
  until?: number;
  cause?: string;
  /** Pagination cursor: only rows with id strictly less than this. */
  before?: number;
  triggeredBy?: number;
  agentSessionId?: string;
  /** When true, only events with no agent_session_id. Ignored if agentSessionId is set. */
  unscopedOnly?: boolean;
  limit?: number;
};

const AGENT_SCAN_BATCH = 200;
const AGENT_SCAN_MAX_BATCHES = 50;

function actorTypeExpr(): string {
  return `json_extract(attribution_json, '$[0].actor.type')`;
}

/** Build WHERE clauses shared by listEvents SQL path (no agent filter). */
function listEventsWhere(
  opts: Omit<ListEventsOpts, "agent" | "limit"> & { before?: number },
): { clauses: string[]; params: unknown[] } {
  const clauses = ["site = ?"];
  const params: unknown[] = [opts.site];
  if (opts.type) {
    clauses.push("type = ?");
    params.push(opts.type);
  } else if (opts.types && opts.types.length > 0) {
    clauses.push(`type IN (${opts.types.map(() => "?").join(", ")})`);
    params.push(...opts.types);
  }
  if (opts.since) {
    clauses.push("created_at >= ?");
    params.push(opts.since);
  }
  if (opts.until != null && Number.isFinite(opts.until)) {
    clauses.push("created_at <= ?");
    params.push(opts.until);
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
  if (opts.agentSessionId) {
    clauses.push("agent_session_id = ?");
    params.push(opts.agentSessionId);
  } else if (opts.unscopedOnly) {
    clauses.push("(agent_session_id IS NULL OR agent_session_id = '')");
  }
  if (opts.actors && opts.actors.length > 0) {
    const actorClauses: string[] = [];
    const t = actorTypeExpr();
    for (const bucket of opts.actors) {
      if (bucket === "people") {
        actorClauses.push(`${t} = 'ui'`);
      } else if (bucket === "agents") {
        actorClauses.push(`${t} = 'mcp'`);
      } else if (bucket === "system") {
        actorClauses.push(
          `(attribution_json IS NULL OR attribution_json = '' OR attribution_json = '[]' OR ${t} IS NULL OR ${t} = '' OR ${t} = 'system')`,
        );
      }
    }
    if (actorClauses.length > 0) {
      clauses.push(`(${actorClauses.join(" OR ")})`);
    }
  }
  if (opts.entries && opts.entries.length > 0) {
    const entryClauses: string[] = [];
    const resourceKeyExpr = `(json_extract(resource_json, '$.contentType') || '/' || json_extract(resource_json, '$.slug') || '/' || json_extract(resource_json, '$.locale'))`;
    for (const key of opts.entries) {
      entryClauses.push(`(${resourceKeyExpr} = ? OR json_extract(payload_json, '$.entryKey') = ?)`);
      params.push(key, key);
    }
    clauses.push(`(${entryClauses.join(" OR ")})`);
  }
  return { clauses, params };
}

function listEventsSql(
  opts: Omit<ListEventsOpts, "agent"> & { before?: number },
  limit: number,
): ContentEvent[] {
  ensureSchema(opts.site);
  const db = getSiteSqlite(opts.site);
  const { clauses, params } = listEventsWhere(opts);
  params.push(limit);
  const rows = db
    .prepare(`SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`)
    .all(...params) as Record<string, unknown>[];
  return rows.map(rowToEvent);
}

export function listEvents(opts: ListEventsOpts): ContentEvent[] {
  const limit = opts.limit ?? 50;
  if (!opts.agent) {
    return listEventsSql(opts, limit);
  }

  const out: ContentEvent[] = [];
  let before = opts.before;
  for (let i = 0; i < AGENT_SCAN_MAX_BATCHES && out.length < limit; i++) {
    const batch = listEventsSql({ ...opts, before }, AGENT_SCAN_BATCH);
    if (batch.length === 0) break;
    for (const ev of batch) {
      if (eventMatchesAgentFilter(ev.attribution, opts.agent)) {
        out.push(ev);
        if (out.length >= limit) break;
      }
    }
    before = batch[batch.length - 1]!.id;
    if (batch.length < AGENT_SCAN_BATCH) break;
  }
  return out;
}

export type AgentSessionSummary = {
  agent_session_id: string;
  started_at: number;
  ended_at: number;
  event_count: number;
  write_count: number;
  issue_complete_count: number;
  attribution: EventAttribution[];
};

/** Cap of newest events whose attribution is unioned per session for list enrichment. */
const SESSION_LIST_ATTR_EVENT_CAP = 20;

/** Prefer mcp/ui entries first so list rows show people/agents over system noise. */
function preferInteractiveAttribution(attribution: EventAttribution[]): EventAttribution[] {
  const interactive: EventAttribution[] = [];
  const rest: EventAttribution[] = [];
  for (const entry of attribution) {
    const t = entry.actor?.type;
    if (t === "mcp" || t === "ui") interactive.push(entry);
    else rest.push(entry);
  }
  if (interactive.length === 0) return attribution;
  return [...interactive, ...rest];
}

/**
 * Load attribution for session ids from newest events (one query), capped per session.
 */
function loadSessionListAttributions(
  site: string,
  sessionIds: string[],
  since: number,
): Map<string, EventAttribution[]> {
  const out = new Map<string, EventAttribution[]>();
  if (sessionIds.length === 0) return out;

  const db = getSiteSqlite(site);
  const placeholders = sessionIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT agent_session_id AS agent_session_id,
              attribution_json AS attribution_json
       FROM events
       WHERE site = ?
         AND agent_session_id IN (${placeholders})
         AND created_at >= ?
       ORDER BY id DESC`,
    )
    .all(site, ...sessionIds, since) as Array<{
    agent_session_id: string;
    attribution_json: string | null;
  }>;

  const counts = new Map<string, number>();
  const groups = new Map<string, EventAttribution[][]>();
  for (const row of rows) {
    const sid = row.agent_session_id;
    const n = counts.get(sid) ?? 0;
    if (n >= SESSION_LIST_ATTR_EVENT_CAP) continue;
    counts.set(sid, n + 1);
    const attr = parseAttribution(row.attribution_json);
    if (attr.length === 0) continue;
    const list = groups.get(sid) ?? [];
    list.push(attr);
    groups.set(sid, list);
  }

  for (const [sid, attrs] of groups) {
    out.set(sid, preferInteractiveAttribution(unionAttribution(...attrs)));
  }
  return out;
}

/** Recent agent sessions derived from events (no separate store). */
export function listAgentSessions(
  site: string,
  opts?: { since?: number; limit?: number },
): AgentSessionSummary[] {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const since = opts?.since ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
  const limit = opts?.limit ?? 20;
  const writeTypes = [...AGENT_SESSION_WRITE_EVENT_TYPES];
  const writePlaceholders = writeTypes.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT agent_session_id AS agent_session_id,
              MIN(created_at) AS started_at,
              MAX(created_at) AS ended_at,
              COUNT(*) AS event_count,
              SUM(CASE WHEN type IN (${writePlaceholders}) THEN 1 ELSE 0 END) AS write_count,
              SUM(CASE WHEN type = 'validation_issue_completed' THEN 1 ELSE 0 END) AS issue_complete_count
       FROM events
       WHERE site = ?
         AND agent_session_id IS NOT NULL
         AND agent_session_id != ''
         AND created_at >= ?
       GROUP BY agent_session_id
       ORDER BY ended_at DESC
       LIMIT ?`,
    )
    .all(...writeTypes, site, since, limit) as Array<{
    agent_session_id: string;
    started_at: number;
    ended_at: number;
    event_count: number;
    write_count: number;
    issue_complete_count: number;
  }>;

  const attributions = loadSessionListAttributions(
    site,
    rows.map((r) => r.agent_session_id),
    since,
  );

  return rows.map((r) => ({
    agent_session_id: r.agent_session_id,
    started_at: r.started_at,
    ended_at: r.ended_at,
    event_count: r.event_count,
    write_count: Number(r.write_count) || 0,
    issue_complete_count: Number(r.issue_complete_count) || 0,
    attribution: attributions.get(r.agent_session_id) ?? [],
  }));
}

/** Template rollup for one session (events only, no LLM). */
export function getAgentSessionDetail(
  site: string,
  agentSessionId: string,
): {
  summary: AgentSessionSummary;
  events: ContentEvent[];
  files: string[];
  reports: Array<{ type: string; report: string; created_at: number; event_id: number }>;
  headline: string | null;
  attribution: EventAttribution[];
} | null {
  const events = listEvents({
    site,
    agentSessionId,
    limit: 500,
  });
  if (events.length === 0) return null;

  const started_at = Math.min(...events.map((e) => e.created_at));
  const ended_at = Math.max(...events.map((e) => e.created_at));
  const writeTypes = new Set<string>(AGENT_SESSION_WRITE_EVENT_TYPES);
  let write_count = 0;
  let issue_complete_count = 0;
  const files: string[] = [];
  const fileSeen = new Set<string>();
  const reports: Array<{ type: string; report: string; created_at: number; event_id: number }> =
    [];
  let headline: string | null = null;

  // events are newest-first
  for (const e of events) {
    if (writeTypes.has(e.type)) write_count += 1;
    if (e.type === "validation_issue_completed") issue_complete_count += 1;
    const path =
      (typeof e.payload.path === "string" && e.payload.path) ||
      (typeof e.resource.path === "string" && e.resource.path) ||
      undefined;
    if (path && !fileSeen.has(path)) {
      fileSeen.add(path);
      files.push(path);
    }
    const updatedFiles = e.payload.updatedFiles;
    if (Array.isArray(updatedFiles)) {
      for (const f of updatedFiles) {
        if (typeof f === "string" && !fileSeen.has(f)) {
          fileSeen.add(f);
          files.push(f);
        }
      }
    }
    const report = typeof e.payload.report === "string" ? e.payload.report.trim() : "";
    if (report) {
      reports.push({
        type: e.type,
        report,
        created_at: e.created_at,
        event_id: e.id,
      });
    }
    if (e.type === "agent_session_summarized" && report && !headline) {
      headline = report;
    }
  }

  // Prefer newest summarize (events are newest-first so first match is newest)
  if (!headline) {
    const complete = reports.find((r) => r.type === "validation_issue_completed");
    if (complete) headline = complete.report;
  }

  const attribution = unionAttribution(...events.map((e) => e.attribution));

  return {
    summary: {
      agent_session_id: agentSessionId,
      started_at,
      ended_at,
      event_count: events.length,
      write_count,
      issue_complete_count,
      attribution,
    },
    events,
    files,
    reports,
    headline,
    attribution,
  };
}

export function getUnpublishedCount(site: string): number {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM events WHERE published = 0 AND type IN (${dispatchTypePlaceholders()})`,
    )
    .get(...OUTBOX_DISPATCHABLE_EVENT_TYPES) as { cnt: number };
  return row.cnt;
}

export function getOldestUnpublishedAgeMs(site: string): number | null {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const row = db
    .prepare(
      `SELECT MIN(created_at) AS oldest FROM events WHERE published = 0 AND type IN (${dispatchTypePlaceholders()})`,
    )
    .get(...OUTBOX_DISPATCHABLE_EVENT_TYPES) as { oldest: number | null };
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

/**
 * Replace the entire event log with a production snapshot (dev pull).
 * Preserves ids and timestamps; forces published=1 so the dispatcher is not woken.
 */
export function replaceEventsFromSnapshot(site: string, events: ContentEvent[]): number {
  ensureSchema(site);
  const db = getSiteSqlite(site);
  const sorted = [...events].sort((a, b) => a.id - b.id);

  const insert = db.prepare(`
    INSERT INTO events (
      id, type, site, resource_json, cause, payload_json,
      triggered_by_event_id, triggered_by_event_ids_json, attribution_json,
      agent_session_id, published, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  const run = db.transaction(() => {
    db.prepare("DELETE FROM events").run();
    for (const ev of sorted) {
      insert.run(
        ev.id,
        ev.type,
        site,
        JSON.stringify(ev.resource ?? {}),
        ev.cause ?? null,
        JSON.stringify(ev.payload ?? {}),
        ev.triggeredByEventId ?? null,
        ev.triggeredByEventIds?.length ? JSON.stringify(ev.triggeredByEventIds) : null,
        JSON.stringify(ev.attribution ?? []),
        ev.agent_session_id ?? null,
        ev.created_at,
      );
    }
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'events'").run();
    const maxId = sorted.length > 0 ? sorted[sorted.length - 1]!.id : 0;
    if (maxId > 0) {
      db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('events', ?)").run(maxId);
    }
  });

  run();
  return sorted.length;
}

/** Dev-only: wipe event logs for all configured sites (orphan audit rows, stale queues). */
export function wipeAllSiteEventStores(sites: string[]): number {
  let total = 0;
  for (const site of sites) {
    try {
      total += clearAllEvents(site);
    } catch {
      /* non-fatal */
    }
  }
  return total;
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
