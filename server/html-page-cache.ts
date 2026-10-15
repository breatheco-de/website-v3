/**
 * In-memory LRU of anonymous public HTML, keyed by build + site + path + variant.
 * Bodies are stored precompressed (brotli and gzip). A copy stays until this
 * build is replaced or something invalidates it. Freshness comes from
 * invalidation and background rebuilds, not from a clock.
 *
 * nginx in front must forward a response that already has Content-Encoding.
 * The live site answers brotli today from that proxy. ngx_brotli / gzip skip
 * bodies that are already encoded, which is what a hit relies on.
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import zlib from "zlib";
import { child } from "./logger";

const log = child({ module: "html-page-cache" });

const DEFAULT_BYTE_BUDGET = 150 * 1024 * 1024;
/** A save that is still showing the previous HTML after this long is deleted. */
export const HTML_REBUILD_TOO_SLOW_MS = 8_000;

export interface CachedHtmlPage {
  status: number;
  storedAt: number;
  expiresAt: number;
  /** Generation written into this copy. */
  generation: number;
  /** Generation a rebuild was asked to produce, if newer than `generation`. */
  pendingGeneration: number;
  pendingSince: number;
  /** A single-page save deletes this copy if the rebuild is still pending too long. */
  pendingDeleteIfSlow: boolean;
  br: Buffer;
  gzip: Buffer;
  byteLength: number;
  html: string;
}

type Stored = Omit<CachedHtmlPage, "html"> & { html?: string };

const cache = new Map<string, Stored>();
let byteBudget = DEFAULT_BYTE_BUDGET;
let usedBytes = 0;
let nowFn = () => Date.now();
let buildId = resolveHtmlBuildId();
const inflight = new Map<string, Promise<unknown>>();
const generations = new Map<string, number>();
/** Why the last miss for this key found nothing usable. Read by the rendered warning. */
const diskMissReason = new Map<string, string>();

function resolveHtmlBuildId(): string {
  const fromEnv = process.env.HTML_CACHE_BUILD_ID?.trim();
  if (fromEnv) return fromEnv;
  try {
    const real = fs.realpathSync(process.cwd());
    const base = path.basename(real);
    if (/^[0-9a-f]{7,40}$/i.test(base)) return base;
  } catch {
    /* cwd may be unavailable */
  }
  return "dev";
}

export function getHtmlBuildId(): string {
  return buildId;
}

export function setHtmlBuildIdForTests(id: string): void {
  buildId = id;
}

export function setHtmlCacheClockForTests(fn: () => number): void {
  nowFn = fn;
}

/** Drop the in-memory copy and keep the file, so a test can reload it. */
export function dropHtmlCacheMemoryForTests(): void {
  cache.clear();
  usedBytes = 0;
}

export function setHtmlCacheBudgetForTests(bytes: number): void {
  byteBudget = bytes;
}

export function resetHtmlPageCacheForTests(): void {
  cache.clear();
  usedBytes = 0;
  inflight.clear();
  generations.clear();
  diskMissReason.clear();
  byteBudget = DEFAULT_BYTE_BUDGET;
  nowFn = () => Date.now();
  buildId = resolveHtmlBuildId();
}

function cacheRootDir(): string {
  if (process.env.VITEST) {
    return path.join(os.tmpdir(), `website-v3-html-cache-${process.pid}`);
  }
  return path.resolve("data", "html-page-cache");
}

function diskPathForKey(key: string): string {
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  return path.join(cacheRootDir(), buildId, `${hash}.json`);
}

export type HtmlCachePathIndex = {
  resolveUrl(url: string): {
    contentType: string;
    slug: string;
    patternLocale?: string;
  } | null;
  getAlternateUrls(slug: string, contentType: string): Record<string, string>;
};

/**
 * Cache key path for a public request. Folder names and per-locale slugs can
 * both resolve the same entry; the stored copy is the locale's public URL
 * (the one in the sitemap). Unknown paths stay as requested.
 */
