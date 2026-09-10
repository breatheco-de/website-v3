/**
 * Bulk OpenRush keyword refresh for staff manage SEO selection.
 * Cache-only (no YAML seo.kw_*). Supports preview/dry-run for credit estimates.
 */

import {
  getKeywordEntry,
  keywordEntryFresh,
  normalizeKeywordCachePart,
} from "./openrush-keyword-cache";
import { getOpenRushSettings } from "./settings";
import {
  inspectKeywordQuery,
  isOpenRushConfigured,
  OPENRUSH_INSPECT_KEYWORD_CREDITS,
} from "./openrush-client";

export const KEYWORD_REFRESH_BULK_MAX = 50;

export type KeywordRefreshBulkItem = { slug: string; locale: string };

export type KeywordRefreshBulkResultRow = {
  slug: string;
  locale: string;
  keyword: string | null;
  ok: boolean;
  skipped?: boolean;
  aborted?: boolean;
  reason?:
    | "no_keyword"
    | "already_fresh"
    | "fetch_failed"
    | "aborted"
    | "openrush_inactive";
  error?: string;
  kw_monthly_volume?: number | null;
  kw_difficulty?: number | null;
  fetched_at?: string | null;
};

export type KeywordRefreshBulkResponse = {
  ok: true;
  preview: boolean;
  results: KeywordRefreshBulkResultRow[];
  credits_per_call: number;
  /** Distinct keywords that would be / were fetched (not skipped). */
  keywords_to_fetch: number;
  keywords_fetched: number;
  credits_spent: number;
  credits_estimated: number;
  skipped_no_keyword: number;
  skipped_already_fresh: number;
  failed: number;
  aborted: number;
  aborted_remaining?: boolean;
};

export function resolveMainKeywordForEntry(opts: {
  contentType: string;
  slug: string;
  locale: string;
  contentRoot: string;
  loadMergedContent: (
    contentType: string,
    slug: string,
    locale: string,
  ) => { data?: Record<string, unknown> | null };
  loadSeoIndex: (contentRoot: string) => {
    entries: Record<string, { main_keyword?: string | null } | undefined>;
  };
  seoEntryId: (contentType: string, slug: string, locale: string) => string;
}): string {
  const { loadSeoIndex, seoEntryId } = opts;
  const seoIndex = loadSeoIndex(opts.contentRoot);
  const row = seoIndex.entries[seoEntryId(opts.contentType, opts.slug, opts.locale)];
  const merged = opts.loadMergedContent(opts.contentType, opts.slug, opts.locale);
  const data = (merged.data || {}) as Record<string, unknown>;
  const seo =
    data.seo && typeof data.seo === "object" && !Array.isArray(data.seo)
      ? (data.seo as Record<string, unknown>)
      : {};
  const fromYaml =
    typeof seo.main_keyword === "string" && seo.main_keyword.trim()
      ? seo.main_keyword.trim()
      : "";
  const fromIndex =
    typeof row?.main_keyword === "string" && row.main_keyword.trim()
      ? row.main_keyword.trim()
      : "";
  return fromYaml || fromIndex;
}

function keywordDedupeKey(keyword: string): string {
  return normalizeKeywordCachePart(keyword);
}

/**
 * Plan which distinct keywords need an OpenRush pull (not fresh / not empty).
 */
export function planKeywordRefreshBulk(opts: {
  items: KeywordRefreshBulkItem[];
  resolveKeyword: (item: KeywordRefreshBulkItem) => string;
  contentRoot?: string;
  contentFolder?: string;
  now?: number;
}): {
  results: KeywordRefreshBulkResultRow[];
  keywordsToFetch: string[];
  skippedNoKeyword: number;
  skippedAlreadyFresh: number;
} {
  const settings = getOpenRushSettings(opts.contentRoot);
  const location = settings.location || "United States";
  const language = settings.language || "English";
  const now = opts.now ?? Date.now();

  const results: KeywordRefreshBulkResultRow[] = [];
  const keywordsToFetch: string[] = [];
  const seenFetchKeys = new Set<string>();
  let skippedNoKeyword = 0;
  let skippedAlreadyFresh = 0;

  for (const item of opts.items) {
    const keyword = opts.resolveKeyword(item).trim() || null;
    if (!keyword) {
      skippedNoKeyword += 1;
      results.push({
        slug: item.slug,
        locale: item.locale,
        keyword: null,
        ok: false,
        skipped: true,
        reason: "no_keyword",
      });
      continue;
    }
    const entry = getKeywordEntry(keyword, location, language, opts.contentFolder);
    const fresh = keywordEntryFresh(entry, now);
    if (fresh) {
      skippedAlreadyFresh += 1;
      results.push({
        slug: item.slug,
        locale: item.locale,
        keyword,
        ok: true,
        skipped: true,
        reason: "already_fresh",
        kw_monthly_volume: entry?.monthly_volume ?? null,
        kw_difficulty: entry?.kw_difficulty ?? null,
        fetched_at: entry?.fetched_at ?? null,
      });
      continue;
    }
    const dk = keywordDedupeKey(keyword);
    if (!seenFetchKeys.has(dk)) {
      seenFetchKeys.add(dk);
      keywordsToFetch.push(keyword);
    }
    results.push({
      slug: item.slug,
      locale: item.locale,
      keyword,
      ok: true,
      skipped: false,
    });
  }

  return {
    results,
    keywordsToFetch,
    skippedNoKeyword,
    skippedAlreadyFresh,
  };
}

