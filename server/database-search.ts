/**
 * Shared database semantic/keyword search with L1 memory + L2 GCS cache.
 * Used by /api/databases/:name/search, FAQ dynamic_entries.search, and future callers.
 */
import { createHash } from "crypto";
import { siteDbSearchCacheKey, siteDbSearchCachePrefix } from "@shared/gcsKeys";
import { databaseManager, type DatabaseManager } from "./database";
import { getJobState, setJobState } from "./db-job-state";
import { gcs } from "./gcs";
import { child } from "./logger";
import { getDefaultContentFolder } from "./site-config";

const log = child({ module: "database-search" });

/** Always search/cache at this ceiling; callers slice. */
export const SEARCH_CACHE_CEILING = 100;

/** Ignore cached entries older than this (reindex also invalidates). */
export const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SearchFallbackReason =
  | "vector_store_unavailable"
  | "semantic_index_empty";

export interface DatabaseSearchResult {
  items: Record<string, unknown>[];
  count: number;
  semantic: boolean;
  scores?: Record<string, number>;
  fallback_reason?: SearchFallbackReason;
  fallback_message?: string;
  /** Whether this response was served from L1 or L2 cache. */
  cache?: "memory" | "gcs" | "miss";
}

interface CacheRef {
  slug: string;
  /** Row key from the site-scoped collection (vectorItemKey). */
  key?: string;
  /** Row position; legacy (bare-name) collections only. */
  _idx?: number;
  score: number;
}

type ItemKeyFn = (item: Record<string, unknown>, fields: string[]) => string;
type ItemKeyMap = Map<string, Record<string, unknown>>;

interface CachePayload {
  writtenAt: string;
  semantic: true;
  refs: CacheRef[];
}

interface MemoryEntry {
  writtenAt: number;
  payload: CachePayload;
}

const memoryCache = new Map<string, MemoryEntry>();

export function normalizeSearchQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function cacheKey(dbName: string, normalizedQ: string, locale?: string): string {
  return `${dbName}|${locale ?? ""}|${normalizedQ}|${SEARCH_CACHE_CEILING}`;
}

function queryHash(normalizedQ: string, locale?: string): string {
  return createHash("sha256")
    .update(`${locale ?? ""}|${normalizedQ}|${SEARCH_CACHE_CEILING}`)
    .digest("hex")
    .slice(0, 40);
}

function isExpired(writtenAtMs: number): boolean {
  return Date.now() - writtenAtMs > SEARCH_CACHE_TTL_MS;
}

const keyMapMemo = new Map<string, { sig: string; map: ItemKeyMap }>();

/** Row key → item, rebuilt only when the database copy or the embedded fields change. */
export function getItemKeyMap(
  memoKey: string,
  fetchedAt: string,
  items: Record<string, unknown>[],
  fields: string[],
  keyFn: ItemKeyFn,
): ItemKeyMap {
  const sig = `${fetchedAt}|${items.length}|${fields.join(",")}`;
  const hit = keyMapMemo.get(memoKey);
  if (hit && hit.sig === sig) return hit.map;
  const map: ItemKeyMap = new Map();
  for (const item of items) {
    const k = keyFn(item, fields);
    if (!map.has(k)) map.set(k, item);
  }
  keyMapMemo.set(memoKey, { sig, map });
  return map;
}

function resolveLegacyRef(
  ref: { slug: string; _idx?: number },
  allItems: Record<string, unknown>[],
): Record<string, unknown> | undefined {
  if (ref._idx !== undefined && ref._idx >= 0 && ref._idx < allItems.length) {
    const candidate = allItems[ref._idx];
    const candidateSlug = String(candidate.slug ?? candidate.id ?? "");
    // Slugless rows were stored with their position as `slug`.
    if (candidateSlug === ref.slug || !ref.slug || !candidateSlug) {
      return candidate;
    }
  }
  return allItems.find((i) => String(i.slug ?? i.id ?? "") === ref.slug);
}

