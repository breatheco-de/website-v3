/**
 * Bulk keyword metrics refresh for staff manage SEO selection (DataForSEO when configured, else OpenRush).
 * Cache-only (no YAML seo.kw_*). Each row uses its page locale's default research market.
 * Supports preview/dry-run for cost estimates; DataForSEO runs stop cleanly at the daily USD cap.
 */

import {
  getKeywordEntry,
  keywordEntryFresh,
  normalizeKeywordCachePart,
} from "./openrush-keyword-cache";
import { resolveSiteResearchMarket } from "./seo-research-market";
import {
  affordableKeywordCount,
  estimateKeywordMetricsCost,
  fetchKeywordMetrics,
  providerFor,
  type SeoResearchProvider,
} from "./seo-research-providers";
import {
  STAFF_BUDGET_SESSION_KEY,
  budgetSnapshot,
  recordSpend,
  remainingBudget,
  type SeoResearchBudgetUnit,
} from "./seo-research-budget";
import { dataForSeoMode, type DataForSeoMode } from "./dataforseo-client";
import { OPENRUSH_INSPECT_KEYWORD_CREDITS } from "./openrush-client";

export const KEYWORD_REFRESH_BULK_MAX = 50;

export type KeywordRefreshBulkItem = { slug: string; locale: string };

export type KeywordRefreshBulkResultRow = {
  slug: string;
  locale: string;
  keyword: string | null;
  /** Research market this row was looked up in (e.g. "Spain"). */
  market?: string | null;
  ok: boolean;
  skipped?: boolean;
  aborted?: boolean;
  reason?:
    | "no_keyword"
    | "already_fresh"
    | "fetch_failed"
    | "aborted"
    | "stopped_at_cap"
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
  provider: SeoResearchProvider | null;
  cost_unit: SeoResearchBudgetUnit;
  /** DataForSEO only: live API vs free sandbox (sample data). */
  mode: DataForSeoMode | null;
  credits_per_call: number;
  /** Distinct keyword+market pairs that would be / were fetched (not skipped). */
  keywords_to_fetch: number;
  keywords_fetched: number;
  credits_spent: number;
  credits_estimated: number;
  usd_estimated: number;
  usd_spent: number;
  /** Remaining staff daily budget before this run (provider unit). */
  budget_remaining: number;
  skipped_no_keyword: number;
  skipped_already_fresh: number;
  failed: number;
  aborted: number;
  aborted_remaining?: boolean;
  /** Run stopped before the daily cap; keywords_not_refreshed lists what was left. */
  stopped_at_cap?: boolean;
  keywords_not_refreshed?: string[];
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

type MarketGroup = {
  key: string;
  label: string;
  location: string;
  language: string;
  keywords: string[];
};

function marketKey(location: string, language: string): string {
  return `${normalizeKeywordCachePart(location)}|${normalizeKeywordCachePart(language)}`;
}

function fetchKey(keyword: string, location: string, language: string): string {
  return `${normalizeKeywordCachePart(keyword)}|${marketKey(location, language)}`;
}

/**
 * Plan which distinct keyword+market pairs need a pull (not fresh / not empty).
 */
export function planKeywordRefreshBulk(opts: {
  items: KeywordRefreshBulkItem[];
  resolveKeyword: (item: KeywordRefreshBulkItem) => string;
  contentRoot?: string;
  contentFolder?: string;
  now?: number;
}): {
  results: KeywordRefreshBulkResultRow[];
  /** Row index → fetch key (rows that need a fetch). */
  rowFetchKeys: Map<number, string>;
  groups: MarketGroup[];
  keywordsToFetch: number;
  skippedNoKeyword: number;
  skippedAlreadyFresh: number;
} {
  const now = opts.now ?? Date.now();
  const results: KeywordRefreshBulkResultRow[] = [];
  const rowFetchKeys = new Map<number, string>();
  const groups = new Map<string, MarketGroup>();
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
    const resolved = resolveSiteResearchMarket({ contentRoot: opts.contentRoot, locale: item.locale });
    const market = resolved.ok
      ? resolved.market
      : { label: "United States / English", location: "United States", language: "English" };
    const entry = getKeywordEntry(keyword, market.location, market.language, opts.contentFolder);
    if (keywordEntryFresh(entry, now)) {
      skippedAlreadyFresh += 1;
      results.push({
        slug: item.slug,
        locale: item.locale,
        keyword,
        market: market.label,
        ok: true,
        skipped: true,
        reason: "already_fresh",
        kw_monthly_volume: entry?.monthly_volume ?? null,
        kw_difficulty: entry?.kw_difficulty ?? null,
        fetched_at: entry?.fetched_at ?? null,
      });
      continue;
    }
    const fk = fetchKey(keyword, market.location, market.language);
    rowFetchKeys.set(results.length, fk);
    if (!seenFetchKeys.has(fk)) {
      seenFetchKeys.add(fk);
      const mk = marketKey(market.location, market.language);
      const group = groups.get(mk) ?? {
        key: mk,
        label: market.label,
        location: market.location,
        language: market.language,
        keywords: [],
      };
      group.keywords.push(keyword);
      groups.set(mk, group);
    }
    results.push({
      slug: item.slug,
      locale: item.locale,
      keyword,
      market: market.label,
      ok: true,
      skipped: false,
    });
  }

  return {
    results,
    rowFetchKeys,
    groups: [...groups.values()],
    keywordsToFetch: seenFetchKeys.size,
    skippedNoKeyword,
    skippedAlreadyFresh,
  };
}

