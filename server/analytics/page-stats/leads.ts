/**
 * Leads for one page from the lead ledger (`lead_submissions`): leads that converted on this
 * page (`conversion_path`) and leads whose visit started here (`landing_path`), kept apart.
 * Test and repeat leads are excluded from every count and reported separately.
 */

import { getSiteSqlite } from "../../db";
import { ensurePipelineDb } from "../../pipeline-db/runner";
import { ledgerCollectingSince } from "../../ads/lead-ledger";
import { PAID_SQL } from "../../ads/leads-query";
import { normalizeLandingPath } from "@shared/paid-traffic";
import type { LeadBlock, LeadBreakdownRow, LeadsFacts, Section } from "@shared/page-stats";

const TOP = 8;

type Window = { startMs: number; endMs: number };
type Db = ReturnType<typeof getSiteSqlite>;

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

function breakdown(db: Db, where: string, params: unknown[], expr: string): LeadBreakdownRow[] {
  const rows = db
    .prepare(
      `SELECT ${expr} AS k, COUNT(*) AS n FROM lead_submissions WHERE ${where} GROUP BY k ORDER BY n DESC LIMIT ${TOP}`,
    )
    .all(...params) as Array<{ k: string | null; n: number }>;
  return rows.map((r) => ({ key: r.k && String(r.k).trim() ? String(r.k) : "(none)", count: r.n }));
}

type Extra = { sql: string; params: unknown[] };
const NO_EXTRA: Extra = { sql: "", params: [] };

function block(
  db: Db,
  column: "conversion_path" | "landing_path",
  paths: string[],
  cur: Window,
  prior: Window | null,
  extra: Extra = NO_EXTRA,
): LeadBlock {
  const inPaths = `${column} IN (${placeholders(paths.length)})`;
  const clean = "is_test = 0 AND is_repeat = 0";
  const curWhere = `${clean} AND ${inPaths} AND created_at >= ? AND created_at < ?${extra.sql}`;
  const curParams = [...paths, cur.startMs, cur.endMs, ...extra.params];
  const count = (where: string, params: unknown[]) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM lead_submissions WHERE ${where}`).get(...params) as { n: number }).n;
  const series = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n
       FROM lead_submissions WHERE ${curWhere} GROUP BY day ORDER BY day`,
    )
    .all(...curParams) as Array<{ day: string; n: number }>;
  return {
    count: count(curWhere, curParams),
    prior_count: prior
      ? count(`${clean} AND ${inPaths} AND created_at >= ? AND created_at < ?${extra.sql}`, [...paths, prior.startMs, prior.endMs, ...extra.params])
      : 0,
    paid_count: count(`${curWhere} AND ${PAID_SQL}`, curParams),
    by_form: breakdown(db, curWhere, curParams, "form"),
    by_channel: breakdown(db, curWhere, curParams, `CASE WHEN ${PAID_SQL} THEN 'paid' ELSE IFNULL(channel, '(not tracked)') END`),
    by_campaign: breakdown(db, curWhere, curParams, "utm_campaign"),
    by_country: breakdown(db, curWhere, curParams, "country"),
    by_version: breakdown(db, `${curWhere} AND variant IS NOT NULL`, curParams, "variant"),
    series: series.map((r) => ({ day: r.day, count: r.n })),
  };
}

/** Window bounds are UTC days (YYYY-MM-DD); `end` is inclusive. */
function dayWindow(start: string, end: string): Window {
  return { startMs: Date.parse(`${start}T00:00:00.000Z`), endMs: Date.parse(`${end}T00:00:00.000Z`) + 86_400_000 };
}

/** Clean converted-here leads per conversion path (same-stage benchmark numerators). */
export function convertedByPath(site: string, paths: string[], window: { start: string; end: string }): Map<string, number> {
  const out = new Map<string, number>();
  if (paths.length === 0) return out;
  try {
    ensurePipelineDb(site);
    const w = dayWindow(window.start, window.end);
    const norm = Array.from(new Set(paths.map(normalizeLandingPath)));
    const rows = getSiteSqlite(site)
      .prepare(
        `SELECT conversion_path AS p, COUNT(*) AS n FROM lead_submissions
         WHERE is_test = 0 AND is_repeat = 0 AND created_at >= ? AND created_at < ?
           AND conversion_path IN (${placeholders(norm.length)})
         GROUP BY conversion_path`,
      )
      .all(w.startMs, w.endMs, ...norm) as Array<{ p: string; n: number }>;
    for (const r of rows) out.set(r.p, r.n);
  } catch {
    return out;
  }
  return out;
}