/** Resolve hits/refs to items: by key when present, else legacy `_idx`/slug. Drops duplicates. */
export function resolveRefs(
  refs: CacheRef[],
  allItems: Record<string, unknown>[],
  getKeyMap?: () => ItemKeyMap | null,
): { items: Record<string, unknown>[]; scores: Record<string, number>; refs: CacheRef[] } {
  const items: Record<string, unknown>[] = [];
  const scores: Record<string, number> = {};
  const kept: CacheRef[] = [];
  const seen = new Set<Record<string, unknown>>();
  let keyMap: ItemKeyMap | null | undefined;
  for (const ref of refs) {
    let item: Record<string, unknown> | undefined;
    if (ref.key) {
      if (keyMap === undefined) keyMap = getKeyMap?.() ?? null;
      item = keyMap?.get(ref.key);
    } else {
      item = resolveLegacyRef(ref, allItems);
    }
    if (!item || seen.has(item)) continue;
    seen.add(item);
    items.push(item);
    kept.push(ref);
    scores[String(item.slug ?? item.id ?? items.length - 1)] = ref.score;
  }
  return { items, scores, refs: kept };
}

/** Per database: the newest index `changedAt` already applied to L1 in this process. */
const appliedChangedAt = new Map<string, number>();

/** The worker re-embedded rows: drop L1 entries written before that (other processes cannot reach this cache). */
function dropStaleMemory(dbName: string, changedAtMs: number): void {
  if (!Number.isFinite(changedAtMs) || changedAtMs <= 0) return;
  if ((appliedChangedAt.get(dbName) ?? 0) >= changedAtMs) return;
  appliedChangedAt.set(dbName, changedAtMs);
  for (const [key, entry] of memoryCache.entries()) {
    if (key.startsWith(`${dbName}|`) && entry.writtenAt < changedAtMs) memoryCache.delete(key);
  }
}

async function readGcsCache(
  dbName: string,
  normalizedQ: string,
  locale: string | undefined,
  contentFolder: string,
): Promise<CachePayload | null> {
  if (!gcs.available) return null;
  const key = siteDbSearchCacheKey(
    contentFolder,
    dbName,
    queryHash(normalizedQ, locale),
  );
  try {
    const buf = await gcs.download(key);
    if (!buf) return null;
    const payload = JSON.parse(buf.toString("utf8")) as CachePayload;
    if (!payload?.writtenAt || !Array.isArray(payload.refs) || !payload.semantic) {
      return null;
    }
    if (isExpired(Date.parse(payload.writtenAt))) return null;
    return payload;
  } catch (err) {
    log.warn({ err, dbName }, "[database-search] GCS read failed");
    return null;
  }
}

async function writeGcsCache(
  dbName: string,
  normalizedQ: string,
  locale: string | undefined,
  contentFolder: string,
  payload: CachePayload,
): Promise<void> {
  if (!gcs.available) return;
  const key = siteDbSearchCacheKey(
    contentFolder,
    dbName,
    queryHash(normalizedQ, locale),
  );
  try {
    await gcs.upload(
      key,
      Buffer.from(JSON.stringify(payload), "utf8"),
      "application/json",
      { cacheControl: "private, max-age=0" },
    );
  } catch (err) {
    // 2A: keep L1; log; do not throw
    log.warn({ err, dbName, key }, "[database-search] GCS write failed");
  }
}

function writeMemory(key: string, payload: CachePayload): void {
  memoryCache.set(key, {
    writtenAt: Date.parse(payload.writtenAt) || Date.now(),
    payload,
  });
}

