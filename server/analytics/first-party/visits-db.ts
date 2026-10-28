/**
 * Per-site SQLite for the site's own visit counts: data/<site>/visits.db, next to app.db.
 * Opened lazily (like data/process-stats.db) so importing this module never touches disk,
 * and the file is only created on the first write for a site.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { getProjectRoot } from "@shared/paths";
import { runVisitsMigrations } from "./visits-schema";
import { child } from "../../logger";

const log = child({ module: "first-party/visits-db" });

const handles = new Map<string, Database.Database>();
let dataDirOverride: string | null = null;

function safeSite(site: string): string {
  return site.replace(/[/\\]/g, "-");
}

function dataDir(): string {
  return dataDirOverride ?? path.join(getProjectRoot(), "data");
}

export function visitsDbPath(site: string): string {
  return path.join(dataDir(), safeSite(site), "visits.db");
}

export function visitsDbExists(site: string): boolean {
  return handles.has(safeSite(site)) || fs.existsSync(visitsDbPath(site));
}

/** Open (and migrate) a visits database file. Exported for tests. */
export function openVisitsDatabase(filePath: string): Database.Database {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  runVisitsMigrations(db);
  return db;
}

/**
 * Handle for a site's visits.db. `create: false` returns null when the file does not
 * exist yet (read paths must not create it).
 */
export function getVisitsDb(site: string, opts: { create?: boolean } = {}): Database.Database | null {
  const key = safeSite(site);
  const cached = handles.get(key);
  if (cached) return cached;
  if (!opts.create && !fs.existsSync(visitsDbPath(site))) return null;
  const db = openVisitsDatabase(visitsDbPath(site));
  handles.set(key, db);
  return db;
}

/** Boot: migrate visits.db for sites that already have one. Never creates files. */
export function ensureVisitsDbForSites(sites: string[]): void {
  for (const site of sites) {
    try {
      if (fs.existsSync(visitsDbPath(site))) getVisitsDb(site);
    } catch (err) {
      log.error({ err, site }, "[visits-db] migrate failed");
    }
  }
}

/** Tests: point at a temp data dir and close handles. */
export function setVisitsDataDirForTests(dir: string | null): void {
  closeVisitsDbs();
  dataDirOverride = dir;
}

export function closeVisitsDbs(): void {
  for (const db of handles.values()) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  handles.clear();
}
