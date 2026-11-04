/**
 * Compares the current public URL set (sitemap rules applied) with the last known
 * set and writes one change row per real change. Idempotent: a second scan with
 * no edits writes nothing.
 */

import { child } from "../logger";
import type { PublicUrlSnapshotEntry } from "../sitemap";
import {
  PUBLIC_URL_CONSUMERS,
  getScanState,
  listPendingUpdates,
  listState,
  publicUrlDb,
  updateConsumer,
  writeScanState,
  type PublicUrlChangeKind,
  type PublicUrlStateRow,
} from "./store";

const log = child({ module: "public-url-changes" });

/** Removals at or above this share of known URLs are held (with LARGE_DROP_MIN_COUNT). */
export const LARGE_DROP_RATIO = 0.2;
/** The ratio rule ignores drops smaller than this, so a 5-page site can still remove one page. */
export const LARGE_DROP_MIN_COUNT = 10;
/** More removals than this are always held. */
export const LARGE_DROP_ABSOLUTE = 200;

export type ScanPublicUrlChangesInput = {
  site: string;
  snapshot: PublicUrlSnapshotEntry[];
  indexingBlocked: boolean;
  /** Absolute URL a removed URL redirects to, or null. */
  resolveRedirect?: (url: string, locale: string | null) => string | null;
  causeEventId?: number | null;
  now?: number;
};

export type ScanPublicUrlChangesResult = {
  status: "baseline" | "paused" | "held" | "ok";
  published: number;
  updated: number;
  moved: number;
  removed: number;
  heldRemovedCount?: number;
};

type NewChange = {
  url: string;
  kind: PublicUrlChangeKind;
  previousUrl: string | null;
  entryKey: string | null;
  contentType: string | null;
  slug: string | null;
  locale: string | null;
  updatedAt: string | null;
};

export function normalizeUrlForCompare(url: string): string {
  try {
    const u = new URL(url);
    let p = u.pathname.toLowerCase();
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return `${u.host.toLowerCase()}${p}`;
  } catch {
    let p = url.toLowerCase();
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return p;
  }
}

export function isLargeDrop(removed: number, known: number): boolean {
  if (removed > LARGE_DROP_ABSOLUTE) return true;
  if (removed < LARGE_DROP_MIN_COUNT || known <= 0) return false;
  return removed / known >= LARGE_DROP_RATIO;
}

function emptyResult(status: ScanPublicUrlChangesResult["status"]): ScanPublicUrlChangesResult {
  return { status, published: 0, updated: 0, moved: 0, removed: 0 };
}