export function getDatabaseSearchCacheStats(dbName: string): {
  memoryEntries: number;
  lastWrittenAt: string | null;
} {
  let memoryEntries = 0;
  let lastWrittenAtMs = 0;
  for (const [key, entry] of memoryCache.entries()) {
    if (!key.startsWith(`${dbName}|`)) continue;
    if (isExpired(entry.writtenAt)) continue;
    memoryEntries++;
    if (entry.writtenAt > lastWrittenAtMs) lastWrittenAtMs = entry.writtenAt;
  }
  return {
    memoryEntries,
    lastWrittenAt: lastWrittenAtMs > 0 ? new Date(lastWrittenAtMs).toISOString() : null,
  };
}

/** On-demand GCS listing — do not call from polled job-status. */
export async function countDatabaseSearchCacheGcs(
  dbName: string,
  contentFolder: string = getDefaultContentFolder(),
): Promise<number> {
  if (!gcs.available) return 0;
  const prefix = siteDbSearchCachePrefix(contentFolder, dbName);
  try {
    const keys = await gcs.list(prefix);
    return keys.filter((k) => k.endsWith(".json") && !k.endsWith("/")).length;
  } catch (err) {
    log.warn({ err, dbName }, "[database-search] GCS list failed");
    return 0;
  }
}

export async function invalidateDatabaseSearchCache(
  dbName: string,
  contentFolder: string = getDefaultContentFolder(),
): Promise<void> {
  for (const key of [...memoryCache.keys()]) {
    if (key.startsWith(`${dbName}|`)) memoryCache.delete(key);
  }
  if (!gcs.available) return;
  const prefix = siteDbSearchCachePrefix(contentFolder, dbName);
  try {
    const keys = await gcs.list(prefix);
    await Promise.all(keys.map((k) => gcs.delete(k)));
    log.info({ dbName, cleared: keys.length }, "[database-search] Cache invalidated");
  } catch (err) {
    log.warn({ err, dbName }, "[database-search] GCS invalidate failed");
  }
}

export interface SearchDatabaseItemsOptions {
  /** Requested slice size (after cache ceiling search). Default 20, max 100. */
  limit?: number;
  locale?: string;
  db?: DatabaseManager;
  contentFolder?: string;
  /** Override keyword fallback fields (e.g. from listing search.fields). */
  keywordFields?: string[];
}

/**
 * Semantic search when enabled; keyword fallback otherwise.
 * Always fetches up to SEARCH_CACHE_CEILING, caches semantic hits, then slices to limit.
 */
