/**
 * Sync State Management
 * 
 * Tracks the synchronization state between local content files and GitHub.
 * Persists state to GCS bucket to survive deployments, with local file as cache.
 * Works without git CLI - uses file hashes and GitHub API for comparison.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { siteSyncGcsKey, SYNC_FILENAMES, syncStateReadKeys } from '@shared/gcsKeys';
import { gcs } from './gcs';
import { child } from "./logger";
import { getDefaultContentFolder, getDefaultContentRoot } from "./site-config";
import type { EventActor } from "./events/types";
import { getContentWriteContext } from "./write-context";
const log = child({ module: "sync-state" });

function defaultContentFolder(): string {
  return getDefaultContentFolder();
}

/** Canonicalize paths so /var and /private/var compare consistently on macOS. */
function resolvePathForComparison(targetPath: string): string {
  try {
    return fs.realpathSync.native(targetPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      const parent = path.dirname(targetPath);
      const base = path.basename(targetPath);
      try {
        return path.join(fs.realpathSync.native(parent), base);
      } catch {
        return path.resolve(targetPath);
      }
    }
    return path.resolve(targetPath);
  }
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Returns the relative content folder name for a given contentRoot.
 * Falls back to the default site from sites.yml when no contentRoot provided.
 */
export function getContentFolder(contentRoot?: string): string {
  if (!contentRoot) return defaultContentFolder();
  if (path.isAbsolute(contentRoot)) {
    const cwd = resolvePathForComparison(process.cwd());
    const root = resolvePathForComparison(contentRoot);
    return path.relative(cwd, root);
  }
  return contentRoot;
}

/**
 * Normalize a file path so it carries the correct content folder prefix.
 * Handles absolute paths, already-prefixed relative paths, and bare relative paths.
 */
function normalizePath(filePath: string, contentRoot?: string): string {
  if (path.isAbsolute(filePath)) {
    const cwd = resolvePathForComparison(process.cwd());
    const abs = resolvePathForComparison(filePath);
    return path.relative(cwd, abs);
  }
  const folder = getContentFolder(contentRoot);
  return filePath.startsWith(`${folder}/`) || filePath.startsWith('client/')
    ? filePath
    : `${folder}/${filePath}`;
}

/**
 * Returns the local filesystem path for the sync-state JSON file.
 * When contentRoot is provided each site stores its own isolated state file
 * inside its content directory, preventing cross-repo contamination.
 */
function getSyncStatePath(contentRoot?: string): string {
  if (!contentRoot) return path.join(getDefaultContentRoot(), '.sync-state.json');
  const abs = path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot);
  return path.join(abs, '.sync-state.json');
}

/**
 * Returns the GCS bucket key used to persist sync state across deployments.
 * Keyed by contentRoot so that multi-site setups don't share a single key.
 */
function getSiteFolder(contentRoot?: string): string {
  return getContentFolder(contentRoot)
    .replace(/\\/g, '/')
    .replace(/^\/|\/$/g, '');
}

function getGcsSyncStateKey(contentRoot?: string): string {
  return siteSyncGcsKey(getSiteFolder(contentRoot), SYNC_FILENAMES.syncState);
}

/**
 * Load sync state from GCS bucket on startup using authenticated download.
 * In production: loads from bucket, falls back to local file.
 * In development: uses local file only (each dev environment has its own state).
 */
export async function loadSyncStateFromBucket(contentRoot?: string): Promise<SyncState> {
  if (!IS_PRODUCTION) {
    log.info('[SyncState] Development mode, using local file only');
    return loadSyncState(contentRoot);
  }

  if (!gcs.available) {
    log.info('[SyncState] GCS unavailable, loading from local file');
    return loadSyncState(contentRoot);
  }

  const siteFolder = getSiteFolder(contentRoot);
  try {
    const result = await gcs.downloadFirstExisting(syncStateReadKeys(siteFolder));
    if (!result) {
      log.info('[SyncState] No sync state found in bucket, using local file');
      return loadSyncState(contentRoot);
    }

    const state = JSON.parse(result.data.toString('utf-8')) as SyncStateWithConfig;
    log.info('[SyncState] Loaded sync state from GCS bucket (authenticated)');

    saveSyncStateLocal(state, contentRoot);
    return state;
  } catch (error) {
    log.error({ err: error }, '[SyncState] Error loading from bucket:');
    return loadSyncState(contentRoot);
  }
}

