/**
 * Derived outbound relation-pointer index per entry (contentType/slug).
 * Coalesced pending ops + optional GCS persistence — mirrors link-index.
 */

import * as fs from "fs";
import * as path from "path";
import { getDefaultContentRoot } from "./site-config";
import { siteSyncGcsKey, SYNC_FILENAMES, relationIndexReadKeys } from "@shared/gcsKeys";
import { gcs } from "./gcs";
import { child } from "./logger";

const log = child({ module: "relation-index" });

export const RELATION_INDEX_FILENAME = "relation-index.json";
const PENDING_FILENAME = "relation-index-pending.json";
const DEBOUNCE_MS = 800;

export type RelationIndex = {
  version: 1;
  updated_at: string;
  /** Source entry key (contentType/slug) → target keys (source/pointerSlug) */
  outbound: Record<string, string[]>;
};

type PendingOp =
  | { op: "set"; entryKey: string; targets: string[] }
  | { op: "remove"; entryKey: string }
  | { op: "strip_target"; targetKey: string };

type PendingFile = { ops: PendingOp[] };

function absRoot(contentRoot?: string): string {
  return contentRoot
    ? path.isAbsolute(contentRoot)
      ? contentRoot
      : path.join(process.cwd(), contentRoot)
    : getDefaultContentRoot();
}

function indexPath(contentRoot?: string): string {
  return path.join(absRoot(contentRoot), RELATION_INDEX_FILENAME);
}

function pendingPath(contentRoot?: string): string {
  return path.join(absRoot(contentRoot), ".cache", PENDING_FILENAME);
}

function siteNameFromContentRoot(contentRoot?: string): string {
  return path.basename(absRoot(contentRoot));
}

let cache: { root: string; data: RelationIndex } | null = null;
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const flushLocks = new Set<string>();
let gcsHydratedRoots = new Set<string>();

function emptyIndex(): RelationIndex {
  return { version: 1, updated_at: new Date().toISOString(), outbound: {} };
}

function ensureCacheDir(contentRoot?: string): void {
  fs.mkdirSync(path.join(absRoot(contentRoot), ".cache"), { recursive: true });
}

function readPending(contentRoot?: string): PendingFile {
  const fp = pendingPath(contentRoot);
  if (!fs.existsSync(fp)) return { ops: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf-8")) as PendingFile;
    if (!parsed || !Array.isArray(parsed.ops)) return { ops: [] };
    return parsed;
  } catch {
    return { ops: [] };
  }
}

function writePending(contentRoot: string | undefined, data: PendingFile): void {
  ensureCacheDir(contentRoot);
  fs.writeFileSync(pendingPath(contentRoot), JSON.stringify(data), "utf-8");
}

function appendPendingOp(contentRoot: string | undefined, op: PendingOp): void {
  const pending = readPending(contentRoot);
  pending.ops.push(op);
  writePending(contentRoot, pending);
}

function clearPending(contentRoot?: string): void {
  const fp = pendingPath(contentRoot);
  if (fs.existsSync(fp)) {
    try {
      fs.unlinkSync(fp);
    } catch {
      /* non-fatal */
    }
  }
}

function applyPendingOps(data: RelationIndex, ops: PendingOp[]): RelationIndex {
  const outbound = { ...data.outbound };
  for (const op of ops) {
    if (op.op === "set") {
      if (op.targets.length === 0) {
        delete outbound[op.entryKey];
      } else {
        outbound[op.entryKey] = [...new Set(op.targets)].sort();
      }
    } else if (op.op === "remove") {
      delete outbound[op.entryKey];
    } else if (op.op === "strip_target") {
      for (const [key, targets] of Object.entries(outbound)) {
        const next = targets.filter((t) => t !== op.targetKey);
        if (next.length === 0) delete outbound[key];
        else outbound[key] = next;
      }
    }
  }
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    outbound,
  };
}

async function uploadToGcs(contentRoot: string | undefined, body: string): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  if (!gcs.available) gcs.initBootstrapFromEnv();
  if (!gcs.available) return;
  const site = siteNameFromContentRoot(contentRoot);
  const key = siteSyncGcsKey(site, SYNC_FILENAMES.relationIndex);
  try {
    await gcs.upload(key, Buffer.from(body, "utf-8"), "application/json");
  } catch (err) {
    log.warn({ err, key }, "[RelationIndex] GCS upload failed");
  }
}

