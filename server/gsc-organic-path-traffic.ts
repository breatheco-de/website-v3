/**
 * Aggregate GSC organic-days cache into per-path traffic for Cluster Map.
 */

import { normalizePageUrl, type GscDayRow } from "./gsc-keep-filter";
import {
  completeDataDates,
  listOrganicDayDates,
  loadDaysRange,
} from "./gsc-organic-days";
import { getDefaultContentFolder } from "./site-config";

export const ORGANIC_TRAFFIC_WINDOW_DAYS = 28;

export type PathTrafficStats = {
  clicks: number;
  impressions: number;
  position: number;
};

export type OrganicPathTraffic = {
  window: { start: string; end: string } | null;
  /** Day files present anywhere in the organic-days cache. */
  days_present: number;
  /** Day files loaded inside the requested window. */
  days_in_window: number;
  days_expected: number;
  incomplete: boolean;
  byPath: Record<string, PathTrafficStats>;
};

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
  days?: number;
}): OrganicPathTraffic {
  const folder = opts?.contentFolder || getDefaultContentFolder();
  const windowDays = opts?.days ?? ORGANIC_TRAFFIC_WINDOW_DAYS;
  const expected = completeDataDates();
  const window = sliceExpected(expected, windowDays);
  const present = listOrganicDayDates(folder);
  if (!window) {
    return {
      window: null,
      days_present: present.length,
      days_in_window: 0,
      days_expected: windowDays,
      incomplete: true,
      byPath: {},
    };
  }
  const files = loadDaysRange(window.start, window.end, folder);
  if (files.length === 0) {
    return {
      window: null,
      days_present: present.length,
      days_in_window: 0,
      days_expected: windowDays,
      incomplete: true,
      byPath: {},
    };
  }
  const incomplete = files.length < windowDays;
  return {
    window,
    days_present: present.length,
    days_in_window: files.length,
    days_expected: windowDays,
    incomplete,
    byPath: aggregateTrafficByPath(files),
  };
}