/**
 * Save sync state to GCS bucket for persistence across deployments.
 * Only runs in production — development uses local file only.
 */
async function saveSyncStateToBucket(state: SyncStateWithConfig, contentRoot?: string): Promise<void> {
  if (!IS_PRODUCTION || !gcs.available) return;

  try {
    const content = JSON.stringify(state, null, 2);
    const gcsKey = getGcsSyncStateKey(contentRoot);
    gcs.debouncedUpload(gcsKey, Buffer.from(content, 'utf-8'), 'application/json');
  } catch (error) {
    log.error({ err: error }, '[SyncState] Error saving to bucket:');
  }
}

/**
 * Check if a file should be tracked by the sync system.
 * Tracks YAML and JSON files in 4geeks-com directory.
 * Excludes component-registry, dot-prefixed state files, and image directories.
 */
export function shouldTrackFile(filePath: string, allowedExceptions?: Set<string>, contentRoot?: string): boolean {
  if (allowedExceptions instanceof Set && allowedExceptions.has(filePath)) return true;

  const folder = getContentFolder(contentRoot);
  if (!filePath.startsWith(`${folder}/`)) {
    return false;
  }
  
  if (filePath.includes('component-registry/')) {
    // Shared schemas (leadFormDataSchema, ctaButtonSchema, …) live here — not under a version folder.
    // Pattern: component-registry/_common/*.{ts,yml,yaml}
    if (/component-registry\/_common\/[^/]+\.(ts|ya?ml)$/.test(filePath)) {
      return true;
    }
    // Allow YML files inside the examples/ subfolder
    // Pattern: component-registry/{type}/{version}/examples/{file}.yml
    if (/component-registry\/[^/]+\/[^/]+\/examples\/[^/]+\.ya?ml$/.test(filePath)) {
      return true;
    }
    // Allow schema.yml files
    // Pattern: component-registry/{type}/{version}/schema.yml
    if (/component-registry\/[^/]+\/[^/]+\/schema\.ya?ml$/.test(filePath)) {
      return true;
    }
    // Allow .ts files (schema.ts, field-editors.ts) so they appear in the sync modal
    // Pattern: component-registry/{type}/{version}/*.ts
    if (/component-registry\/[^/]+\/[^/]+\/[^/]+\.ts$/.test(filePath)) {
      return true;
    }
    return false;
  }

  const basename = path.basename(filePath);
  if (basename === 'validation-cache.json') {
    return false;
  }

  if (basename === 'seo-index.json') {
    return false;
  }

  if (basename.startsWith('.') && basename.endsWith('-state.json')) {
    return false;
  }

  if (filePath.includes('/images/')) {
    return false;
  }
  
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.yml' && ext !== '.yaml' && ext !== '.json') {
    return false;
  }
  
  return true;
}

export interface FileSyncInfo {
  sha: string;
  lastModified: number;
  remoteSha?: string;
  pulledFromCommit?: string;
  author?: string;
  modifiedAt?: string;
  committedAt?: string;
}

export interface SyncConfig {
  commitIntervalSeconds: number;
}

export interface SyncState {
  lastSyncedCommit: string | null;
  lastSyncedAt: string | null;
  files: Record<string, FileSyncInfo>;
}

export interface WebhookInfo {
  webhookId: number;
  webhookSecret: string;
  webhookUrl: string;
  createdAt: string;
}

export interface SyncStateWithConfig extends SyncState {
  config?: SyncConfig;
  webhook?: WebhookInfo;
}

export interface PendingChange {
  file: string;
  status: 'modified' | 'added' | 'deleted';
  source: 'local' | 'incoming' | 'conflict';
  contentType: string;
  slug: string;
  localSha: string;
  remoteSha?: string;
  author?: string;
  date?: string;
  commitSha?: string;
}

const DEFAULT_CONFIG: SyncConfig = {
  commitIntervalSeconds: 5,
};

const DEFAULT_SYNC_STATE: SyncStateWithConfig = {
  config: DEFAULT_CONFIG,
  lastSyncedCommit: null,
  lastSyncedAt: null,
  files: {},
};