async function hydrateFromGcsIfNeeded(contentRoot?: string): Promise<void> {
  const root = absRoot(contentRoot);
  if (gcsHydratedRoots.has(root)) return;
  gcsHydratedRoots.add(root);

  if (process.env.NODE_ENV !== "production") return;
  if (fs.existsSync(indexPath(contentRoot))) return;

  if (!gcs.available) gcs.initBootstrapFromEnv();
  if (!gcs.available) return;

  const site = siteNameFromContentRoot(contentRoot);
  try {
    const result = await gcs.downloadFirstExisting(relationIndexReadKeys(site));
    if (!result) return;
    ensureCacheDir(contentRoot);
    fs.writeFileSync(indexPath(contentRoot), result.data.toString("utf-8"), "utf-8");
    cache = null;
    log.info({ site, key: result.key }, "[RelationIndex] Hydrated from GCS");
  } catch (err) {
    log.warn({ err, site }, "[RelationIndex] GCS hydrate failed");
  }
}

export async function loadRelationIndexesFromBucket(
  sites: Array<{ contentRoot?: string }>,
): Promise<void> {
  await Promise.all(sites.map((s) => hydrateFromGcsIfNeeded(s.contentRoot)));
}

/** True when relation-index.json exists on disk (fail-closed for bulk delete). */
export function isRelationIndexReady(contentRoot?: string): boolean {
  return fs.existsSync(indexPath(contentRoot));
}

export function getRelationIndexStatus(contentRoot?: string): {
  ready: boolean;
  updated_at: string | null;
  reason?: "missing" | "corrupt";
} {
  const fp = indexPath(contentRoot);
  if (!fs.existsSync(fp)) {
    return { ready: false, updated_at: null, reason: "missing" };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf-8")) as RelationIndex;
    if (!parsed || parsed.version !== 1 || typeof parsed.outbound !== "object") {
      return { ready: false, updated_at: null, reason: "corrupt" };
    }
    return { ready: true, updated_at: parsed.updated_at ?? null };
  } catch {
    return { ready: false, updated_at: null, reason: "corrupt" };
  }
}

export function loadRelationIndex(contentRoot?: string): RelationIndex {
  void hydrateFromGcsIfNeeded(contentRoot);
  const root = absRoot(contentRoot);
  if (cache && cache.root === root) return cache.data;
  const fp = indexPath(contentRoot);
  if (!fs.existsSync(fp)) {
    const data = emptyIndex();
    cache = { root, data };
    return data;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf-8")) as RelationIndex;
    if (!parsed || parsed.version !== 1 || typeof parsed.outbound !== "object") {
      const data = emptyIndex();
      cache = { root, data };
      return data;
    }
    cache = { root, data: parsed };
    return parsed;
  } catch {
    const data = emptyIndex();
    cache = { root, data };
    return data;
  }
}

export function saveRelationIndex(data: RelationIndex, contentRoot?: string): void {
  const root = absRoot(contentRoot);
  data.updated_at = new Date().toISOString();
  ensureCacheDir(contentRoot);
  const body = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(indexPath(contentRoot), body, "utf-8");
  cache = { root, data };
  void uploadToGcs(contentRoot, body);
}

export function invalidateRelationIndexCache(): void {
  cache = null;
  gcsHydratedRoots = new Set();
}

export function getRelationIndexOutbound(
  entryKey: string,
  contentRoot?: string,
): string[] | null {
  const row = loadRelationIndex(contentRoot).outbound[entryKey];
  return Array.isArray(row) ? row : null;
}

export function queueRelationIndexSet(
  entryKey: string,
  targets: string[],
  contentRoot?: string,
): void {
  appendPendingOp(contentRoot, { op: "set", entryKey, targets: [...targets] });
  scheduleRelationIndexFlush(contentRoot);
}

export function queueRelationIndexRemove(
  entryKeys: string | string[],
  contentRoot?: string,
): void {
  const keys = Array.isArray(entryKeys) ? entryKeys : [entryKeys];
  for (const entryKey of keys) {
    appendPendingOp(contentRoot, { op: "remove", entryKey });
  }
  scheduleRelationIndexFlush(contentRoot);
}

