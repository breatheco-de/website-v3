/**
 * On/off periods of "Optimize for ads" per content type (fp_type_windows in visits.db).
 * They drive "collecting since", "until <date>" and the gaps shown in page stats.
 */

import type Database from "better-sqlite3";
import { getVisitsDb } from "./visits-db";

export type TypeWindow = { content_type: string; enabled_at: number; disabled_at: number | null };

const openKnown = new Set<string>();

export function openWindow(db: Database.Database, contentType: string, now = Date.now()): void {
  const open = db
    .prepare("SELECT id FROM fp_type_windows WHERE content_type = ? AND disabled_at IS NULL LIMIT 1")
    .get(contentType);
  if (!open) db.prepare("INSERT INTO fp_type_windows (content_type, enabled_at) VALUES (?, ?)").run(contentType, now);
}

export function closeWindow(db: Database.Database, contentType: string, now = Date.now()): void {
  db.prepare("UPDATE fp_type_windows SET disabled_at = ? WHERE content_type = ? AND disabled_at IS NULL").run(now, contentType);
}

export function listWindows(db: Database.Database, contentType: string): TypeWindow[] {
  return db
    .prepare("SELECT content_type, enabled_at, disabled_at FROM fp_type_windows WHERE content_type = ? ORDER BY enabled_at")
    .all(contentType) as TypeWindow[];
}

/** Called when staff flip the switch. Closing never touches collected rows. */
export function recordAdsOptimizeChange(site: string, contentType: string, enabled: boolean, now = Date.now()): void {
  const key = `${site}\u0001${contentType}`;
  if (enabled) {
    const db = getVisitsDb(site, { create: true });
    if (!db) return;
    openWindow(db, contentType, now);
    openKnown.add(key);
    return;
  }
  openKnown.delete(key);
  const db = getVisitsDb(site);
  if (db) closeWindow(db, contentType, now);
}

/** First visit for a flagged type with no open window (flag set outside the dashboard): open one. */
export function ensureOpenWindow(site: string, contentType: string, now = Date.now()): void {
  const key = `${site}\u0001${contentType}`;
  if (openKnown.has(key)) return;
  const db = getVisitsDb(site, { create: true });
  if (!db) return;
  openWindow(db, contentType, now);
  openKnown.add(key);
}

export function resetWindowCacheForTests(): void {
  openKnown.clear();
}