export function computeFileSha(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function computeGitBlobSha(content: string): string {
  const buf = Buffer.from(content, 'utf-8');
  const header = `blob ${buf.length}\0`;
  return crypto.createHash('sha1').update(header).update(buf).digest('hex');
}

export function getSyncConfig(contentRoot?: string): SyncConfig {
  const state = loadSyncState(contentRoot) as SyncStateWithConfig;
  return state.config || DEFAULT_CONFIG;
}

export function updateSyncConfig(config: Partial<SyncConfig>, contentRoot?: string): void {
  const state = loadSyncState(contentRoot) as SyncStateWithConfig;
  state.config = { ...(state.config || DEFAULT_CONFIG), ...config };
  saveSyncState(state, contentRoot);
}

/**
 * Save sync state to local file only (no bucket upload).
 */
function saveSyncStateLocal(state: SyncStateWithConfig, contentRoot?: string): void {
  try {
    const statePath = getSyncStatePath(contentRoot);
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    log.error({ err: error }, 'Error saving sync state locally:');
  }
}

export function loadSyncState(contentRoot?: string): SyncState {
  try {
    const statePath = getSyncStatePath(contentRoot);
    if (fs.existsSync(statePath)) {
      const content = fs.readFileSync(statePath, 'utf-8');
      const state = JSON.parse(content) as SyncStateWithConfig;
      
      const prunedFiles: Record<string, FileSyncInfo> = {};
      let pruned = false;
      for (const [filePath, info] of Object.entries(state.files)) {
        if (shouldTrackFile(filePath, undefined, contentRoot)) {
          prunedFiles[filePath] = info;
        } else {
          pruned = true;
        }
      }
      
      if (pruned) {
        state.files = prunedFiles;
        saveSyncStateLocal(state, contentRoot);
      }
      
      return state;
    }
  } catch (error) {
    log.error({ err: error }, 'Error loading sync state:');
  }
  return { ...DEFAULT_SYNC_STATE };
}

/**
 * Save sync state to local file AND to GCS bucket.
 */
export function saveSyncState(state: SyncState, contentRoot?: string): void {
  const stateWithConfig = state as SyncStateWithConfig;
  if (!stateWithConfig.config) {
    stateWithConfig.config = DEFAULT_CONFIG;
  }
  saveSyncStateLocal(stateWithConfig, contentRoot);
  saveSyncStateToBucket(stateWithConfig, contentRoot).catch(err => {
    log.error({ err: err }, '[SyncState] Background bucket save failed:');
  });
}

export interface ReuploadSyncStateResult {
  success: boolean;
  uploaded: boolean;
  gcsKey: string;
  reason?: string;
}

/** Force-upload local sync-state JSON to GCS immediately (admin Cloud Sync). */
export async function reuploadSyncStateToBucket(contentRoot?: string): Promise<ReuploadSyncStateResult> {
  const gcsKey = getGcsSyncStateKey(contentRoot);

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

  const statePath = getSyncStatePath(contentRoot);
  if (!fs.existsSync(statePath)) {
    return {
      success: false,
      uploaded: false,
      gcsKey,
      reason: "No local sync-state file found to upload.",
    };
  }

  const content = fs.readFileSync(statePath, "utf-8");
  await gcs.upload(gcsKey, Buffer.from(content, "utf-8"), "application/json");
  log.info({ gcsKey }, "[SyncState] Re-uploaded sync state to GCS via admin action");
  return { success: true, uploaded: true, gcsKey };
}

export function getSyncStateLocalPath(contentRoot?: string): string {
  return getSyncStatePath(contentRoot);
}

let autoCommitCallback: ((filePath: string, author?: string, allowedExceptions?: Set<string>) => void) | null = null;

/**
 * Register the auto-commit callback. Called once during server init.
 */
export function setAutoCommitCallback(cb: (filePath: string, author?: string, allowedExceptions?: Set<string>) => void): void {
  autoCommitCallback = cb;
}

export type FileModifiedEvent = {
  filePath: string;
  author?: string;
  actor?: EventActor;
  /** True when file bytes changed vs prior sync-state sha. */
  contentChanged?: boolean;
  /** New file body when the file still exists (listeners decide domain emits). */
  content?: string;
  /** MCP agent session correlation (ephemeral — not persisted in sync-state JSON). */
  agentSessionId?: string;
  /** MCP write report (ephemeral — stored on content_file_written payload). */
  report?: string;
};

const fileModifiedListeners: Set<(evt: FileModifiedEvent) => void> = new Set();

/**
 * Register a listener that fires whenever any content file is marked modified.
 */
export function addFileModifiedListener(cb: (evt: FileModifiedEvent) => void): void {
  fileModifiedListeners.add(cb);
}

function notifyFileModifiedListeners(
  relativePath: string,
  author?: string,
  actor?: EventActor,
  extras?: {
    contentChanged?: boolean;
    content?: string;
    agentSessionId?: string;
    report?: string;
  },
): void {
  const evt: FileModifiedEvent = {
    filePath: relativePath,
    author,
    actor,
    contentChanged: extras?.contentChanged,
    content: extras?.content,
    agentSessionId: extras?.agentSessionId,
    report: extras?.report,
  };
  fileModifiedListeners.forEach((cb) => cb(evt));
}

const syncStateDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSyncStates = new Map<string, SyncStateWithConfig>();

function syncStateKey(contentRoot?: string): string {
  return contentRoot || getDefaultContentRoot();
}

function scheduleDebouncedSaveSyncState(state: SyncState, contentRoot?: string): void {
  const key = syncStateKey(contentRoot);
  pendingSyncStates.set(key, state as SyncStateWithConfig);
  const existing = syncStateDebounceTimers.get(key);
  if (existing) clearTimeout(existing);
  syncStateDebounceTimers.set(
    key,
    setTimeout(() => {
      syncStateDebounceTimers.delete(key);
      const pending = pendingSyncStates.get(key);
      if (pending) {
        pendingSyncStates.delete(key);
        saveSyncState(pending, contentRoot);
      }
    }, 500),
  );
}

/** Flush debounced sync-state writes (shutdown + background job). */
export function flushPendingSyncStateWrites(contentRoot?: string): void {
  const key = syncStateKey(contentRoot);
  const timer = syncStateDebounceTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    syncStateDebounceTimers.delete(key);
  }
  const pending = pendingSyncStates.get(key);
  if (pending) {
    pendingSyncStates.delete(key);
    saveSyncState(pending, contentRoot);
  }
}