export async function runKeywordRefreshBulk(opts: {
  contentType: string;
  items: KeywordRefreshBulkItem[];
  contentRoot: string;
  contentFolder: string;
  preview?: boolean;
  resolveKeyword: (item: KeywordRefreshBulkItem) => string;
  now?: number;
}): Promise<KeywordRefreshBulkResponse> {
  const preview = opts.preview === true;

  if (!isOpenRushConfigured(opts.contentRoot)) {
    return {
      ok: true,
      preview,
      results: opts.items.map((item) => ({
        slug: item.slug,
        locale: item.locale,
        keyword: null,
        ok: false,
        skipped: true,
        reason: "openrush_inactive" as const,
        error: "OpenRush must be activated to refresh keyword metrics",
      })),
      credits_per_call: OPENRUSH_INSPECT_KEYWORD_CREDITS,
      keywords_to_fetch: 0,
      keywords_fetched: 0,
      credits_spent: 0,
      credits_estimated: 0,
      skipped_no_keyword: 0,
      skipped_already_fresh: 0,
      failed: opts.items.length,
      aborted: 0,
    };
  }

  const planned = planKeywordRefreshBulk({
    items: opts.items,
    resolveKeyword: opts.resolveKeyword,
    contentRoot: opts.contentRoot,
    contentFolder: opts.contentFolder,
    now: opts.now,
  });

  const creditsEstimated =
    planned.keywordsToFetch.length * OPENRUSH_INSPECT_KEYWORD_CREDITS;

  if (preview) {
    return {
      ok: true,
      preview: true,
      results: planned.results,
      credits_per_call: OPENRUSH_INSPECT_KEYWORD_CREDITS,
      keywords_to_fetch: planned.keywordsToFetch.length,
      keywords_fetched: 0,
      credits_spent: 0,
      credits_estimated: creditsEstimated,
      skipped_no_keyword: planned.skippedNoKeyword,
      skipped_already_fresh: planned.skippedAlreadyFresh,
      failed: 0,
      aborted: 0,
    };
  }

  // Fetch distinct keywords; map outcomes back onto result rows
  type FetchOutcome =
    | {
        ok: true;
        volume: number | null;
        difficulty: number | null;
        fetched_at: string | null;
      }
    | { ok: false; error: string; fatal?: boolean };

  const fetchByKey = new Map<string, FetchOutcome>();
  let abortedRemaining = false;
  let keywordsFetched = 0;
  let failed = 0;
  let aborted = 0;

  for (const keyword of planned.keywordsToFetch) {
    if (abortedRemaining) {
      fetchByKey.set(keywordDedupeKey(keyword), {
        ok: false,
        error: "Aborted after OpenRush account/auth failure",
        fatal: true,
      });
      continue;
    }
    const inspected = await inspectKeywordQuery({
      keyword,
      contentRoot: opts.contentRoot,
      contentFolder: opts.contentFolder,
    });
    if (!inspected.ok || !inspected.metrics) {
      const fatal = inspected.fatal === true;
      fetchByKey.set(keywordDedupeKey(keyword), {
        ok: false,
        error: inspected.error || "OpenRush keyword lookup failed",
        fatal,
      });
      if (fatal) abortedRemaining = true;
      continue;
    }
    keywordsFetched += 1;
    fetchByKey.set(keywordDedupeKey(keyword), {
      ok: true,
      volume: inspected.entry?.monthly_volume ?? inspected.metrics.monthly_volume,
      difficulty: inspected.entry?.kw_difficulty ?? inspected.metrics.kw_difficulty,
      fetched_at: inspected.entry?.fetched_at ?? null,
    });
  }

  const results: KeywordRefreshBulkResultRow[] = planned.results.map((row) => {
    if (row.skipped) return row;
    if (!row.keyword) return row;
    const outcome = fetchByKey.get(keywordDedupeKey(row.keyword));
    if (!outcome) {
      failed += 1;
      return {
        ...row,
        ok: false,
        reason: "fetch_failed",
        error: "No fetch outcome",
      };
    }
    if (outcome.ok) {
      return {
        ...row,
        ok: true,
        kw_monthly_volume: outcome.volume,
        kw_difficulty: outcome.difficulty,
        fetched_at: outcome.fetched_at,
      };
    }
    if (outcome.fatal && outcome.error.includes("Aborted")) {
      aborted += 1;
      return {
        ...row,
        ok: false,
        aborted: true,
        reason: "aborted",
        error: outcome.error,
      };
    }
    failed += 1;
    return {
      ...row,
      ok: false,
      reason: "fetch_failed",
      error: outcome.error,
      aborted: outcome.fatal || undefined,
    };
  });

  // Count aborted placeholders that were never attempted after fatal
  for (const keyword of planned.keywordsToFetch) {
    const outcome = fetchByKey.get(keywordDedupeKey(keyword));
    if (outcome && !outcome.ok && outcome.fatal && outcome.error.includes("Aborted")) {
      // already counted per-row above
    }
  }

  return {
    ok: true,
    preview: false,
    results,
    credits_per_call: OPENRUSH_INSPECT_KEYWORD_CREDITS,
    keywords_to_fetch: planned.keywordsToFetch.length,
    keywords_fetched: keywordsFetched,
    credits_spent: keywordsFetched * OPENRUSH_INSPECT_KEYWORD_CREDITS,
    credits_estimated: creditsEstimated,
    skipped_no_keyword: planned.skippedNoKeyword,
    skipped_already_fresh: planned.skippedAlreadyFresh,
    failed,
    aborted,
    aborted_remaining: abortedRemaining || undefined,
  };
}
