/**
 * Read side of the lead ledger for the Leads page (/private/store/leads):
 * a newest-first page of 20 leads, one lead's full row, and the stats above the table (KPIs, timeline, breakdowns).
 * All counting happens in SQLite on `lead_submissions` (indexed on created_at); days are UTC.
 * Never returns browser_hash.
 */

import { getSiteSqlite } from "../db";
import { ensurePipelineDb } from "../pipeline-db/runner";
import { ledgerCollectingSince } from "./lead-ledger";
import { funnelBreakdowns, funnelFilterLabels, funnelFilterSql, type FunnelIndex, type FunnelRow } from "./leads-funnel";
import { utmViolations, type UtmGrace } from "@shared/ads-diagnostics-rules";
import { DEFAULT_UTM_CONVENTION, type UtmConvention } from "@shared/ads-settings";
import { PAID_LOOKBACK_DAYS, PAID_MEDIUMS } from "@shared/paid-traffic";
import { isTrafficChannel, TRAFFIC_CHANNEL_LABELS } from "@shared/traffic-channel";
import {
  LEADS_BREAKDOWN_TOP,
  LEADS_DAILY_MAX_DAYS,
  LEADS_DAY_MS,
  LEADS_NONE,
  LEADS_PAGE_SIZE,
  LEADS_TTL_BOUNDS,
  LEADS_TTL_BUCKETS,
  LEADS_TTL_LABELS,
  leadsDeltaPct,
  leadsRangeBounds,
  normalizeUtmKey,
  sharePct,
  utcDayKey,
  type LeadDetail,
  type LeadsBreakdownRow,
  type LeadsFilters,
  type LeadsListResponse,
  type LeadsListRow,
  type LeadsLocalCopy,
  type LeadsOffConventionValue,
  type LeadsQuery,
  type LeadsShow,
  type LeadsStatsResponse,
  type LeadsTimelinePoint,
  type LeadsTimelineSeries,
  LEADS_TIMELINE_SERIES,
} from "@shared/leads-query";

type Where = { sql: string; params: (string | number)[] };
type Window = { startMs: number; endMs?: number };

const LIST_COLUMNS = [
  "submission_id", "created_at", "form", "host", "locale",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "platform",
  "landing_path", "conversion_path", "experiment_id", "variant",
  "is_test", "test_reason", "is_repeat", "channel", "last_organic_channel",
] as const;

const PAID_MEDIUMS_SQL = PAID_MEDIUMS.map((m) => `'${m.replace(/'/g, "''")}'`).join(", ");
/**
 * Only a Facebook click id, no paid medium or Meta id. New rows store the ledger's status;
 * older rows (no traffic_status) are recognized from their stored tags.
 */
export const UNCLEAR_SQL = `(IFNULL(traffic_status, '') = 'unclear' OR (traffic_status IS NULL
  AND IFNULL(platform, '') = 'meta' AND IFNULL(click_id_type, '') = 'fbclid' AND campaign_id IS NULL
  AND LOWER(TRIM(IFNULL(utm_medium, ''))) NOT IN (${PAID_MEDIUMS_SQL})))`;
/**
 * Paid: a paid platform that isn't Meta-unclear, or (rows recorded after channel tracking only)
 * a paid landing within the paid lookback before the lead.
 */
export const PAID_SQL = `((platform IS NOT NULL AND NOT ${UNCLEAR_SQL}) OR (traffic_status IS NOT NULL
  AND last_paid_at IS NOT NULL AND (created_at - last_paid_at) BETWEEN -3600000 AND ${PAID_LOOKBACK_DAYS * LEADS_DAY_MS}))`;
const TAGGED_SQL = "(utm_source IS NOT NULL OR utm_medium IS NOT NULL OR utm_campaign IS NOT NULL)";
/** Timeline series of one lead (LEADS_TIMELINE_SERIES). */
const SERIES_SQL = `CASE
  WHEN ${PAID_SQL} THEN 'paid'
  WHEN ${UNCLEAR_SQL} THEN 'meta_unclear'
  WHEN channel IS NULL THEN 'not_tracked'
  WHEN channel = 'organic_search' THEN 'organic_search'
  WHEN channel = 'ai_assistant' THEN 'ai_assistant'
  ELSE 'other_organic' END`;
