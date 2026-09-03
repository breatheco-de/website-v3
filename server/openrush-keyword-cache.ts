/**
 * Local per-keyword OpenRush inspect_keyword snapshots on persistent `.cache` (no GCS).
 * Shared by phrase + market (keyword|location|language). Partial merges keep prior non-null metrics.
 */

import fs from "fs";
import path from "path";
import { CACHE_DIR } from "./db-cache";
import { getDefaultContentFolder } from "./site-config";
import { getOpenRushSettings } from "./settings";

export const KEYWORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type OpenRushKeywordEntry = {
  keyword: string;
  location: string;
  language: string;
  fetched_at: string;
  monthly_volume: number | null;
  kw_difficulty: number | null;
  /** Human-readable merge / partial-pull note for UI + MCP. */
  notes: string | null;
  /** Full last OpenRush data payload (best-effort). */
  payload: Record<string, unknown> | null;
};

export type OpenRushKeywordCacheFile = {
  updated_at: string;
  entries: Record<string, OpenRushKeywordEntry>;
};

export type KeywordMetricsSource = "openrush_cache" | "yaml_fallback" | "none";

export type ResolvedKeywordMetrics = {
  openrush_configured: boolean;
  source: KeywordMetricsSource;
  kw_monthly_volume: number | null;
  kw_difficulty: number | null;
  fetched_at: string | null;
  stale: boolean;
  may_not_be_recent: boolean;
  notes: string | null;
};

export function normalizeKeywordCachePart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function keywordCacheKey(keyword: string, location: string, language: string): string {
  return [
    normalizeKeywordCachePart(keyword),
    normalizeKeywordCachePart(location || "United States"),
    normalizeKeywordCachePart(language || "English"),
  ].join("|");
}

export function openrushKeywordCachePath(contentFolder?: string): string {
  const folder = contentFolder || getDefaultContentFolder();
  return path.join(CACHE_DIR, folder, "openrush-keywords.json");
}

export function loadKeywordCache(contentFolder?: string): OpenRushKeywordCacheFile {
  const p = openrushKeywordCachePath(contentFolder);
  if (!fs.existsSync(p)) return { updated_at: "", entries: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as OpenRushKeywordCacheFile;
    if (!parsed || typeof parsed.entries !== "object" || parsed.entries == null) {
      return { updated_at: "", entries: {} };
    }
    return { updated_at: parsed.updated_at || "", entries: parsed.entries };
  } catch {
    return { updated_at: "", entries: {} };
  }
}

export function saveKeywordCache(file: OpenRushKeywordCacheFile, contentFolder?: string): void {
  const p = openrushKeywordCachePath(contentFolder);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(file), "utf-8");
}

export function keywordEntryFresh(
  entry: OpenRushKeywordEntry | undefined,
  now = Date.now(),
): boolean {
  if (!entry?.fetched_at) return false;
  const t = Date.parse(entry.fetched_at);
  if (Number.isNaN(t)) return false;
  return now - t < KEYWORD_TTL_MS;
}

export function getKeywordEntry(
  keyword: string,
  location: string,
  language: string,
  contentFolder?: string,
): OpenRushKeywordEntry | undefined {
  const key = keywordCacheKey(keyword, location, language);
  return loadKeywordCache(contentFolder).entries[key];
}

export type IncomingKeywordMetrics = {
  keyword: string;
  location: string;
  language: string;
  monthly_volume: number | null;
  kw_difficulty: number | null;
  payload?: Record<string, unknown> | null;
};

/**
 * Partial merge: non-null incoming metrics overwrite; nulls keep prior values.
 * Always updates fetched_at and rebuilds notes for UI/MCP.
 */