export function canonicalHtmlCachePath(
  pathname: string,
  ci: HtmlCachePathIndex | null | undefined,
): string {
  const clean = pathname.split("?")[0].split("#")[0] || "/";
  if (!ci) return clean;
  let resolved: ReturnType<HtmlCachePathIndex["resolveUrl"]>;
  try {
    resolved = ci.resolveUrl(clean);
  } catch {
    return clean;
  }
  if (!resolved) return clean;
  const locale =
    resolved.patternLocale && resolved.patternLocale !== "default"
      ? resolved.patternLocale
      : clean === "/es" || clean.startsWith("/es/")
        ? "es"
        : "en";
  let urls: Record<string, string>;
  try {
    urls = ci.getAlternateUrls(resolved.slug, resolved.contentType) || {};
  } catch {
    return clean;
  }
  const canonical = urls[locale];
  if (!canonical || !canonical.startsWith("/")) return clean;
  return canonical.split("?")[0].split("#")[0] || clean;
}

export function buildHtmlCacheKey(
  siteId: string,
  pathname: string,
  variantKey: string = "live",
): string {
  const clean = pathname.split("?")[0].split("#")[0] || "/";
  const variant = variantKey && variantKey !== "default" ? variantKey : "live";
  return `${buildId}::${siteId}::${clean}::${variant}`;
}

export function parseHtmlCacheKey(key: string): {
  siteId: string;
  pathname: string;
  variantKey: string;
} | null {
  const parts = key.split("::");
  if (parts.length < 4) return null;
  if (parts[0] !== buildId) return null;
  const variantKey = parts[parts.length - 1] || "live";
  const siteId = parts[1] || "default";
  const pathname = parts.slice(2, -1).join("::") || "/";
  return { siteId, pathname, variantKey };
}

function touch(key: string, entry: Stored): void {
  cache.delete(key);
  cache.set(key, entry);
}

function dropMemory(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  usedBytes -= entry.byteLength;
  cache.delete(key);
}

function forgetDisk(key: string): void {
  try {
    fs.rmSync(diskPathForKey(key), { force: true });
  } catch {
    /* missing file is fine */
  }
}

/** Drop the in-memory copy and its disk handoff so a later read cannot restore it. */
function dropKey(key: string): void {
  dropMemory(key);
  forgetDisk(key);
}

function evictUntilBudget(): void {
  while (usedBytes > byteBudget && cache.size > 0) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const parsed = parseHtmlCacheKey(oldest);
    const pathname = parsed?.pathname ?? oldest;
    const budgetMb = Math.max(1, Math.round(byteBudget / (1024 * 1024)));
    log.warn(
      { pathname, variantKey: parsed?.variantKey, siteId: parsed?.siteId, buildId },
      `HTML cache dropped ${pathname}: over ${budgetMb}MB budget`,
    );
    dropKey(oldest);
  }
}

function decorate(entry: Stored): CachedHtmlPage {
  let decoded = entry.html;
  const page = entry as CachedHtmlPage;
  Object.defineProperty(page, "html", {
    configurable: true,
    enumerable: true,
    get() {
      if (decoded === undefined) decoded = zlib.gunzipSync(entry.gzip).toString("utf8");
      return decoded;
    },
  });
  return page;
}

