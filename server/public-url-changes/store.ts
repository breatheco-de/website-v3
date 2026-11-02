/**
 * Per-site public URL change log in data/<site>/app.db.
 * One writer (the scanner job); readers keep their own bookmark in public_url_consumers.
 */

import type Database from "better-sqlite3";
import { getSiteSqlite } from "../db";
import { ensurePipelineDb } from "../pipeline-db/runner";

export type PublicUrlChangeKind = "published" | "updated" | "moved" | "removed";

export type PublicUrlChange = {
  id: number;
  url: string;
  kind: PublicUrlChangeKind;
  previousUrl: string | null;
  entryKey: string | null;
  contentType: string | null;
  slug: string | null;
  locale: string | null;
  updatedAt: string | null;
  causeEventId: number | null;
  detectedAt: number;
};

export type PublicUrlStateRow = {
  url: string;
  entryKey: string | null;
  contentType: string | null;
  slug: string | null;
  locale: string | null;
  updatedAt: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
};

export type PublicUrlConsumer = {
  consumer: string;
  lastChangeId: number;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  lastSubmittedCount: number;
  verifiedAt: number | null;
  rejectedSince: number | null;
  nextAttemptAt: number | null;
  stoppedAt: number | null;
};

export type PublicUrlScanState = {
  lastScanAt: number | null;
  pausedReason: "indexing_blocked" | null;
  heldReason: "large_drop" | null;
  heldRemovedCount: number;
  heldAt: number | null;
  releaseNextDrop: boolean;
};

export type PendingUpdate = { url: string; entryKey: string | null; causeEventId: number | null };

export const PUBLIC_URL_CHANGE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/** Known readers; the baseline scan starts each bookmark at the end of the log. */
export const PUBLIC_URL_CONSUMERS = ["indexnow"] as const;

export function publicUrlDb(site: string): Database.Database {
  ensurePipelineDb(site);
  return getSiteSqlite(site);
}

