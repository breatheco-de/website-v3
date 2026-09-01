/**
 * Shared database semantic/keyword search with L1 memory + L2 GCS cache.
 * Used by /api/databases/:name/search, FAQ dynamic_entries.search, and future callers.
 */
import { createHash } from "crypto";
import { siteDbSearchCacheKey, siteDbSearchCachePrefix } from "@shared/gcsKeys";
import { databaseManager, type DatabaseManager } from "./database";
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
  _idx?: number;
  score: number;
}

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

function resolveRefs(
  refs: CacheRef[],
  allItems: Record<string, unknown>[],
): { items: Record<string, unknown>[]; scores: Record<string, number> } {
  const items: Record<string, unknown>[] = [];
  const scores: Record<string, number> = {};
  for (const ref of refs) {
    let item: Record<string, unknown> | undefined;
    if (ref._idx !== undefined && ref._idx >= 0 && ref._idx < allItems.length) {
      const candidate = allItems[ref._idx];
      if (String(candidate.slug ?? candidate.id ?? "") === ref.slug || !ref.slug) {
        item = candidate;
      }
    }
    if (!item) {
      item = allItems.find((i) => String(i.slug ?? i.id ?? "") === ref.slug);
    }
    if (item) {
      items.push(item);
      scores[String(item.slug ?? item.id ?? items.length - 1)] = ref.score;
    }
  }
  return { items, scores };
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

  const mem = memoryCache.get(memKey);
  if (mem && !isExpired(mem.writtenAt)) {
    const { items, scores } = resolveRefs(mem.payload.refs, allItems);
    const sliced = items.slice(0, limit);
    return {
      items: sliced,
      count: sliced.length,
      semantic: true,
      scores,
      cache: "memory",
    };
  }

  const gcsPayload = await readGcsCache(dbName, normalizedQ, locale, contentFolder);
  if (gcsPayload) {
    writeMemory(memKey, gcsPayload);
    const { items, scores } = resolveRefs(gcsPayload.refs, allItems);
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

  if (vectorEnabled) {
    const { search: vectorSearch, isAvailable } = await import("./vector-search");
    const available = await isAvailable();

    if (!available) {
      fallbackReason = "vector_store_unavailable";
      fallbackMessage =
        'Vector store (Qdrant) is unreachable. Search fell back to exact keyword matching — related words like "certificate" / "certification" will not match unless the exact substring appears.';
    } else {
      const searchResults = await vectorSearch(
        dbName,
        normalizedQ,
        SEARCH_CACHE_CEILING,
        locale,
      );

      if (searchResults.length > 0) {
        const orderedWithScores: Array<{
          item: Record<string, unknown>;
          score: number;
          ref: CacheRef;
        }> = [];
        for (const r of searchResults) {
          let item: Record<string, unknown> | undefined;
          if (r._idx !== undefined && r._idx >= 0 && r._idx < allItems.length) {
            item = allItems[r._idx];
          }
          if (!item) {
            item = allItems.find((i) => String(i.slug ?? i.id ?? "") === r.slug);
          }
          if (!item) continue;
          if (locale) {
            const itemLocale = String(item.locale ?? item.language ?? item.lang ?? "");
            if (itemLocale.toLowerCase() !== locale.toLowerCase()) continue;
          }
          orderedWithScores.push({
            item,
            score: r.score,
            ref: { slug: r.slug, _idx: r._idx, score: r.score },
          });
        }

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
      fallbackMessage =
        "Semantic index returned no results (collection may be empty or not built yet). Run Force Refresh / Re-index, then retry. Until then, search uses exact keyword matching only.";
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