export function htmlLooksPersonalized(html: string): boolean {
  if (/name=["']csrf/i.test(html)) return true;
  if (/\bnonce=["'][A-Za-z0-9+/=_-]{8,}["']/.test(html)) return true;
  if (/4g_user_id=/.test(html)) return true;
  if (/\bcsrfToken["']?\s*[:=]/i.test(html)) return true;
  return false;
}

export function getCachedHtml(key: string): CachedHtmlPage | null {
  const pending = cache.get(key);
  if (!pending || pending.pendingGeneration > pending.generation) {
    adoptDiskIfNewer(key);
  }
  const entry = cache.get(key);
  if (!entry) {
    rememberDiskMiss(key, inspectHtmlCacheDisk(key));
    return null;
  }
  if (
    entry.pendingDeleteIfSlow &&
    entry.pendingGeneration > entry.generation &&
    entry.pendingSince > 0 &&
    nowFn() - entry.pendingSince >= HTML_REBUILD_TOO_SLOW_MS
  ) {
    const parsed = parseHtmlCacheKey(key);
    const pathname = parsed?.pathname ?? key;
    log.warn(
      { pathname, variantKey: parsed?.variantKey, siteId: parsed?.siteId },
      `HTML cache dropped ${pathname}: rebuild still pending after 8s`,
    );
    rememberDiskMiss(key, "dropped, rebuild still pending after 8s");
    dropKey(key);
    return null;
  }
  touch(key, entry);
  return decorate(entry);
}

export function noteHtmlRebuildPending(
  key: string,
  generation: number,
  deleteIfSlow = false,
): void {
  const entry = cache.get(key);
  if (!entry) return;
  entry.pendingGeneration = generation;
  entry.pendingSince = nowFn();
  entry.pendingDeleteIfSlow = deleteIfSlow;
}

export function htmlRebuildInFlight(key: string): boolean {
  const entry = cache.get(key);
  if (!entry) return false;
  return entry.pendingGeneration > entry.generation;
}

export function currentHtmlGeneration(key: string): number {
  return generations.get(key) ?? cache.get(key)?.generation ?? 0;
}

export function bumpHtmlGeneration(key: string): number {
  const next = currentHtmlGeneration(key) + 1;
  generations.set(key, next);
  return next;
}

export function setCachedHtml(
  key: string,
  html: string,
  status: number,
  opts?: { generation?: number },
): void {
  if (htmlLooksPersonalized(html)) {
    log.warn({ key }, "refusing to cache HTML that looks per-visitor");
    return;
  }
  const generation = opts?.generation ?? currentHtmlGeneration(key);
  if (generation < (generations.get(key) ?? 0)) return;

  const raw = Buffer.from(html, "utf8");
  const gzip = zlib.gzipSync(raw, { level: 6 });
  const br = zlib.brotliCompressSync(raw, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
  });
  const byteLength = gzip.length + br.length;
  const storedAt = nowFn();
  const next: Stored = {
    status,
    storedAt,
    expiresAt: Number.MAX_SAFE_INTEGER,
    generation,
    pendingGeneration: generation,
    pendingSince: 0,
    pendingDeleteIfSlow: false,
    br,
    gzip,
    byteLength,
    html,
  };
  dropMemory(key);
  cache.set(key, next);
  usedBytes += byteLength;
  generations.set(key, Math.max(generations.get(key) ?? 0, generation));
  evictUntilBudget();
  persistEntry(key, next);
}

function persistEntry(key: string, entry: Stored): void {
  const existing = readDiskEntry(key);
  if (existing && existing.generation > entry.generation) return;
  const file = diskPathForKey(key);
  const payload = JSON.stringify({
    v: 1,
    buildId,
    key,
    status: entry.status,
    storedAt: entry.storedAt,
    expiresAt: entry.expiresAt,
    generation: entry.generation,
    br: entry.br.toString("base64"),
    gzip: entry.gzip.toString("base64"),
  });
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, file);
  } catch (err) {
    log.warn({ err, key }, "html cache disk write failed");
  }
}

function rememberDiskMiss(key: string, reason: string): void {
  diskMissReason.set(key, reason);
  if (diskMissReason.size <= 500) return;
  const first = diskMissReason.keys().next().value;
  if (first) diskMissReason.delete(first);
}

/** Why this key has no usable copy. The rendered warning puts this in the message. */
export function htmlCacheDiskReason(key: string): string {
  return diskMissReason.get(key) ?? inspectHtmlCacheDisk(key);
}

function inspectHtmlCacheDisk(key: string): string {
  let raw: string;
  try {
    raw = fs.readFileSync(diskPathForKey(key), "utf8");
  } catch {
    return "no file";
  }
  let parsed: {
    buildId?: string;
    key?: string;
    expiresAt?: number;
    generation?: number;
    br?: string;
    gzip?: string;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return "disk rejected unreadable";
  }
  if (parsed.buildId !== buildId) return `disk rejected wrong build ${parsed.buildId ?? "unknown"}`;
  if (parsed.key !== key) return "disk rejected key mismatch";
  if (!parsed.gzip || !parsed.br) return "disk rejected unreadable";
  if ((parsed.generation ?? 0) < (generations.get(key) ?? 0)) return "disk rejected older generation";
  return "on disk but not loaded";
}

function readDiskEntry(key: string): Stored | null {
  try {
    const raw = fs.readFileSync(diskPathForKey(key), "utf8");
    const parsed = JSON.parse(raw) as {
      buildId?: string;
      key?: string;
      status?: number;
      storedAt?: number;
      expiresAt?: number;
      generation?: number;
      br?: string;
      gzip?: string;
    };
    if (parsed.buildId !== buildId || parsed.key !== key) return null;
    if (!parsed.gzip || !parsed.br) return null;
    const gzip = Buffer.from(parsed.gzip, "base64");
    const br = Buffer.from(parsed.br, "base64");
    const generation = parsed.generation ?? 0;
    if (generation < (generations.get(key) ?? 0)) return null;
    return {
      status: parsed.status ?? 200,
      storedAt: parsed.storedAt ?? nowFn(),
      expiresAt: parsed.expiresAt ?? Number.MAX_SAFE_INTEGER,
      generation,
      pendingGeneration: generation,
      pendingSince: 0,
      pendingDeleteIfSlow: false,
      br,
      gzip,
      byteLength: gzip.length + br.length,
    };
  } catch {
    return null;
  }
}

export type HotHtmlPageSnapshot = {
  pathname: string;
  variantKey: string;
  generation: number;
};

/** Pages already in memory for this site. The worker never sees this Map. */
export function snapshotHotHtmlPages(siteId: string): HotHtmlPageSnapshot[] {
  const out: HotHtmlPageSnapshot[] = [];
  for (const key of cache.keys()) {
    const parsed = parseHtmlCacheKey(key);
    if (!parsed || parsed.siteId !== siteId) continue;
    out.push({
      pathname: parsed.pathname,
      variantKey: parsed.variantKey,
      generation: currentHtmlGeneration(key),
    });
  }
  return out;
}

/** Load worker-written files into this process. A newer generation replaces the object in memory. */
export function adoptHtmlCacheKeys(keys: string[]): number {
  let adopted = 0;
  for (const key of keys) {
    if (typeof key !== "string" || !key) continue;
    const before = cache.get(key)?.generation ?? -1;
    adoptDiskIfNewer(key);
    const after = cache.get(key)?.generation ?? -1;
    if (after !== before) adopted += 1;
  }
  return adopted;
}

function adoptDiskIfNewer(key: string): void {
  const disk = readDiskEntry(key);
  if (!disk) return;
  const memory = cache.get(key);
  if (memory && disk.generation <= memory.generation) return;
  if (memory) dropMemory(key);
  cache.set(key, disk);
  usedBytes += disk.byteLength;
  generations.set(key, Math.max(generations.get(key) ?? 0, disk.generation));
  evictUntilBudget();
}

export function rehydrateHtmlPageCache(): number {
  const dir = path.join(cacheRootDir(), buildId);
  let loaded = 0;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  const files = names
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as {
          key?: string;
          storedAt?: number;
        };
        return parsed;
      } catch {
        return null;
      }
    })
    .filter((row): row is { key?: string; storedAt?: number } => !!row?.key)
    .sort((a, b) => (b.storedAt ?? 0) - (a.storedAt ?? 0));

  for (const parsed of files) {
    if (!parsed.key) continue;
    const entry = readDiskEntry(parsed.key);
    if (!entry) continue;
    if (cache.has(parsed.key)) continue;
    if (usedBytes + entry.byteLength > byteBudget) continue;
    cache.set(parsed.key, entry);
    usedBytes += entry.byteLength;
    loaded += 1;
  }
  evictUntilBudget();
  return loaded;
}