export function mergeKeywordEntry(
  prior: OpenRushKeywordEntry | undefined,
  incoming: IncomingKeywordMetrics,
  fetchedAt = new Date().toISOString(),
): OpenRushKeywordEntry {
  const volume =
    incoming.monthly_volume != null
      ? incoming.monthly_volume
      : (prior?.monthly_volume ?? null);
  const difficulty =
    incoming.kw_difficulty != null
      ? incoming.kw_difficulty
      : (prior?.kw_difficulty ?? null);

  const noteParts: string[] = [];
  if (incoming.monthly_volume != null) {
    noteParts.push("Volume refreshed");
  } else if (prior?.monthly_volume != null) {
    noteParts.push("Volume kept from earlier pull");
  } else {
    noteParts.push("Volume missing");
  }
  if (incoming.kw_difficulty != null) {
    noteParts.push("difficulty refreshed");
  } else if (prior?.kw_difficulty != null) {
    noteParts.push("difficulty kept from earlier pull");
  } else {
    noteParts.push("difficulty missing");
  }

  return {
    keyword: incoming.keyword.trim(),
    location: incoming.location.trim() || "United States",
    language: incoming.language.trim() || "English",
    fetched_at: fetchedAt,
    monthly_volume: volume,
    kw_difficulty: difficulty,
    notes: noteParts.join("; ") + ".",
    payload:
      incoming.payload && typeof incoming.payload === "object"
        ? incoming.payload
        : (prior?.payload ?? null),
  };
}

export function upsertKeywordEntry(
  incoming: IncomingKeywordMetrics,
  contentFolder?: string,
): OpenRushKeywordEntry {
  const cache = loadKeywordCache(contentFolder);
  const key = keywordCacheKey(incoming.keyword, incoming.location, incoming.language);
  const prior = cache.entries[key];
  const merged = mergeKeywordEntry(prior, incoming);
  cache.entries[key] = merged;
  cache.updated_at = merged.fetched_at;
  saveKeywordCache(cache, contentFolder);
  return merged;
}

function yamlMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function openRushConfigured(contentRoot?: string): boolean {
  const settings = getOpenRushSettings(contentRoot);
  return Boolean(settings.enabled && (process.env.OPENRUSH_API_KEY || "").trim());
}

/**
 * Prefer OpenRush cache when configured; otherwise YAML fallback (may not be recent).
 */
export function resolveKeywordMetrics(opts: {
  keyword: string | null | undefined;
  contentRoot?: string;
  contentFolder?: string;
  yamlVolume?: unknown;
  yamlDifficulty?: unknown;
  now?: number;
}): ResolvedKeywordMetrics {
  const keyword = typeof opts.keyword === "string" ? opts.keyword.trim() : "";
  const openrush_configured = openRushConfigured(opts.contentRoot);
  const yamlVol = yamlMetric(opts.yamlVolume);
  const yamlDiff = yamlMetric(opts.yamlDifficulty);
  const empty: ResolvedKeywordMetrics = {
    openrush_configured,
    source: "none",
    kw_monthly_volume: null,
    kw_difficulty: null,
    fetched_at: null,
    stale: false,
    may_not_be_recent: false,
    notes: null,
  };

  if (!keyword) return empty;

  if (openrush_configured) {
    const settings = getOpenRushSettings(opts.contentRoot);
    const entry = getKeywordEntry(
      keyword,
      settings.location || "United States",
      settings.language || "English",
      opts.contentFolder,
    );
    if (entry) {
      const now = opts.now ?? Date.now();
      return {
        openrush_configured: true,
        source: "openrush_cache",
        kw_monthly_volume: entry.monthly_volume,
        kw_difficulty: entry.kw_difficulty,
        fetched_at: entry.fetched_at,
        stale: !keywordEntryFresh(entry, now),
        may_not_be_recent: false,
        notes: entry.notes,
      };
    }
  }

  if (yamlVol != null || yamlDiff != null) {
    return {
      openrush_configured,
      source: "yaml_fallback",
      kw_monthly_volume: yamlVol,
      kw_difficulty: yamlDiff,
      fetched_at: null,
      stale: false,
      may_not_be_recent: true,
      notes: null,
    };
  }

  return empty;
}