/** Flush all pending sync-state writes across sites. */
export function flushAllPendingSyncStateWrites(): void {
  for (const key of [...pendingSyncStates.keys()]) {
    flushPendingSyncStateWrites(key === getDefaultContentRoot() ? undefined : key);
  }
}


/**
 * Mark a file as modified (dirty) after an edit.
 * Tracks YAML and JSON files in 4geeks-com directory.
 * Also queues the file for auto-commit if enabled.
 * @param filePath - The file path to mark as modified
 * @param author - Optional author name who made the modification
 */
export function markFileAsModified(
  filePath: string,
  author?: string,
  allowedExceptions?: Set<string>,
  contentRoot?: string,
  actor?: EventActor,
  opts?: { agentSessionId?: string; report?: string },
): void {
  const writeCtx = getContentWriteContext();
  const effectiveActor = actor ?? writeCtx?.actor;
  const effectiveSessionId = opts?.agentSessionId ?? writeCtx?.agentSessionId;
  const effectiveReport = opts?.report ?? writeCtx?.report;
  const relativePath = normalizePath(filePath, contentRoot);
  
  if (!shouldTrackFile(relativePath, allowedExceptions, contentRoot)) {
    return;
  }
  
  const state = loadSyncState(contentRoot);
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), relativePath);
  
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const sha = computeFileSha(content);
    const stats = fs.statSync(fullPath);
    const prev = state.files[relativePath];
    const contentChanged = !prev || prev.sha !== sha;
    const now = new Date().toISOString();

    state.files[relativePath] = {
      sha,
      lastModified: stats.mtimeMs,
      remoteSha: prev?.remoteSha,
      author: author || prev?.author,
      // Content-hash gated: only bump modifiedAt when bytes change.
      modifiedAt: contentChanged ? now : (prev?.modifiedAt || prev?.committedAt || now),
      ...(prev?.committedAt ? { committedAt: prev.committedAt } : {}),
      ...(prev?.pulledFromCommit ? { pulledFromCommit: prev.pulledFromCommit } : {}),
    };
    
    scheduleDebouncedSaveSyncState(state, contentRoot);

    if (autoCommitCallback) {
      autoCommitCallback(relativePath, author, allowedExceptions);
    }
    notifyFileModifiedListeners(relativePath, author || prev?.author, effectiveActor, {
      contentChanged,
      content,
      agentSessionId: effectiveSessionId,
      report: effectiveReport,
    });
  } else if (state.files[relativePath]) {
    // File deleted / missing — do not invent a content-change timestamp from a touch.
    state.files[relativePath] = {
      ...state.files[relativePath],
      author: author || state.files[relativePath].author,
    };
    
    scheduleDebouncedSaveSyncState(state, contentRoot);

    if (autoCommitCallback) {
      autoCommitCallback(relativePath, author, allowedExceptions);
    }
    notifyFileModifiedListeners(relativePath, author || state.files[relativePath].author, effectiveActor, {
      agentSessionId: effectiveSessionId,
      report: effectiveReport,
    });
  } else if (allowedExceptions instanceof Set && allowedExceptions.has(relativePath)) {
    if (autoCommitCallback) {
      autoCommitCallback(relativePath, author, allowedExceptions);
    }
    notifyFileModifiedListeners(relativePath, author, effectiveActor, {
      agentSessionId: effectiveSessionId,
      report: effectiveReport,
    });
  }
}