function rowToChange(row: Record<string, unknown>): PublicUrlChange {
  return {
    id: Number(row.id),
    url: String(row.url),
    kind: row.kind as PublicUrlChangeKind,
    previousUrl: (row.previous_url as string | null) ?? null,
    entryKey: (row.entry_key as string | null) ?? null,
    contentType: (row.content_type as string | null) ?? null,
    slug: (row.slug as string | null) ?? null,
    locale: (row.locale as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
    causeEventId: row.cause_event_id == null ? null : Number(row.cause_event_id),
    detectedAt: Number(row.detected_at),
  };
}

function rowToState(row: Record<string, unknown>): PublicUrlStateRow {
  return {
    url: String(row.url),
    entryKey: (row.entry_key as string | null) ?? null,
    contentType: (row.content_type as string | null) ?? null,
    slug: (row.slug as string | null) ?? null,
    locale: (row.locale as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
    firstSeenAt: Number(row.first_seen_at),
    lastSeenAt: Number(row.last_seen_at),
  };
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

export function getMaxChangeId(site: string): number {
  const row = publicUrlDb(site).prepare("SELECT COALESCE(MAX(id), 0) AS max_id FROM public_url_changes").get() as {
    max_id: number;
  };
  return row.max_id;
}

export function listChangesAfter(site: string, afterId: number, limit: number): PublicUrlChange[] {
  const rows = publicUrlDb(site)
    .prepare("SELECT * FROM public_url_changes WHERE id > ? ORDER BY id ASC LIMIT ?")
    .all(afterId, limit) as Record<string, unknown>[];
  return rows.map(rowToChange);
}

export function countChangesAfter(site: string, afterId: number): number {
  const row = publicUrlDb(site)
    .prepare("SELECT COUNT(*) AS cnt FROM public_url_changes WHERE id > ?")
    .get(afterId) as { cnt: number };
  return row.cnt;
}

export function oldestChangeAfter(site: string, afterId: number): PublicUrlChange | null {
  const row = publicUrlDb(site)
    .prepare("SELECT * FROM public_url_changes WHERE id > ? ORDER BY id ASC LIMIT 1")
    .get(afterId) as Record<string, unknown> | undefined;
  return row ? rowToChange(row) : null;
}

/** Newest first. `url` matches the page itself or a move away from it. */
export function listRecentChanges(site: string, opts?: { limit?: number; url?: string }): PublicUrlChange[] {
  const limit = Math.min(Math.max(1, opts?.limit ?? 20), 200);
  const db = publicUrlDb(site);
  const rows = opts?.url
    ? (db
        .prepare(
          "SELECT * FROM public_url_changes WHERE url = ? OR previous_url = ? ORDER BY id DESC LIMIT ?",
        )
        .all(opts.url, opts.url, limit) as Record<string, unknown>[])
    : (db.prepare("SELECT * FROM public_url_changes ORDER BY id DESC LIMIT ?").all(limit) as Record<
        string,
        unknown
      >[]);
  return rows.map(rowToChange);
}

export function countChangesSince(site: string, sinceMs: number): number {
  const row = publicUrlDb(site)
    .prepare("SELECT COUNT(*) AS cnt FROM public_url_changes WHERE detected_at >= ?")
    .get(sinceMs) as { cnt: number };
  return row.cnt;
}

export function countChangesSinceUpTo(site: string, sinceMs: number, maxId: number): number {
  const row = publicUrlDb(site)
    .prepare("SELECT COUNT(*) AS cnt FROM public_url_changes WHERE detected_at >= ? AND id <= ?")
    .get(sinceMs, maxId) as { cnt: number };
  return row.cnt;
}

export function pruneChanges(site: string, maxAgeMs = PUBLIC_URL_CHANGE_RETENTION_MS, now = Date.now()): number {
  const info = publicUrlDb(site).prepare("DELETE FROM public_url_changes WHERE detected_at < ?").run(now - maxAgeMs);
  return info.changes;
}

/** Hourly 12-month prune for all known sites (call from server boot). */
export function startPublicUrlChangesPruneTimer(sites: string[]): void {
  const run = () => {
    for (const site of sites) {
      try {
        pruneChanges(site);
      } catch {
        /* non-fatal */
      }
    }
  };
  run();
  setInterval(run, 60 * 60 * 1000).unref();
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export function listState(site: string): PublicUrlStateRow[] {
  const rows = publicUrlDb(site).prepare("SELECT * FROM public_url_state").all() as Record<string, unknown>[];
  return rows.map(rowToState);
}

export function countState(site: string): number {
  const row = publicUrlDb(site).prepare("SELECT COUNT(*) AS cnt FROM public_url_state").get() as { cnt: number };
  return row.cnt;
}

/** Stable page of current public URLs (submit-all walks this). */
export function listStateUrlsAfter(site: string, afterUrl: string, limit: number): string[] {
  const rows = publicUrlDb(site)
    .prepare("SELECT url FROM public_url_state WHERE url > ? ORDER BY url ASC LIMIT ?")
    .all(afterUrl, limit) as Array<{ url: string }>;
  return rows.map((r) => r.url);
}

// ---------------------------------------------------------------------------
// Scan state
// ---------------------------------------------------------------------------

export function getScanState(site: string): PublicUrlScanState {
  const row = publicUrlDb(site).prepare("SELECT * FROM public_url_scan_state WHERE id = 1").get() as
    | Record<string, unknown>
    | undefined;
  return {
    lastScanAt: row?.last_scan_at == null ? null : Number(row.last_scan_at),
    pausedReason: (row?.paused_reason as PublicUrlScanState["pausedReason"]) ?? null,
    heldReason: (row?.held_reason as PublicUrlScanState["heldReason"]) ?? null,
    heldRemovedCount: Number(row?.held_removed_count ?? 0),
    heldAt: row?.held_at == null ? null : Number(row.held_at),
    releaseNextDrop: Number(row?.release_next_drop ?? 0) === 1,
  };
}

export function writeScanState(site: string, state: PublicUrlScanState, db = publicUrlDb(site)): void {
  db.prepare(
    `INSERT INTO public_url_scan_state (id, last_scan_at, paused_reason, held_reason, held_removed_count, held_at, release_next_drop)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_scan_at = excluded.last_scan_at,
       paused_reason = excluded.paused_reason,
       held_reason = excluded.held_reason,
       held_removed_count = excluded.held_removed_count,
       held_at = excluded.held_at,
       release_next_drop = excluded.release_next_drop`,
  ).run(
    state.lastScanAt,
    state.pausedReason,
    state.heldReason,
    state.heldRemovedCount,
    state.heldAt,
    state.releaseNextDrop ? 1 : 0,
  );
}

/** Staff confirmed a held large drop. Returns false when nothing is held. */
export function releaseHeldDrop(site: string): boolean {
  const state = getScanState(site);
  if (state.heldReason !== "large_drop") return false;
  writeScanState(site, { ...state, releaseNextDrop: true });
  return true;
}

// ---------------------------------------------------------------------------
// Pending database updates
// ---------------------------------------------------------------------------

export function queuePendingUpdates(site: string, rows: PendingUpdate[], now = Date.now()): number {
  if (rows.length === 0) return 0;
  const db = publicUrlDb(site);
  const insert = db.prepare(
    `INSERT INTO public_url_pending_updates (url, entry_key, cause_event_id, queued_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET entry_key = excluded.entry_key, cause_event_id = excluded.cause_event_id, queued_at = excluded.queued_at`,
  );
  const run = db.transaction(() => {
    for (const r of rows) insert.run(r.url, r.entryKey, r.causeEventId, now);
  });
  run();
  return rows.length;
}

export function listPendingUpdates(site: string, db = publicUrlDb(site)): PendingUpdate[] {
  const rows = db.prepare("SELECT url, entry_key, cause_event_id FROM public_url_pending_updates").all() as Array<{
    url: string;
    entry_key: string | null;
    cause_event_id: number | null;
  }>;
  return rows.map((r) => ({ url: r.url, entryKey: r.entry_key, causeEventId: r.cause_event_id }));
}

// ---------------------------------------------------------------------------
// Consumers
// ---------------------------------------------------------------------------

function defaultConsumer(consumer: string): PublicUrlConsumer {
  return {
    consumer,
    lastChangeId: 0,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    lastSubmittedCount: 0,
    verifiedAt: null,
    rejectedSince: null,
    nextAttemptAt: null,
    stoppedAt: null,
  };
}

export function getConsumer(site: string, consumer: string): PublicUrlConsumer {
  const row = publicUrlDb(site).prepare("SELECT * FROM public_url_consumers WHERE consumer = ?").get(consumer) as
    | Record<string, unknown>
    | undefined;
  if (!row) return defaultConsumer(consumer);
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    consumer,
    lastChangeId: Number(row.last_change_id ?? 0),
    lastRunAt: num(row.last_run_at),
    lastStatus: (row.last_status as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    lastSubmittedCount: Number(row.last_submitted_count ?? 0),
    verifiedAt: num(row.verified_at),
    rejectedSince: num(row.rejected_since),
    nextAttemptAt: num(row.next_attempt_at),
    stoppedAt: num(row.stopped_at),
  };
}

export function updateConsumer(
  site: string,
  consumer: string,
  patch: Partial<Omit<PublicUrlConsumer, "consumer">>,
  db = publicUrlDb(site),
): PublicUrlConsumer {
  const current = getConsumer(site, consumer);
  const next: PublicUrlConsumer = { ...current, ...patch, consumer };
  db.prepare(
    `INSERT INTO public_url_consumers (
       consumer, last_change_id, last_run_at, last_status, last_error, last_submitted_count,
       verified_at, rejected_since, next_attempt_at, stopped_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(consumer) DO UPDATE SET
       last_change_id = excluded.last_change_id,
       last_run_at = excluded.last_run_at,
       last_status = excluded.last_status,
       last_error = excluded.last_error,
       last_submitted_count = excluded.last_submitted_count,
       verified_at = excluded.verified_at,
       rejected_since = excluded.rejected_since,
       next_attempt_at = excluded.next_attempt_at,
       stopped_at = excluded.stopped_at`,
  ).run(
    consumer,
    next.lastChangeId,
    next.lastRunAt,
    next.lastStatus,
    next.lastError,
    next.lastSubmittedCount,
    next.verifiedAt,
    next.rejectedSince,
    next.nextAttemptAt,
    next.stoppedAt,
  );
  return next;
}

/** Bookmark only moves forward. */
export function advanceConsumer(site: string, consumer: string, toChangeId: number): PublicUrlConsumer {
  const current = getConsumer(site, consumer);
  if (toChangeId <= current.lastChangeId) return current;
  return updateConsumer(site, consumer, { lastChangeId: toChangeId });
}
