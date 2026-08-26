import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { child, registerLogSink } from "./logger";
import { errorLogFingerprint } from "./utils/error-log-fingerprint";
const log = child({ module: "db" });

/** Max frequency for storing the same warning fingerprint in SQLite. */
const WARN_SINK_RATE_LIMIT_MS = 60_000;
const warnSinkLastInsert = new Map<string, number>();
const WARN_SINK_MAP_MAX = 5000;

function shouldInsertWarn(module: string, message: string, ts: number): boolean {
  const fp = errorLogFingerprint(module, message);
  const last = warnSinkLastInsert.get(fp);
  if (last != null && ts - last < WARN_SINK_RATE_LIMIT_MS) {
    return false;
  }
  warnSinkLastInsert.set(fp, ts);
  if (warnSinkLastInsert.size > WARN_SINK_MAP_MAX) {
    const cutoff = ts - WARN_SINK_RATE_LIMIT_MS;
    for (const [key, at] of warnSinkLastInsert) {
      if (at < cutoff) warnSinkLastInsert.delete(key);
    }
    if (warnSinkLastInsert.size > WARN_SINK_MAP_MAX) {
      warnSinkLastInsert.clear();
      warnSinkLastInsert.set(fp, ts);
    }
  }
  return true;
}



const dataDir = path.resolve("data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "app.db");
export const sqlite = new Database(dbPath);

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const CONVERSATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    page_url TEXT,
    content_type TEXT,
    content_slug TEXT,
    locale TEXT DEFAULT 'en',
    feature_tags TEXT DEFAULT '[]',
    user_id TEXT,
    started_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    question_tag TEXT,
    rating TEXT,
    rated_by TEXT,
    rated_at INTEGER,
    override_content TEXT,
    override_by TEXT,
    override_at INTEGER,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS ai_knowledge (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at INTEGER,
    updated_by TEXT
  );
`;

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  );
${CONVERSATION_SCHEMA}
`);

// Migrate existing databases: rename visitor_id column to user_id if it exists
try {
  const cols = sqlite.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
  const hasVisitorId = cols.some(c => c.name === "visitor_id");
  const hasUserId = cols.some(c => c.name === "user_id");
  if (hasVisitorId && !hasUserId) {
    sqlite.exec("ALTER TABLE conversations RENAME COLUMN visitor_id TO user_id");
    log.info("[DB] Migrated conversations.visitor_id → user_id");
  }
} catch (err) {
  log.warn("[DB] Column migration check failed (non-fatal):", err);
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    level TEXT NOT NULL,
    module TEXT NOT NULL,
    message TEXT NOT NULL,
    err_name TEXT,
    err_stack TEXT
  );

  CREATE INDEX IF NOT EXISTS error_log_ts_idx ON error_log (ts);
  CREATE INDEX IF NOT EXISTS error_log_level_idx ON error_log (level);