export function queryPageLeads(opts: {
  site: string;
  paths: string[];
  current: { start: string; end: string };
  prior: { start: string; end: string };
}): Section<LeadsFacts> {
  try {
    ensurePipelineDb(opts.site);
    const db = getSiteSqlite(opts.site);
    const paths = Array.from(new Set(opts.paths.map(normalizeLandingPath)));
    const cur = dayWindow(opts.current.start, opts.current.end);
    const prior = dayWindow(opts.prior.start, opts.prior.end);
    const inPaths = (c: string) => `${c} IN (${placeholders(paths.length)})`;
    const any = `(${inPaths("conversion_path")} OR ${inPaths("landing_path")})`;
    const anyParams = [...paths, ...paths, cur.startMs, cur.endMs];
    const scalar = (sql: string, params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n;
    const since = ledgerCollectingSince(opts.site);
    const data: LeadsFacts = {
      converted_here: block(db, "conversion_path", paths, cur, prior),
      started_here: block(db, "landing_path", paths, cur, prior),
      both: scalar(
        `SELECT COUNT(*) AS n FROM lead_submissions WHERE is_test = 0 AND is_repeat = 0
           AND ${inPaths("conversion_path")} AND ${inPaths("landing_path")} AND created_at >= ? AND created_at < ?`,
        [...paths, ...paths, cur.startMs, cur.endMs],
      ),
      excluded_test: scalar(`SELECT COUNT(*) AS n FROM lead_submissions WHERE is_test = 1 AND ${any} AND created_at >= ? AND created_at < ?`, anyParams),
      excluded_repeat: scalar(
        `SELECT COUNT(*) AS n FROM lead_submissions WHERE is_test = 0 AND is_repeat = 1 AND ${any} AND created_at >= ? AND created_at < ?`,
        anyParams,
      ),
      collecting_since: since ? new Date(since).toISOString().slice(0, 10) : null,
    };
    return { status: "ok", as_of: new Date().toISOString(), data };
  } catch (err) {
    return { status: "error", as_of: null, message: err instanceof Error ? err.message : String(err), data: null };
  }
}

/**
 * Leads per version of one test run (no prior period). `converted_here` = sent on this page;
 * `all_from_test` = any lead carrying this test and version, wherever the form was sent.
 */
export function queryTestLeads(opts: {
  site: string;
  paths: string[];
  experimentId: string;
  versions: string[];
  window: { start: string; end: string };
}): Map<string, Section<LeadsFacts>> {
  const out = new Map<string, Section<LeadsFacts>>();
  try {
    ensurePipelineDb(opts.site);
    const db = getSiteSqlite(opts.site);
    const paths = Array.from(new Set(opts.paths.map(normalizeLandingPath)));
    const cur = dayWindow(opts.window.start, opts.window.end);
    const inPaths = (c: string) => `${c} IN (${placeholders(paths.length)})`;
    const any = `(${inPaths("conversion_path")} OR ${inPaths("landing_path")})`;
    const scalar = (sql: string, params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n;
    const since = ledgerCollectingSince(opts.site);
    for (const version of opts.versions) {
      const extra: Extra = { sql: " AND experiment_id = ? AND variant = ?", params: [opts.experimentId, version] };
      const anyParams = [...paths, ...paths, cur.startMs, cur.endMs, ...extra.params];
      const data: LeadsFacts = {
        converted_here: { ...block(db, "conversion_path", paths, cur, null, extra), by_version: [] },
        started_here: { ...block(db, "landing_path", paths, cur, null, extra), by_version: [] },
        both: scalar(
          `SELECT COUNT(*) AS n FROM lead_submissions WHERE is_test = 0 AND is_repeat = 0
             AND ${inPaths("conversion_path")} AND ${inPaths("landing_path")} AND created_at >= ? AND created_at < ?${extra.sql}`,
          [...paths, ...paths, cur.startMs, cur.endMs, ...extra.params],
        ),
        excluded_test: scalar(`SELECT COUNT(*) AS n FROM lead_submissions WHERE is_test = 1 AND ${any} AND created_at >= ? AND created_at < ?${extra.sql}`, anyParams),
        excluded_repeat: scalar(
          `SELECT COUNT(*) AS n FROM lead_submissions WHERE is_test = 0 AND is_repeat = 1 AND ${any} AND created_at >= ? AND created_at < ?${extra.sql}`,
          anyParams,
        ),
        collecting_since: since ? new Date(since).toISOString().slice(0, 10) : null,
        all_from_test: scalar(
          `SELECT COUNT(*) AS n FROM lead_submissions WHERE is_test = 0 AND is_repeat = 0 AND created_at >= ? AND created_at < ?${extra.sql}`,
          [cur.startMs, cur.endMs, ...extra.params],
        ),
      };
      out.set(version, { status: "ok", as_of: new Date().toISOString(), data });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const version of opts.versions) out.set(version, { status: "error", as_of: null, message, data: null });
  }
  return out;
}