/** List tracked content files under a site content root (same filters as the Commit Queue). */
export function getAllContentFiles(contentRoot?: string): string[] {
  const files: string[] = [];
  const scanDir = contentRoot
    ? (path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot))
    : getDefaultContentRoot();

  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) {
          walkDir(fullPath);
        }
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.yml' || ext === '.yaml' || ext === '.json' || ext === '.ts') {
          const relativePath = path.relative(process.cwd(), fullPath);
          if (shouldTrackFile(relativePath, undefined, contentRoot)) {
            files.push(relativePath);
          }
        }
      }
    }
  }
  
  walkDir(scanDir);
  return files;
}

function parseContentPath(filePath: string, contentRoot?: string): { contentType: string; slug: string } {
  const folder = getContentFolder(contentRoot);
  const withoutPrefix = filePath.startsWith(`${folder}/`) ? filePath.slice(folder.length + 1) : filePath;
  const parts = withoutPrefix.split('/');
  if (parts.length >= 2) {
    return {
      contentType: parts[0],
      slug: parts[1],
    };
  }
  return {
    contentType: 'config',
    slug: path.basename(filePath, path.extname(filePath)),
  };
}

export function detectPendingChanges(contentRoot?: string): PendingChange[] {
  const state = loadSyncState(contentRoot);
  const changesMap = new Map<string, PendingChange>();
  const currentFiles = getAllContentFiles(contentRoot);
  const processedFiles = new Set<string>();
  
  for (const filePath of currentFiles) {
    if (!shouldTrackFile(filePath, undefined, contentRoot)) {
      continue;
    }
    
    processedFiles.add(filePath);
    const fullPath = path.join(process.cwd(), filePath);
    
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const currentSha = computeFileSha(content);
      const storedInfo = state.files[filePath];
      
      const { contentType, slug } = parseContentPath(filePath, contentRoot);
      
      // Safety net: if the current content already matches the stored remoteSha,
      // the file is in sync with the remote — skip it regardless of stale local state.
      if (storedInfo?.remoteSha && storedInfo.remoteSha === currentSha) {
        continue;
      }

      if (!storedInfo || !storedInfo.remoteSha) {
        changesMap.set(filePath, {
          file: filePath,
          status: 'added',
          source: 'local',
          contentType,
          slug,
          localSha: currentSha,
          author: storedInfo?.author,
          date: storedInfo?.modifiedAt,
        });
      } else if (storedInfo.remoteSha !== currentSha) {
        changesMap.set(filePath, {
          file: filePath,
          status: 'modified',
          source: 'local',
          contentType,
          slug,
          localSha: currentSha,
          remoteSha: storedInfo.remoteSha,
          author: storedInfo.author,
          date: storedInfo.modifiedAt,
        });
      } else if (storedInfo.sha !== currentSha) {
        changesMap.set(filePath, {
          file: filePath,
          status: 'modified',
          source: 'local',
          contentType,
          slug,
          localSha: currentSha,
          remoteSha: storedInfo.remoteSha,
          author: storedInfo.author,
          date: storedInfo.modifiedAt,
        });
      }
    } catch (error) {
      log.error({ err: error }, `Error checking file ${filePath}:`);
    }
  }
  
  for (const [filePath, info] of Object.entries(state.files)) {
    if (!processedFiles.has(filePath) && shouldTrackFile(filePath, undefined, contentRoot) && info.remoteSha) {
      const { contentType, slug } = parseContentPath(filePath, contentRoot);
      changesMap.set(filePath, {
        file: filePath,
        status: 'deleted',
        source: 'local',
        contentType,
        slug,
        localSha: '',
        remoteSha: info.remoteSha,
        author: info.author,
        date: info.modifiedAt,
      });
    }
  }
  
  return Array.from(changesMap.values());
}