/** Remove a target key from every outbound row (after target entry deleted). */
export function queueRelationIndexStripTarget(
  targetKey: string,
  contentRoot?: string,
): void {
  appendPendingOp(contentRoot, { op: "strip_target", targetKey });
  scheduleRelationIndexFlush(contentRoot);
}

export function scheduleRelationIndexFlush(contentRoot?: string): void {
  const root = absRoot(contentRoot);
  const existing = flushTimers.get(root);
  if (existing) clearTimeout(existing);
  flushTimers.set(
    root,
    setTimeout(() => {
      flushTimers.delete(root);
      void flushRelationIndexPending(contentRoot);
    }, DEBOUNCE_MS),
  );
}

export async function flushRelationIndexPending(contentRoot?: string): Promise<boolean> {
  const root = absRoot(contentRoot);
  if (flushLocks.has(root)) return false;
  flushLocks.add(root);
  try {
    const pending = readPending(contentRoot);
    if (pending.ops.length === 0) return false;
    const data = applyPendingOps(loadRelationIndex(contentRoot), pending.ops);
    saveRelationIndex(data, contentRoot);
    clearPending(contentRoot);
    return true;
  } finally {
    flushLocks.delete(root);
  }
}

export function flushRelationIndexPendingSync(contentRoot?: string): boolean {
  const root = absRoot(contentRoot);
  if (flushLocks.has(root)) return false;
  flushLocks.add(root);
  try {
    const pending = readPending(contentRoot);
    if (pending.ops.length === 0) return false;
    const data = applyPendingOps(loadRelationIndex(contentRoot), pending.ops);
    saveRelationIndex(data, contentRoot);
    clearPending(contentRoot);
    return true;
  } finally {
    flushLocks.delete(root);
  }
}

export function rebuildRelationIndex(
  outboundByEntry: Record<string, string[]>,
  contentRoot?: string,
): RelationIndex {
  const root = absRoot(contentRoot);
  const timer = flushTimers.get(root);
  if (timer) {
    clearTimeout(timer);
    flushTimers.delete(root);
  }
  clearPending(contentRoot);
  const data: RelationIndex = {
    version: 1,
    updated_at: new Date().toISOString(),
    outbound: {},
  };
  for (const [id, targets] of Object.entries(outboundByEntry)) {
    if (targets.length === 0) continue;
    data.outbound[id] = [...new Set(targets)].sort();
  }
  saveRelationIndex(data, contentRoot);
  return data;
}

export function invertRelationIndex(
  outbound: Record<string, string[]>,
): Map<string, string[]> {
  const dependents = new Map<string, string[]>();
  for (const [entryKey, targets] of Object.entries(outbound)) {
    for (const target of targets) {
      const list = dependents.get(target) ?? [];
      if (!list.includes(entryKey)) list.push(entryKey);
      dependents.set(target, list);
    }
  }
  for (const [k, v] of dependents) {
    dependents.set(k, v.sort());
  }
  return dependents;
}

export function getDependentsForTarget(
  targetType: string,
  targetSlug: string,
  contentRoot?: string,
  opts?: { limit?: number },
): {
  count: number;
  dependents: string[];
  updatedAt: string | null;
  ready: boolean;
} {
  const status = getRelationIndexStatus(contentRoot);
  if (!status.ready) {
    return { count: 0, dependents: [], updatedAt: null, ready: false };
  }
  const index = loadRelationIndex(contentRoot);
  const inverted = invertRelationIndex(index.outbound);
  const key = `${targetType}/${targetSlug}`;
  const keys = inverted.get(key) ?? [];
  const limit = opts?.limit ?? 50;
  return {
    count: keys.length,
    dependents: keys.slice(0, limit),
    updatedAt: index.updated_at ?? null,
    ready: true,
  };
}

/** Immediate set + flush (tests / sync callers). */
export function patchRelationIndexOutbound(
  entryKey: string,
  targets: string[],
  contentRoot?: string,
): void {
  queueRelationIndexSet(entryKey, targets, contentRoot);
  flushRelationIndexPendingSync(contentRoot);
}

export function _resetRelationIndexStateForTests(): void {
  invalidateRelationIndexCache();
  flushTimers.clear();
  flushLocks.clear();
}
