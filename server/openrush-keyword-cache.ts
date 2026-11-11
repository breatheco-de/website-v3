/**
 * Local per-keyword research snapshots on persistent `.cache` (no GCS), shared by every provider
 * (OpenRush, DataForSEO): a fresh entry is used no matter who filled it.
 * Keyed by phrase + market (keyword|location|language). Partial merges keep prior non-null metrics.
 */

import fs from "fs";
import path from "path";
import { CACHE_DIR } from "./db-cache";
import { getDefaultContentFolder } from "./site-config";
import { getOpenRushSettings } from "./settings";
import { readKeywordDifficulty, type KeywordDifficultySource } from "./openrush-keyword-difficulty";
import { isDataForSeoConfigured } from "./dataforseo-client";
import { marketSummary, resolveSiteResearchMarket } from "./seo-research-market";

export const KEYWORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type KeywordMetricsProvider = "openrush" | "dataforseo";

export type OpenRushKeywordEntry = {
  keyword: string;
  location: string;
  language: string;
  fetched_at: string;
  monthly_volume: number | null;
  kw_difficulty: number | null;
  /** Absent on entries written before the source was tracked — use keywordDifficultySourceOf. */
  kw_difficulty_source?: KeywordDifficultySource | null;
  competition_level?: string | number | null;
  /** Which provider supplied each metric (display only; freshness ignores it). Absent on legacy entries = openrush. */
  volume_provider?: KeywordMetricsProvider | null;
  difficulty_provider?: KeywordMetricsProvider | null;
  /** Last provider that answered a lookup for this keyword (missing metrics are then a real unknown). */
  checked_by?: KeywordMetricsProvider | null;
  /** Human-readable merge / partial-pull note for UI + MCP. */
  notes: string | null;
  /** Last provider payload (best-effort). */
  payload: Record<string, unknown> | null;
};

export type OpenRushKeywordCacheFile = {
  updated_at: string;
  entries: Record<string, OpenRushKeywordEntry>;
};

export type KeywordMetricsSource = "openrush_cache" | "yaml_fallback" | "none";

