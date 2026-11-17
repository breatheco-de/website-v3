/**
 * Page-1 CTR health rollup for SEO overview KPIs.
 * Impression-weighted CTR for query×URL rows at positions 1–10 with enough impressions.
 * Computed on read from organic-days cache — no separate KPI store.
 */

import { expectedCtrForPosition, type GscDayRow } from "./gsc-keep-filter";
import { completeDataDates, listOrganicDayDates, loadDaysRange } from "./gsc-organic-days";
import {
  DEFAULT_ORGANIC_MARKETS,
  resolveMarket,
  rowMatchesMarket,
  type OrganicMarket,
} from "./gsc-organic-markets";
import { ORGANIC_TRAFFIC_WINDOW_DAYS, dayFileHasCountryDimension } from "./gsc-organic-path-traffic";
import { getSearchConsoleSettings } from "./settings";
import { getDefaultContentFolder } from "./site-config";

/** Local shape — avoid importing seo-organic-opportunities (cycles with cluster-metrics). */
export type Page1CtrRow = {
  query: string;
  url: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
};

function aggregateQueryUrlRows(days: { rows: GscDayRow[] }[]): Page1CtrRow[] {
  const map = new Map<
    string,
    { query: string; url: string; clicks: number; impressions: number; sum_position: number }
  >();
  for (const day of days) {
    for (const r of day.rows) {
      const key = `${r.query}\0${r.url}`;
      const cur = map.get(key) || {
        query: r.query,
        url: r.url,
        clicks: 0,
        impressions: 0,
        sum_position: 0,
      };
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
      cur.sum_position += r.sum_position;
      map.set(key, cur);
    }
  }
  return [...map.values()].map((r) => ({
    query: r.query,
    url: r.url,
    clicks: r.clicks,
    impressions: r.impressions,
    position: r.impressions > 0 ? r.sum_position / r.impressions : 0,
    ctr: r.impressions > 0 ? r.clicks / r.impressions : 0,
  }));
}

/** Same bar as classifyLowCtr / Diagnostics. */
export const PAGE1_CTR_MIN_IMPRESSIONS = 100;
/** Badge "below expected" when actual < expected * this ratio. */
export const PAGE1_CTR_GAP_RATIO = 0.5;

export type Page1CtrBand = {
  ctr: number;
  expected_ctr: number;
  impressions: number;
  clicks: number;
  query_count: number;
};

export type Page1CtrRollup = {
  empty: boolean;
  ctr: number | null;
  expected_ctr: number | null;
  /** True when ctr is under 50% of expected (and both are non-null). */
  below_expected: boolean;
  impressions: number;
  clicks: number;
  query_count: number;
  below_expected_count: number;
  band_1_3: Page1CtrBand | null;
  band_4_10: Page1CtrBand | null;
};

export type Page1CtrKpi = Page1CtrRollup & {
  window: { start: string; end: string } | null;
  days_in_window: number;
  days_expected: number;
  incomplete: boolean;
  market: OrganicMarket;
};

function emptyBand(): Page1CtrBand {
  return { ctr: 0, expected_ctr: 0, impressions: 0, clicks: 0, query_count: 0 };
}

function finalizeBand(acc: Page1CtrBand): Page1CtrBand | null {
  if (acc.impressions <= 0 || acc.query_count <= 0) return null;
  return {
    ctr: acc.clicks / acc.impressions,
    expected_ctr: acc.expected_ctr / acc.impressions,
    impressions: acc.impressions,
    clicks: acc.clicks,
    query_count: acc.query_count,
  };
}