`);

log.info(`[DB] SQLite database: ${dbPath}`);

// Prepared statement for inserting error log entries
const _insertErrorLog = sqlite.prepare(
  "INSERT INTO error_log (ts, level, module, message, err_name, err_stack) VALUES (?, ?, ?, ?, ?, ?)"
);

// Pruning: remove entries older than 48h
const _pruneErrorLog = sqlite.prepare(
  "DELETE FROM error_log WHERE ts < ?"
);

function pruneOldErrorLogs() {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  try {
    _pruneErrorLog.run(cutoff);
  } catch {
    // non-fatal
  }
}

// Run pruning on startup and then every hour
pruneOldErrorLogs();
setInterval(pruneOldErrorLogs, 60 * 60 * 1000).unref();

// Register log sink so logger.ts can insert warn/error entries into SQLite.
// Errors always insert; warnings are rate-limited per fingerprint (module+normalized message).
registerLogSink((ts, level, module, message, errName, errStack) => {
  try {
    if (level === "warn" && !shouldInsertWarn(module, message, ts)) {
      return;
    }
    _insertErrorLog.run(ts, level, module, message, errName, errStack);
  } catch {
    // never throw from a log sink
  }
});

export const db = drizzle(sqlite);

// ─── Per-site SQLite factory ─────────────────────────────────────────────────
//
// Each site gets its own SQLite file at data/<contentFolderName>/app.db so
// conversations, AI knowledge, etc. are isolated by site.
//
// On first access for a given contentFolderName, if the legacy shared
// data/app.db exists and the site-specific file does not yet exist, we copy
// the legacy file into the site-specific location so no existing data is lost.

export type SiteDb = ReturnType<typeof drizzle>;

const _siteDbCache = new Map<string, SiteDb>();
const _siteSqliteCache = new Map<string, Database.Database>();

/** Test helper — close cached site DB handles after deleting files on disk. */
export function clearSiteSqliteCacheForTests(): void {
  for (const db of _siteSqliteCache.values()) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  _siteSqliteCache.clear();
  _siteDbCache.clear();
}

/** Raw better-sqlite3 handle for a site DB (events, leases, etc.). */
export function getSiteSqlite(contentFolderName: string, copyLegacyIfMissing = false): Database.Database {
  const safeName = contentFolderName.replace(/[/\\]/g, "-");
  if (_siteSqliteCache.has(safeName)) {
    return _siteSqliteCache.get(safeName)!;
  }
  // Ensure drizzle cache is warm (runs migrations / legacy copy)
  createSiteDb(contentFolderName, copyLegacyIfMissing);
  const siteDataDir = path.join(dataDir, safeName);
  const siteDbPath = path.join(siteDataDir, "app.db");
  const siteSqlite = new Database(siteDbPath);
  siteSqlite.pragma("journal_mode = WAL");
  siteSqlite.pragma("foreign_keys = ON");
  siteSqlite.pragma("busy_timeout = 5000");
  _siteSqliteCache.set(safeName, siteSqlite);
  return siteSqlite;
}

// createSiteDb — returns (and caches) a drizzle instance for a site-specific
// SQLite database at data/<contentFolderName>/app.db.
//
// When copyLegacyIfMissing=true (set only for the first/primary site), if the
// site-specific DB does not yet exist but the legacy shared data/app.db does,
// the legacy file is copied over so existing conversations remain visible in
// the default site's admin UI.  Secondary sites always start with an empty DB
// to prevent cross-site data leakage.
export function createSiteDb(contentFolderName: string, copyLegacyIfMissing = false): SiteDb {
  if (_siteDbCache.has(contentFolderName)) {
    return _siteDbCache.get(contentFolderName)!;
  }

  // Sanitize to a safe directory component (replace slashes with dashes)
  const safeName = contentFolderName.replace(/[/\\]/g, "-");
  const siteDataDir = path.join(dataDir, safeName);

  if (!fs.existsSync(siteDataDir)) {
    fs.mkdirSync(siteDataDir, { recursive: true });
  }

  const siteDbPath = path.join(siteDataDir, "app.db");

  // One-time legacy migration: copy data/app.db → site-specific location only
  // for the primary/default site so that pre-multi-site conversations are
  // preserved.  Secondary sites intentionally start fresh.
  if (copyLegacyIfMissing && !fs.existsSync(siteDbPath) && fs.existsSync(dbPath)) {
    try {
      fs.copyFileSync(dbPath, siteDbPath);
      log.info(`[DB] Migrated legacy data/app.db → ${siteDbPath}`);
    } catch (err) {
      log.warn({ err }, `[DB] Could not copy legacy DB to ${siteDbPath} (non-fatal)`);
    }
  }

  const siteSqlite = new Database(siteDbPath);
  siteSqlite.pragma("journal_mode = WAL");
  siteSqlite.pragma("foreign_keys = ON");
  siteSqlite.exec(CONVERSATION_SCHEMA);

  // visitor_id → user_id migration for site-specific DBs
  try {
    const cols = siteSqlite.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
    const hasVisitorId = cols.some(c => c.name === "visitor_id");
    const hasUserId = cols.some(c => c.name === "user_id");
    if (hasVisitorId && !hasUserId) {
      siteSqlite.exec("ALTER TABLE conversations RENAME COLUMN visitor_id TO user_id");
      log.info(`[DB] Migrated ${safeName} conversations.visitor_id → user_id`);
    }
  } catch (err) {
    log.warn({ err }, `[DB] Column migration check failed for ${safeName} (non-fatal)`);
  }

  const siteDb = drizzle(siteSqlite);
  _siteDbCache.set(contentFolderName, siteDb);
  log.info(`[DB] Site SQLite database: ${siteDbPath}`);
  return siteDb;
}
