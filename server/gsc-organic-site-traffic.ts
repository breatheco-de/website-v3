/**
 * Site-wide organic traffic (all Search Console URLs) for the KPI window.
 * Sourced from BigQuery — not the keep-filtered organic-days cache.
 */

import fs from "fs";
import path from "path";
import { CACHE_DIR } from "./db-cache";
import {
  getGscBigQueryConfigStatus,
  querySiteOrganicDailyTotals,
} from "./gsc-bigquery-client";
import { completeDataDates } from "./gsc-organic-days";
import {
  ORGANIC_TRAFFIC_WINDOW_DAYS,
  sumSeriesTotals,
  type OrganicDayPoint,
  type OrganicSiteTotals,
} from "./gsc-organic-path-traffic";
import { getDefaultContentFolder } from "./site-config";
import { child } from "./logger";

const log = child({ module: "gsc-organic-site-traffic" });

/** Refresh site-wide BQ totals at most once per hour for a given window. */
export const SITE_ORGANIC_CACHE_TTL_MS = 60 * 60 * 1000;

export type SiteOrganicTraffic = {
  window: { start: string; end: string } | null;
  days_in_window: number;
  days_expected: number;
  incomplete: boolean;
  configured: boolean;
  source: "bigquery" | "cache" | "none";
  error?: string;
  totals: OrganicSiteTotals;
  series: OrganicDayPoint[];
};

type SiteOrganicCacheFile = {
  window: { start: string; end: string };
  fetched_at: string;
  series: OrganicDayPoint[];
};

const EMPTY_TOTALS: OrganicSiteTotals = { clicks: 0, impressions: 0, ctr: 0 };

function cachePath(contentFolder: string, start: string, end: string): string {
  return path.join(
    CACHE_DIR,
    contentFolder,
    "gsc-organic-site-totals",
    `${start}_${end}.json`,
  );
}

function sliceExpectedWindow(
  all: string[],
  days: number,
): { start: string; end: string } | null {
  if (all.length < days) return null;
  const slice = all.slice(all.length - days);
  return { start: slice[0]!, end: slice[slice.length - 1]! };
}

function emptySiteOrganic(opts: {
  window: { start: string; end: string } | null;
  daysExpected: number;
  configured: boolean;
  error?: string;
}): SiteOrganicTraffic {
  return {
    window: opts.window,
    days_in_window: 0,
    days_expected: opts.daysExpected,
    incomplete: true,
    configured: opts.configured,
    source: "none",
    error: opts.error,
    totals: EMPTY_TOTALS,
    series: [],
  };
}

function readCache(filePath: string): SiteOrganicCacheFile | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as SiteOrganicCacheFile;
    if (
      !parsed?.window?.start ||
      !parsed?.window?.end ||
      !parsed.fetched_at ||
      !Array.isArray(parsed.series)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(filePath: string, payload: SiteOrganicCacheFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload), "utf-8");
}

function fromSeries(
  window: { start: string; end: string },
  series: OrganicDayPoint[],
  daysExpected: number,
  source: "bigquery" | "cache",
  configured: boolean,
): SiteOrganicTraffic {
  return {
    window,
    days_in_window: series.length,
    days_expected: daysExpected,
    incomplete: series.length < daysExpected,
    configured,
    source,
    totals: sumSeriesTotals(series),
    series,
  };
}

export async function buildSiteOrganicTraffic(opts?: {
  contentRoot?: string;
  contentFolder?: string;
  days?: number;
  now?: Date;
  /** Force a BigQuery refresh even if cache is fresh. */
  force?: boolean;
}): Promise<SiteOrganicTraffic> {
  const folder = opts?.contentFolder || getDefaultContentFolder();
  const daysExpected = opts?.days ?? ORGANIC_TRAFFIC_WINDOW_DAYS;
  const expected = completeDataDates(opts?.now);
  const window = sliceExpectedWindow(expected, daysExpected);
  const status = getGscBigQueryConfigStatus(opts?.contentRoot);

  if (!window) {
    return emptySiteOrganic({
      window: null,
      daysExpected,
      configured: status.configured,
      error: status.configured ? undefined : status.warnings[0],
    });
  }

  if (!status.configured) {
    return emptySiteOrganic({
      window,
      daysExpected,
      configured: false,
      error: status.warnings[0] || "Search Console BigQuery is not configured",
    });
  }

  const file = cachePath(folder, window.start, window.end);
  const cached = readCache(file);
  if (
    !opts?.force &&
    cached &&
    cached.window.start === window.start &&
    cached.window.end === window.end
  ) {
    const age = Date.now() - Date.parse(cached.fetched_at);
    if (Number.isFinite(age) && age >= 0 && age < SITE_ORGANIC_CACHE_TTL_MS) {
      return fromSeries(window, cached.series, daysExpected, "cache", true);
    }
  }

  try {
    const series = await querySiteOrganicDailyTotals(window.start, window.end, opts?.contentRoot);
    writeCache(file, {
      window,
      fetched_at: new Date().toISOString(),
      series,
    });
    return fromSeries(window, series, daysExpected, "bigquery", true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err, window }, "[gsc-organic-site-traffic] BigQuery site totals failed");
    if (
      cached &&
      cached.window.start === window.start &&
      cached.window.end === window.end
    ) {
      return {
        ...fromSeries(window, cached.series, daysExpected, "cache", true),
        error: message,
      };
    }
    return emptySiteOrganic({
      window,
      daysExpected,
      configured: true,
      error: message,
    });
  }
}