const NO_CONSENT_SQL = "IFNULL(consent_state, '') IN ('denied', 'unset')";

function nullableEq(column: string, value: string, conds: string[], params: (string | number)[]): void {
  if (value === LEADS_NONE) {
    conds.push(`(${column} IS NULL OR TRIM(${column}) = '')`);
  } else {
    conds.push(`${column} = ?`);
    params.push(value);
  }
}

/**
 * Parameterized WHERE for the show selector, filter chips and an optional time window.
 * `trackingIndex` resolves persona ids for the funnel_persona filter on rows without pairs.
 */
export function buildLeadsWhere(
  q: { show: LeadsShow; filters: LeadsFilters },
  window?: Window | null,
  trackingIndex?: FunnelIndex,
): Where {
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (q.show === "real") conds.push("is_test = 0 AND is_repeat = 0");
  else if (q.show === "test") conds.push("is_test = 1");
  if (window) {
    conds.push("created_at >= ?");
    params.push(window.startMs);
    if (window.endMs != null) {
      conds.push("created_at < ?");
      params.push(window.endMs);
    }
  }
  const f = q.filters;
  for (const key of ["source", "medium"] as const) {
    const v = f[key];
    if (!v) continue;
    const column = key === "source" ? "utm_source" : "utm_medium";
    if (v === LEADS_NONE) conds.push(`(${column} IS NULL OR TRIM(${column}) = '')`);
    else {
      conds.push(`LOWER(TRIM(${column})) = ?`);
      params.push(normalizeUtmKey(v));
    }
  }
  if (f.conversion_path) nullableEq("conversion_path", f.conversion_path, conds, params);
  if (f.landing_path) nullableEq("landing_path", f.landing_path, conds, params);
  if (f.experiment) nullableEq("experiment_id", f.experiment, conds, params);
  if (f.variant) nullableEq("variant", f.variant, conds, params);
  if (f.channel) nullableEq("channel", f.channel, conds, params);
  if (f.product) {
    if (f.product === LEADS_NONE) {
      conds.push("(product_id IS NULL OR TRIM(product_id) = '') AND (product_slug IS NULL OR TRIM(product_slug) = '')");
    } else {
      conds.push("(product_id = ? OR product_slug = ?)");
      params.push(f.product, f.product);
    }
  }
  funnelFilterSql(f, trackingIndex, conds, params);
  if (f.ttl) {
    const [min, max] = LEADS_TTL_BOUNDS[f.ttl];
    conds.push("first_paid_at IS NOT NULL");
    if (min != null) {
      conds.push("(created_at - first_paid_at) >= ?");
      params.push(min * LEADS_DAY_MS);
    }
    if (max != null) {
      conds.push("(created_at - first_paid_at) < ?");
      params.push(max * LEADS_DAY_MS);
    }
  }
  return { sql: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

function and(where: Where, extra: string): string {
  return where.sql ? `${where.sql} AND ${extra}` : `WHERE ${extra}`;
}

/** Newest-first page of 20 leads for the current range, toggle and filters. */
export function listLeadsPage(
  site: string,
  q: LeadsQuery,
  nowMs: number = Date.now(),
  trackingIndex?: FunnelIndex,
): LeadsListResponse {
  ensurePipelineDb(site);
  const db = getSiteSqlite(site);
  const bounds = leadsRangeBounds(q.range, nowMs, ledgerCollectingSince(site));
  const where = buildLeadsWhere(q, q.range === "all" ? null : { startMs: bounds.startMs }, trackingIndex);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM lead_submissions ${where.sql}`).get(...where.params) as { n: number }).n;
  const totalPages = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));
  const page = Math.min(Math.max(1, q.page), totalPages);
  const rows = db
    .prepare(
      `SELECT ${LIST_COLUMNS.join(", ")} FROM lead_submissions ${where.sql}
       ORDER BY created_at DESC, submission_id DESC LIMIT ? OFFSET ?`,
    )
    .all(...where.params, LEADS_PAGE_SIZE, (page - 1) * LEADS_PAGE_SIZE) as LeadsListRow[];
  return { total, page, page_size: LEADS_PAGE_SIZE, total_pages: totalPages, rows };
}

/** One lead's full ledger row (without browser_hash), or null when the id is unknown. */
export function getLeadDetail(site: string, submissionId: string): LeadDetail | null {
  ensurePipelineDb(site);
  const row = getSiteSqlite(site)
    .prepare("SELECT * FROM lead_submissions WHERE submission_id = ?")
    .get(submissionId) as (LeadDetail & { browser_hash?: unknown }) | undefined;
  if (!row) return null;
  const { browser_hash: _hidden, ...detail } = row;
  return detail;
}

function topWithOther(rows: LeadsBreakdownRow[], whole: number): LeadsBreakdownRow[] {
  const sorted = [...rows].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (sorted.length <= LEADS_BREAKDOWN_TOP) return sorted;
  const top = sorted.slice(0, LEADS_BREAKDOWN_TOP);
  const rest = sorted.slice(LEADS_BREAKDOWN_TOP).reduce((n, r) => n + r.count, 0);
  top.push({ key: "__other__", label: `Other (${sorted.length - LEADS_BREAKDOWN_TOP})`, count: rest, pct: sharePct(rest, whole) ?? 0, filter: null });
  return top;
}

/**
 * Source/medium values (as sent, on this platform) that break the site's UTM convention, one per
 * param + value. Values the grace period still accepts are left out. Only source/medium rules count;
 * id and campaign rules need params the breakdown does not group by.
 */
export function offConventionValues(
  source: string | null,
  medium: string | null,
  platform: string | null,
  convention: UtmConvention = DEFAULT_UTM_CONVENTION,
  grace: UtmGrace | null = null,
): Omit<LeadsOffConventionValue, "leads">[] {
  const out = new Map<string, Omit<LeadsOffConventionValue, "leads">>();
  const p = platform === "meta" || platform === "google" ? platform : null;
  for (const v of utmViolations({ params: { utm_source: source, utm_medium: medium }, platform, convention, grace, kind: "observed" })) {
    if (v.in_grace || (v.param !== "utm_source" && v.param !== "utm_medium")) continue;
    const key = `${v.param}\u0001${v.value}`;
    const cur = out.get(key) ?? { param: v.param, value: v.value, expected: null, platform: p, codes: [] };
    cur.codes.push(v.code);
    // Platform rules come last and name the final value (e.g. "fb" over the lowercase "facebook").
    if (v.expected) cur.expected = v.expected;
    out.set(key, cur);
  }
  return Array.from(out.values());
}

export function isOffConvention(
  source: string | null,
  medium: string | null,
  platform: string | null,
  convention: UtmConvention = DEFAULT_UTM_CONVENTION,
  grace: UtmGrace | null = null,
): boolean {
  return offConventionValues(source, medium, platform, convention, grace).length > 0;
}

function mostCommon(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = -1;
  counts.forEach((n, v) => {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  });
  return best;
}

function sourceMediumBreakdown(
  rows: { utm_source: string | null; utm_medium: string | null; platform: string | null; n: number }[],
  whole: number,
  convention: UtmConvention,
  grace: UtmGrace | null,
): LeadsBreakdownRow[] {
  type Group = { source: string; medium: string; count: number; spellings: Map<string, number>; off: Map<string, LeadsOffConventionValue> };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const source = normalizeUtmKey(r.utm_source);
    const medium = normalizeUtmKey(r.utm_medium);
    const key = `${source}\u0001${medium}`;
    const g = groups.get(key) ?? { source, medium, count: 0, spellings: new Map(), off: new Map() };
    g.count += r.n;
    const spelling = `${r.utm_source?.trim() || LEADS_NONE} / ${r.utm_medium?.trim() || LEADS_NONE}`;
    g.spellings.set(spelling, (g.spellings.get(spelling) ?? 0) + r.n);
    if (r.utm_source || r.utm_medium) {
      for (const v of offConventionValues(r.utm_source, r.utm_medium, r.platform, convention, grace)) {
        const vk = `${v.param}\u0001${v.value}\u0001${v.platform ?? ""}`;
        const cur = g.off.get(vk);
        if (cur) cur.leads += r.n;
        else g.off.set(vk, { ...v, leads: r.n });
      }
    }
    groups.set(key, g);
  }
  const out: LeadsBreakdownRow[] = [];
  groups.forEach((g, key) => {
    const untagged = g.source === LEADS_NONE && g.medium === LEADS_NONE;
    out.push({
      key,
      label: untagged ? "Direct / untagged" : mostCommon(g.spellings) ?? `${g.source} / ${g.medium}`,
      count: g.count,
      pct: sharePct(g.count, whole) ?? 0,
      filter: { source: g.source, medium: g.medium },
      off_convention: Array.from(g.off.values()).sort((a, b) => b.leads - a.leads || a.param.localeCompare(b.param)),
    });
  });
  return topWithOther(out, whole);
}

function pathBreakdown(
  rows: { path: string | null; locale: string | null; n: number }[],
  whole: number,
  filterKey: "conversion_path" | "landing_path",
): LeadsBreakdownRow[] {
  const groups = new Map<string, { count: number; locales: Map<string, number> }>();
  for (const r of rows) {
    const path = r.path?.trim() || LEADS_NONE;
    const g = groups.get(path) ?? { count: 0, locales: new Map() };
    g.count += r.n;
    if (r.locale) g.locales.set(r.locale, (g.locales.get(r.locale) ?? 0) + r.n);
    groups.set(path, g);
  }
  const out: LeadsBreakdownRow[] = [];
  groups.forEach((g, path) => {
    out.push({
      key: path,
      label: path === LEADS_NONE ? "(unknown page)" : path,
      count: g.count,
      pct: sharePct(g.count, whole) ?? 0,
      filter: { [filterKey]: path },
      locale: mostCommon(g.locales),
    });
  });
  return topWithOther(out, whole);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "landing:coding-bootcamp:en" + "b" -> "coding-bootcamp (en) · b".
 * "landing:coding-bootcamp:en@2026-10-23" + "b" -> "coding-bootcamp (en, from Oct 23) · b".
 */
export function experimentLabel(experimentId: string, variant: string | null): string {
  const at = experimentId.lastIndexOf("@");
  const base = at > 0 ? experimentId.slice(0, at) : experimentId;
  const run = at > 0 ? experimentId.slice(at + 1) : "";
  const parts = base.split(":");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(run);
  const from = m ? `, from ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}` : run ? `, run ${run}` : "";
  const page = parts.length === 3 ? `${parts[1]} (${parts[2]}${from})` : experimentId;
  return `${page} · ${variant ?? "(no variant)"}`;
}

function experimentBreakdown(rows: { experiment_id: string; variant: string | null; n: number }[]): LeadsBreakdownRow[] {
  const whole = rows.reduce((n, r) => n + r.n, 0);
  const out = rows.map((r) => ({
    key: `${r.experiment_id}\u0001${r.variant ?? ""}`,
    label: experimentLabel(r.experiment_id, r.variant),
    count: r.n,
    pct: sharePct(r.n, whole) ?? 0,
    filter: { experiment: r.experiment_id, variant: r.variant ?? LEADS_NONE },
  }));
  return topWithOther(out, whole);
}

function mondayKey(day: string): string {
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  return utcDayKey(ms - dow * LEADS_DAY_MS);
}

function emptyPoint(date: string): LeadsTimelinePoint {
  return { date, paid: 0, meta_unclear: 0, organic_search: 0, ai_assistant: 0, other_organic: 0, not_tracked: 0 };
}

function buildTimeline(
  rows: { day: string; series: string; n: number }[],
  startMs: number,
  nowMs: number,
  days: number,
): LeadsStatsResponse["timeline"] {
  const byDay = new Map<string, LeadsTimelinePoint>();
  for (const r of rows) {
    if (!(LEADS_TIMELINE_SERIES as readonly string[]).includes(r.series)) continue;
    const p = byDay.get(r.day) ?? emptyPoint(r.day);
    p[r.series as LeadsTimelineSeries] += r.n;
    byDay.set(r.day, p);
  }
  const daily: LeadsTimelinePoint[] = [];
  const lastKey = utcDayKey(nowMs);
  for (let ms = startMs; ; ms += LEADS_DAY_MS) {
    const key = utcDayKey(ms);
    daily.push(byDay.get(key) ?? emptyPoint(key));
    if (key >= lastKey) break;
  }
  if (days <= LEADS_DAILY_MAX_DAYS) return { bucket: "day", points: daily };
  const weeks = new Map<string, LeadsTimelinePoint>();
  for (const p of daily) {
    const wk = mondayKey(p.date);
    const w = weeks.get(wk) ?? emptyPoint(wk);
    for (const s of LEADS_TIMELINE_SERIES) w[s] += p[s];
    weeks.set(wk, w);
  }
  return { bucket: "week", points: Array.from(weeks.values()) };
}

function channelBreakdown(rows: { channel: string | null; n: number }[], whole: number): LeadsBreakdownRow[] {
  const out: LeadsBreakdownRow[] = rows.map((r) => {
    const key = r.channel && isTrafficChannel(r.channel) ? r.channel : LEADS_NONE;
    return {
      key,
      label: key === LEADS_NONE ? "Not tracked yet" : TRAFFIC_CHANNEL_LABELS[key as keyof typeof TRAFFIC_CHANNEL_LABELS],
      count: r.n,
      pct: sharePct(r.n, whole) ?? 0,
      filter: { channel: key },
    };
  });
  const merged = new Map<string, LeadsBreakdownRow>();
  for (const r of out) {
    const prev = merged.get(r.key);
    if (prev) {
      prev.count += r.count;
      prev.pct = sharePct(prev.count, whole) ?? 0;
    } else merged.set(r.key, r);
  }
  return topWithOther(Array.from(merged.values()), whole);
}

/** First non-test lead with a channel (when channel tracking started recording). */
export function trackingSince(site: string): number | null {
  ensurePipelineDb(site);
  const row = getSiteSqlite(site)
    .prepare("SELECT MIN(created_at) AS first FROM lead_submissions WHERE channel IS NOT NULL AND is_test = 0")
    .get() as { first: number | null } | undefined;
  return row?.first ?? null;
}

/** First non-test lead with a page funnel product list (since pipeline migration 41). */
export function funnelSince(site: string): number | null {
  ensurePipelineDb(site);
  const row = getSiteSqlite(site)
    .prepare("SELECT MIN(created_at) AS first FROM lead_submissions WHERE product IS NOT NULL AND is_test = 0")
    .get() as { first: number | null } | undefined;
  return row?.first ?? null;
}

/** First non-test lead with a product (when product recording started). */
export function productSince(site: string): number | null {
  ensurePipelineDb(site);
  const row = getSiteSqlite(site)
    .prepare("SELECT MIN(created_at) AS first FROM lead_submissions WHERE product_id IS NOT NULL AND is_test = 0")
    .get() as { first: number | null } | undefined;
  return row?.first ?? null;
}

export function getLeadsStats(
  site: string,
  q: Pick<LeadsQuery, "range" | "show" | "filters">,
  opts: {
    convention?: UtmConvention;
    grace?: UtmGrace | null;
    nowMs?: number;
    localCopy?: LeadsLocalCopy;
    trackingIndex?: FunnelIndex;
  } = {},
): LeadsStatsResponse {
  ensurePipelineDb(site);
  const db = getSiteSqlite(site);
  const nowMs = opts.nowMs ?? Date.now();
  const convention = opts.convention ?? DEFAULT_UTM_CONVENTION;
  const trackingIndex = opts.trackingIndex;
  const collectingSince = ledgerCollectingSince(site);
  const bounds = leadsRangeBounds(q.range, nowMs, collectingSince);
  const where = buildLeadsWhere(q, q.range === "all" ? null : { startMs: bounds.startMs }, trackingIndex);
  const count = (w: Where, extra?: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM lead_submissions ${extra ? and(w, extra) : w.sql}`).get(...w.params) as { n: number }).n;

  const totalAllTime = count(buildLeadsWhere({ show: q.show, filters: {} }));
  const kpiRow = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN ${PAID_SQL} THEN 1 ELSE 0 END), 0) AS paid,
              COALESCE(SUM(CASE WHEN ${TAGGED_SQL} THEN 1 ELSE 0 END), 0) AS tagged,
              COALESCE(SUM(CASE WHEN channel IS NOT NULL THEN 1 ELSE 0 END), 0) AS tracked,
              COALESCE(SUM(CASE WHEN channel = 'organic_search' AND NOT ${PAID_SQL} THEN 1 ELSE 0 END), 0) AS organic_search,
              COALESCE(SUM(CASE WHEN ${NO_CONSENT_SQL} THEN 1 ELSE 0 END), 0) AS no_consent,
              COALESCE(SUM(CASE WHEN ${UNCLEAR_SQL} AND NOT ${PAID_SQL} THEN 1 ELSE 0 END), 0) AS meta_unclear,
              COALESCE(SUM(CASE WHEN is_test = 1 AND test_reason = 'staff_session' THEN 1 ELSE 0 END), 0) AS test_staff,
              COALESCE(SUM(CASE WHEN is_test = 1 AND test_reason = 'email_pattern' THEN 1 ELSE 0 END), 0) AS test_email
       FROM lead_submissions ${where.sql}`,
    )
    .get(...where.params) as {
    n: number;
    paid: number;
    tagged: number;
    tracked: number;
    organic_search: number;
    no_consent: number;
    meta_unclear: number;
    test_staff: number;
    test_email: number;
  };
  const inRange = kpiRow.n;
  const previous = bounds.previous ? count(buildLeadsWhere(q, bounds.previous, trackingIndex)) : null;

  const timelineRows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, ${SERIES_SQL} AS series, COUNT(*) AS n
       FROM lead_submissions ${where.sql} GROUP BY day, series`,
    )
    .all(...where.params) as { day: string; series: string; n: number }[];

  const channelRows = db
    .prepare(`SELECT channel, COUNT(*) AS n FROM lead_submissions ${where.sql} GROUP BY channel`)
    .all(...where.params) as { channel: string | null; n: number }[];

  const smRows = db
    .prepare(
      `SELECT utm_source, utm_medium, platform, COUNT(*) AS n FROM lead_submissions ${where.sql}
       GROUP BY utm_source, utm_medium, platform`,
    )
    .all(...where.params) as { utm_source: string | null; utm_medium: string | null; platform: string | null; n: number }[];

  const pathRows = (column: "conversion_path" | "landing_path") =>
    db
      .prepare(`SELECT ${column} AS path, locale, COUNT(*) AS n FROM lead_submissions ${where.sql} GROUP BY ${column}, locale`)
      .all(...where.params) as { path: string | null; locale: string | null; n: number }[];

  const expRows = db
    .prepare(
      `SELECT experiment_id, variant, COUNT(*) AS n FROM lead_submissions ${and(where, "experiment_id IS NOT NULL")}
       GROUP BY experiment_id, variant`,
    )
    .all(...where.params) as { experiment_id: string; variant: string | null; n: number }[];

  const funnelRows = db
    .prepare(
      `SELECT product, persona, product_persona, COUNT(*) AS n FROM lead_submissions ${where.sql}
       GROUP BY product, persona, product_persona`,
    )
    .all(...where.params) as FunnelRow[];
  const funnel = funnelBreakdowns(funnelRows, inRange, trackingIndex, topWithOther);
  const funnelLabels = funnelFilterLabels(q.filters, trackingIndex);

  const gapWhere = and(where, "first_paid_at IS NOT NULL");
  const bucketSql = LEADS_TTL_BUCKETS.map((b) => {
    const [min, max] = LEADS_TTL_BOUNDS[b];
    const parts = [
      min != null ? `(created_at - first_paid_at) >= ${min * LEADS_DAY_MS}` : null,
      max != null ? `(created_at - first_paid_at) < ${max * LEADS_DAY_MS}` : null,
    ].filter(Boolean);
    return `COALESCE(SUM(CASE WHEN ${parts.join(" AND ")} THEN 1 ELSE 0 END), 0) AS "${b}"`;
  }).join(", ");
  const ttlRow = db
    .prepare(`SELECT COUNT(*) AS n, ${bucketSql} FROM lead_submissions ${gapWhere}`)
    .get(...where.params) as Record<string, number>;
  const paidWithClick = ttlRow.n ?? 0;
  let medianDays: number | null = null;
  if (paidWithClick > 0) {
    const gapAt = (offset: number) =>
      (db
        .prepare(`SELECT (created_at - first_paid_at) AS gap FROM lead_submissions ${gapWhere} ORDER BY gap LIMIT 1 OFFSET ?`)
        .get(...where.params, offset) as { gap: number }).gap;
    const mid = Math.floor(paidWithClick / 2);
    const gap = paidWithClick % 2 === 1 ? gapAt(mid) : (gapAt(mid - 1) + gapAt(mid)) / 2;
    medianDays = Math.round((Math.max(0, gap) / LEADS_DAY_MS) * 10) / 10;
  }

  return {
    range: q.range,
    start_ms: bounds.startMs,
    end_ms: bounds.endMs,
    collecting_since: collectingSince,
    kpis: {
      total_all_time: totalAllTime,
      in_range: inRange,
      previous,
      delta_pct: leadsDeltaPct(inRange, previous, bounds.previous?.startMs ?? null, collectingSince),
      paid: kpiRow.paid,
      paid_share: sharePct(kpiRow.paid, inRange),
      tagged: kpiRow.tagged,
      tagged_share: sharePct(kpiRow.tagged, inRange),
      tracked: kpiRow.tracked,
      organic_search: kpiRow.organic_search,
      organic_share: sharePct(kpiRow.organic_search, kpiRow.tracked),
      no_consent: kpiRow.no_consent,
      meta_unclear: kpiRow.meta_unclear,
      test_staff: kpiRow.test_staff,
      test_email: kpiRow.test_email,
    },
    tracking_since: trackingSince(site),
    product_since: productSince(site),
    funnel_since: funnelSince(site),
    funnel_persona_product_unknown: funnel.personaProductUnknown,
    ...(funnelLabels ? { funnel_filter_labels: funnelLabels } : {}),
    timeline: buildTimeline(timelineRows, bounds.startMs, nowMs, bounds.days),
    breakdowns: {
      source_medium: sourceMediumBreakdown(smRows, inRange, convention, opts.grace ?? null),
      channels: channelBreakdown(channelRows, inRange),
      conversion_paths: pathBreakdown(pathRows("conversion_path"), inRange, "conversion_path"),
      landing_paths: pathBreakdown(pathRows("landing_path"), inRange, "landing_path"),
      experiments: experimentBreakdown(expRows),
      funnel_products: funnel.products,
      funnel_personas: funnel.personas,
      time_to_lead: {
        paid_with_click: paidWithClick,
        median_days: medianDays,
        buckets: LEADS_TTL_BUCKETS.map((b) => ({
          key: b,
          label: LEADS_TTL_LABELS[b],
          count: ttlRow[b] ?? 0,
          pct: sharePct(ttlRow[b] ?? 0, paidWithClick) ?? 0,
          filter: { ttl: b },
        })),
      },
    },
    ...(opts.localCopy ? { local_copy: opts.localCopy } : {}),
  };
}
