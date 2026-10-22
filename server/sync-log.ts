import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { siteSyncGcsKey, SYNC_FILENAMES, syncLogReadKeys } from "@shared/gcsKeys";
import { gcs } from './gcs';
import { child as loggerChild } from './logger';
import { getDefaultContentFolder } from './site-config';

const syncLogLogger = loggerChild({ module: "SyncLog", worker: "SyncLog" });

/** Async-local style context so logSync() routes to the active site's log. */
let _activeContentRoot: string | undefined;

export function withSyncLogContext<T>(contentRoot: string | undefined, fn: () => T): T {
  const prev = _activeContentRoot;
  _activeContentRoot = contentRoot;
  try {
    return fn();
  } finally {
    _activeContentRoot = prev;
  }
}

export async function withSyncLogContextAsync<T>(
  contentRoot: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = _activeContentRoot;
  _activeContentRoot = contentRoot;
  try {
    return await fn();
  } finally {
    _activeContentRoot = prev;
  }
}

/** Pre-multisite global sync log location (read-only migration import). */
function legacyGlobalSyncLogPath(): string {
  return path.join(process.cwd(), 'content', '.sync-log-state.txt');
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MAX_LOG_LINES = 500;

export const INSTANCE_ID = crypto.randomBytes(2).toString('hex');

let APP_CHECKPOINT = '?';
try {
  APP_CHECKPOINT = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch {
  APP_CHECKPOINT = '?';
}

let GITHUB_COMMIT: string | null = null;

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const cleanUrl = url.replace(/\.git$/, '');
    const match = cleanUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (match) return { owner: match[1], repo: match[2] };
    return null;
  } catch {
    return null;
  }
}