export function invalidateHtmlPageCache(): void {
  cache.clear();
  usedBytes = 0;
  try {
    fs.rmSync(path.join(cacheRootDir(), buildId), { recursive: true, force: true });
  } catch {
    /* empty dir is fine */
  }
}

export function invalidateHtmlPageCacheKey(key: string): void {
  dropKey(key);
}

export function invalidateHtmlPageCacheForPath(siteId: string, pathname: string): void {
  const clean = pathname.split("?")[0].split("#")[0] || "/";
  const marker = `::${siteId}::${clean}::`;
  for (const key of listStoredHtmlCacheKeys(siteId)) {
    if (key.includes(marker)) dropKey(key);
  }
}

/** A database row change drops cached pages for that slug, not every page of the type. */
export function invalidateHtmlPageCacheForSlug(siteId: string, slug: string): void {
  const clean = slug.trim().replace(/^\/+|\/+$/g, "");
  if (!clean || clean.length < 2) return;
  const needle = `/${clean}`;
  for (const key of [...cache.keys()]) {
    const parsed = parseHtmlCacheKey(key);
    if (!parsed || parsed.siteId !== siteId) continue;
    const pathName = parsed.pathname;
    if (
      pathName === needle ||
      pathName.endsWith(needle) ||
      pathName.includes(`${needle}/`)
    ) {
      dropKey(key);
    }
  }
}