export async function searchDatabaseItems(
  dbName: string,
  q: string,
  options: SearchDatabaseItemsOptions = {},
): Promise<DatabaseSearchResult> {
  const normalizedQ = normalizeSearchQuery(q);
  if (!normalizedQ) {
    return { items: [], count: 0, semantic: false, cache: "miss" };
  }

  const limit = Math.min(
    Math.max(1, options.limit ?? 20),
    SEARCH_CACHE_CEILING,
  );
  const locale = options.locale;
  const dbm = options.db ?? databaseManager;
  const contentFolder = options.contentFolder ?? getDefaultContentFolder();
  const memKey = cacheKey(dbName, normalizedQ, locale);

  const config = dbm.get(dbName);
  const vsConfig = (config as { vector_search?: { enabled?: boolean; fields?: string[] } })
    .vector_search;
  const vectorEnabled =
    vsConfig?.enabled === true &&
    Array.isArray(vsConfig.fields) &&
    vsConfig.fields.length > 0;

  const cacheResult = await dbm.fetchItems(dbName);
  const allItems = cacheResult.items;

  const contentRoot = typeof dbm.getContentRoot === "function" ? dbm.getContentRoot() : undefined;
  const indexState = getJobState(dbName, contentRoot).index;
  const changedAtMs = indexState.changedAt ? Date.parse(indexState.changedAt) : 0;
  dropStaleMemory(dbName, changedAtMs);

  const vector = vectorEnabled ? await import("./vector-search") : null;
  const fields = vsConfig?.fields ?? [];
  const keyMapFor = (): ItemKeyMap | null =>
    vector && fields.length > 0
      ? getItemKeyMap(
          `${contentRoot ?? contentFolder}|${dbName}`,
          cacheResult.fetched_at,
          allItems,
          fields,
          vector.vectorItemKey,
        )
      : null;

  const mem = memoryCache.get(memKey);
  if (mem && !isExpired(mem.writtenAt)) {
    const { items, scores } = resolveRefs(mem.payload.refs, allItems, keyMapFor);
    const sliced = items.slice(0, limit);
    return {
      items: sliced,
      count: sliced.length,
      semantic: true,
      scores,
      cache: "memory",
    };
  }

  const gcsRaw = await readGcsCache(dbName, normalizedQ, locale, contentFolder);
  const gcsPayload =
    gcsRaw && !(changedAtMs > 0 && Date.parse(gcsRaw.writtenAt) < changedAtMs) ? gcsRaw : null;
  if (gcsPayload) {
    writeMemory(memKey, gcsPayload);
    const { items, scores } = resolveRefs(gcsPayload.refs, allItems, keyMapFor);
    const sliced = items.slice(0, limit);
    return {
      items: sliced,
      count: sliced.length,
      semantic: true,
      scores,
      cache: "gcs",
    };
  }

  let fallbackReason: SearchFallbackReason | undefined;
  let fallbackMessage: string | undefined;

  if (vector) {
    const available = await vector.isAvailable();
    const queueSync = () => {
      if (typeof dbm.queueVectorIndex === "function") void dbm.queueVectorIndex(dbName, "missing_collection");
    };

    if (!available) {
      fallbackReason = "vector_store_unavailable";
      fallbackMessage =
        'Vector store (Qdrant) is unreachable. Search fell back to exact keyword matching — related words like "certificate" / "certification" will not match unless the exact substring appears.';
    } else {
      // A partially built site-scoped collection is never searched: until the
      // first sync finishes, use the legacy collection or keyword matching.
      const siteCollection = vector.siteCollectionName(contentRoot ?? contentFolder, dbName);
      const siteReady = indexState.ready === true && indexState.collection === siteCollection;
      let collection: string | null = siteReady ? siteCollection : null;
      if (!siteReady) {
        queueSync();
        const legacy = vector.legacyCollectionName(dbName);
        if (await vector.collectionExists(legacy).catch(() => false)) collection = legacy;
      }

      const response = collection
        ? await vector.search(collection, normalizedQ, SEARCH_CACHE_CEILING, locale)
        : { hits: [], missingCollection: true };
      if (response.missingCollection && siteReady) {
        setJobState(dbName, "index", { ready: false }, contentRoot);
        queueSync();
      }
      const searchResults = response.hits;

      if (searchResults.length > 0) {
        const orderedWithScores: Array<{
          item: Record<string, unknown>;
          score: number;
          ref: CacheRef;
        }> = [];
        const resolved = resolveRefs(
          searchResults.map((r) => ({
            slug: r.slug,
            score: r.score,
            ...(collection === siteCollection && r.key ? { key: r.key } : { _idx: r._idx }),
          })),
          allItems,
          keyMapFor,
        );
        resolved.items.forEach((item, i) => {
          if (locale) {
            const itemLocale = String(item.locale ?? item.language ?? item.lang ?? "");
            if (itemLocale.toLowerCase() !== locale.toLowerCase()) return;
          }
          const ref = resolved.refs[i];
          orderedWithScores.push({ item, score: ref.score, ref });
        });

        if (orderedWithScores.length > 0) {
          const payload: CachePayload = {
            writtenAt: new Date().toISOString(),
            semantic: true,
            refs: orderedWithScores.map((o) => o.ref),
          };
          writeMemory(memKey, payload);
          await writeGcsCache(dbName, normalizedQ, locale, contentFolder, payload);

          const sliced = orderedWithScores.slice(0, limit);
          return {
            items: sliced.map((o) => o.item),
            count: orderedWithScores.length,
            semantic: true,
            scores: Object.fromEntries(
              sliced.map((o, i) => [
                String(o.item.slug ?? o.item.id ?? i),
                o.score,
              ]),
            ),
            cache: "miss",
          };
        }
      }

      fallbackReason = "semantic_index_empty";
      fallbackMessage = collection
        ? "Semantic index returned no results (collection may be empty). A background re-index is queued when it is missing. Until then, search uses exact keyword matching only."
        : "Semantic index is being built in the background. Until it finishes, search uses exact keyword matching only.";
    }
  }

  // Keyword fallback — do not cache (5B)
  const qLower = normalizedQ;
  const searchFieldsConfig = (config as { search_fields?: string[] }).search_fields;
  const keywordFields = options.keywordFields?.length
    ? options.keywordFields
    : searchFieldsConfig?.length
      ? searchFieldsConfig
      : vsConfig?.fields?.length
        ? vsConfig.fields
        : null;
  let fallback = allItems.filter((item) => {
    const fieldsToCheck = keywordFields ?? Object.keys(item);
    return fieldsToCheck.some((f) => {
      const val = item[f];
      if (val === null || val === undefined) return false;
      if (typeof val === "object") return JSON.stringify(val).toLowerCase().includes(qLower);
      return String(val).toLowerCase().includes(qLower);
    });
  });

  if (locale) {
    fallback = fallback.filter((item) => {
      const itemLocale = String(item.locale ?? item.language ?? item.lang ?? "");
      return itemLocale.toLowerCase() === locale.toLowerCase();
    });
  }

  const sliced = fallback.slice(0, limit);
  return {
    items: sliced,
    count: fallback.length,
    semantic: false,
    cache: "miss",
    ...(fallbackReason && {
      fallback_reason: fallbackReason,
      fallback_message: fallbackMessage,
    }),
  };
}