export async function refreshGithubCommit(): Promise<void> {
  const token = process.env.GITHUB_TOKEN || '';
  const repoUrl = process.env.GITHUB_REPO_URL || '';
  const branch = process.env.GITHUB_BRANCH || 'main';
  const parsed = parseGitHubUrl(repoUrl);
  if (!token || !parsed) return;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?sha=${branch}&per_page=1`,
      { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (res.ok) {
      const commits = await res.json() as Array<{ sha: string }>;
      if (commits.length > 0) {
        GITHUB_COMMIT = commits[0].sha.slice(0, 8);
      }
    }
  } catch {
    // silently ignore - GITHUB_COMMIT stays as previous value or null
  }
}

export function getGithubCommit(): string | null {
  return GITHUB_COMMIT;
}

export type SyncLogCategory =
  | 'RESTART'
  | 'RECONCILE'
  | 'WEBHOOK'
  | 'AUTO-PULL'
  | 'COMMIT'
  | 'CONFLICT'
  | 'ERROR'
  | 'EDIT';

export type SyncLogEntry = {
  ts: string;
  category: SyncLogCategory;
  message: string;
  person?: string;
  meta?: Record<string, unknown>;
};

function parseOldTextLine(line: string): SyncLogEntry | null {
  const m = line.match(/^(\S+) \[(\w[\w-]*)\] (.+)$/);
  if (!m) return null;
  const [, ts, category, message] = m;
  const personMatch = message.match(/ by (.+?)(?::|$)/);
  const person = personMatch ? personMatch[1].trim() : undefined;
  return { ts, category: category as SyncLogCategory, message, ...(person ? { person } : {}) };
}

// ─── SyncLog class ────────────────────────────────────────────────────────────
//
// Each site gets its own SyncLog instance, parameterised by contentRoot
// (the absolute path to the site's content folder) and contentFolderName
// (the relative path, used as part of the GCS key).
//
// The module-level exported functions below delegate to a shared default
// instance for backward compatibility with startup code in routes/index.ts and
// any callers that don't have access to res.locals.site.

export class SyncLog {
  private readonly syncLogPath: string;
  private readonly gcsKey: string;
  private readonly readKeys: string[];
  private readonly migrateLegacy: boolean;
  private logEntries: SyncLogEntry[] = [];
  private loaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  // migrateLegacy should be true only for the first/primary registered site.
  // Secondary sites must pass false to prevent cross-site log contamination.
  constructor(contentRoot: string, contentFolderName: string, migrateLegacy = false) {
    this.syncLogPath = path.join(contentRoot, '.sync-log-state.txt');
    // Per-site GCS key: sync/<contentFolderName>/sync-log-state.txt
    // Sanitise the folder name so slashes don't create unexpected GCS prefixes.
    const safeFolder = contentFolderName.replace(/\\/g, '/').replace(/^\/|\/$/g, '');
    this.gcsKey = siteSyncGcsKey(safeFolder, SYNC_FILENAMES.syncLog);
    this.readKeys = syncLogReadKeys(safeFolder);
    this.migrateLegacy = migrateLegacy;
  }

  // Legacy migration: resolve the canonical pre-multi-site sync log location —
  // CONTENT_FOLDER env var directory or 'content' as a final fallback.
  //
  // Deliberately does NOT scan other registered site folders: importing another
  // site's history would break per-site log isolation.  Only called when
  // migrateLegacy=true (i.e. the primary/default site).
  private findLegacySyncLogPath(): string | null {
    const candidates = [
      legacyGlobalSyncLogPath(),
      ...(process.env.CONTENT_FOLDER
        ? [path.join(process.cwd(), process.env.CONTENT_FOLDER, '.sync-log-state.txt')]
        : []),
    ].filter((p) => p !== this.syncLogPath);
    for (const legacyPath of candidates) {
      if (fs.existsSync(legacyPath)) return legacyPath;
    }
    return null;
  }

  private loadLocal(): void {
    try {
      const pathToRead = fs.existsSync(this.syncLogPath)
        ? this.syncLogPath
        : (this.migrateLegacy ? this.findLegacySyncLogPath() : null);

      if (pathToRead) {
        const raw = fs.readFileSync(pathToRead, 'utf-8');
        this.logEntries = this.parseLogLines(raw);
      } else {
        this.logEntries = [];
      }

      // One-time import: pre-multisite logs lived under content/.sync-log-state.txt
      if (this.logEntries.length === 0) {
        this.tryImportLegacyGlobalLog();
      }
    } catch {
      this.logEntries = [];
    }
    this.loaded = true;
  }

  private parseLogLines(raw: string): SyncLogEntry[] {
    return raw
      .split('\n')
      .filter(l => l.trim() !== '')
      .map(line => {
        try {
          return JSON.parse(line) as SyncLogEntry;
        } catch {
          return parseOldTextLine(line);
        }
      })
      .filter((e): e is SyncLogEntry => e !== null);
  }

  private tryImportLegacyGlobalLog(): void {
    const legacyPath = legacyGlobalSyncLogPath();
    if (legacyPath === this.syncLogPath || !fs.existsSync(legacyPath)) return;
    try {
      const imported = this.parseLogLines(fs.readFileSync(legacyPath, 'utf-8'));
      if (imported.length === 0) return;
      this.logEntries = imported;
      this.saveLocal();
      syncLogLogger.info(
        { count: imported.length, target: this.syncLogPath },
        "Imported legacy global sync log into per-site log",
      );
    } catch {
      // non-fatal
    }
  }

  private saveLocal(): void {
    try {
      const dir = path.dirname(this.syncLogPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const content = this.logEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.writeFileSync(this.syncLogPath, content, 'utf-8');
    } catch (error) {
      syncLogLogger.error({ err: error }, "error saving local log");
    }
  }

  private async saveToBucket(): Promise<void> {
    if (!IS_PRODUCTION || !gcs.available) return;
    try {
      const content = this.logEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
      gcs.debouncedUpload(this.gcsKey, Buffer.from(content, 'utf-8'), 'text/plain', 2_000);
    } catch (error) {
      syncLogLogger.error({ err: error }, "error saving log to bucket");
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      this.saveLocal();
      await this.saveToBucket();
    }, 2000);
  }

  private trimLog(): void {
    if (this.logEntries.length > MAX_LOG_LINES) {
      this.logEntries = this.logEntries.slice(this.logEntries.length - MAX_LOG_LINES);
    }
  }

  async load(): Promise<void> {
    if (this.loaded) return;

    if (IS_PRODUCTION && gcs.available) {
      try {
        const result = await gcs.downloadFirstExisting(this.readKeys);
        if (result) {
          const data = result.data;
          this.logEntries = this.parseLogLines(data.toString('utf-8'));
          this.loaded = true;
          this.saveLocal();
          return;
        }
      } catch (error) {
        syncLogLogger.error({ err: error }, "error loading from bucket");
      }
    }

    this.loadLocal();
  }

  log(category: SyncLogCategory, message: string, person?: string, meta?: Record<string, unknown>): void {
    if (!this.loaded) this.loadLocal();

    const entry: SyncLogEntry = {
      ts: new Date().toISOString(),
      category,
      message,
      ...(person ? { person } : {}),
      ...(meta ? { meta } : {}),
    };
    this.logEntries.push(entry);
    this.trimLog();
    this.scheduleSave();

    const legacyText = `${entry.ts} [${category}] ${message}`;
    syncLogLogger.info({ category, person }, legacyText);
  }

  getEntries(): SyncLogEntry[] {
    if (!this.loaded) this.loadLocal();
    return [...this.logEntries];
  }

  getText(): string {
    if (!this.loaded) this.loadLocal();
    return this.logEntries.map(e => `${e.ts} [${e.category}] ${e.message}`).join('\n');
  }

  getRecent(count: number = 20): SyncLogEntry[] {
    if (!this.loaded) this.loadLocal();
    return this.logEntries.slice(-count);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveLocal();
    await this.saveToBucket();
  }

  /**
   * Force-reload log entries from GCS (prod) or local file, overwriting memory.
   */
  async reloadFromBucket(): Promise<"gcs" | "local"> {
    this.loaded = false;
    if (IS_PRODUCTION) {
      if (!gcs.available) gcs.initBootstrapFromEnv();
      if (gcs.available) {
        try {
          const result = await gcs.downloadFirstExisting(this.readKeys);
          if (result) {
            this.logEntries = this.parseLogLines(result.data.toString("utf-8"));
            this.loaded = true;
            this.saveLocal();
            return "gcs";
          }
        } catch (error) {
          syncLogLogger.error({ err: error }, "error reloading from bucket");
        }
      }
    }
    this.loadLocal();
    return "local";
  }

  /**
   * Force-upload current log to GCS immediately (no debounce). Admin Cloud Sync.
   */
  async forceUploadToBucket(): Promise<{
    success: boolean;
    uploaded: boolean;
    gcsKey: string;
    reason?: string;
  }> {
    const gcsKey = this.gcsKey;
    if (!IS_PRODUCTION) {
      return {
        success: false,
        uploaded: false,
        gcsKey,
        reason: "GCS sync only runs in production (NODE_ENV=production).",
      };
    }
    if (!gcs.available) {
      gcs.initBootstrapFromEnv();
    }
    if (!gcs.available) {
      return {
        success: false,
        uploaded: false,
        gcsKey,
        reason: "GCS is unavailable — missing GCS_BUCKET_NAME or credentials.",
      };
    }
    if (!this.loaded) this.loadLocal();
    if (!fs.existsSync(this.syncLogPath) && this.logEntries.length === 0) {
      return {
        success: false,
        uploaded: false,
        gcsKey,
        reason: "No local sync-log file found to upload.",
      };
    }
    this.saveLocal();
    const content = this.logEntries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await gcs.upload(gcsKey, Buffer.from(content, "utf-8"), "text/plain");
    return { success: true, uploaded: true, gcsKey };
  }

  getLocalPath(): string {
    return this.syncLogPath;
  }

  getGcsKey(): string {
    return this.gcsKey;
  }

  async clear(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.logEntries = [];
    this.saveLocal();
    await this.saveToBucket();
    this.log('RESTART', `Log cleared (instance=${INSTANCE_ID}, checkpoint=${APP_CHECKPOINT})`);
  }

  async clearOlderThan(cutoffMs: number): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const before = this.logEntries.length;
    this.logEntries = this.logEntries.filter(e => new Date(e.ts).getTime() >= cutoffMs);
    const removed = before - this.logEntries.length;
    this.saveLocal();
    await this.saveToBucket();
    this.log('RESTART', `Cleared ${removed} log entr${removed !== 1 ? 'ies' : 'y'} older than ${new Date(cutoffMs).toISOString()} (instance=${INSTANCE_ID})`);
  }
}

// ─── Default module-level instance ───────────────────────────────────────────
//
// Used by startup code in routes/index.ts and any other callers that don't
// have access to a per-site SyncLog. Delegates to the default site's SyncLog
// from SiteContext when available.

function getDefaultSyncLogInstance(): SyncLog {
  try {
    const { getDefaultSite } = require('./site-manager') as typeof import('./site-manager');
    return getDefaultSite().syncLog;
  } catch {
    const folder = getDefaultContentFolder();
    const root = path.join(process.cwd(), folder);
    return new SyncLog(root, folder);
  }
}

function resolveContentRootName(contentRoot?: string): string | undefined {
  if (!contentRoot) return undefined;
  return path.isAbsolute(contentRoot)
    ? path.relative(process.cwd(), contentRoot)
    : contentRoot.replace(/\\/g, '/').replace(/^\/|\/$/g, '');
}

/** Resolve the per-site SyncLog for a content folder name or absolute path. */
export function getSyncLog(contentRoot?: string): SyncLog {
  const key = resolveContentRootName(contentRoot ?? _activeContentRoot);
  if (key) {
    try {
      const { getSiteContextMap } = require('./site-manager') as typeof import('./site-manager');
      for (const ctx of getSiteContextMap().values()) {
        if (ctx.contentRootName === key || ctx.contentRoot === contentRoot) {
          return ctx.syncLog;
        }
      }
    } catch {
      // site map not ready yet
    }
  }
  return getDefaultSyncLogInstance();
}

// ─── Per-request helper ───────────────────────────────────────────────────────
//
// Resolves the per-site SyncLog from res.locals.site (set by siteResolutionMiddleware)
// falling back to the default instance when no site context is available.

export function getSyncLogForResponse(res: { locals: Record<string, unknown> }): SyncLog {
  const site = res.locals.site as { syncLog?: SyncLog } | undefined;
  return site?.syncLog ?? getDefaultSyncLogInstance();
}

// ─── Module-level backward-compatible exports ─────────────────────────────────

export async function loadSyncLog(): Promise<void> {
  await getDefaultSyncLogInstance().load();
  try {
    const { getSiteContextMap } = await import('./site-manager');
    await Promise.all(
      Array.from(getSiteContextMap().values()).map((ctx) => ctx.syncLog.load()),
    );
  } catch {
    // site map not ready
  }
}

export function logSync(category: SyncLogCategory, message: string, person?: string, meta?: Record<string, unknown>, contentRoot?: string): void {
  getSyncLog(contentRoot ?? _activeContentRoot).log(category, message, person, meta);
}

export function getInstanceId(): string {
  return INSTANCE_ID;
}

export function getAppCheckpoint(): string {
  return APP_CHECKPOINT;
}

export function getSyncLogEntries(): SyncLogEntry[] {
  return getDefaultSyncLogInstance().getEntries();
}

export function getSyncLogText(): string {
  return getDefaultSyncLogInstance().getText();
}

export function getRecentEntries(count: number = 20): SyncLogEntry[] {
  return getDefaultSyncLogInstance().getRecent(count);
}

export async function flushSyncLog(): Promise<void> {
  return getDefaultSyncLogInstance().flush();
}

export async function clearSyncLog(): Promise<void> {
  return getDefaultSyncLogInstance().clear();
}

export async function clearSyncLogOlderThan(cutoffMs: number): Promise<void> {
  return getDefaultSyncLogInstance().clearOlderThan(cutoffMs);
}
