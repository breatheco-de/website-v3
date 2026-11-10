/**
 * Draft activity seen by this server: when it first saw a draft and when the draft's content
 * last changed (any source: app, agent, laptop push, GitHub edit pulled in). Kept in the
 * site SQLite `draft_activity`; only the live server's copy feeds the daily draft cleanup.
 * Hashes ignore `_draft`, so cleanup flags and Keep stamps never count as a change.
 */

import fs from "fs";
import path from "path";
import { getSiteSqlite } from "../db";
import { hashVariantFileContents, resolveRoot, variantFilePathFor } from "./draft-meta";
import type { DraftRef } from "./draft-base";

export type DraftActivityRow = {
  content_hash: string;
  first_seen_at: number;
  changed_at: number | null;
};

export interface DraftActivityStore {
  get(site: string, ref: DraftRef): DraftActivityRow | null;
  put(site: string, ref: DraftRef, row: DraftActivityRow): void;
  delete(site: string, ref: DraftRef): void;
}

export function createMemoryDraftActivityStore(): DraftActivityStore {
  const rows = new Map<string, DraftActivityRow>();
  const key = (site: string, r: DraftRef) => `${site}|${r.contentType}|${r.slug}|${r.locale}|${r.variant}`;
  return {
    get: (site, ref) => {
      const row = rows.get(key(site, ref));
      return row ? { ...row } : null;
    },
    put: (site, ref, row) => void rows.set(key(site, ref), { ...row }),
    delete: (site, ref) => void rows.delete(key(site, ref)),
  };
}

function createSqliteDraftActivityStore(): DraftActivityStore {
  const db = (site: string) => getSiteSqlite(site);
  return {
    get(site, ref) {
      try {
        const row = db(site)
          .prepare(
            `SELECT content_hash, first_seen_at, changed_at FROM draft_activity
             WHERE content_type = ? AND slug = ? AND locale = ? AND variant = ?`,
          )
          .get(ref.contentType, ref.slug, ref.locale, ref.variant) as DraftActivityRow | undefined;
        return row ?? null;
      } catch {
        return null;
      }
    },
    put(site, ref, row) {
      db(site)
        .prepare(
          `INSERT INTO draft_activity (content_type, slug, locale, variant, content_hash, first_seen_at, changed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(content_type, slug, locale, variant) DO UPDATE SET
             content_hash = excluded.content_hash,
             changed_at = excluded.changed_at`,
        )
        .run(ref.contentType, ref.slug, ref.locale, ref.variant, row.content_hash, row.first_seen_at, row.changed_at);
    },
    delete(site, ref) {
      try {
        db(site)
          .prepare(`DELETE FROM draft_activity WHERE content_type = ? AND slug = ? AND locale = ? AND variant = ?`)
          .run(ref.contentType, ref.slug, ref.locale, ref.variant);
      } catch {
        /* non-fatal */
      }
    },
  };
}

let activeStore: DraftActivityStore = process.env.VITEST
  ? createMemoryDraftActivityStore()
  : createSqliteDraftActivityStore();

/** Swap the store (tests). Returns the previous one. */
export function setDraftActivityStore(store: DraftActivityStore): DraftActivityStore {
  const prev = activeStore;
  activeStore = store;
  return prev;
}

function siteOf(ref: DraftRef): string {
  return path.basename(resolveRoot(ref.contentRoot));
}

export function getDraftActivity(ref: DraftRef): DraftActivityRow | null {
  return activeStore.get(siteOf(ref), ref);
}

export type DraftObservation = {
  row: DraftActivityRow;
  /** No row existed: the draft was just seen for the first time. */
  first_sighting: boolean;
  /** Content differs from the last sighting (changed_at moved to `now`). */
  changed: boolean;
};

/**
 * Compare the draft's content with the last sighting and record it (`record: false` only
 * computes). Null when the file is missing.
 */
export function observeDraftContent(
  ref: DraftRef,
  now: number = Date.now(),
  opts: { record?: boolean } = {},
): DraftObservation | null {
  const filePath = variantFilePathFor(ref);
  if (!fs.existsSync(filePath)) return null;
  const hash = hashVariantFileContents(fs.readFileSync(filePath, "utf-8"));
  const site = siteOf(ref);
  const record = opts.record !== false;
  const prev = activeStore.get(site, ref);
  if (!prev) {
    const row = { content_hash: hash, first_seen_at: now, changed_at: null };
    if (record) activeStore.put(site, ref, row);
    return { row, first_sighting: true, changed: false };
  }
  if (prev.content_hash === hash) return { row: prev, first_sighting: false, changed: false };
  const row = { ...prev, content_hash: hash, changed_at: now };
  if (record) activeStore.put(site, ref, row);
  return { row, first_sighting: false, changed: true };
}

export function forgetDraftActivity(ref: DraftRef): void {
  activeStore.delete(siteOf(ref), ref);
}
