/**
 * Pure helpers for per-URL organic query lists (BigQuery → staff popover).
 */

import { normalizePageUrl } from "./gsc-keep-filter";
import { trafficCtr } from "./organic-entries";

export const ORGANIC_URL_QUERIES_CAP = 100;

export type OrganicUrlQueryAggInput = {
  query: string;
  clicks: number;
  impressions: number;
  sum_position: number;
};

export type OrganicUrlQueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
};

/** Same pathname key as pathKeyFromUrlOrPath (kept local to avoid BQ ↔ path-traffic cycles). */
export function organicUrlPathKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) {
    const loc = normalizePageUrl(`https://placeholder.local${trimmed}`);
    return loc?.path ?? null;
  }
  const loc = normalizePageUrl(trimmed);
  return loc?.path ?? null;
}

/** Keep only rows whose URL normalizes to the target path key. */
export function filterRowsMatchingPathKey<T extends { url: string }>(
  rows: T[],
  pathKey: string,
): T[] {
  if (!pathKey) return [];
  return rows.filter((r) => organicUrlPathKey(r.url) === pathKey);
}

/**
 * Drop blank queries, sort by impressions desc, cap, and derive position/ctr.
 */
export function finalizeOrganicUrlQueries(
  rows: OrganicUrlQueryAggInput[],
  cap = ORGANIC_URL_QUERIES_CAP,
): { queries: OrganicUrlQueryRow[]; truncated: boolean } {
  const safeCap = Math.max(1, Math.min(ORGANIC_URL_QUERIES_CAP, cap));
  const filtered = rows.filter((r) => typeof r.query === "string" && r.query.trim().length > 0);
  filtered.sort(
    (a, b) =>
      b.impressions - a.impressions ||
      b.clicks - a.clicks ||
      a.query.localeCompare(b.query),
  );
  const truncated = filtered.length > safeCap;
  const sliced = filtered.slice(0, safeCap);
  return {
    truncated,
    queries: sliced.map((r) => ({
      query: r.query.trim(),
      clicks: r.clicks,
      impressions: r.impressions,
      position: r.impressions > 0 ? r.sum_position / r.impressions : 0,
      ctr: trafficCtr(r.clicks, r.impressions),
    })),
  };
}

/** BigQuery REGEXP path extract → same key shape as organicUrlPathKey. */
export function sqlNormalizedPathExpression(urlColumn = "url"): string {
  return `COALESCE(
    NULLIF(
      REGEXP_REPLACE(
        REGEXP_EXTRACT(${urlColumn}, r'^https?://[^/?#]+(/[^?#]*)?'),
        r'/+$',
        ''
      ),
      ''
    ),
    '/'
  )`;
}
