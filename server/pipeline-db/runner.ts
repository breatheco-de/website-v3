/**
 * Versioned migrations for pipeline SQLite tables in data/<site>/app.db.
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getSiteSqlite } from "../db";
import { child } from "../logger";
import { BOOT_ID } from "../server-control";
import {
  PIPELINE_MIGRATIONS,
  PIPELINE_SCHEMA_VERSION,
  detectLegacyBaseline,
} from "./migrations";
import type { EnsurePipelineDbOpts } from "./types";
import { tableExists } from "./types";

const log = child({ module: "pipeline-db" });

const VERSION_TABLE = `
  CREATE TABLE IF NOT EXISTS pipeline_schema_version (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL
  );
`;

const _schemaReady = new Set<string>();
const dataDir = path.resolve("data");

function siteSafeName(site: string): string {
  return site.replace(/[/\\]/g, "-");
}

function liveDbPath(site: string): string {
  return path.join(dataDir, siteSafeName(site), "app.db");
}

function resolveDbPath(site: string, workDir?: string): string {
  if (workDir) {
    return path.join(workDir, siteSafeName(site), "app.db");
  }
  return liveDbPath(site);
}

function openPipelineDatabase(site: string, workDir?: string): Database.Database {
  const dbPath = resolveDbPath(site, workDir);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

function getStoredVersion(db: Database.Database): number | null {
  if (!tableExists(db, "pipeline_schema_version")) return null;
  const row = db.prepare("SELECT version FROM pipeline_schema_version WHERE id = 1").get() as
    | { version: number }
    | undefined;
  return row?.version ?? null;
}

function setStoredVersion(db: Database.Database, version: number): void {
  db.exec(VERSION_TABLE);
  db.prepare(
    `INSERT INTO pipeline_schema_version (id, version) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET version = excluded.version`,
  ).run(version);
}

function runMigrations(db: Database.Database, fromExclusive: number): number {
  db.exec(VERSION_TABLE);
  let current = getStoredVersion(db);
  if (current == null) {
    current = detectLegacyBaseline(db);
    if (current > 0) {
      setStoredVersion(db, current);
    }
  }

  for (const migration of PIPELINE_MIGRATIONS) {
    if (migration.version <= fromExclusive) continue;
    if (current != null && migration.version <= current) continue;
    migration.up(db);
    setStoredVersion(db, migration.version);
    current = migration.version;
  }

  return current ?? 0;
}

function pruneOldBackups(siteDir: string, keepDays = 7): void {
  if (!fs.existsSync(siteDir)) return;
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(siteDir)) {
    if (!name.startsWith("app.db.bak-")) continue;
    const full = path.join(siteDir, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    } catch {
      /* non-fatal */
    }
  }
}

function backupLiveDb(site: string, bootId: string): void {
  const src = liveDbPath(site);
  if (!fs.existsSync(src)) return;
  const siteDir = path.dirname(src);
  const dest = path.join(siteDir, `app.db.bak-${bootId}`);
  fs.copyFileSync(src, dest);
  pruneOldBackups(siteDir);
}

function withApplyLock<T>(site: string, fn: () => T): T {
  const lockPath = path.join(dataDir, siteSafeName(site), ".pipeline-migrate.lock");
  const lockDir = path.dirname(lockPath);
  if (!fs.existsSync(lockDir)) fs.mkdirSync(lockDir, { recursive: true });

  let fd: number | null = null;
  try {
    fd = fs.openSync(lockPath, "wx");
    return fn();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST") {
      throw new Error(`Pipeline migration already in progress for ${site}`);
    }
    throw err;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
        fs.unlinkSync(lockPath);
      } catch {
        /* non-fatal */
      }
    }
  }
}

export function getPipelineSchemaVersion(site: string, workDir?: string): number {
  const db = openPipelineDatabase(site, workDir);
  try {
    const stored = getStoredVersion(db);
    if (stored != null) return stored;
    return detectLegacyBaseline(db);
  } finally {
    db.close();
  }
}

export function ensurePipelineDb(site: string, opts: EnsurePipelineDbOpts = {}): number {
  const cacheKey = opts.workDir ? `${site}:${opts.workDir}` : site;
  if (_schemaReady.has(cacheKey)) {
    return getPipelineSchemaVersion(site, opts.workDir);
  }

  const apply = !opts.dryRun;
  const run = (): number => {
    let db: Database.Database;
    if (apply && !opts.workDir) {
      db = getSiteSqlite(site);
    } else {
      db = openPipelineDatabase(site, opts.workDir);
    }

    try {
      if (apply && process.env.NODE_ENV === "production" && !opts.skipBackup && !opts.workDir) {
        backupLiveDb(site, BOOT_ID);
      }

      const version = runMigrations(db, 0);
      if (version < PIPELINE_SCHEMA_VERSION) {
        throw new Error(
          `Pipeline DB for ${site} at version ${version}, expected ${PIPELINE_SCHEMA_VERSION}`,
        );
      }
      _schemaReady.add(cacheKey);
      return version;
    } finally {
      if (opts.workDir || !apply) {
        db.close();
      }
    }
  };

  if (apply && !opts.workDir) {
    return withApplyLock(site, run);
  }
  return run();
}

export function ensurePipelineDbForSites(sites: string[], opts: EnsurePipelineDbOpts = {}): void {
  for (const site of sites) {
    try {
      const version = ensurePipelineDb(site, opts);
      const mode = opts.dryRun ? "dry-run ok" : "apply ok";
      console.log(`[pipeline-db] ${mode} site=${site} version=${version}`);
      log.info({ site, version, dryRun: opts.dryRun ?? false }, `[pipeline-db] ${mode}`);
    } catch (err) {
      log.error({ err, site }, "[pipeline-db] migration failed");
      throw err;
    }
  }
}

/** Reset in-process cache (tests). */
export function resetPipelineDbCache(): void {
  _schemaReady.clear();
}
