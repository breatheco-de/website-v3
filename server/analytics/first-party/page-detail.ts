/**
 * get_analytics_report page_detail from the site's own visit counts (data/<site>/visits.db).
 * Coverage = the latest continuous "Optimize for ads" on-period; a window reaching outside it
 * fails instead of stitching GA4 or returning a silently shorter range.
 */

import type Database from "better-sqlite3";
import { PAGE_STATS_MIN_SESSIONS } from "@shared/page-stats";
import type { TypeWindow } from "./windows";
import { goodVisitSql, lowQualitySql, SUMMARY_GRACE_MS } from "./visit-quality";
import { RAW_RETENTION_DAYS, utcDay } from "./ingest";

export type FirstPartyCoverage = {
  /** First full UTC day after the latest switch-on. */
  collecting_since: string;
  /** First day that can be read: first full day, or the raw retention cutoff when later. */
  start: string;
  /** Last day that can be read: yesterday while on, else the switch-off day (never after yesterday). */
  end: string;
  enabled: boolean;
};

export type FirstPartyWindowPlan = {
  start: string;
  end: string;
  days: number;
  days_shortened: boolean;
  window_end_shifted: boolean;
};

export type FirstPartyWindowError = {
  message: string;
  details: Record<string, unknown>;
};

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetweenInclusive(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function yesterdayUtc(now: number): string {
  return addDays(utcDay(now), -1);
}

/** Latest on-period of the type, or null when it was never switched on. */
export function latestCoverage(windows: TypeWindow[], now: number): FirstPartyCoverage | null {
  if (windows.length === 0) return null;
  const last = [...windows].sort((a, b) => a.enabled_at - b.enabled_at)[windows.length - 1]!;
  const yesterday = yesterdayUtc(now);
  const collectingSince = addDays(utcDay(last.enabled_at), 1);
  const retentionStart = addDays(utcDay(now), -RAW_RETENTION_DAYS);
  const offDay = last.disabled_at === null ? null : utcDay(last.disabled_at);
  return {
    collecting_since: collectingSince,
    start: collectingSince > retentionStart ? collectingSince : retentionStart,
    end: offDay === null || offDay > yesterday ? yesterday : offDay,
    enabled: last.disabled_at === null,
  };
}

/**
 * Pick the window. `days` passed explicitly must fit inside coverage; omitted days shorten
 * to what is covered. `shiftEnd` (explicit first_party on a switched-off type) ends the
 * window on the switch-off day instead of yesterday.
 */
export function planFirstPartyWindow(opts: {
  coverage: FirstPartyCoverage | null;
  days: number;
  daysExplicit: boolean;
  defaultDays: number;
  shiftEnd: boolean;
  now: number;
}): { ok: true; plan: FirstPartyWindowPlan } | { ok: false; error: FirstPartyWindowError } {
  const { coverage } = opts;
  const yesterday = yesterdayUtc(opts.now);
  if (!coverage) {
    return {
      ok: false,
      error: {
        message:
          "No visits counted for this page's content type yet (Optimize for ads has no on-period). Use source \"ga4\".",
        details: { source: "first_party", available_from: null, max_days: 0 },
      },
    };
  }
  const end = opts.shiftEnd ? coverage.end : yesterday;
  if (end > coverage.end) {
    return {
      ok: false,
      error: {
        message:
          `Optimize for ads has been off for this page's type since ${coverage.end}, so the site's own counts stop there. ` +
          `Pass source "first_party" to read the on-period (window ends ${coverage.end}), or source "ga4".`,
        details: { source: "first_party", available_from: coverage.start, available_until: coverage.end, max_days: 0 },
      },
    };
  }
  if (coverage.start > end) {
    const tooOld = coverage.collecting_since <= end;
    return {
      ok: false,
      error: {
        message: tooOld
          ? `The site's own counts for this period are older than the ${RAW_RETENTION_DAYS}-day retention. Use source "ga4".`
          : `No complete day of the site's own counts yet (collecting since ${coverage.collecting_since}). Try again tomorrow or use source "ga4".`,
        details: {
          source: "first_party",
          available_from: coverage.start,
          collecting_since: coverage.collecting_since,
          max_days: 0,
          ...(tooOld ? { retention_days: RAW_RETENTION_DAYS } : {}),
        },
      },
    };
  }
  const maxDays = daysBetweenInclusive(coverage.start, end);
  if (opts.daysExplicit && opts.days > maxDays) {
    return {
      ok: false,
      error: {
        message:
          `days ${opts.days} reaches before the site's own counts start (${coverage.start}). ` +
          `The most you can ask for is days ${maxDays}. For a longer history pass source "ga4" ` +
          `(GA4 counts sessions differently from the page-stats drawer).`,
        details: { source: "first_party", available_from: coverage.start, available_until: end, max_days: maxDays },
      },
    };
  }
  const days = opts.daysExplicit ? opts.days : Math.min(opts.defaultDays, maxDays);
  return {
    ok: true,
    plan: {
      start: addDays(end, -(days - 1)),
      end,
      days,
      days_shortened: !opts.daysExplicit && days < opts.defaultDays,
      window_end_shifted: end !== yesterday,
    },
  };
}

type PathRow = {
  path: string;
  views: number;
  sessions: number;
  low_quality: number;
  cta_clicks: number;
  form_starts: number;
  video_starts: number;
  video_completes: number;
};

export type FirstPartyPageDetail = {
  rows: Array<{ path: string; views: number; sessions: number }>;
  totals: {
    views: number;
    sessions: number;
    top_events: [];
    interactions: { cta_clicks: number; form_starts: number; video_starts: number; video_completes: number };
    low_quality_excluded: number;
  };
  low_sample: boolean;
};

/** Views = every stored page view; sessions = counted visits (same rule as page stats). */
export function queryFirstPartyPageDetail(
  db: Database.Database,
  paths: string[],
  window: { start: string; end: string },
  now: number,
): FirstPartyPageDetail {
  const staleBefore = now - SUMMARY_GRACE_MS;
  const good = goodVisitSql(staleBefore);
  const lq = lowQualitySql(staleBefore);
  const found =
    paths.length === 0
      ? []
      : (db
          .prepare(
            `SELECT path,
               COUNT(*) AS views,
               SUM(CASE WHEN ${good} THEN 1 ELSE 0 END) AS sessions,
               SUM(CASE WHEN counted_visit = 1 AND ${lq} THEN 1 ELSE 0 END) AS low_quality,
               SUM(CASE WHEN ${good} THEN cta_clicks ELSE 0 END) AS cta_clicks,
               SUM(CASE WHEN ${good} THEN form_starts ELSE 0 END) AS form_starts,
               SUM(CASE WHEN ${good} THEN video_starts ELSE 0 END) AS video_starts,
               SUM(CASE WHEN ${good} THEN video_completes ELSE 0 END) AS video_completes
             FROM fp_page_views
             WHERE path IN (${paths.map(() => "?").join(", ")}) AND day >= ? AND day <= ?
             GROUP BY path`,
          )
          .all(...paths, window.start, window.end) as PathRow[]);
  const byPath = new Map(found.map((r) => [r.path, r]));
  const picked = paths.map((p) => byPath.get(p));
  const sum = (k: keyof Omit<PathRow, "path">) => picked.reduce((s, r) => s + Number(r?.[k] ?? 0), 0);
  const sessions = sum("sessions");
  return {
    rows: paths.map((p, i) => ({ path: p, views: Number(picked[i]?.views ?? 0), sessions: Number(picked[i]?.sessions ?? 0) })),
    totals: {
      views: sum("views"),
      sessions,
      top_events: [],
      interactions: {
        cta_clicks: sum("cta_clicks"),
        form_starts: sum("form_starts"),
        video_starts: sum("video_starts"),
        video_completes: sum("video_completes"),
      },
      low_quality_excluded: sum("low_quality"),
    },
    low_sample: sessions < PAGE_STATS_MIN_SESSIONS,
  };
}