/** Sync L1 peek for resolveFaqItems — returns refs order or null. */
export function peekDatabaseSearchCacheL1(
  dbName: string,
  q: string,
  locale?: string,
): CacheRef[] | null {
  const normalizedQ = normalizeSearchQuery(q);
  if (!normalizedQ) return null;
  const mem = memoryCache.get(cacheKey(dbName, normalizedQ, locale));
  if (!mem || isExpired(mem.writtenAt) || !mem.payload.semantic) return null;
  return mem.payload.refs;
}

/** Test helper — clears L1 only. */
export function clearDatabaseSearchMemoryCacheForTests(): void {
  memoryCache.clear();
  keyMapMemo.clear();
  appliedChangedAt.clear();
}

/**
 * Intersect ranked search hits with filter-only pool, then backfill (1B) to fill slots.
 * Preserves search rank; appends remaining filter-only items not already selected.
 */
export function intersectSearchWithFiltersAndBackfill(
  searchHits: Record<string, unknown>[],
  filterOnlyItems: Record<string, unknown>[],
  remainingSlots: number,
  itemIdentity: (item: Record<string, unknown>) => string = defaultItemIdentity,
): Record<string, unknown>[] {
  if (remainingSlots <= 0) return [];
  const selected: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const item of searchHits) {
    if (selected.length >= remainingSlots) break;
    const id = itemIdentity(item);
    if (seen.has(id)) continue;
    seen.add(id);
    selected.push(item);
  }

  if (selected.length < remainingSlots) {
    for (const item of filterOnlyItems) {
      if (selected.length >= remainingSlots) break;
      const id = itemIdentity(item);
      if (seen.has(id)) continue;
      seen.add(id);
      selected.push(item);
    }
  }

  return selected;
}

function defaultItemIdentity(item: Record<string, unknown>): string {
  const slug = item.slug ?? item.id;
  if (slug !== undefined && slug !== null && String(slug).length > 0) {
    return `slug:${String(slug)}`;
  }
  const q = String(item.question ?? "");
  return `q:${q.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "-").slice(0, 80)}`;
}