export function scanPublicUrlChanges(input: ScanPublicUrlChangesInput): ScanPublicUrlChangesResult {
  const { site, snapshot } = input;
  const now = input.now ?? Date.now();
  const causeEventId = input.causeEventId ?? null;
  const db = publicUrlDb(site);
  const scanState = getScanState(site);

  if (input.indexingBlocked) {
    if (scanState.pausedReason !== "indexing_blocked") {
      writeScanState(site, { ...scanState, pausedReason: "indexing_blocked" }, db);
      log.info({ site }, "Public URL change log paused: site indexing is blocked");
    }
    return emptyResult("paused");
  }

  const current = new Map<string, PublicUrlSnapshotEntry>();
  for (const entry of snapshot) current.set(entry.url, entry);

  const upsertState = db.prepare(
    `INSERT INTO public_url_state (url, entry_key, content_type, slug, locale, updated_at, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET
       entry_key = excluded.entry_key,
       content_type = excluded.content_type,
       slug = excluded.slug,
       locale = excluded.locale,
       updated_at = excluded.updated_at,
       last_seen_at = excluded.last_seen_at`,
  );

  // Baseline: record the starting point silently; readers start at the end of the log.
  if (scanState.lastScanAt == null) {
    if (current.size === 0) return emptyResult("baseline");
    const maxId = (db.prepare("SELECT COALESCE(MAX(id), 0) AS max_id FROM public_url_changes").get() as {
      max_id: number;
    }).max_id;
    db.transaction(() => {
      for (const e of current.values()) {
        upsertState.run(e.url, e.entryKey, e.contentType, e.slug, e.locale, e.updatedAt, now, now);
      }
      db.prepare("DELETE FROM public_url_pending_updates").run();
      for (const consumer of PUBLIC_URL_CONSUMERS) updateConsumer(site, consumer, { lastChangeId: maxId }, db);
      writeScanState(
        site,
        { ...scanState, lastScanAt: now, pausedReason: null, heldReason: null, heldRemovedCount: 0, heldAt: null },
        db,
      );
    })();
    log.info({ site, urls: current.size }, "Public URL change log baseline recorded");
    return emptyResult("baseline");
  }

  const known = new Map<string, PublicUrlStateRow>();
  for (const row of listState(site)) known.set(row.url, row);

  const added: PublicUrlSnapshotEntry[] = [];
  const updated: PublicUrlSnapshotEntry[] = [];
  for (const entry of current.values()) {
    const prev = known.get(entry.url);
    if (!prev) added.push(entry);
    else if (entry.updatedAt && entry.updatedAt !== prev.updatedAt) updated.push(entry);
  }
  const removedRows: PublicUrlStateRow[] = [];
  for (const row of known.values()) if (!current.has(row.url)) removedRows.push(row);

  // Pair a removal with a URL that just appeared when a redirect points there.
  const addedByNorm = new Map<string, PublicUrlSnapshotEntry>();
  for (const a of added) addedByNorm.set(normalizeUrlForCompare(a.url), a);
  const moves: Array<{ from: PublicUrlStateRow; to: PublicUrlSnapshotEntry }> = [];
  const pureRemovals: PublicUrlStateRow[] = [];
  const movedTargets = new Set<string>();
  for (const row of removedRows) {
    let target: PublicUrlSnapshotEntry | undefined;
    if (input.resolveRedirect && addedByNorm.size > 0) {
      try {
        const to = input.resolveRedirect(row.url, row.locale);
        if (to) {
          const candidate = addedByNorm.get(normalizeUrlForCompare(to));
          if (candidate && !movedTargets.has(candidate.url)) target = candidate;
        }
      } catch (err) {
        log.warn({ err, url: row.url }, "Redirect lookup failed during public URL scan");
      }
    }
    if (target) {
      movedTargets.add(target.url);
      moves.push({ from: row, to: target });
    } else {
      pureRemovals.push(row);
    }
  }
  const published = added.filter((a) => !movedTargets.has(a.url));

  if (isLargeDrop(pureRemovals.length, known.size) && !scanState.releaseNextDrop) {
    writeScanState(
      site,
      {
        ...scanState,
        pausedReason: null,
        heldReason: "large_drop",
        heldRemovedCount: pureRemovals.length,
        heldAt: scanState.heldReason === "large_drop" && scanState.heldAt ? scanState.heldAt : now,
      },
      db,
    );
    log.warn(
      { site, removed: pureRemovals.length, known: known.size },
      "Public URL scan held: too many pages disappeared at once",
    );
    return { ...emptyResult("held"), heldRemovedCount: pureRemovals.length };
  }

  const changes: NewChange[] = [];
  const changedUrls = new Set<string>();
  const fromEntry = (kind: PublicUrlChangeKind, e: PublicUrlSnapshotEntry, previousUrl: string | null = null) => {
    changedUrls.add(e.url);
    changes.push({
      url: e.url,
      kind,
      previousUrl,
      entryKey: e.entryKey,
      contentType: e.contentType,
      slug: e.slug,
      locale: e.locale,
      updatedAt: e.updatedAt,
    });
  };
  for (const e of published) fromEntry("published", e);
  for (const e of updated) fromEntry("updated", e);
  for (const m of moves) fromEntry("moved", m.to, m.from.url);
  for (const r of pureRemovals) {
    changedUrls.add(r.url);
    changes.push({
      url: r.url,
      kind: "removed",
      previousUrl: null,
      entryKey: r.entryKey,
      contentType: r.contentType,
      slug: r.slug,
      locale: r.locale,
      updatedAt: r.updatedAt,
    });
  }

  const pending = listPendingUpdates(site, db);
  let pendingUpdated = 0;
  for (const p of pending) {
    const e = current.get(p.url);
    if (!e || changedUrls.has(e.url)) continue;
    fromEntry("updated", e);
    pendingUpdated += 1;
  }

  const insertChange = db.prepare(
    `INSERT INTO public_url_changes (url, kind, previous_url, entry_key, content_type, slug, locale, updated_at, cause_event_id, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const deleteState = db.prepare("DELETE FROM public_url_state WHERE url = ?");
  const deletePending = db.prepare("DELETE FROM public_url_pending_updates WHERE url = ?");

  db.transaction(() => {
    for (const c of changes) {
      insertChange.run(
        c.url,
        c.kind,
        c.previousUrl,
        c.entryKey,
        c.contentType,
        c.slug,
        c.locale,
        c.updatedAt,
        causeEventId,
        now,
      );
    }
    for (const e of current.values()) {
      upsertState.run(e.url, e.entryKey, e.contentType, e.slug, e.locale, e.updatedAt, now, now);
    }
    for (const r of removedRows) deleteState.run(r.url);
    for (const p of pending) deletePending.run(p.url);
    writeScanState(
      site,
      {
        lastScanAt: now,
        pausedReason: null,
        heldReason: null,
        heldRemovedCount: 0,
        heldAt: null,
        releaseNextDrop: false,
      },
      db,
    );
  })();

  const result: ScanPublicUrlChangesResult = {
    status: "ok",
    published: published.length,
    updated: updated.length + pendingUpdated,
    moved: moves.length,
    removed: pureRemovals.length,
  };
  if (changes.length > 0) log.info({ site, ...result }, "Public URL changes recorded");
  return result;
}