export function updateSyncStateAfterCommit(
  commitSha: string,
  committedFiles: string[],
  contentRoot?: string
): void {
  const state = loadSyncState(contentRoot);
  
  state.lastSyncedCommit = commitSha;
  state.lastSyncedAt = new Date().toISOString();

  const committedAt = new Date().toISOString();
  
  for (const filePath of committedFiles) {
    if (!shouldTrackFile(filePath, undefined, contentRoot)) {
      continue;
    }
    
    const fullPath = path.join(process.cwd(), filePath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const sha = computeFileSha(content);
      const stats = fs.statSync(fullPath);
      
      state.files[filePath] = {
        sha,
        lastModified: stats.mtimeMs,
        remoteSha: sha,
        committedAt,
      };
    } else {
      delete state.files[filePath];
    }
  }
  
  saveSyncState(state, contentRoot);
}

export function initializeSyncStateFromRemote(
  commitSha: string,
  remoteFiles: Array<{ path: string; sha: string }>,
  contentRoot?: string
): void {
  const existingState = loadSyncState(contentRoot) as SyncStateWithConfig;
  const state: SyncStateWithConfig = {
    config: existingState.config || DEFAULT_CONFIG,
    ...(existingState.webhook ? { webhook: existingState.webhook } : {}),
    lastSyncedCommit: commitSha,
    lastSyncedAt: new Date().toISOString(),
    files: {},
  };
  
  for (const file of remoteFiles) {
    if (!shouldTrackFile(file.path, undefined, contentRoot)) {
      continue;
    }
    
    const fullPath = path.join(process.cwd(), file.path);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const localSha = computeFileSha(content);
      const stats = fs.statSync(fullPath);
      
      state.files[file.path] = {
        sha: localSha,
        lastModified: stats.mtimeMs,
        remoteSha: file.sha,
      };
    }
  }
  
  saveSyncState(state, contentRoot);
}

/**
 * Rebuild sync state from on-disk files and advance lastSyncedCommit.
 *
 * @param opts.syncedRemotePaths - When provided (e.g. from a GitHub tree fetch during
 *   bootstrap), only those paths are marked as matching remote (`remoteSha = local sha`).
 *   Local-only paths get no remoteSha so they appear as "added" in the Commit Queue.
 *   When omitted, never invent remoteSha = sha; only preserve an existing remoteSha.
 */
export function rebuildSyncStateFromLocal(
  commitSha: string,
  contentRoot?: string,
  opts?: { syncedRemotePaths?: Iterable<string> },
): void {
  const currentFiles = getAllContentFiles(contentRoot);
  const existingState = loadSyncState(contentRoot) as SyncStateWithConfig;
  const remoteSet = opts?.syncedRemotePaths ? new Set(opts.syncedRemotePaths) : null;
  const state: SyncStateWithConfig = {
    config: existingState.config || DEFAULT_CONFIG,
    ...(existingState.webhook ? { webhook: existingState.webhook } : {}),
    lastSyncedCommit: commitSha,
    lastSyncedAt: new Date().toISOString(),
    files: {},
  };
  
  for (const filePath of currentFiles) {
    if (!shouldTrackFile(filePath, undefined, contentRoot)) {
      continue;
    }
    
    const fullPath = path.join(process.cwd(), filePath);
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const sha = computeFileSha(content);
      const stats = fs.statSync(fullPath);

      const existing = existingState.files[filePath];
      const hadLocalChanges = !!(existing?.remoteSha && existing.sha !== existing.remoteSha);

      let remoteSha: string | undefined;
      if (remoteSet) {
        if (remoteSet.has(filePath)) {
          // Confirmed on remote at this commit — local baseline matches unless still dirty.
          remoteSha = hadLocalChanges ? existing!.remoteSha : sha;
        } else {
          // Local-only — never claim it exists on GitHub.
          remoteSha = undefined;
        }
      } else if (hadLocalChanges) {
        remoteSha = existing!.remoteSha;
      } else if (existing?.remoteSha) {
        // Preserve last known remote sha; do NOT invent remoteSha = sha.
        remoteSha = existing.remoteSha;
      } else {
        remoteSha = undefined;
      }

      const keepLocalMeta = hadLocalChanges || remoteSha === undefined;
      const shaUnchanged = !!(existing && existing.sha === sha);

      state.files[filePath] = {
        sha,
        lastModified: stats.mtimeMs,
        ...(remoteSha !== undefined ? { remoteSha } : {}),
        ...(keepLocalMeta && existing?.author ? { author: existing.author } : {}),
        // Hash-gated content-changed time: keep when bytes unchanged.
        ...(shaUnchanged && existing?.modifiedAt
          ? { modifiedAt: existing.modifiedAt }
          : keepLocalMeta && existing?.modifiedAt
            ? { modifiedAt: existing.modifiedAt }
            : {}),
        // Always preserve committedAt and pulledFromCommit — these represent real GitHub
        // timestamps and must survive reconcile/rebuild cycles so sitemap lastmod stays accurate.
        ...(existing?.committedAt ? { committedAt: existing.committedAt } : {}),
        ...(existing?.pulledFromCommit ? { pulledFromCommit: existing.pulledFromCommit } : {}),
      };
    } catch (error) {
      log.error({ err: error }, `Error reading file ${filePath}:`);
    }
  }
  
  saveSyncState(state, contentRoot);
}

