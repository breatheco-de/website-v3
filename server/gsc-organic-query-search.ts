/**
 * GSC-style organic query search (query text → nested landing pages).
 * BigQuery first; day-cache fallback when BQ is unavailable.
 */

import {
  getGscBigQueryConfigStatus,
  queryOrganicByQueryFilter,
  type OrganicQueryMatchMode,
  type OrganicQueryUrlAggRow,
} from "./gsc-bigquery-client";
// Re-exported: mcp-server/lib/organic-traffic-mcp.ts imports the type from
// this module (it owns the parse/validate surface for match modes).
export type { OrganicQueryMatchMode } from "./gsc-bigquery-client";
import {
  completeDataDates,
  listOrganicDayDates,
  loadDaysRange,
} from "./gsc-organic-days";
import {
  DEFAULT_ORGANIC_MARKETS,
  resolveMarket,
  rowMatchesMarket,
  type OrganicMarket,
} from "./gsc-organic-markets";
import {
  ORGANIC_TRAFFIC_WINDOW_DAYS,
  pathKeyFromUrlOrPath,
  type OrganicSiteTotals,
} from "./gsc-organic-path-traffic";
import { getSearchConsoleSettings } from "./settings";
import { getDefaultContentFolder } from "./site-config";
import { aggregateDayRows } from "./seo-organic-opportunities";
import { child } from "./logger";

const log = child({ module: "gsc-organic-query-search" });

export const QUERIES_DEFAULT_WINDOW_DAYS = ORGANIC_TRAFFIC_WINDOW_DAYS;
export const QUERIES_MAX_SPAN_DAYS = 90;
export const QUERIES_MIN_CONTAINS_LEN = 2;
export const QUERIES_DEFAULT_LIMIT = 25;
export const QUERIES_MAX_LIMIT = 50;
export const QUERIES_DEFAULT_PAGES_PER_QUERY = 5;
export const QUERIES_MAX_PAGES_PER_QUERY = 15;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type OrganicQueryPageRow = {
  url: string;
  path: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type OrganicQueryItem = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  pages: OrganicQueryPageRow[];
};

export type OrganicQuerySearchResult = {
  configured: boolean;
  source: "bigquery" | "day_cache" | "none";
  window: { start: string; end: string } | null;
  days_in_window: number;
  days_expected: number;
  incomplete: boolean;
  truncated: boolean;
  market: OrganicMarket;
  markets: OrganicMarket[];
  market_warning?: string;
  match: { query_contains: string; match: OrganicQueryMatchMode };
  items: OrganicQueryItem[];
  selection_totals: OrganicSiteTotals;
  total: number;
  offset: number;
  next_offset: number | null;
  pages_per_query: number;
  limit: number;
  error?: string;
  /** Soft signals for MCP warnings (not HTTP errors). */
  notes: string[];
};

export function parseOrganicQueryMatchMode(raw: unknown): OrganicQueryMatchMode {
  if (raw === "equals" || raw === "starts_with" || raw === "contains") return raw;
  return "contains";
}

export function queryTextMatches(
  query: string,
  needle: string,
  match: OrganicQueryMatchMode,
): boolean {
  const q = query.toLowerCase().trim();
  const n = needle.toLowerCase().trim();
  if (!n) return false;
  if (match === "equals") return q === n;
  if (match === "starts_with") return q.startsWith(n);
  return q.includes(n);
}