function estimateGroups(provider: SeoResearchProvider, groups: MarketGroup[]): number {
  return groups.reduce((sum, g) => sum + estimateKeywordMetricsCost(provider, g.keywords.length), 0);
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
  const provider = providerFor("keyword_metrics", opts.contentRoot);
  const base = {
    ok: true as const,
    preview,
    provider,
    cost_unit: (provider === "dataforseo" ? "usd" : "credits") as SeoResearchBudgetUnit,
    mode: provider === "dataforseo" ? dataForSeoMode() : null,
    credits_per_call: OPENRUSH_INSPECT_KEYWORD_CREDITS,
  };

  if (!provider) {
    return {
      ...base,
      results: opts.items.map((item) => ({
        slug: item.slug,
        locale: item.locale,
        keyword: null,
        ok: false,
        skipped: true,
        reason: "openrush_inactive" as const,
        error: "Keyword research must be activated to refresh keyword metrics",
      })),
      keywords_to_fetch: 0,
      keywords_fetched: 0,
      credits_spent: 0,
      credits_estimated: 0,
      usd_estimated: 0,
      usd_spent: 0,
      budget_remaining: 0,
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

  const estimated = estimateGroups(provider, planned.groups);
  const snap = budgetSnapshot({
    provider,
    contentRoot: opts.contentRoot,
    contentFolder: opts.contentFolder,
    sessionKey: STAFF_BUDGET_SESSION_KEY,
    applySessionCap: false,
    now: opts.now,
  });
  const budgetRemaining = remainingBudget(snap);
  const costFields = (spent: number) =>
    provider === "dataforseo"
      ? { credits_estimated: 0, credits_spent: 0, usd_estimated: estimated, usd_spent: spent }
      : { credits_estimated: estimated, credits_spent: spent, usd_estimated: 0, usd_spent: 0 };

  if (preview) {
    return {
      ...base,
      results: planned.results,
      keywords_to_fetch: planned.keywordsToFetch,
      keywords_fetched: 0,
      ...costFields(0),
      budget_remaining: budgetRemaining,
      skipped_no_keyword: planned.skippedNoKeyword,
      skipped_already_fresh: planned.skippedAlreadyFresh,
      failed: 0,
      aborted: 0,
    };
  }

  type FetchOutcome =
    | { ok: true; volume: number | null; difficulty: number | null; fetched_at: string | null }
    | { ok: false; error: string; aborted?: boolean; stopped_at_cap?: boolean };

  const outcomes = new Map<string, FetchOutcome>();
  let remaining = budgetRemaining;
  let spent = 0;
  let keywordsFetched = 0;
  let abortedRemaining = false;
  let stoppedAtCap = false;
  const notRefreshed: string[] = [];

  for (const group of planned.groups) {
    const fkOf = (kw: string) => fetchKey(kw, group.location, group.language);
    if (abortedRemaining || stoppedAtCap) {
      for (const kw of group.keywords) {
        outcomes.set(
          fkOf(kw),
          abortedRemaining
            ? { ok: false, error: "Not attempted after a provider failure", aborted: true }
            : { ok: false, error: "Stopped at the daily budget limit", stopped_at_cap: true },
        );
        if (stoppedAtCap) notRefreshed.push(kw);
      }
      continue;
    }

    let batch = group.keywords;
    if (provider === "dataforseo") {
      const affordable = affordableKeywordCount(provider, remaining, batch.length);
      if (affordable < batch.length) {
        stoppedAtCap = true;
        for (const kw of batch.slice(affordable)) {
          outcomes.set(fkOf(kw), { ok: false, error: "Stopped at the daily budget limit", stopped_at_cap: true });
          notRefreshed.push(kw);
        }
        batch = batch.slice(0, affordable);
      }
      if (batch.length === 0) continue;
    }

    const fetched = await fetchKeywordMetrics({
      provider,
      keywords: batch,
      market: { location: group.location, language: group.language },
      contentRoot: opts.contentRoot,
      contentFolder: opts.contentFolder,
    });
    spent += fetched.cost;
    remaining = Math.max(0, remaining - fetched.cost);
    for (const row of fetched.rows) {
      if (row.ok) {
        keywordsFetched += 1;
        outcomes.set(fkOf(row.keyword), {
          ok: true,
          volume: row.entry.monthly_volume,
          difficulty: row.entry.kw_difficulty,
          fetched_at: row.entry.fetched_at,
        });
      } else {
        outcomes.set(fkOf(row.keyword), { ok: false, error: row.error, aborted: row.aborted });
      }
    }
    if (fetched.fatal) abortedRemaining = true;
  }

  if (spent > 0) {
    recordSpend({
      provider,
      contentRoot: opts.contentRoot,
      contentFolder: opts.contentFolder,
      sessionKey: STAFF_BUDGET_SESSION_KEY,
      cost: spent,
      now: opts.now,
    });
  }

  let failed = 0;
  let aborted = 0;
  const results: KeywordRefreshBulkResultRow[] = planned.results.map((row, idx) => {
    const fk = planned.rowFetchKeys.get(idx);
    if (!fk) return row;
    const outcome = outcomes.get(fk);
    if (!outcome) {
      failed += 1;
      return { ...row, ok: false, reason: "fetch_failed", error: "No fetch outcome" };
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
    if (outcome.stopped_at_cap) {
      return { ...row, ok: false, reason: "stopped_at_cap", error: outcome.error };
    }
    if (outcome.aborted) {
      aborted += 1;
      return { ...row, ok: false, aborted: true, reason: "aborted", error: outcome.error };
    }
    failed += 1;
    return { ...row, ok: false, reason: "fetch_failed", error: outcome.error };
  });

  return {
    ...base,
    results,
    keywords_to_fetch: planned.keywordsToFetch,
    keywords_fetched: keywordsFetched,
    ...costFields(Math.round(spent * 10_000) / 10_000),
    budget_remaining: budgetRemaining,
    skipped_no_keyword: planned.skippedNoKeyword,
    skipped_already_fresh: planned.skippedAlreadyFresh,
    failed,
    aborted,
    aborted_remaining: abortedRemaining || undefined,
    stopped_at_cap: stoppedAtCap || undefined,
    keywords_not_refreshed: notRefreshed.length > 0 ? notRefreshed : undefined,
  };
}
