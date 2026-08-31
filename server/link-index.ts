/**
 * Derived outbound internal-link index per entry id.
 * Coalesced pending ops + optional GCS persistence in production.
 */

import * as fs from "fs";
import * as path from "path";
import { getDefaultContentRoot } from "./site-config";
import { siteSyncGcsKey, SYNC_FILENAMES, linkIndexReadKeys } from "@shared/gcsKeys";
import { gcs } from "./gcs";
import { child } from "./logger";

const log = child({ module: "link-index" });

export const LINK_INDEX_FILENAME = "link-index.json";
const PENDING_FILENAME = "link-index-pending.json";
const DEBOUNCE_MS = 800;

export type LinkIndex = {
  version: 1;
  updated_at: string;
  outbound: Record<string, string[]>;
};

type PendingOp =
  | { op: "set"; entryKey: string; paths: string[] }
  | { op: "remove"; entryKey: string };

type PendingFile = { ops: PendingOp[] };

function absRoot(contentRoot?: string): string {
  return contentRoot
    ? path.isAbsolute(contentRoot)
      ? contentRoot
      : path.join(process.cwd(), contentRoot)
    : getDefaultContentRoot();
}

function indexPath(contentRoot?: string): string {
  return path.join(absRoot(contentRoot), LINK_INDEX_FILENAME);
}

function pendingPath(contentRoot?: string): string {
  return path.join(absRoot(contentRoot), ".cache", PENDING_FILENAME);
}

function siteNameFromContentRoot(contentRoot?: string): string {
  const root = absRoot(contentRoot);
  return path.basename(root);
}

let cache: { root: string; data: LinkIndex } | null = null;
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const flushLocks = new Set<string>();
let gcsHydratedRoots = new Set<string>();

function emptyIndex(): LinkIndex {
  return { version: 1, updated_at: new Date().toISOString(), outbound: {} };
}

