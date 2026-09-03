/**
 * Local per-query OpenRush SERP snapshots on persistent `.cache` (no GCS).
 */

import fs from "fs";
import path from "path";
import { CACHE_DIR } from "./db-cache";
import { getDefaultContentFolder } from "./site-config";
import { normalizePageUrl } from "./gsc-keep-filter";

export const SERP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type OpenRushOrganicHit = {
  url: string;
  rank: number;
};

export type OpenRushSerpEntry = {
  query: string;
  fetched_at: string;
  organic: OpenRushOrganicHit[];
  featured_snippet_url: string | null;
  has_paa: boolean;
  our_serp_rank: number | null;
  visible_in_serp: boolean | null;
};

export type OpenRushSerpCacheFile = {
  updated_at: string;
  entries: Record<string, OpenRushSerpEntry>;
};

export function openrushSerpCachePath(contentFolder?: string): string {
  const folder = contentFolder || getDefaultContentFolder();
  return path.join(CACHE_DIR, folder, "openrush-serp.json");
}

export function loadSerpCache(contentFolder?: string): OpenRushSerpCacheFile {
  const p = openrushSerpCachePath(contentFolder);
  if (!fs.existsSync(p)) return { updated_at: "", entries: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as OpenRushSerpCacheFile;
    if (!parsed || typeof parsed.entries !== "object" || parsed.entries == null) {
      return { updated_at: "", entries: {} };
    }
    return { updated_at: parsed.updated_at || "", entries: parsed.entries };
  } catch {
    return { updated_at: "", entries: {} };
  }
}

export function saveSerpCache(file: OpenRushSerpCacheFile, contentFolder?: string): void {
  const p = openrushSerpCachePath(contentFolder);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(file), "utf-8");
}

export function upsertSerpEntry(
  entry: OpenRushSerpEntry,
  contentFolder?: string,
): OpenRushSerpCacheFile {
  const cache = loadSerpCache(contentFolder);
  cache.entries[entry.query] = entry;
  cache.updated_at = new Date().toISOString();
  saveSerpCache(cache, contentFolder);
  return cache;
}

export function serpEntryFresh(entry: OpenRushSerpEntry | undefined, now = Date.now()): boolean {
  if (!entry?.fetched_at) return false;
  const t = Date.parse(entry.fetched_at);
  if (Number.isNaN(t)) return false;
  return now - t < SERP_TTL_MS;
}

export function listStaleOrMissingQueries(
  wanted: string[],
  entries: Record<string, OpenRushSerpEntry>,
  now = Date.now(),
): string[] {
  return wanted.filter((q) => !serpEntryFresh(entries[q], now));
}

export function urlsMatch(a: string, b: string): boolean {
  const na = normalizePageUrl(a);
  const nb = normalizePageUrl(b);
  if (!na || !nb) return false;
  return na.host === nb.host && na.path === nb.path;
}

export function rankOfUrlInOrganic(url: string, organic: OpenRushOrganicHit[]): number | null {
  for (const hit of organic) {
    if (urlsMatch(hit.url, url)) return hit.rank;
  }
  return null;
}