export function listHotHtmlCacheKeys(): string[] {
  return [...cache.keys()];
}

/**
 * Memory keys plus disk handoffs for this build. Disk files are read for the
 * `key` field only. Pass a site id to skip other sites.
 */
export function listStoredHtmlCacheKeys(siteId?: string): string[] {
  const keys = new Set<string>(cache.keys());
  const dir = path.join(cacheRootDir(), buildId);
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    names = [];
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as { key?: string };
      if (typeof parsed.key === "string" && parsed.key) keys.add(parsed.key);
    } catch {
      /* unreadable handoff */
    }
  }
  const out: string[] = [];
  for (const key of keys) {
    const parsed = parseHtmlCacheKey(key);
    if (!parsed) continue;
    if (siteId && parsed.siteId !== siteId) continue;
    out.push(key);
  }
  return out;
}

export function htmlPageCacheSize(): number {
  return cache.size;
}

export function htmlPageCacheBytes(): number {
  return usedBytes;
}

export async function singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/**
 * Edit URLs are not the public document. The editor shows hidden sections and
 * leaves variables unsubstituted, so the stored copy must not be served or
 * rendered. The catch-all sends the same empty client shell as /private/preview.
 */
export function isEditDocumentRequest(url: string | undefined): boolean {
  const raw = url || "";
  const withoutHash = raw.split("#")[0] || "";
  const query = withoutHash.includes("?") ? withoutHash.slice(withoutHash.indexOf("?") + 1) : "";
  if (!query) return false;
  const params = new URLSearchParams(query);
  return params.get("edit") === "1" || params.get("edit_mode") === "true";
}

export type HtmlRenderSkipReason = "not_read" | "cache_false" | "other_site" | "authorization";

type HtmlCacheRequest = {
  method?: string;
  headers: Record<string, unknown> | { get?(name: string): string | undefined; cookie?: string; authorization?: string };
  originalUrl?: string;
  url?: string;
};

/**
 * Why this request must build a fresh public document instead of reading the stored copy.
 * Edit URLs are not a reason: they use the client shell and never render.
 * Null means the stored copy may be served.
 */
export function htmlRenderSkipReason(req: HtmlCacheRequest): HtmlRenderSkipReason | null {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return "not_read";

  const url = req.originalUrl || req.url || "";
  if (/[?&]cache=false(?:&|#|$)/i.test(url)) return "cache_false";
  if (url.includes("__site=")) return "other_site";

  const headers = req.headers as {
    get?(name: string): string | undefined;
    authorization?: string | string[];
  };
  const authRaw =
    typeof headers.get === "function"
      ? headers.get("authorization")
      : Array.isArray(headers.authorization)
        ? headers.authorization[0]
        : headers.authorization;
  if (authRaw) return "authorization";

  return null;
}

/** Skip the stored copy and render a fresh public document. Edit URLs are not included: they use the client shell. */
export function shouldBypassHtmlCache(req: HtmlCacheRequest): boolean {
  return htmlRenderSkipReason(req) != null;
}

const QUERY_PARAM_ALLOW = new Set([
  "force_variant",
  "raw",
  "cache",
  "edit",
  "edit_mode",
  "__site",
]);

export function containsParamPlaceholder(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (typeof value === "string") return value.includes("{{ param.");
  if (Array.isArray(value)) return value.some((item) => containsParamPlaceholder(item, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) =>
      containsParamPlaceholder(item, depth + 1),
    );
  }
  return false;
}

const PARAM_NAME = /\{\{\s*param\.([a-zA-Z_][a-zA-Z0-9_]*)/g;

/** Names used as `{{ param.X }}` in the page, before they are filled in. */
export function collectParamPlaceholderNames(value: unknown, depth = 0, into = new Set<string>()): string[] {
  if (depth > 12 || value == null) return [...into];
  if (typeof value === "string") {
    PARAM_NAME.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PARAM_NAME.exec(value))) into.add(match[1]);
    return [...into];
  }
  if (Array.isArray(value)) {
    for (const item of value) collectParamPlaceholderNames(item, depth + 1, into);
    return [...into];
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectParamPlaceholderNames(item, depth + 1, into);
    }
  }
  return [...into];
}