export function getLastSyncedCommit(contentRoot?: string): string | null {
  const state = loadSyncState(contentRoot);
  return state.lastSyncedCommit;
}

/**
 * Get the best available lastmod date for a file, for use in sitemaps / updated_at.
 * Priority: content-hash-gated modifiedAt > committedAt > today's date.
 * Prefer modifiedAt when present — it only advances when file SHA changes.
 */
export function getFileLastmod(filePath: string, contentRoot?: string): string {
  const relativePath = normalizePath(filePath, contentRoot);
  const state = loadSyncState(contentRoot);
  const info = state.files[relativePath];

  if (info?.modifiedAt) {
    return info.modifiedAt.split('T')[0];
  }

  if (info?.committedAt) {
    return info.committedAt.split('T')[0];
  }

  return new Date().toISOString().split('T')[0];
}

/**
 * Full ISO timestamp for content-hash-gated file changes (templates / lists).
 * Priority: modifiedAt > committedAt > today ISO.
 */
export function getFileUpdatedAtIso(filePath: string, contentRoot?: string): string {
  const relativePath = normalizePath(filePath, contentRoot);
  const state = loadSyncState(contentRoot);
  const info = state.files[relativePath];

  if (info?.modifiedAt) {
    return info.modifiedAt.includes('T') ? info.modifiedAt : `${info.modifiedAt}T00:00:00.000Z`;
  }

  if (info?.committedAt) {
    return info.committedAt.includes('T') ? info.committedAt : `${info.committedAt}T00:00:00.000Z`;
  }

  return new Date().toISOString();
}

export function getFileStatus(filePath: string, contentRoot?: string): {
  exists: boolean;
  localSha: string | null;
  remoteSha: string | null;
  hasConflict: boolean;
  status: 'synced' | 'modified' | 'added' | 'deleted' | 'conflict' | 'unknown';
} {
  const relativePath = normalizePath(filePath, contentRoot);
  
  if (!shouldTrackFile(relativePath, undefined, contentRoot)) {
    return { exists: false, localSha: null, remoteSha: null, hasConflict: false, status: 'unknown' };
  }
  
  const state = loadSyncState(contentRoot);
  const fullPath = path.join(process.cwd(), relativePath);
  const storedInfo = state.files[relativePath];
  
  if (!fs.existsSync(fullPath)) {
    if (storedInfo?.remoteSha) {
      return { exists: false, localSha: null, remoteSha: storedInfo.remoteSha, hasConflict: false, status: 'deleted' };
    }
    return { exists: false, localSha: null, remoteSha: null, hasConflict: false, status: 'unknown' };
  }
  
  const content = fs.readFileSync(fullPath, 'utf-8');
  const localSha = computeFileSha(content);
  const remoteSha = storedInfo?.remoteSha || null;
  
  if (!remoteSha) {
    return { exists: true, localSha, remoteSha: null, hasConflict: false, status: 'added' };
  }
  
  if (localSha === remoteSha) {
    return { exists: true, localSha, remoteSha, hasConflict: false, status: 'synced' };
  }
  
  return { exists: true, localSha, remoteSha, hasConflict: false, status: 'modified' };
}