/** Pure rollup from already-aggregated GSC rows (any market/window). */
export function rollupPage1Ctr(rows: Page1CtrRow[]): Page1CtrRollup {
  let clicks = 0;
  let impressions = 0;
  let expectedWeighted = 0;
  let query_count = 0;
  let below_expected_count = 0;
  const band13 = emptyBand();
  const band410 = emptyBand();

  for (const r of rows) {
    if (!r.query.trim()) continue;
    if (r.impressions < PAGE1_CTR_MIN_IMPRESSIONS) continue;
    if (r.position <= 0 || r.position > 10) continue;

    const expected = expectedCtrForPosition(r.position);
    clicks += r.clicks;
    impressions += r.impressions;
    expectedWeighted += expected * r.impressions;
    query_count += 1;
    if (r.ctr < expected * PAGE1_CTR_GAP_RATIO) below_expected_count += 1;

    const band = r.position <= 3 ? band13 : band410;
    band.clicks += r.clicks;
    band.impressions += r.impressions;
    band.expected_ctr += expected * r.impressions;
    band.query_count += 1;
  }

  if (impressions <= 0 || query_count <= 0) {
    return {
      empty: true,
      ctr: null,
      expected_ctr: null,
      below_expected: false,
      impressions: 0,
      clicks: 0,
      query_count: 0,
      below_expected_count: 0,
      band_1_3: null,
      band_4_10: null,
    };
  }

  const ctr = clicks / impressions;
  const expected_ctr = expectedWeighted / impressions;
  return {
    empty: false,
    ctr,
    expected_ctr,
    below_expected: ctr < expected_ctr * PAGE1_CTR_GAP_RATIO,
    impressions,
    clicks,
    query_count,
    below_expected_count,
    band_1_3: finalizeBand(band13),
    band_4_10: finalizeBand(band410),
  };
}

function sliceExpected(
  all: string[],
  days: number,
  offsetEnd = 0,
): { start: string; end: string } | null {
  const endIdx = all.length - offsetEnd;
  const startIdx = endIdx - days;
  if (startIdx < 0 || endIdx <= 0) return null;
  const slice = all.slice(startIdx, endIdx);
  if (slice.length === 0) return null;
  return { start: slice[0]!, end: slice[slice.length - 1]! };
}

/**
 * Load market-filtered day rows for the default (or explicit) traffic window and roll up Page-1 CTR.
 */
export function buildPage1CtrKpi(opts: {
  contentFolder?: string;
  contentRoot?: string;
  market?: string | null;
  days?: number;
  /** When set, use this window instead of trailing `days`. */
  window?: { start: string; end: string } | null;
}): Page1CtrKpi {
  const folder = opts.contentFolder || getDefaultContentFolder();
  const daysExpected = opts.days ?? ORGANIC_TRAFFIC_WINDOW_DAYS;
  const markets =
    opts.contentRoot != null
      ? getSearchConsoleSettings(opts.contentRoot).organic_markets
      : DEFAULT_ORGANIC_MARKETS.map((m) => ({ ...m, countries: [...m.countries] }));
  const resolved = resolveMarket(markets, opts.market);
  const market = resolved.market;

  const window =
    opts.window?.start && opts.window?.end
      ? opts.window
      : sliceExpected(completeDataDates(), daysExpected);

  const empty = (incomplete: boolean): Page1CtrKpi => ({
    window,
    days_in_window: 0,
    days_expected: daysExpected,
    incomplete,
    market,
    empty: true,
    ctr: null,
    expected_ctr: null,
    below_expected: false,
    impressions: 0,
    clicks: 0,
    query_count: 0,
    below_expected_count: 0,
    band_1_3: null,
    band_4_10: null,
  });

  if (!window) return empty(true);

  const files = loadDaysRange(window.start, window.end, folder);
  if (files.length === 0) {
    return { ...empty(true), days_in_window: 0 };
  }

  let country_less = false;
  let truncated = false;
  for (const f of files) {
    if (!dayFileHasCountryDimension(f)) country_less = true;
    if (f.truncated) truncated = true;
  }

  const filtered: Array<{ date: string; rows: GscDayRow[] }> = files.map((f) => ({
    date: f.date,
    rows: f.rows.filter((r) => rowMatchesMarket(r.country, market)),
  }));
  const daysWithData = filtered.filter((f) => f.rows.length > 0).length;
  const incomplete = daysWithData < daysExpected || country_less || truncated;
  const rollup = rollupPage1Ctr(aggregateQueryUrlRows(filtered));

  return {
    window,
    days_in_window: daysWithData,
    days_expected: daysExpected,
    incomplete,
    market,
    ...rollup,
  };
}

/** Present for callers that only need a presence check. */
export function page1CtrDaysPresent(contentFolder?: string): number {
  return listOrganicDayDates(contentFolder || getDefaultContentFolder()).length;
}
