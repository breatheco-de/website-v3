/**
 * Paid visits from the site's own counts (data/<site>/visits.db) for paid page rows, shown next
 * to the GA4 numbers. Only for content types with "Optimize for ads" on for part of the range.
 * Same visit rule as page stats (no reloads, no suspected low quality).
 */

import { getVisitsDb } from "../analytics/first-party/visits-db";
import { listWindows, type TypeWindow } from "../analytics/first-party/windows";
import { flushSite } from "../analytics/first-party/ingest";
import { goodVisitSql, SUMMARY_GRACE_MS } from "../analytics/first-party/visit-quality";
import { getType } from "../content-types";
import { child } from "../logger";

const log = child({ module: "ads/own-paid-visits" });

export type OwnPaidVisits = {
  paid_visits: number;
  /** Days in the report range with "Optimize for ads" on for this content type. */
  covered_days: number;
  total_days: number;
};

type RowRef = { kind: string; content_type: string | null; path: string; redirected_from: string[] };

const DAY_MS = 86_400_000;

function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** Days of [start, end] touched by at least one counting window. */
export function coveredDays(windows: TypeWindow[], range: { start: string; end: string }, now: number): number {
  let n = 0;
  for (let t = dayStart(range.start); t <= dayStart(range.end); t += DAY_MS) {
    const end = t + DAY_MS - 1;
    if (windows.some((w) => w.enabled_at <= end && (w.disabled_at ?? now) >= t)) n += 1;
  }
  return n;
}

export function makeOwnPaidVisitsLookup(opts: {
  site: string;
  contentRoot: string;
  window: { start: string; end: string; days: number };
  rows: RowRef[];
  now?: number;
}): (row: RowRef) => OwnPaidVisits | null {
  const none = () => null;
  const now = opts.now ?? Date.now();
  try {
    const db = getVisitsDb(opts.site);
    if (!db) return none;
    flushSite(opts.site);

    const coverage = new Map<string, number>();
    const coverageFor = (contentType: string): number => {
      let type = contentType;
      try {
        type = getType(contentType, opts.contentRoot);
      } catch {
        /* keep row type */
      }
      if (!coverage.has(type)) coverage.set(type, coveredDays(listWindows(db, type), opts.window, now));
      return coverage.get(type)!;
    };

    const pathsOf = (r: RowRef) => [r.path, ...r.redirected_from];
    const wanted = new Set<string>();
    for (const r of opts.rows) {
      if (r.kind === "entry" && r.content_type && coverageFor(r.content_type) > 0) for (const p of pathsOf(r)) wanted.add(p);
    }
    if (wanted.size === 0) return none;

    const paths = Array.from(wanted);
    const visits = new Map<string, number>();
    const rows = db
      .prepare(
        `SELECT path, SUM(CASE WHEN ${goodVisitSql(now - SUMMARY_GRACE_MS)} THEN 1 ELSE 0 END) AS n
         FROM fp_page_views
         WHERE channel = 'paid' AND day >= ? AND day <= ? AND path IN (${paths.map(() => "?").join(", ")})
         GROUP BY path`,
      )
      .all(opts.window.start, opts.window.end, ...paths) as { path: string; n: number }[];
    for (const r of rows) visits.set(r.path, Number(r.n) || 0);

    return (r) => {
      if (r.kind !== "entry" || !r.content_type) return null;
      const covered = coverageFor(r.content_type);
      if (covered === 0) return null;
      const paid = pathsOf(r).reduce((s, p) => s + (visits.get(p) ?? 0), 0);
      return { paid_visits: paid, covered_days: covered, total_days: opts.window.days };
    };
  } catch (err) {
    log.warn({ err, site: opts.site }, "[ads] own paid visits lookup failed");
    return none;
  }
}