export function inclusiveDaySpan(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00.000Z`);
  const b = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function resolveQueriesWindow(opts: {
  start?: string | null;
  end?: string | null;
  now?: Date;
}): { ok: true; start: string; end: string; days_expected: number } | { ok: false; message: string } {
  const startRaw = typeof opts.start === "string" ? opts.start.trim() : "";
  const endRaw = typeof opts.end === "string" ? opts.end.trim() : "";
  const hasStart = Boolean(startRaw);
  const hasEnd = Boolean(endRaw);
  if (hasStart !== hasEnd) {
    return {
      ok: false,
      message: "start and end must both be set (YYYY-MM-DD), or both omitted for the default 28-day window.",
    };
  }

  const expected = completeDataDates(opts.now ?? new Date(), Math.max(QUERIES_MAX_SPAN_DAYS, QUERIES_DEFAULT_WINDOW_DAYS));
  const latestComplete = expected[expected.length - 1];
  if (!latestComplete) {
    return { ok: false, message: "Could not resolve a complete GSC data date." };
  }

  if (!hasStart && !hasEnd) {
    const slice = expected.slice(-QUERIES_DEFAULT_WINDOW_DAYS);
    const start = slice[0]!;
    const end = slice[slice.length - 1]!;
    return { ok: true, start, end, days_expected: QUERIES_DEFAULT_WINDOW_DAYS };
  }

  if (!DATE_RE.test(startRaw) || !DATE_RE.test(endRaw)) {
    return { ok: false, message: "start and end must be YYYY-MM-DD." };
  }
  if (startRaw > endRaw) {
    return { ok: false, message: "start must be on or before end." };
  }
  const span = inclusiveDaySpan(startRaw, endRaw);
  if (!Number.isFinite(span) || span < 1) {
    return { ok: false, message: "Invalid date range." };
  }
  if (span > QUERIES_MAX_SPAN_DAYS) {
    return {
      ok: false,
      message: `Date range span is ${span} days; max is ${QUERIES_MAX_SPAN_DAYS}.`,
    };
  }

  let start = startRaw;
  let end = endRaw;
  if (end > latestComplete) end = latestComplete;
  if (start > end) {
    return {
      ok: true,
      start,
      end,
      days_expected: 0,
    };
  }
  return {
    ok: true,
    start,
    end,
    days_expected: inclusiveDaySpan(start, end),
  };
}

export function clampQueriesLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return QUERIES_DEFAULT_LIMIT;
  return Math.min(QUERIES_MAX_LIMIT, Math.max(1, Math.floor(raw)));
}

export function clampQueriesOffset(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

export function clampPagesPerQuery(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return QUERIES_DEFAULT_PAGES_PER_QUERY;
  return Math.min(QUERIES_MAX_PAGES_PER_QUERY, Math.max(1, Math.floor(raw)));
}

function emptyTotals(): OrganicSiteTotals {
  return { clicks: 0, impressions: 0, ctr: 0 };
}

function metricsFromSums(clicks: number, impressions: number, sum_position: number) {
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? sum_position / impressions : 0,
  };
}

function compareTraffic(
  a: { clicks: number; impressions: number; query?: string },
  b: { clicks: number; impressions: number; query?: string },
): number {
  if (a.clicks !== b.clicks) return b.clicks - a.clicks;
  if (a.impressions !== b.impressions) return b.impressions - a.impressions;
  return (a.query || "").localeCompare(b.query || "");
}

/** Nest query×url rows into query items with top landing pages; window-wide totals. */
export function nestOrganicQueryRows(
  rows: OrganicQueryUrlAggRow[],
  opts: { pagesPerQuery: number; offset: number; limit: number },
): {
  items: OrganicQueryItem[];
  selection_totals: OrganicSiteTotals;
  total: number;
  offset: number;
  next_offset: number | null;
} {
  type Acc = {
    query: string;
    clicks: number;
    impressions: number;
    sum_position: number;
    pages: Map<string, { url: string; clicks: number; impressions: number; sum_position: number }>;
  };
  const byQuery = new Map<string, Acc>();
  let totalClicks = 0;
  let totalImpressions = 0;

  for (const r of rows) {
    const q = (r.query || "").trim();
    if (!q) continue;
    totalClicks += r.clicks;
    totalImpressions += r.impressions;
    let acc = byQuery.get(q);
    if (!acc) {
      acc = { query: q, clicks: 0, impressions: 0, sum_position: 0, pages: new Map() };
      byQuery.set(q, acc);
    }
    acc.clicks += r.clicks;
    acc.impressions += r.impressions;
    acc.sum_position += r.sum_position;
    const url = r.url || "";
    const page = acc.pages.get(url) || { url, clicks: 0, impressions: 0, sum_position: 0 };
    page.clicks += r.clicks;
    page.impressions += r.impressions;
    page.sum_position += r.sum_position;
    acc.pages.set(url, page);
  }

  const ranked = [...byQuery.values()].sort(compareTraffic);
  const total = ranked.length;
  const offset = opts.offset;
  const limit = opts.limit;
  const slice = ranked.slice(offset, offset + limit);
  const items: OrganicQueryItem[] = slice.map((acc) => {
    const m = metricsFromSums(acc.clicks, acc.impressions, acc.sum_position);
    const pages = [...acc.pages.values()]
      .sort(compareTraffic)
      .slice(0, opts.pagesPerQuery)
      .map((p) => {
        const pm = metricsFromSums(p.clicks, p.impressions, p.sum_position);
        return {
          url: p.url,
          path: pathKeyFromUrlOrPath(p.url),
          ...pm,
        };
      });
    return { query: acc.query, ...m, pages };
  });

  return {
    items,
    selection_totals: {
      clicks: totalClicks,
      impressions: totalImpressions,
      ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
    },
    total,
    offset,
    next_offset: offset + limit < total ? offset + limit : null,
  };
}

function filterAggRowsByMatch(
  rows: OrganicQueryUrlAggRow[],
  needle: string,
  match: OrganicQueryMatchMode,
): OrganicQueryUrlAggRow[] {
  return rows.filter((r) => queryTextMatches(r.query, needle, match));
}

function dayCacheToAggRows(
  contentFolder: string,
  start: string,
  end: string,
  market: OrganicMarket,
): { rows: OrganicQueryUrlAggRow[]; days_in_window: number; truncated: boolean } {
  const files = loadDaysRange(start, end, contentFolder);
  let truncated = false;
  const filteredFiles = files.map((f) => {
    if (f.truncated) truncated = true;
    const rows = f.rows.filter((r) => rowMatchesMarket(r.country, market));
    return { ...f, rows };
  });
  const aggregated = aggregateDayRows(filteredFiles);
  const rows: OrganicQueryUrlAggRow[] = aggregated.map((r) => ({
    query: r.query,
    url: r.url,
    clicks: r.clicks,
    impressions: r.impressions,
    sum_position: r.impressions > 0 ? r.position * r.impressions : 0,
  }));
  return { rows, days_in_window: files.length, truncated };
}

export async function searchOrganicQueries(opts: {
  contentRoot?: string;
  contentFolder?: string;
  queryContains: string;
  match?: OrganicQueryMatchMode;
  start?: string;
  end?: string;
  market?: string;
  limit?: number;
  offset?: number;
  pagesPerQuery?: number;
  now?: Date;
}): Promise<OrganicQuerySearchResult | { error: string }> {
  const needle = (opts.queryContains || "").trim();
  if (needle.length < QUERIES_MIN_CONTAINS_LEN) {
    return {
      error: `query_contains must be at least ${QUERIES_MIN_CONTAINS_LEN} characters after trim.`,
    };
  }
  const match = parseOrganicQueryMatchMode(opts.match);
  const window = resolveQueriesWindow({
    start: opts.start,
    end: opts.end,
    now: opts.now,
  });
  if (!window.ok) return { error: window.message };

  const folder = opts.contentFolder || getDefaultContentFolder();
  const markets =
    getSearchConsoleSettings(opts.contentRoot).organic_markets?.length > 0
      ? getSearchConsoleSettings(opts.contentRoot).organic_markets
      : DEFAULT_ORGANIC_MARKETS.map((m) => ({ ...m, countries: [...m.countries] }));
  const resolved = resolveMarket(markets, opts.market);
  const market = resolved.market;
  const limit = clampQueriesLimit(opts.limit);
  const offset = clampQueriesOffset(opts.offset);
  const pages_per_query = clampPagesPerQuery(opts.pagesPerQuery);
  const notes: string[] = [];
  const matchMeta = { query_contains: needle, match };

  const emptyBase = (): OrganicQuerySearchResult => ({
    configured: false,
    source: "none",
    window: window.days_expected === 0 ? null : { start: window.start, end: window.end },
    days_in_window: 0,
    days_expected: window.days_expected,
    incomplete: true,
    truncated: false,
    market,
    markets,
    ...(resolved.warning ? { market_warning: resolved.warning } : {}),
    match: matchMeta,
    items: [],
    selection_totals: emptyTotals(),
    total: 0,
    offset,
    next_offset: null,
    pages_per_query,
    limit,
    notes,
  });

  if (window.days_expected === 0) {
    const out = emptyBase();
    out.configured = getGscBigQueryConfigStatus(opts.contentRoot).configured || listOrganicDayDates(folder).length > 0;
    out.notes.push("Date window empty after clamping to latest complete GSC day.");
    return out;
  }

  const bq = getGscBigQueryConfigStatus(opts.contentRoot);
  let rows: OrganicQueryUrlAggRow[] = [];
  let source: "bigquery" | "day_cache" | "none" = "none";
  let truncated = false;
  let days_in_window = 0;
  let error: string | undefined;

  if (bq.configured) {
    try {
      const result = await queryOrganicByQueryFilter({
        queryContains: needle,
        match,
        start: window.start,
        end: window.end,
        countries: market.countries.length > 0 ? market.countries : undefined,
        contentRoot: opts.contentRoot,
      });
      rows = result.rows;
      truncated = result.truncated;
      source = "bigquery";
      days_in_window = window.days_expected;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ err }, "[organic-query-search] BigQuery failed; trying day cache");
      error = message;
      notes.push(`bigquery_failed:${message}`);
    }
  }

  if (source === "none") {
    const cache = dayCacheToAggRows(folder, window.start, window.end, market);
    if (cache.days_in_window > 0) {
      rows = filterAggRowsByMatch(cache.rows, needle, match);
      truncated = cache.truncated;
      source = "day_cache";
      days_in_window = cache.days_in_window;
      notes.push("organic_from_day_cache");
    } else if (!bq.configured) {
      const out = emptyBase();
      out.error = bq.warnings[0] || "Search Console BigQuery is not configured and day cache is empty.";
      return out;
    } else {
      const out = emptyBase();
      out.configured = true;
      out.error = error || "BigQuery query failed and day cache has no days in the window.";
      out.notes = notes;
      return out;
    }
  }

  const nested = nestOrganicQueryRows(rows, {
    pagesPerQuery: pages_per_query,
    offset,
    limit,
  });

  const incomplete = source === "day_cache" && days_in_window < window.days_expected;
  if (source === "bigquery") {
    // BQ may lack some days in the range; we don't probe per-day here.
    days_in_window = window.days_expected;
  }

  return {
    configured: true,
    source,
    window: { start: window.start, end: window.end },
    days_in_window,
    days_expected: window.days_expected,
    incomplete,
    truncated,
    market,
    markets,
    ...(resolved.warning ? { market_warning: resolved.warning } : {}),
    match: matchMeta,
    items: nested.items,
    selection_totals: nested.selection_totals,
    total: nested.total,
    offset: nested.offset,
    next_offset: nested.next_offset,
    pages_per_query,
    limit,
    ...(error && source === "day_cache" ? { error } : {}),
    notes,
  };
}