export function updateFileAfterPull(filePath: string, pulledFromCommit?: string, committedAt?: string, contentRoot?: string): void {
  const relativePath = normalizePath(filePath, contentRoot);
  
  if (!shouldTrackFile(relativePath, undefined, contentRoot)) {
    return;
  }
  
  const state = loadSyncState(contentRoot);
  const fullPath = path.join(process.cwd(), relativePath);
  
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const sha = computeFileSha(content);
    const stats = fs.statSync(fullPath);
    const prev = state.files[relativePath];
    const contentChanged = !prev || prev.sha !== sha;
    const now = new Date().toISOString();

    state.files[relativePath] = {
      sha,
      lastModified: stats.mtimeMs,
      remoteSha: sha,
      pulledFromCommit,
      ...(committedAt ? { committedAt } : {}),
      // Hash-gated: identical pull content keeps previous content-changed time.
      modifiedAt: contentChanged
        ? (committedAt || now)
        : (prev?.modifiedAt || committedAt || prev?.committedAt || now),
    };
    
    saveSyncState(state, contentRoot);
  }
}

export function wasFilePulledFromCommit(filePath: string, commitSha: string, contentRoot?: string): boolean {
  const relativePath = normalizePath(filePath, contentRoot);
  const state = loadSyncState(contentRoot);
  const fileInfo = state.files[relativePath];
  
  if (!fileInfo || !fileInfo.pulledFromCommit) {
    return false;
  }
  
  return fileInfo.pulledFromCommit === commitSha;
}

export function updateFileAfterCommit(filePath: string, commitSha: string, contentRoot?: string): void {
  const relativePath = normalizePath(filePath, contentRoot);
  
  if (!shouldTrackFile(relativePath, undefined, contentRoot)) {
    return;
  }
  
  const state = loadSyncState(contentRoot);
  const fullPath = path.join(process.cwd(), relativePath);
  
  state.lastSyncedCommit = commitSha;
  state.lastSyncedAt = new Date().toISOString();
  
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const sha = computeFileSha(content);
    const stats = fs.statSync(fullPath);
    const prev = state.files[relativePath];
    const contentChanged = !prev || prev.sha !== sha;
    const now = new Date().toISOString();

    state.files[relativePath] = {
      sha,
      lastModified: stats.mtimeMs,
      remoteSha: sha,
      committedAt: now,
      modifiedAt: contentChanged ? now : (prev?.modifiedAt || prev?.committedAt || now),
    };
  } else {
    delete state.files[relativePath];
  }
  
  saveSyncState(state, contentRoot);
}

export function isFileSynced(filePath: string, contentRoot?: string): boolean {
  const relativePath = normalizePath(filePath, contentRoot);
  const state = loadSyncState(contentRoot);
  const fileInfo = state.files[relativePath];
  
  if (!fileInfo) {
    return false;
  }
  
  return fileInfo.sha === fileInfo.remoteSha;
}

export function discardLocalChanges(filePath: string, contentRoot?: string): boolean {
  const relativePath = normalizePath(filePath, contentRoot);
  
  if (!shouldTrackFile(relativePath, undefined, contentRoot)) {
    return false;
  }
  
  const state = loadSyncState(contentRoot);
  const fullPath = path.join(process.cwd(), relativePath);
  
  if (!fs.existsSync(fullPath)) {
    delete state.files[relativePath];
    saveSyncState(state, contentRoot);
    return true;
  }
  
  const content = fs.readFileSync(fullPath, 'utf-8');
  const sha = computeFileSha(content);
  const stats = fs.statSync(fullPath);
  
  state.files[relativePath] = {
    sha,
    lastModified: stats.mtimeMs,
    remoteSha: sha,
  };
  
  saveSyncState(state, contentRoot);
  return true;
}

export function removeFileFromState(filePath: string, contentRoot?: string): void {
  const relativePath = normalizePath(filePath, contentRoot);
  const state = loadSyncState(contentRoot);
  delete state.files[relativePath];
  saveSyncState(state, contentRoot);
}

export function getWebhookInfo(contentRoot?: string): WebhookInfo | undefined {
  const state = loadSyncState(contentRoot) as SyncStateWithConfig;
  return state.webhook;
}

export function setWebhookInfo(webhook: WebhookInfo, contentRoot?: string): void {
  const state = loadSyncState(contentRoot) as SyncStateWithConfig;
  state.webhook = webhook;
  saveSyncState(state, contentRoot);
}

export function clearWebhookInfo(contentRoot?: string): void {
  const state = loadSyncState(contentRoot) as SyncStateWithConfig;
  delete state.webhook;
  saveSyncState(state, contentRoot);
}
