import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { child } from "./logger";
import { getProjectRoot } from "@shared/paths";
const log = child({ module: "db-cache" });



export const CACHE_DIR = path.join(getProjectRoot(), ".cache");

export interface CacheEntry {
  fetched_at: string;
  items: Record<string, unknown>[];
  raw_count: number;
  facets?: Record<string, string[]>;
}

export interface CacheDbStats {
  item_count: number;
  fetched_at: string | null;
}

export interface CacheStats {
  totalFileSizeBytes: number;
  perDb: Record<string, CacheDbStats>;
}

export interface IDatabaseCache {
  read(dbName: string, ttlHours: number, raw?: boolean): CacheEntry | null;
  write(dbName: string, entry: CacheEntry, raw?: boolean): void;
  clear(dbName: string): void;
  has(dbName: string, ttlHours: number): boolean;
  getCacheStats(): CacheStats;
}

export class JsonFileCache implements IDatabaseCache {
  private cacheDir: string;

  constructor(cacheDir = CACHE_DIR) {
    this.cacheDir = cacheDir;
  }

  private cachePath(dbName: string, raw: boolean): string {
    const suffix = raw ? "-raw" : "";
    return path.join(this.cacheDir, `db-${dbName}${suffix}.json`);
  }

  read(dbName: string, ttlHours: number, raw = false): CacheEntry | null {
    const filePath = this.cachePath(dbName, raw);
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const entry = JSON.parse(content) as CacheEntry;
      const age = (Date.now() - new Date(entry.fetched_at).getTime()) / (1000 * 60 * 60);
      if (age > ttlHours) return null;
      return entry;
    } catch {
      return null;
    }
  }

  write(dbName: string, entry: CacheEntry, raw = false): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    fs.writeFileSync(
      this.cachePath(dbName, raw),
      JSON.stringify(entry, null, 2)
    );
  }

  clear(dbName: string): void {
    const mapped = this.cachePath(dbName, false);
    const raw = this.cachePath(dbName, true);
    if (fs.existsSync(mapped)) fs.unlinkSync(mapped);
    if (fs.existsSync(raw)) fs.unlinkSync(raw);
  }

  has(dbName: string, ttlHours: number): boolean {
    return this.read(dbName, ttlHours) !== null;
  }

  getCacheStats(): CacheStats {
    const perDb: Record<string, CacheDbStats> = {};
    let totalFileSizeBytes = 0;

    if (!fs.existsSync(this.cacheDir)) {
      return { totalFileSizeBytes, perDb };
    }

    let files: string[];
    try {
      files = fs.readdirSync(this.cacheDir);
    } catch {
      return { totalFileSizeBytes, perDb };
    }

    for (const file of files) {
      const filePath = path.join(this.cacheDir, file);
      try {
        const stat = fs.statSync(filePath);
        totalFileSizeBytes += stat.size;
      } catch {
        // skip
      }

      if (file.startsWith("db-") && file.endsWith(".json") && !file.endsWith("-raw.json")) {
        const dbName = file.slice(3, -5);
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const entry = JSON.parse(content) as CacheEntry;
          perDb[dbName] = {
            item_count: Array.isArray(entry.items) ? entry.items.length : 0,
            fetched_at: entry.fetched_at ?? null,
          };
        } catch {
          perDb[dbName] = { item_count: 0, fetched_at: null };
        }
      }
    }

    return { totalFileSizeBytes, perDb };
  }
}

