/**
 * High-traffic query×URL pairs outside hub/spoke clusters for SEO overview cards.
 */

import type { GscDayRow } from "./gsc-keep-filter";
import { completeDataDates, loadDaysRange } from "./gsc-organic-days";
import {
  DEFAULT_ORGANIC_MARKETS,
  resolveMarket,
  rowMatchesMarket,
  type OrganicMarket,
} from "./gsc-organic-markets";
import {
  dayFileHasCountryDimension,
  ORGANIC_TRAFFIC_WINDOW_DAYS,
  pathKeyFromUrlOrPath,
} from "./gsc-organic-path-traffic";
import { getSearchConsoleSettings } from "./settings";
import { getDefaultContentFolder } from "./site-config";
import type { SeoIndex } from "./seo-index";
import {
  aggregateDayRows,
  gscUrlToPath,
  type AggregatedGscRow,
} from "./seo-organic-opportunities";

export const OTHER_TRAFFIC_ROW_LIMIT = 25;
/** Keep if clicks ≥ 1 or impressions ≥ this (matches keep-filter floor). */
export const OTHER_TRAFFIC_MIN_IMPRESSIONS = 5;

export type OtherHighTrafficRow = AggregatedGscRow;

export type OtherHighTrafficResult = {
  known: OtherHighTrafficRow[];
  unknown: OtherHighTrafficRow[];
  window: { start: string; end: string } | null;
  market: OrganicMarket;
  days_in_window: number;
  days_expected: number;
  incomplete: boolean;
};

function sliceExpected(
  all: string[],
  days: number,
): { start: string; end: string } | null {
  const endIdx = all.length;
  const startIdx = endIdx - days;
  if (startIdx < 0 || endIdx <= 0) return null;
  const slice = all.slice(startIdx, endIdx);
  if (slice.length === 0) return null;
  return { start: slice[0]!, end: slice[slice.length - 1]! };
}

function filterRowsForMarket(rows: GscDayRow[], market: OrganicMarket): GscDayRow[] {
  return rows.filter((r) => rowMatchesMarket(r.country, market));
}

/** Hub paths + spoke member paths from seo-index clusters (normalized pathnames). */
export function clusteredPathsFromSeoIndex(index: SeoIndex): Set<string> {
  const out = new Set<string>();
  for (const cluster of Object.values(index.clusters)) {
    const hubKey = pathKeyFromUrlOrPath(cluster.path);
    if (hubKey) out.add(hubKey);
    for (const memberId of cluster.members) {
      const entry = index.entries[memberId];
      if (!entry?.path) continue;
      const memberKey = pathKeyFromUrlOrPath(entry.path);
      if (memberKey) out.add(memberKey);
    }
  }
  return out;
}

export function passesOtherTrafficMinBar(row: Pick<AggregatedGscRow, "clicks" | "impressions">): boolean {
  return row.clicks >= 1 || row.impressions >= OTHER_TRAFFIC_MIN_IMPRESSIONS;
}

function sortAndCap(rows: OtherHighTrafficRow[], limit: number): OtherHighTrafficRow[] {
  return [...rows]
    .sort((a, b) => {
      if (b.clicks !== a.clicks) return b.clicks - a.clicks;
      return b.impressions - a.impressions;
    })
    .slice(0, limit);
}

/**
 * Split aggregated GSC rows into known-outside-cluster vs unknown CMS URLs.
 * Opted-out known pages are included in `known` (not hubs/spokes).
 */
export function classifyOtherHighTraffic(
  rows: AggregatedGscRow[],
  opts: {
    isKnownUrl: (path: string) => boolean;
    clusteredPaths: Set<string>;
    limit?: number;
  },
): { known: OtherHighTrafficRow[]; unknown: OtherHighTrafficRow[] } {
  const limit = opts.limit ?? OTHER_TRAFFIC_ROW_LIMIT;
  const known: OtherHighTrafficRow[] = [];
  const unknown: OtherHighTrafficRow[] = [];

  for (const row of rows) {
    if (!passesOtherTrafficMinBar(row)) continue;
    const path = gscUrlToPath(row.url);
    if (!opts.isKnownUrl(path)) {
      unknown.push(row);
      continue;
    }
    if (!opts.clusteredPaths.has(path)) {
      known.push(row);
    }
  }

  return {
    known: sortAndCap(known, limit),
    unknown: sortAndCap(unknown, limit),
  };
}

export function buildOtherHighTraffic(opts: {
  contentFolder?: string;
  contentRoot?: string;
  days?: number;
  market?: string | null;
  seoIndex: SeoIndex;
  isKnownUrl: (path: string) => boolean;
}): OtherHighTrafficResult {
  const folder = opts.contentFolder || getDefaultContentFolder();
  const windowDays = opts.days ?? ORGANIC_TRAFFIC_WINDOW_DAYS;
  const markets =
    opts.contentRoot != null
      ? getSearchConsoleSettings(opts.contentRoot).organic_markets
      : DEFAULT_ORGANIC_MARKETS.map((m) => ({ ...m, countries: [...m.countries] }));
  const resolved = resolveMarket(markets, opts.market);
  const market = resolved.market;
  const clusteredPaths = clusteredPathsFromSeoIndex(opts.seoIndex);

  const empty = (window: { start: string; end: string } | null = null): OtherHighTrafficResult => ({
    known: [],
    unknown: [],
    window,
    market,
    days_in_window: 0,
    days_expected: windowDays,
    incomplete: true,
  });

  const expected = completeDataDates();
  const window = sliceExpected(expected, windowDays);
  if (!window) return empty(null);

  const files = loadDaysRange(window.start, window.end, folder);
  if (files.length === 0) return empty(window);

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
  const daysWithData = filtered.filter((f) => f.rows.length > 0).length;
  const incomplete = daysWithData < windowDays || country_less || truncated;

  const aggregated = aggregateDayRows(filtered);
  const { known, unknown } = classifyOtherHighTraffic(aggregated, {
    isKnownUrl: opts.isKnownUrl,
    clusteredPaths,
  });

  return {
    known,
    unknown,
    window,
    market,
    days_in_window: daysWithData,
    days_expected: windowDays,
    incomplete,
  };
}