function queryKeys(url: string): string[] {
  const q = url.split("?")[1]?.split("#")[0];
  if (!q) return [];
  const keys: string[] = [];
  for (const part of q.split("&")) {
    const key = decodeURIComponent(part.split("=")[0] || "");
    if (key) keys.push(key);
  }
  return keys;
}

/**
 * True when this URL fills a `{{ param.X }}` that the page actually uses.
 * `?utm_source` and `?plan` do not, unless the page template names them.
 */
export function requestBakesQueryParamTemplate(
  url: string,
  source: unknown,
  pathParamKeys?: Iterable<string>,
): boolean {
  const names = new Set(collectParamPlaceholderNames(source));
  if (names.size === 0) return false;
  const pathKeys = new Set(pathParamKeys ? [...pathParamKeys] : []);
  for (const key of queryKeys(url)) {
    if (QUERY_PARAM_ALLOW.has(key) || pathKeys.has(key)) continue;
    if (names.has(key)) return true;
  }
  return false;
}

/** True when the URL has a query key that might be written into the page. `?edit=1` alone does not. */
export function urlHasContentQuery(url: string): boolean {
  return queryKeys(url).some((key) => !QUERY_PARAM_ALLOW.has(key));
}

export function pickCachedEncoding(acceptEncoding: string | undefined): "br" | "gzip" | "identity" {
  const header = acceptEncoding || "";
  const br = /(?:^|,)\s*br\s*(?:;q=([0-9.]+))?(?:$|,)/i.exec(header);
  const gzip = /(?:^|,)\s*gzip\s*(?:;q=([0-9.]+))?(?:$|,)/i.exec(header);
  const brQ = br ? (br[1] === undefined ? 1 : Number(br[1])) : 0;
  const gzipQ = gzip ? (gzip[1] === undefined ? 1 : Number(gzip[1])) : 0;
  if (brQ > 0 && brQ >= gzipQ) return "br";
  if (gzipQ > 0) return "gzip";
  return "identity";
}

export function htmlDocumentCacheControl(): string {
  if (process.env.NODE_ENV !== "production") return "no-store";
  return "public, max-age=60, stale-while-revalidate=300";
}

export function logHtmlRender(fields: {
  url: string;
  ms: number;
  cache: "HIT" | "MISS" | "STALE";
}): void {
  log.info(fields, "html-render");
}

/** Generation stored on disk for this key. The worker uses it so a rewrite is newer. */
export function htmlDiskGeneration(key: string): number {
  return readDiskEntry(key)?.generation ?? 0;
}

/** Sidequest finished writing HTML files. Ask this process to load them into the map it serves. */
export async function notifyHtmlCacheAdopted(keys: string[], dropKeys: string[] = []): Promise<void> {
  const unique = [...new Set(keys.filter((key) => typeof key === "string" && key.length > 0))];
  const drop = [...new Set(dropKeys.filter((key) => typeof key === "string" && key.length > 0))];
  if (unique.length === 0 && drop.length === 0) return;
  if (process.env.VITEST) {
    for (const key of drop) invalidateHtmlPageCacheKey(key);
    if (unique.length > 0) adoptHtmlCacheKeys(unique);
    return;
  }
  const secret = process.env.SESSION_SECRET || "";
  if (!secret) {
    log.warn({ keys: unique.length }, "html cache adopt skipped: SESSION_SECRET is empty");
    return;
  }
  const port = process.env.PORT || "5000";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/internal/html-cache/adopt`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ keys: unique, dropKeys: drop }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn({ status: res.status, keys: unique.length }, "html cache adopt call failed");
    }
  } catch (err) {
    log.warn({ err, keys: unique.length }, "html cache adopt call failed");
  } finally {
    clearTimeout(timer);
  }
}
