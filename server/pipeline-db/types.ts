import type Database from "better-sqlite3";

export type PipelineMigration = {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
};

export type EnsurePipelineDbOpts = {
  /** When true, only validate — caller must point db at a copy (see workDir). */
  dryRun?: boolean;
  /** Root dir containing per-site `<safe-site>/app.db` copies for dry-run. */
  workDir?: string;
  /** Skip production backup (tests). */
  skipBackup?: boolean;
};

export function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row != null;
}

export function tableHasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

export function indexExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(name);
  return row != null;
}
