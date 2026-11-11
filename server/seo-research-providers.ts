/**
 * SEO research provider routing: DataForSEO owns keyword metrics (volume + ranking difficulty)
 * when configured; OpenRush serves SERP, keyword ideas, competitors and gaps (and keyword metrics
 * when DataForSEO is off). Both write the same keyword cache. No fallback between providers on failure.
 */

import { isOpenRushConfigured, inspectKeywordQuery, OPENRUSH_INSPECT_KEYWORD_CREDITS } from "./openrush-client";
import {
  DATAFORSEO_KEYWORD_OVERVIEW_MAX,
  dataForSeoMode,
  estimateKeywordOverviewUsd,
  isDataForSeoConfigured,
  keywordOverviewQuery,
  roundUsd,
  type DataForSeoErrorKind,
  type DataForSeoMode,
} from "./dataforseo-client";
import { upsertKeywordEntry, type OpenRushKeywordEntry } from "./openrush-keyword-cache";
import type { ResearchMarket } from "./seo-research-market";

export type SeoResearchProvider = "openrush" | "dataforseo";

export type SeoResearchActionKind =
  | "keyword_metrics"
  | "serp"
  | "keyword_ideas"
  | "competitors"
  | "keyword_gaps";

/** Which provider serves an action on this site, or null when none is configured for it. */
export function providerFor(
  action: SeoResearchActionKind,
  contentRoot?: string,
): SeoResearchProvider | null {
  if (action === "keyword_metrics") {
    if (isDataForSeoConfigured(contentRoot)) return "dataforseo";
    return isOpenRushConfigured(contentRoot) ? "openrush" : null;
  }
  return isOpenRushConfigured(contentRoot) ? "openrush" : null;
}

export function isSeoResearchConfigured(action: SeoResearchActionKind, contentRoot?: string): boolean {
  return providerFor(action, contentRoot) != null;
}

/** Estimated keyword-metrics cost in the provider's budget unit (credits or USD). */
export function estimateKeywordMetricsCost(provider: SeoResearchProvider, keywordCount: number): number {
  if (provider === "dataforseo") return estimateKeywordOverviewUsd(keywordCount);
  return Math.max(0, Math.floor(keywordCount)) * OPENRUSH_INSPECT_KEYWORD_CREDITS;
}

/** Most keywords one market batch can fetch within `remaining` budget (provider unit). */
export function affordableKeywordCount(provider: SeoResearchProvider, remaining: number, wanted: number): number {
  if (wanted <= 0 || remaining <= 0) return 0;
  let lo = 0;
  let hi = wanted;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateKeywordMetricsCost(provider, mid) <= remaining + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export type KeywordMetricsRow =
  | {
      keyword: string;
      ok: true;
      entry: OpenRushKeywordEntry;
      /** Provider had data for this keyword (false = checked, nothing returned). */
      found: boolean;
    }
  | {
      keyword: string;
      ok: false;
      error: string;
      fatal: boolean;
      error_kind?: DataForSeoErrorKind;
      /** Not attempted because an earlier call failed fatally. */
      aborted?: boolean;
    };

export type FetchKeywordMetricsResult = {
  provider: SeoResearchProvider;
  /** DataForSEO only: live API vs free sandbox (sample data). */
  mode: DataForSeoMode | null;
  rows: KeywordMetricsRow[];
  /** Spend on successful calls, in the provider's unit (credits / USD). */
  cost: number;
  /** First fatal failure (auth / funds / outage); remaining keywords were not attempted. */
  fatal?: { error: string; error_kind: DataForSeoErrorKind | null };
};

function abortedRows(keywords: string[], error: string): KeywordMetricsRow[] {
  return keywords.map((keyword) => ({
    keyword,
    ok: false as const,
    error: `Not attempted: ${error}`,
    fatal: true,
    aborted: true,
  }));
}

/**
 * Fetch keyword metrics for one market and upsert the shared cache. Callers gate budget
 * beforehand and record `cost` afterwards. Does not write YAML.
 */
export async function fetchKeywordMetrics(opts: {
  provider: SeoResearchProvider;
  keywords: string[];
  market: Pick<ResearchMarket, "location" | "language">;
  contentRoot?: string;
  contentFolder?: string;
}): Promise<FetchKeywordMetricsResult> {
  const keywords = [...new Set(opts.keywords.map((k) => k.trim()).filter(Boolean))];
  const { location, language } = opts.market;

  if (opts.provider === "dataforseo") {
    const rows: KeywordMetricsRow[] = [];
    let cost = 0;
    for (let i = 0; i < keywords.length; i += DATAFORSEO_KEYWORD_OVERVIEW_MAX) {
      const chunk = keywords.slice(i, i + DATAFORSEO_KEYWORD_OVERVIEW_MAX);
      const res = await keywordOverviewQuery({
        keywords: chunk,
        market: { location, language },
        contentRoot: opts.contentRoot,
      });
      if (!res.ok) {
        for (const keyword of chunk) {
          rows.push({ keyword, ok: false, error: res.error, fatal: res.fatal, error_kind: res.error_kind });
        }
        if (res.fatal) {
          rows.push(...abortedRows(keywords.slice(i + chunk.length), res.error));
          return {
            provider: "dataforseo",
            mode: dataForSeoMode(),
            rows,
            cost: roundUsd(cost),
            fatal: { error: res.error, error_kind: res.error_kind },
          };
        }
        continue;
      }
      cost += res.cost_usd;
      for (const keyword of chunk) {
        const m = res.metrics.get(keyword.toLowerCase());
        const entry = upsertKeywordEntry(
          {
            keyword,
            location,
            language,
            monthly_volume: m?.monthly_volume ?? null,
            kw_difficulty: m?.kw_difficulty ?? null,
            kw_difficulty_source: m?.kw_difficulty_source ?? null,
            competition_level: m?.competition_level ?? null,
            provider: "dataforseo",
            difficulty_checked: true,
            payload: m?.payload ?? null,
          },
          opts.contentFolder,
        );
        rows.push({ keyword, ok: true, entry, found: Boolean(m) });
      }
    }
    return { provider: "dataforseo", mode: dataForSeoMode(), rows, cost: roundUsd(cost) };
  }

  const rows: KeywordMetricsRow[] = [];
  let successes = 0;
  for (let i = 0; i < keywords.length; i += 1) {
    const keyword = keywords[i]!;
    const inspected = await inspectKeywordQuery({
      keyword,
      contentRoot: opts.contentRoot,
      contentFolder: opts.contentFolder,
      market: { location, language },
    });
    if (!inspected.ok || !inspected.entry) {
      const error = inspected.error || "Keyword research lookup failed";
      const fatal = inspected.fatal === true;
      rows.push({ keyword, ok: false, error, fatal });
      if (fatal) {
        rows.push(...abortedRows(keywords.slice(i + 1), error));
        return {
          provider: "openrush",
          mode: null,
          rows,
          cost: successes * OPENRUSH_INSPECT_KEYWORD_CREDITS,
          fatal: { error, error_kind: null },
        };
      }
      continue;
    }
    successes += 1;
    const found = inspected.metrics?.monthly_volume != null || inspected.metrics?.kw_difficulty != null;
    rows.push({ keyword, ok: true, entry: inspected.entry, found });
  }
  return {
    provider: "openrush",
    mode: null,
    rows,
    cost: successes * OPENRUSH_INSPECT_KEYWORD_CREDITS,
  };
}