function ensureCacheDir(contentRoot?: string): void {
  const dir = path.join(absRoot(contentRoot), ".cache");
  fs.mkdirSync(dir, { recursive: true });
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

function applyPendingOps(data: LinkIndex, ops: PendingOp[]): LinkIndex {
  const outbound = { ...data.outbound };
  for (const op of ops) {
    if (op.op === "set") {
      if (op.paths.length === 0) {
        delete outbound[op.entryKey];
      } else {
        outbound[op.entryKey] = [...new Set(op.paths)].sort();
      }
    } else {
      delete outbound[op.entryKey];
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
  if (!gcs.available) {
    gcs.initBootstrapFromEnv();
  }
  if (!gcs.available) return;
  const site = siteNameFromContentRoot(contentRoot);
  const key = siteSyncGcsKey(site, SYNC_FILENAMES.linkIndex);
  try {
    await gcs.upload(key, Buffer.from(body, "utf-8"), "application/json");
  } catch (err) {
    log.warn({ err, key }, "[LinkIndex] GCS upload failed");
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
    const result = await gcs.downloadFirstExisting(linkIndexReadKeys(site));
    if (!result) return;
    ensureCacheDir(contentRoot);
    fs.writeFileSync(indexPath(contentRoot), result.data.toString("utf-8"), "utf-8");
    cache = null;
    log.info({ site, key: result.key }, "[LinkIndex] Hydrated from GCS");
  } catch (err) {
    log.warn({ err, site }, "[LinkIndex] GCS hydrate failed");
  }
}

/** Boot-time GCS hydrate for all sites (mirror validation cache). */
export async function loadLinkIndexesFromBucket(
  sites: Array<{ contentRoot?: string }>,
): Promise<void> {
  await Promise.all(sites.map((s) => hydrateFromGcsIfNeeded(s.contentRoot)));
}

export function loadLinkIndex(contentRoot?: string): LinkIndex {
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
    const parsed = JSON.parse(fs.readFileSync(fp, "utf-8")) as LinkIndex;
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

export function saveLinkIndex(data: LinkIndex, contentRoot?: string): void {
  const root = absRoot(contentRoot);
  data.updated_at = new Date().toISOString();
  ensureCacheDir(contentRoot);
  const body = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(indexPath(contentRoot), body, "utf-8");
  cache = { root, data };
  void uploadToGcs(contentRoot, body);
}

export function invalidateLinkIndexCache(): void {
  cache = null;
  gcsHydratedRoots = new Set();
}

export function getLinkIndexOutbound(entryId: string, contentRoot?: string): string[] | null {
  const row = loadLinkIndex(contentRoot).outbound[entryId];
  return Array.isArray(row) ? row : null;
}

/** @deprecated Prefer queueLinkIndexSet — kept for tests */
export function patchLinkIndexOutbound(
  entryId: string,
  outbound: string[],
  contentRoot?: string,
): void {
  queueLinkIndexSet(entryId, outbound, contentRoot);
  flushLinkIndexPendingSync(contentRoot);
}

export function queueLinkIndexSet(
  entryKey: string,
  paths: string[],
  contentRoot?: string,
): void {
  appendPendingOp(contentRoot, { op: "set", entryKey, paths: [...paths] });
  scheduleLinkIndexFlush(contentRoot);
}

export function queueLinkIndexRemove(
  entryKeys: string | string[],
  contentRoot?: string,
): void {
  const keys = Array.isArray(entryKeys) ? entryKeys : [entryKeys];
  for (const entryKey of keys) {
    appendPendingOp(contentRoot, { op: "remove", entryKey });
  }
  scheduleLinkIndexFlush(contentRoot);
}

export function scheduleLinkIndexFlush(contentRoot?: string): void {
  const root = absRoot(contentRoot);
  const existing = flushTimers.get(root);
  if (existing) clearTimeout(existing);
  flushTimers.set(
    root,
    setTimeout(() => {
      flushTimers.delete(root);
      void flushLinkIndexPending(contentRoot);
    }, DEBOUNCE_MS),
  );
}

export async function flushLinkIndexPending(contentRoot?: string): Promise<boolean> {
  const root = absRoot(contentRoot);
  if (flushLocks.has(root)) return false;
  flushLocks.add(root);
  try {
    const pending = readPending(contentRoot);
    if (pending.ops.length === 0) return false;
    const data = applyPendingOps(loadLinkIndex(contentRoot), pending.ops);
    saveLinkIndex(data, contentRoot);
    clearPending(contentRoot);
    return true;
  } finally {
    flushLocks.delete(root);
  }
}

export function flushLinkIndexPendingSync(contentRoot?: string): boolean {
  const root = absRoot(contentRoot);
  if (flushLocks.has(root)) return false;
  flushLocks.add(root);
  try {
    const pending = readPending(contentRoot);
    if (pending.ops.length === 0) return false;
    const data = applyPendingOps(loadLinkIndex(contentRoot), pending.ops);
    saveLinkIndex(data, contentRoot);
    clearPending(contentRoot);
    return true;
  } finally {
    flushLocks.delete(root);
  }
}

/** Rebuild outbound map from a full crawl result; clears pending ops. */
export function rebuildLinkIndex(
  outboundByEntry: Record<string, string[]>,
  contentRoot?: string,
): LinkIndex {
  const root = absRoot(contentRoot);
  const timer = flushTimers.get(root);
  if (timer) {
    clearTimeout(timer);
    flushTimers.delete(root);
  }
  clearPending(contentRoot);
  const data: LinkIndex = {
    version: 1,
    updated_at: new Date().toISOString(),
    outbound: {},
  };
  for (const [id, paths] of Object.entries(outboundByEntry)) {
    if (paths.length === 0) continue;
    data.outbound[id] = [...new Set(paths)].sort();
  }
  saveLinkIndex(data, contentRoot);
  return data;
}

export function invertLinkIndex(
  outbound: Record<string, string[]>,
): Map<string, string[]> {
  const referrers = new Map<string, string[]>();
  for (const [entryKey, targets] of Object.entries(outbound)) {
    for (const target of targets) {
      const norm = normalizeReferrerTargetPath(target);
      const list = referrers.get(norm) ?? [];
      if (!list.includes(entryKey)) list.push(entryKey);
      referrers.set(norm, list);
    }
  }
  for (const [k, v] of referrers) {
    referrers.set(k, v.sort());
  }
  return referrers;
}

export function normalizeReferrerTargetPath(pathOrUrl: string): string {
  let p = pathOrUrl.trim();
  if (!p.startsWith("/")) {
    try {
      p = new URL(p, "https://example.com").pathname;
    } catch {
      p = `/${p}`;
    }
  }
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

export type LinkReferrer = {
  entryKey: string;
  url?: string;
  title?: string;
};

export function getReferrersForTargetPath(
  targetPath: string,
  contentRoot?: string,
  opts?: { limit?: number },
): {
  count: number;
  referrers: LinkReferrer[];
  updatedAt: string | null;
} {
  const index = loadLinkIndex(contentRoot);
  const inverted = invertLinkIndex(index.outbound);
  const norm = normalizeReferrerTargetPath(targetPath);
  const keys = inverted.get(norm) ?? [];
  const limit = opts?.limit ?? 50;
  return {
    count: keys.length,
    referrers: keys.slice(0, limit).map((entryKey) => ({ entryKey })),
    updatedAt: index.updated_at ?? null,
  };
}

/** Derive entry keys from deleted site-relative YAML paths. */
export function entryKeysFromDeletedPaths(deletedPaths: string[]): string[] {
  const keys = new Set<string>();
  for (const raw of deletedPaths) {
    const norm = raw.replace(/\\/g, "/");
    const m = norm.match(
      /\/([^/]+)\/([^/]+)\/([^/]+)\.(?:ya?ml)$/i,
    );
    if (!m) continue;
    const folder = m[1]!.toLowerCase();
    const slug = m[2]!;
    const base = m[3]!.replace(/\.ya?ml$/i, "");
    if (base === "_common") continue;
    const typeMap: Record<string, string> = {
      programs: "program",
      landings: "landing",
      locations: "location",
      pages: "page",
      blog: "blog",
      workshops: "workshop",
      events: "event",
      courses: "course",
    };
    const contentType = typeMap[folder] ?? folder.replace(/s$/, "");
    let locale = base;
    if (base.startsWith("template.") || base.startsWith("single.")) {
    const rest = base.startsWith("template.") ? base.slice("template.".length) : base.slice("single.".length);
    locale = rest.split(".")[0] || locale;
  }
    else if (base.includes(".")) locale = base.split(".").pop() || base;
    if (locale.includes(".") || locale.startsWith("draft")) continue;
    keys.add(`${contentType}/${slug}/${locale}`);
  }
  return [...keys];
}

export function _resetLinkIndexStateForTests(): void {
  invalidateLinkIndexCache();
  flushTimers.clear();
  flushLocks.clear();
}