export type ResolvedKeywordMetrics = {
  /** Keyword research (any provider) is configured. Legacy name kept for clients. */
  openrush_configured: boolean;
  /** Provider a keyword-metrics refresh would call (DataForSEO when on, else OpenRush). */
  keyword_provider: KeywordMetricsProvider | null;
  source: KeywordMetricsSource;
  kw_monthly_volume: number | null;
  kw_difficulty: number | null;
  kw_difficulty_source: KeywordDifficultySource | null;
  volume_provider: KeywordMetricsProvider | null;
  difficulty_provider: KeywordMetricsProvider | null;
  /** Market the cache lookup used (null for YAML fallback / none). */
  market: { id: string | null; label: string; location: string; language: string } | null;
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

/**
 * Fresh TTL and either both metrics present or a provider already answered within the TTL
 * (skip re-fetch for research tool; a known "no data" is not worth paying for again).
 */
export function keywordMetricsCompleteAndFresh(
  entry: OpenRushKeywordEntry | undefined,
  now = Date.now(),
): boolean {
  if (!keywordEntryFresh(entry, now)) return false;
  if (entry!.monthly_volume != null && entry!.kw_difficulty != null) return true;
  return entry!.checked_by != null;
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
  kw_difficulty_source?: KeywordDifficultySource | null;
  competition_level?: string | number | null;
  provider?: KeywordMetricsProvider;
  /**
   * Provider was asked for difficulty and answered. A null answer then clears a prior
   * ad-competition estimate (a prior reported score is still kept).
   */
  difficulty_checked?: boolean;
  payload?: Record<string, unknown> | null;
};

/**
 * Where an entry's difficulty came from. Legacy entries (no stored source) are re-read from the
 * payload only when that payload still yields the same number — otherwise the value was kept
 * from an earlier pull and its origin is unknown.
 */
export function keywordDifficultySourceOf(
  entry: OpenRushKeywordEntry | undefined,
): KeywordDifficultySource | null {
  if (!entry || entry.kw_difficulty == null) return null;
  if (entry.kw_difficulty_source !== undefined) return entry.kw_difficulty_source;
  const reread = readKeywordDifficulty(entry.payload);
  return reread.value === entry.kw_difficulty ? reread.source : null;
}

export function competitionLevelOf(entry: OpenRushKeywordEntry | undefined): string | number | null {
  if (!entry) return null;
  if (entry.competition_level !== undefined) return entry.competition_level;
  return readKeywordDifficulty(entry.payload).competition_level;
}

export function volumeProviderOf(entry: OpenRushKeywordEntry | undefined): KeywordMetricsProvider | null {
  if (!entry || entry.monthly_volume == null) return null;
  return entry.volume_provider ?? "openrush";
}

export function difficultyProviderOf(entry: OpenRushKeywordEntry | undefined): KeywordMetricsProvider | null {
  if (!entry || entry.kw_difficulty == null) return null;
  return entry.difficulty_provider ?? "openrush";
}

/**
 * Partial merge: non-null incoming metrics overwrite; nulls keep prior values.
 * Always updates fetched_at and rebuilds notes for UI/MCP.
 */
export function mergeKeywordEntry(
  prior: OpenRushKeywordEntry | undefined,
  incoming: IncomingKeywordMetrics,
  fetchedAt = new Date().toISOString(),
): OpenRushKeywordEntry {
  const provider = incoming.provider ?? "openrush";
  const volume =
    incoming.monthly_volume != null
      ? incoming.monthly_volume
      : (prior?.monthly_volume ?? null);
  const volumeProvider =
    incoming.monthly_volume != null ? provider : volumeProviderOf(prior);

  const priorSource = keywordDifficultySourceOf(prior);
  const clearDerived =
    incoming.kw_difficulty == null &&
    incoming.difficulty_checked === true &&
    prior?.kw_difficulty != null &&
    priorSource === "derived_from_competition";

  let difficulty: number | null;
  let difficultySource: KeywordDifficultySource | null;
  let difficultyProvider: KeywordMetricsProvider | null;
  if (incoming.kw_difficulty != null) {
    difficulty = incoming.kw_difficulty;
    difficultySource = incoming.kw_difficulty_source ?? null;
    difficultyProvider = provider;
  } else if (clearDerived) {
    difficulty = null;
    difficultySource = null;
    difficultyProvider = null;
  } else {
    difficulty = prior?.kw_difficulty ?? null;
    difficultySource = priorSource;
    difficultyProvider = difficultyProviderOf(prior);
  }
  const competitionLevel =
    incoming.competition_level != null
      ? incoming.competition_level
      : competitionLevelOf(prior);

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
  } else if (clearDerived) {
    noteParts.push("difficulty unavailable from provider; ad-competition estimate cleared");
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
    kw_difficulty_source: difficultySource,
    competition_level: competitionLevel,
    volume_provider: volumeProvider,
    difficulty_provider: difficultyProvider,
    checked_by: incoming.difficulty_checked ? provider : (prior?.checked_by ?? null),
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

/** Provider that serves keyword metrics on this site (mirrors seo-research-providers.providerFor). */
export function keywordMetricsProvider(contentRoot?: string): KeywordMetricsProvider | null {
  if (isDataForSeoConfigured(contentRoot)) return "dataforseo";
  const settings = getOpenRushSettings(contentRoot);
  return settings.enabled && (process.env.OPENRUSH_API_KEY || "").trim() ? "openrush" : null;
}

/** Keyword metrics research is on when any provider that can serve it is configured. */
export function keywordResearchConfigured(contentRoot?: string): boolean {
  return keywordMetricsProvider(contentRoot) != null;
}

/**
 * Prefer the shared research cache (market from the page locale) when configured; otherwise YAML
 * fallback (may not be recent).
 */
export function resolveKeywordMetrics(opts: {
  keyword: string | null | undefined;
  contentRoot?: string;
  contentFolder?: string;
  /** Page locale → default research market (en → usa, es → spain, …). */
  locale?: string | null;
  yamlVolume?: unknown;
  yamlDifficulty?: unknown;
  now?: number;
}): ResolvedKeywordMetrics {
  const keyword = typeof opts.keyword === "string" ? opts.keyword.trim() : "";
  const keyword_provider = keywordMetricsProvider(opts.contentRoot);
  const openrush_configured = keyword_provider != null;
  const yamlVol = yamlMetric(opts.yamlVolume);
  const yamlDiff = yamlMetric(opts.yamlDifficulty);
  const empty: ResolvedKeywordMetrics = {
    openrush_configured,
    keyword_provider,
    source: "none",
    kw_monthly_volume: null,
    kw_difficulty: null,
    kw_difficulty_source: null,
    volume_provider: null,
    difficulty_provider: null,
    market: null,
    fetched_at: null,
    stale: false,
    may_not_be_recent: false,
    notes: null,
  };

  if (!keyword) return empty;

  if (openrush_configured) {
    const resolved = resolveSiteResearchMarket({ contentRoot: opts.contentRoot, locale: opts.locale });
    if (resolved.ok) {
      const market = resolved.market;
      const entry = getKeywordEntry(keyword, market.location, market.language, opts.contentFolder);
      if (entry) {
        const now = opts.now ?? Date.now();
        const summary = marketSummary(market);
        return {
          openrush_configured: true,
          keyword_provider,
          source: "openrush_cache",
          kw_monthly_volume: entry.monthly_volume,
          kw_difficulty: entry.kw_difficulty,
          kw_difficulty_source: keywordDifficultySourceOf(entry),
          volume_provider: volumeProviderOf(entry),
          difficulty_provider: difficultyProviderOf(entry),
          market: { id: summary.id, label: summary.label, location: summary.location, language: summary.language },
          fetched_at: entry.fetched_at,
          stale: !keywordEntryFresh(entry, now),
          may_not_be_recent: false,
          notes: entry.notes,
        };
      }
    }
  }

  if (yamlVol != null || yamlDiff != null) {
    return {
      ...empty,
      source: "yaml_fallback",
      kw_monthly_volume: yamlVol,
      kw_difficulty: yamlDiff,
      may_not_be_recent: true,
    };
  }

  return empty;
}