export class SqliteCache implements IDatabaseCache {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath = path.join(CACHE_DIR, "db-cache.sqlite")) {
    this.dbPath = dbPath;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache_entries (
        db_name TEXT NOT NULL,
        variant  TEXT NOT NULL DEFAULT '',
        fetched_at TEXT NOT NULL,
        raw_count  INTEGER NOT NULL,
        payload    TEXT NOT NULL,
        PRIMARY KEY (db_name, variant)
      )
    `);
  }

  read(dbName: string, ttlHours: number, raw = false): CacheEntry | null {
    const variant = raw ? "raw" : "";
    const row = this.db
      .prepare(
        "SELECT fetched_at, raw_count, payload FROM cache_entries WHERE db_name = ? AND variant = ?"
      )
      .get(dbName, variant) as
      | { fetched_at: string; raw_count: number; payload: string }
      | undefined;

    if (!row) return null;
    const age = (Date.now() - new Date(row.fetched_at).getTime()) / (1000 * 60 * 60);
    if (age > ttlHours) return null;

    try {
      const items = JSON.parse(row.payload) as Record<string, unknown>[];
      return { fetched_at: row.fetched_at, raw_count: row.raw_count, items };
    } catch {
      return null;
    }
  }

  write(dbName: string, entry: CacheEntry, raw = false): void {
    const variant = raw ? "raw" : "";
    this.db
      .prepare(
        `INSERT INTO cache_entries (db_name, variant, fetched_at, raw_count, payload)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(db_name, variant) DO UPDATE SET
           fetched_at = excluded.fetched_at,
           raw_count  = excluded.raw_count,
           payload    = excluded.payload`
      )
      .run(dbName, variant, entry.fetched_at, entry.raw_count, JSON.stringify(entry.items));
  }

  clear(dbName: string): void {
    this.db.prepare("DELETE FROM cache_entries WHERE db_name = ?").run(dbName);
  }

  has(dbName: string, ttlHours: number): boolean {
    return this.read(dbName, ttlHours) !== null;
  }

  /**
   * One-time migration: for each dbName, if the SQLite store has no row for
   * that name, look for a legacy `.cache/db-<name>.json` (and `-raw` variant)
   * and import it.  Successfully migrated files are deleted to avoid confusion.
   * Returns the list of database names that were migrated.
   */
  migrateFromJson(dbNames: string[], cacheDir = CACHE_DIR): string[] {
    const migrated: string[] = [];

    for (const dbName of dbNames) {
      const variants: Array<{ suffix: string; variant: string }> = [
        { suffix: "",     variant: ""    },
        { suffix: "-raw", variant: "raw" },
      ];

      let anyMigrated = false;

      for (const { suffix, variant } of variants) {
        const existing = this.db
          .prepare("SELECT 1 FROM cache_entries WHERE db_name = ? AND variant = ?")
          .get(dbName, variant);

        if (existing) continue;

        const jsonPath = path.join(cacheDir, `db-${dbName}${suffix}.json`);
        if (!fs.existsSync(jsonPath)) continue;

        try {
          const content = fs.readFileSync(jsonPath, "utf-8");
          const entry = JSON.parse(content) as CacheEntry;

          if (
            typeof entry.fetched_at !== "string" ||
            !Array.isArray(entry.items) ||
            typeof entry.raw_count !== "number"
          ) {
            log.warn(`[SqliteCache] Skipping malformed JSON cache: ${jsonPath}`);
            continue;
          }

          this.db
            .prepare(
              `INSERT INTO cache_entries (db_name, variant, fetched_at, raw_count, payload)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(db_name, variant) DO NOTHING`
            )
            .run(dbName, variant, entry.fetched_at, entry.raw_count, JSON.stringify(entry.items));

          fs.unlinkSync(jsonPath);
          anyMigrated = true;
          log.info(
            `[SqliteCache] Migrated ${jsonPath} → SQLite (db=${dbName}, variant=${variant || "mapped"})`
          );
        } catch (err) {
          log.warn(`[SqliteCache] Failed to migrate ${jsonPath}:`, err);
        }
      }

      if (anyMigrated) migrated.push(dbName);
    }

    return migrated;
  }

  getCacheStats(): CacheStats {
    const rows = this.db
      .prepare(
        "SELECT db_name, json_array_length(payload) AS item_count, fetched_at FROM cache_entries WHERE variant = ''"
      )
      .all() as { db_name: string; item_count: number; fetched_at: string }[];

    const perDb: Record<string, CacheDbStats> = {};
    for (const row of rows) {
      perDb[row.db_name] = {
        item_count: row.item_count,
        fetched_at: row.fetched_at,
      };
    }

    let totalFileSizeBytes = 0;
    try {
      if (fs.existsSync(this.dbPath)) {
        totalFileSizeBytes = fs.statSync(this.dbPath).size;
      }
    } catch {
      // ignore
    }

    return { totalFileSizeBytes, perDb };
  }
}
