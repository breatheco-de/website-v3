/**
 * Aggregate GSC organic-days cache into per-path traffic for Cluster Map.
 */

import { normalizePageUrl, type GscDayRow } from "./gsc-keep-filter";
import {
  completeDataDates,
  listOrganicDayDates,
  loadDaysRange,
  loadOrganicDay,
  type GscOrganicDayFile,
} from "./gsc-organic-days";
import {
  DEFAULT_ORGANIC_MARKETS,
  marketsForUi,
  resolveMarket,
  rowMatchesMarket,
  type OrganicMarket,
} from "./gsc-organic-markets";
import { getSearchConsoleSettings } from "./settings";
import { getDefaultContentFolder } from "./site-config";

export const ORGANIC_TRAFFIC_WINDOW_DAYS = 28;

export type PathTrafficStats = {
  clicks: number;
  impressions: number;
  position: number;
};

export type OrganicDayPoint = {
  day: string;
  clicks: number;
  impressions: number;
};

export type OrganicSiteTotals = {
  clicks: number;
  impressions: number;
  ctr: number;
};

export type OrganicPathTraffic = {
  window: { start: string; end: string } | null;
  /** Day files present anywhere in the organic-days cache. */
  days_present: number;
  /** Day files loaded inside the requested window. */
  days_in_window: number;
  days_expected: number;
  incomplete: boolean;
  /** True when any window day file lacks country on rows (pre-market cache). */
  country_less: boolean;
  /** True when any window day was truncated at DAY_ROW_CAP. */
  truncated: boolean;
  market: OrganicMarket;
  markets: OrganicMarket[];
  market_warning?: string;
  byPath: Record<string, PathTrafficStats>;
  totals: OrganicSiteTotals;
  series: OrganicDayPoint[];
};

const EMPTY_TOTALS: OrganicSiteTotals = { clicks: 0, impressions: 0, ctr: 0 };

function emptyOrganicPathTraffic(
  present: number,
  windowDays: number,
  market: OrganicMarket,
  markets: OrganicMarket[],
  warning?: string,
): OrganicPathTraffic {
  return {
    window: null,
    days_present: present,
    days_in_window: 0,
    days_expected: windowDays,
    incomplete: true,
    country_less: false,
    truncated: false,
    market,
    markets,
    ...(warning ? { market_warning: warning } : {}),
    byPath: {},
    totals: EMPTY_TOTALS,
    series: [],
  };
}

/** Day file is country-aware when it has no rows, or every row includes a `country` key. */
export function dayFileHasCountryDimension(file: GscOrganicDayFile): boolean {
  if (!Array.isArray(file.rows) || file.rows.length === 0) return true;
  return file.rows.every((r) => r && typeof r === "object" && "country" in r);
}

function filterRowsForMarket(rows: GscDayRow[], market: OrganicMarket): GscDayRow[] {
  return rows.filter((r) => rowMatchesMarket(r.country, market));
}

/**
 * One point per day file: sum of keep-filtered row clicks/impressions (zeros if empty).
 * When `paths` is non-null, only rows whose normalized path is in the set are counted
 * (used for cluster-only KPIs; unique paths — no double-count across clusters).
 * An empty set yields zeros (no clusters yet).
 */
export function sumDayTrafficSeries(
  files: Array<{ date: string; rows: GscDayRow[] }>,
  paths?: Set<string> | null,
): OrganicDayPoint[] {
  const filter = paths != null ? paths : null;
  return files.map((file) => {
    let clicks = 0;
    let impressions = 0;
    for (const r of file.rows) {
      if (filter) {
        const key = pathKeyFromUrlOrPath(r.url);
        if (!key || !filter.has(key)) continue;
      }
      clicks += r.clicks;
      impressions += r.impressions;
    }
    return { day: file.date, clicks, impressions };
  });
}

/** Window totals for a set of paths from an already-built byPath map (unique paths). */
export function sumTrafficForPathSet(
  byPath: Record<string, PathTrafficStats>,
  paths: Set<string>,
): OrganicSiteTotals {
  let clicks = 0;
  let impressions = 0;
  for (const path of paths) {
    const stats = byPath[path];
    if (!stats) continue;
    clicks += stats.clicks;
    impressions += stats.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
  };
}

export function sumSeriesTotals(series: OrganicDayPoint[]): OrganicSiteTotals {
  let clicks = 0;
  let impressions = 0;
  for (const p of series) {
    clicks += p.clicks;
    impressions += p.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
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

/** Normalize a site path or absolute URL to the pathname key used in byPath. */
export function pathKeyFromUrlOrPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) {
    const loc = normalizePageUrl(`https://placeholder.local${trimmed}`);
    return loc?.path ?? null;
  }
  const loc = normalizePageUrl(trimmed);
  return loc?.path ?? null;
}

export function aggregateTrafficByPath(days: { rows: GscDayRow[] }[]): Record<string, PathTrafficStats> {
  const map = new Map<string, { clicks: number; impressions: number; sum_position: number }>();
  for (const day of days) {
    for (const r of day.rows) {
      const key = pathKeyFromUrlOrPath(r.url);
      if (!key) continue;
      const cur = map.get(key) || { clicks: 0, impressions: 0, sum_position: 0 };
      cur.clicks += r.clicks;
      cur.impressions += r.impressions;
      cur.sum_position += r.sum_position;
      map.set(key, cur);
    }
  }
  const byPath: Record<string, PathTrafficStats> = {};
  for (const [path, cur] of map) {
    byPath[path] = {
      clicks: cur.clicks,
      impressions: cur.impressions,
      position: cur.impressions > 0 ? cur.sum_position / cur.impressions : 0,
    };
  }
  return byPath;
}

export function lookupPathTraffic(
  byPath: Record<string, PathTrafficStats>,
  urlOrPath: string | null | undefined,
): PathTrafficStats | undefined {
  if (!urlOrPath) return undefined;
  const key = pathKeyFromUrlOrPath(urlOrPath);
  if (!key) return undefined;
  return byPath[key];
}

export function sumPathTraffic(
  parts: Array<PathTrafficStats | undefined | null>,
): PathTrafficStats | undefined {
  let clicks = 0;
  let impressions = 0;
  let sum_position = 0;
  let any = false;
  for (const p of parts) {
    if (!p) continue;
    any = true;
    clicks += p.clicks;
    impressions += p.impressions;
    sum_position += p.impressions * p.position;
  }
  if (!any) return undefined;
  return {
    clicks,
    impressions,
    position: impressions > 0 ? sum_position / impressions : 0,
  };
}

export function buildOrganicPathTraffic(opts?: {
  contentFolder?: string;
  contentRoot?: string;
  days?: number;
  market?: string | null;
  /**
   * When set, `totals` and `series` only include these normalized paths.
   * `byPath` still includes every keep-filtered path (for per-page lookups).
   */
  kpiPaths?: Set<string> | null;
}): OrganicPathTraffic {
  const folder = opts?.contentFolder || getDefaultContentFolder();
  const windowDays = opts?.days ?? ORGANIC_TRAFFIC_WINDOW_DAYS;
  const markets =
    opts?.contentRoot != null
      ? getSearchConsoleSettings(opts.contentRoot).organic_markets
      : DEFAULT_ORGANIC_MARKETS.map((m) => ({ ...m, countries: [...m.countries] }));
  const resolved = resolveMarket(markets, opts?.market);
  const market = resolved.market;

  const expected = completeDataDates();
  const window = sliceExpected(expected, windowDays);
  const present = listOrganicDayDates(folder);
  if (!window) {
    return emptyOrganicPathTraffic(
      present.length,
      windowDays,
      market,
      markets,
      resolved.warning,
    );
  }
  const files = loadDaysRange(window.start, window.end, folder);
  if (files.length === 0) {
    return emptyOrganicPathTraffic(
      present.length,
      windowDays,
      market,
      markets,
      resolved.warning,
    );
  }

  let country_less = false;
  let truncated = false;
  for (const f of files) {
    if (!dayFileHasCountryDimension(f)) country_less = true;
    if (f.truncated) truncated = true;
  }

  const filtered = files.map((f) => ({
    date: f.date,
    rows: filterRowsForMarket(f.rows, market),
  }));

  // Count days that actually have traffic rows — empty stub files do not count.
  // Completeness is about cache coverage (market rows), not whether kpiPaths had clicks.
  const daysWithData = filtered.filter((f) => f.rows.length > 0).length;
  const incomplete = daysWithData < windowDays || country_less || truncated;
  const byPath = aggregateTrafficByPath(filtered);
  // null/undefined = all paths; Set (even empty) = scope KPI to those paths only
  const kpiPaths = opts?.kpiPaths != null ? opts.kpiPaths : null;
  const series = sumDayTrafficSeries(filtered, kpiPaths);
  return {
    window,
    days_present: present.length,
    days_in_window: daysWithData,
    days_expected: windowDays,
    incomplete,
    country_less,
    truncated,
    market,
    markets,
    ...(resolved.warning ? { market_warning: resolved.warning } : {}),
    byPath,
    totals: sumSeriesTotals(series),
    series,
  };
}

export function listMarketsForContentRoot(contentRoot?: string): {
  markets: OrganicMarket[];
  rollups: OrganicMarket[];
  countries: OrganicMarket[];
} {
  const markets = contentRoot
    ? getSearchConsoleSettings(contentRoot).organic_markets
    : DEFAULT_ORGANIC_MARKETS.map((m) => ({ ...m, countries: [...m.countries] }));
  const grouped = marketsForUi(markets);
  return { markets, rollups: grouped.rollups, countries: grouped.countries };
}

/** Probe whether the organic window still needs a country-aware backfill. */
export function organicWindowNeedsCountryBackfill(
  contentFolder?: string,
  days = ORGANIC_TRAFFIC_WINDOW_DAYS,
): boolean {
  const folder = contentFolder || getDefaultContentFolder();
  const expected = completeDataDates();
  const window = sliceExpected(expected, days);
  if (!window) return true;
  const dates = listOrganicDayDates(folder).filter((d) => d >= window.start && d <= window.end);
  if (dates.length === 0) return true;
  for (const d of dates) {
    const f = loadOrganicDay(d, folder);
    if (!f || !dayFileHasCountryDimension(f)) return true;
  }
  return false;
}
