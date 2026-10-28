/**
 * Named GA4 analytics reports from BigQuery export (events_*).
 * Short in-memory TTL only — same window semantics as journey-analytics.
 */

import {
  fqEventsWildcard,
  getBigQueryClient,
  getBigQueryConfigStatus,
  getBigQuerySettings,
} from "../ecommerce/bigquery-client";
import { normalizeAnalyticsPath } from "../ecommerce/journey-analytics";
import { contentIndex, type ContentIndex } from "../content-index";
import {
  getLeadConversionEventNames,
  getTrackingSettings,
  isCountsAsLeadConfigured,
} from "../settings";
import { child } from "../logger";
import { latestCoverage, planFirstPartyWindow, queryFirstPartyPageDetail } from "./first-party/page-detail";
import { getVisitsDb } from "./first-party/visits-db";
import { flushSite } from "./first-party/ingest";
import type { TypeWindow } from "./first-party/windows";
import { PAGE_STATS_MIN_SESSIONS } from "@shared/page-stats";

const log = child({ module: "analytics-reports" });

const TTL_MS = 10 * 60 * 1000;
const DEFAULT_DAYS = 28;
const MAX_DAYS = 90;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const MAX_BYTES_BILLED = "5000000000";

export const ANALYTICS_REPORTS = [
  "site_summary",
  "top_pages",
  "page_detail",
  "events_by_name",
  "traffic_sources",
  "traffic_source_conversions",
] as const;

export type AnalyticsReportName = (typeof ANALYTICS_REPORTS)[number];

export const ANALYTICS_ATTRIBUTIONS = ["session_last_click", "first_user"] as const;
export type AnalyticsAttribution = (typeof ANALYTICS_ATTRIBUTIONS)[number];

export type AnalyticsWarning = { code: string; message: string };

export const ANALYTICS_SOURCES = ["ga4", "first_party"] as const;
export type AnalyticsSource = (typeof ANALYTICS_SOURCES)[number];

export type AnalyticsReportResult = {
  report: AnalyticsReportName;
  status: "ok" | "not_configured";
  window_days: number;
  as_of: string;
  rows: Record<string, unknown>[];
  totals: Record<string, unknown>;
  warnings: AnalyticsWarning[];
  resolved_paths?: string[];
  /** page_detail only: which visit counts the numbers come from. */
  source?: AnalyticsSource;
  window_start?: string;
  window_end?: string;
  /** first_party: days omitted and shortened to the covered days. */
  days_shortened?: boolean;
  /** first_party: window ends on the switch-off day instead of yesterday. */
  window_end_shifted?: boolean;
  /** first_party: sessions below the page-stats minimum. */
  low_sample?: boolean;
};

type CacheEntry = { expires: number; payload: AnalyticsReportResult };
const cache = new Map<string, CacheEntry>();

export type GetAnalyticsReportOpts = {
  report: AnalyticsReportName;
  days?: number;
  limit?: number;
  path?: string;
  content_type?: string;
  slug?: string;
  locale?: string;
  contentRoot?: string;
  /** Site content folder name (e.g. site_4geeks-com); defaults to the first site in sites.yml. */
  site?: string;
  /** Site content index; defaults to the default site's. */
  ci?: ContentIndex;
  /** page_detail only: force GA4 or the site's own counts (default: same pick as page stats). */
  source?: AnalyticsSource;
  /** Optional event name filter for events_by_name */
  event_names?: string[];
  /** traffic_source_conversions only — default session_last_click */
  attribution?: AnalyticsAttribution;
  /** traffic_source_conversions only — filter lead events by ecommerce item_id */
  item_id?: string;
};

function windowBounds(days: number): { start: string; end: string; asOf: string } {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end), asOf: fmt(end) };
}

function priorWindowBounds(
  days: number,
  currentStart: string,
): { start: string; end: string } {
  const end = new Date(`${currentStart}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

/** Prefer GA4 page_path; else path from page_location. */
export function bqNormalizedPagePathSql(): string {
  return `REGEXP_REPLACE(
            COALESCE(
              NULLIF(
                (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_path'),
                ''
              ),
              REGEXP_EXTRACT(
                (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'),
                r'^https?://[^/?#]+([^?#]*)'
              ),
              REGEXP_REPLACE(
                COALESCE(
                  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location'),
                  ''
                ),
                r'[?#].*$',
                ''
              ),
              ''
            ),
            r'/+$',
            ''
          )`;
}

function clampDays(raw?: number): number {
  const n = Number.isFinite(raw) ? Number(raw) : DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, Math.floor(n)));
}

function clampLimit(raw?: number): number {
  const n = Number.isFinite(raw) ? Number(raw) : DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

export type ResolvePagePathsResult =
  | { ok: true; paths: string[]; warnings: AnalyticsWarning[] }
  | { ok: false; error: string };

/**
 * Resolve page_detail identity: raw path XOR content_type+slug (+ optional locale).
 * Bare slug alone is rejected by the caller before this runs.
 */
export function resolvePageDetailPaths(opts: {
  path?: string;
  content_type?: string;
  slug?: string;
  locale?: string;
  ci?: ContentIndex;
}): ResolvePagePathsResult {
  const pathRaw = (opts.path || "").trim();
  const ct = (opts.content_type || "").trim();
  const slug = (opts.slug || "").trim();
  const locale = (opts.locale || "").trim();

  if (pathRaw && (ct || slug)) {
    return {
      ok: false,
      error:
        'Pass either path OR content_type+slug (not both). Example: path="/en/blog/foo" or content_type="blog" slug="foo".',
    };
  }

  if (pathRaw) {
    const p = normalizeAnalyticsPath(pathRaw);
    if (!p) {
      return { ok: false, error: "path could not be normalized to a public pathname." };
    }
    return { ok: true, paths: [p], warnings: [] };
  }

  if (!ct || !slug) {
    return {
      ok: false,
      error:
        'page_detail requires path or content_type+slug. Example: path="/en/..." or content_type="program" slug="ai-fluency". Bare slug alone is not allowed.',
    };
  }

  let urls: Record<string, string> = {};
  try {
    urls = (opts.ci ?? contentIndex).getAlternateUrls(slug, ct) ?? {};
  } catch (err) {
    log.warn({ err, content_type: ct, slug }, "[analytics] getAlternateUrls failed");
  }

  const warnings: AnalyticsWarning[] = [];
  const locales = Object.keys(urls).filter((k) => typeof urls[k] === "string" && urls[k]);
  if (locales.length === 0) {
    return {
      ok: false,
      error: `No live public URLs found for ${ct}/${slug}. Confirm the entry exists and is published.`,
    };
  }

  let chosen: string[] = [];
  if (locale) {
    const u = urls[locale];
    if (!u) {
      return {
        ok: false,
        error: `No live URL for locale "${locale}" on ${ct}/${slug}. Available: ${locales.join(", ")}`,
      };
    }
    chosen = [normalizeAnalyticsPath(u)].filter(Boolean);
  } else if (urls.en) {
    chosen = [normalizeAnalyticsPath(urls.en)].filter(Boolean);
    if (locales.length > 1) {
      warnings.push({
        code: "primary_locale_chosen",
        message: `Multiple live locales (${locales.join(", ")}); using en. Pass locale to select another.`,
      });
    }
  } else {
    const first = locales[0]!;
    chosen = [normalizeAnalyticsPath(urls[first]!)].filter(Boolean);
    if (locales.length > 1) {
      warnings.push({
        code: "primary_locale_chosen",
        message: `Multiple live locales (${locales.join(", ")}); using ${first}. Pass locale to select another.`,
      });
    }
  }

  if (chosen.length === 0) {
    return {
      ok: false,
      error: `Resolved URLs for ${ct}/${slug} could not be normalized to paths.`,
    };
  }

  return { ok: true, paths: chosen, warnings };
}

function emptyResult(
  report: AnalyticsReportName,
  days: number,
  status: "ok" | "not_configured",
  warnings: AnalyticsWarning[],
  extra?: Partial<AnalyticsReportResult>,
): AnalyticsReportResult {
  const { asOf } = windowBounds(days);
  return {
    report,
    status,
    window_days: days,
    as_of: asOf,
    rows: [],
    totals: {},
    warnings,
    ...extra,
  };
}

function notConfiguredResult(
  report: AnalyticsReportName,
  days: number,
  extraWarnings: AnalyticsWarning[] = [],
  contentRoot?: string,
): AnalyticsReportResult {
  const status = getBigQueryConfigStatus(contentRoot);
  return emptyResult(report, days, "not_configured", [
    ...status.warnings.map((m) => ({ code: "bigquery_not_configured", message: m })),
    {
      code: "configure_at",
      message: "Configure project/dataset at /private/tracking/ga4",
    },
    ...extraWarnings,
  ]);
}

function emptyOkWarning(): AnalyticsWarning {
  return {
    code: "no_events_in_window",
    message: "No matching events in this window. BigQuery is configured — this is empty data, not a setup failure.",
  };
}

async function queryRows(
  contentRoot: string | undefined,
  sql: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const client = getBigQueryClient(contentRoot);
  if (!client) {
    throw new Error("bigquery_client_unavailable");
  }
  const settings = getBigQuerySettings(contentRoot);
  const [rows] = await client.query({
    query: sql,
    params,
    location: settings.location || undefined,
    maximumBytesBilled: MAX_BYTES_BILLED,
  });
  return (rows || []) as Record<string, unknown>[];
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  if (v && typeof v === "object" && "value" in (v as object)) {
    return num((v as { value: unknown }).value);
  }
  return 0;
}

async function runSiteSummary(
  days: number,
  contentRoot?: string,
): Promise<AnalyticsReportResult> {
  const settings = getBigQuerySettings(contentRoot);
  const eventsTable = fqEventsWildcard(settings);
  const { start, end, asOf } = windowBounds(days);
  const prior = priorWindowBounds(days, start);

  const sql = `
    WITH params AS (
      SELECT @start_date AS start_date, @end_date AS end_date,
             @prior_start AS prior_start, @prior_end AS prior_end
    ),
    cur AS (
      SELECT
        COUNTIF(event_name = 'page_view') AS views,
        COUNT(DISTINCT IF(event_name = 'page_view',
          CONCAT(user_pseudo_id, '-', CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)),
          NULL)) AS sessions,
        COUNT(DISTINCT user_pseudo_id) AS users
      FROM ${eventsTable}, params
      WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE(params.start_date))
        AND FORMAT_DATE('%Y%m%d', DATE(params.end_date))
    ),
    prev AS (
      SELECT
        COUNTIF(event_name = 'page_view') AS views,
        COUNT(DISTINCT IF(event_name = 'page_view',
          CONCAT(user_pseudo_id, '-', CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)),
          NULL)) AS sessions,
        COUNT(DISTINCT user_pseudo_id) AS users
      FROM ${eventsTable}, params
      WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE(params.prior_start))
        AND FORMAT_DATE('%Y%m%d', DATE(params.prior_end))
    )
    SELECT
      cur.views AS views, cur.sessions AS sessions, cur.users AS users,
      prev.views AS prior_views, prev.sessions AS prior_sessions, prev.users AS prior_users
    FROM cur, prev
  `;

  const rows = await queryRows(contentRoot, sql, {
    start_date: start,
    end_date: end,
    prior_start: prior.start,
    prior_end: prior.end,
  });
  const row = rows[0] || {};
  const views = num(row.views);
  const sessions = num(row.sessions);
  const users = num(row.users);
  const totals = {
    views,
    sessions,
    users,
    prior_views: num(row.prior_views),
    prior_sessions: num(row.prior_sessions),
    prior_users: num(row.prior_users),
    delta_views: views - num(row.prior_views),
    delta_sessions: sessions - num(row.prior_sessions),
    delta_users: users - num(row.prior_users),
  };
  const warnings: AnalyticsWarning[] = [];
  if (views === 0 && sessions === 0) warnings.push(emptyOkWarning());

  return {
    report: "site_summary",
    status: "ok",
    window_days: days,
    as_of: asOf,
    rows: [totals],
    totals,
    warnings,
  };
}

async function runTopPages(
  days: number,
  limit: number,
  contentRoot?: string,
): Promise<AnalyticsReportResult> {
  const settings = getBigQuerySettings(contentRoot);
  const eventsTable = fqEventsWildcard(settings);
  const { start, end, asOf } = windowBounds(days);
  const pagePathExpr = bqNormalizedPagePathSql();

  const sql = `
    WITH params AS (
      SELECT @start_date AS start_date, @end_date AS end_date
    ),
    base AS (
      SELECT
        user_pseudo_id,
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
        ${pagePathExpr} AS page_path
      FROM ${eventsTable}, params
      WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE(params.start_date))
        AND FORMAT_DATE('%Y%m%d', DATE(params.end_date))
        AND event_name = 'page_view'
    ),
    cleaned AS (
      SELECT user_pseudo_id, ga_session_id,
        CASE WHEN page_path = '' THEN '/' ELSE page_path END AS page_path
      FROM base
      WHERE page_path IS NOT NULL AND page_path != ''
    )
    SELECT
      page_path AS path,
      COUNT(*) AS views,
      COUNT(DISTINCT CONCAT(user_pseudo_id, '-', CAST(ga_session_id AS STRING))) AS sessions
    FROM cleaned
    GROUP BY path
    ORDER BY views DESC
    LIMIT @limit
  `;

  const raw = await queryRows(contentRoot, sql, {
    start_date: start,
    end_date: end,
    limit,
  });
  const rows = raw.map((r) => ({
    path: String(r.path || ""),
    views: num(r.views),
    sessions: num(r.sessions),
  }));
  const totals = {
    row_count: rows.length,
    views: rows.reduce((s, r) => s + r.views, 0),
    sessions: rows.reduce((s, r) => s + r.sessions, 0),
  };
  const warnings: AnalyticsWarning[] = [];
  if (rows.length === 0) warnings.push(emptyOkWarning());

  return {
    report: "top_pages",
    status: "ok",
    window_days: days,
    as_of: asOf,
    rows,
    totals,
    warnings,
  };
}

async function runPageDetail(
  days: number,
  paths: string[],
  contentRoot?: string,
  resolveWarnings: AnalyticsWarning[] = [],
): Promise<AnalyticsReportResult> {
  const settings = getBigQuerySettings(contentRoot);
  const eventsTable = fqEventsWildcard(settings);
  const { start, end, asOf } = windowBounds(days);
  const pagePathExpr = bqNormalizedPagePathSql();

  const metricsSql = `
    WITH params AS (
      SELECT @start_date AS start_date, @end_date AS end_date
    ),
    base AS (
      SELECT
        user_pseudo_id,
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
        event_name,
        ${pagePathExpr} AS page_path
      FROM ${eventsTable}, params
      WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE(params.start_date))
        AND FORMAT_DATE('%Y%m%d', DATE(params.end_date))
        AND event_name IN UNNEST(@event_names)
    ),
    cleaned AS (
      SELECT user_pseudo_id, ga_session_id, event_name,
        CASE WHEN page_path = '' THEN '/' ELSE page_path END AS page_path
      FROM base
      WHERE page_path IN UNNEST(@paths)
    )
    SELECT
      page_path AS path,
      COUNTIF(event_name = 'page_view') AS views,
      COUNT(DISTINCT IF(event_name = 'page_view',
        CONCAT(user_pseudo_id, '-', CAST(ga_session_id AS STRING)), NULL)) AS sessions
    FROM cleaned
    GROUP BY path
  `;

  const topEventsSql = `
    WITH params AS (
      SELECT @start_date AS start_date, @end_date AS end_date
    ),
    base AS (
      SELECT
        event_name,
        ${pagePathExpr} AS page_path
      FROM ${eventsTable}, params
      WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE(params.start_date))
        AND FORMAT_DATE('%Y%m%d', DATE(params.end_date))
    ),
    cleaned AS (
      SELECT event_name,
        CASE WHEN page_path = '' THEN '/' ELSE page_path END AS page_path
      FROM base
      WHERE page_path IN UNNEST(@paths)
        AND event_name IS NOT NULL AND event_name != ''
    )
    SELECT event_name, COUNT(*) AS event_count
    FROM cleaned
    GROUP BY event_name
    ORDER BY event_count DESC
    LIMIT 20
  `;

  const metricRows = await queryRows(contentRoot, metricsSql, {
    start_date: start,
    end_date: end,
    paths,
    event_names: ["page_view"],
  });
  const eventRows = await queryRows(contentRoot, topEventsSql, {
    start_date: start,
    end_date: end,
    paths,
  });

  const byPath = new Map(
    metricRows.map((r) => [
      String(r.path || ""),
      { path: String(r.path || ""), views: num(r.views), sessions: num(r.sessions) },
    ]),
  );
  const rows = paths.map((p) => byPath.get(p) || { path: p, views: 0, sessions: 0 });
  const top_events = eventRows.map((r) => ({
    event_name: String(r.event_name || ""),
    event_count: num(r.event_count),
  }));
  const totals = {
    views: rows.reduce((s, r) => s + r.views, 0),
    sessions: rows.reduce((s, r) => s + r.sessions, 0),
    top_events,
  };
  const warnings = [...resolveWarnings];
  if (totals.views === 0 && totals.sessions === 0) warnings.push(emptyOkWarning());

  return {
    report: "page_detail",
    status: "ok",
    window_days: days,
    as_of: asOf,
    rows,
    totals,
    warnings,
    resolved_paths: paths,
  };
}

async function runEventsByName(
  days: number,
  limit: number,
  eventNames: string[] | undefined,
  contentRoot?: string,
): Promise<AnalyticsReportResult> {
  const settings = getBigQuerySettings(contentRoot);
  const eventsTable = fqEventsWildcard(settings);
  const { start, end, asOf } = windowBounds(days);
  const filter = (eventNames || []).map((e) => e.trim()).filter(Boolean);

  const sql = `
    WITH params AS (
      SELECT @start_date AS start_date, @end_date AS end_date
    ),
    base AS (
      SELECT event_name
      FROM ${eventsTable}, params
      WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE(params.start_date))
        AND FORMAT_DATE('%Y%m%d', DATE(params.end_date))
        AND event_name IS NOT NULL AND event_name != ''
        AND (@filter_empty OR event_name IN UNNEST(@event_names))
    )
    SELECT event_name, COUNT(*) AS event_count
    FROM base
    GROUP BY event_name
    ORDER BY event_count DESC
    LIMIT @limit
  `;

  const raw = await queryRows(contentRoot, sql, {
    start_date: start,
    end_date: end,
    event_names: filter.length ? filter : [""],
    filter_empty: filter.length === 0,
    limit,
  });
  const rows = raw.map((r) => ({
    event_name: String(r.event_name || ""),
    event_count: num(r.event_count),
  }));
  const totals = {
    row_count: rows.length,
    event_count: rows.reduce((s, r) => s + r.event_count, 0),
  };
  const warnings: AnalyticsWarning[] = [];
  if (rows.length === 0) warnings.push(emptyOkWarning());

  return {
    report: "events_by_name",
    status: "ok",
    window_days: days,
    as_of: asOf,
    rows,
    totals,
    warnings,
  };
}

async function runTrafficSources(
  days: number,
  limit: number,
  contentRoot?: string,
): Promise<AnalyticsReportResult> {
  const settings = getBigQuerySettings(contentRoot);
  const eventsTable = fqEventsWildcard(settings);
  const { start, end, asOf } = windowBounds(days);

  const sql = `
    WITH params AS (
      SELECT @start_date AS start_date, @end_date AS end_date
    ),
    base AS (
      SELECT
        user_pseudo_id,
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
        COALESCE(NULLIF(traffic_source.source, ''), '(direct)') AS source,
        COALESCE(NULLIF(traffic_source.medium, ''), '(none)') AS medium
      FROM ${eventsTable}, params
      WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE(params.start_date))
        AND FORMAT_DATE('%Y%m%d', DATE(params.end_date))
        AND event_name = 'page_view'
    )
    SELECT
      source,
      medium,
      COUNT(DISTINCT CONCAT(user_pseudo_id, '-', CAST(ga_session_id AS STRING))) AS sessions,
      COUNT(*) AS views
    FROM base
    GROUP BY source, medium
    ORDER BY sessions DESC
    LIMIT @limit
  `;

  const raw = await queryRows(contentRoot, sql, {
    start_date: start,
    end_date: end,
    limit,
  });
  const rows = raw.map((r) => ({
    source: String(r.source || "(direct)"),
    medium: String(r.medium || "(none)"),
    sessions: num(r.sessions),
    views: num(r.views),
  }));
  const totals = {
    row_count: rows.length,
    sessions: rows.reduce((s, r) => s + r.sessions, 0),
    views: rows.reduce((s, r) => s + r.views, 0),
  };
  const warnings: AnalyticsWarning[] = [];
  if (rows.length === 0) warnings.push(emptyOkWarning());

  return {
    report: "traffic_sources",
    status: "ok",
    window_days: days,
    as_of: asOf,
    rows,
    totals,
    warnings,
  };
}

/** First-user / user-acquisition channel (same family as traffic_sources). */
function bqFirstUserChannelSql(): { source: string; medium: string; campaign: string } {
  return {
    source: `COALESCE(NULLIF(traffic_source.source, ''), '(direct)')`,
    medium: `COALESCE(NULLIF(traffic_source.medium, ''), '(none)')`,
    campaign: `COALESCE(NULLIF(traffic_source.name, ''), '(not set)')`,
  };
}

/**
 * Session last-click with collected → traffic_source fallback.
 * Prefer session_traffic_source_last_click when the export has it.
 */
export function bqSessionLastClickChannelSql(opts: {
  includeSessionLastClick: boolean;
}): { source: string; medium: string; campaign: string; usedFallback: string } {
  const sessionSource = opts.includeSessionLastClick
    ? `NULLIF(session_traffic_source_last_click.manual_campaign.source, ''),
            NULLIF(session_traffic_source_last_click.cross_channel_campaign.source, ''),`
    : "";
  const sessionMedium = opts.includeSessionLastClick
    ? `NULLIF(session_traffic_source_last_click.manual_campaign.medium, ''),
            NULLIF(session_traffic_source_last_click.cross_channel_campaign.medium, ''),`
    : "";
  const sessionCampaign = opts.includeSessionLastClick
    ? `NULLIF(session_traffic_source_last_click.manual_campaign.campaign_name, ''),
            NULLIF(session_traffic_source_last_click.google_ads_campaign.campaign_name, ''),
            NULLIF(session_traffic_source_last_click.cross_channel_campaign.campaign_name, ''),`
    : "";

  const sessionSourcePresent = opts.includeSessionLastClick
    ? `(NULLIF(session_traffic_source_last_click.manual_campaign.source, '') IS NOT NULL
              OR NULLIF(session_traffic_source_last_click.cross_channel_campaign.source, '') IS NOT NULL)`
    : `FALSE`;
  const collectedSourcePresent = `NULLIF(collected_traffic_source.manual_source, '') IS NOT NULL`;

  return {
    source: `COALESCE(
            ${sessionSource}
            NULLIF(collected_traffic_source.manual_source, ''),
            NULLIF(traffic_source.source, ''),
            '(direct)'
          )`,
    medium: `COALESCE(
            ${sessionMedium}
            NULLIF(collected_traffic_source.manual_medium, ''),
            NULLIF(traffic_source.medium, ''),
            '(none)'
          )`,
    campaign: `COALESCE(
            ${sessionCampaign}
            NULLIF(collected_traffic_source.manual_campaign_name, ''),
            NULLIF(traffic_source.name, ''),
            '(not set)'
          )`,
    usedFallback: `(NOT (${sessionSourcePresent}) AND NOT (${collectedSourcePresent})
            AND NULLIF(traffic_source.source, '') IS NOT NULL)`,
  };
}

function parseAttribution(raw?: string): AnalyticsAttribution {
  if (raw === "first_user") return "first_user";
  return "session_last_click";
}

async function runTrafficSourceConversions(
  days: number,
  limit: number,
  attribution: AnalyticsAttribution,
  itemIdRaw: string | undefined,
  contentRoot?: string,
): Promise<AnalyticsReportResult> {
  const settings = getBigQuerySettings(contentRoot);
  const eventsTable = fqEventsWildcard(settings);
  const { start, end, asOf } = windowBounds(days);
  const itemId = (itemIdRaw || "").trim();
  const filterItemId = itemId.length > 0;

  const leadEventNames = getLeadConversionEventNames(contentRoot);
  const leadEventsParam =
    leadEventNames.length > 0 ? leadEventNames : ["__no_lead_events__"];

  const warnings: AnalyticsWarning[] = [];
  const countsConfigured = isCountsAsLeadConfigured(
    getTrackingSettings(contentRoot).conversion_events,
  );
  if (!countsConfigured) {
    warnings.push({
      code: "counts_as_lead_not_configured",
      message:
        "Count as lead is not configured yet on conversion events. Lead metrics may be incomplete until staff set Count as lead under Conversions.",
    });
  } else if (leadEventNames.length === 0) {
    warnings.push({
      code: "no_lead_events_configured",
      message:
        "Lead conversions are not being measured because no conversion events have Count as lead turned on. Session rows still appear.",
    });
  }

  if (filterItemId) {
    warnings.push({
      code: "lead_rate_channel_sessions",
      message:
        "item_id filters lead events only; sessions remain channel-level. lead_rate is product leads / channel sessions.",
    });
  }

  const buildSql = (includeSessionLastClick: boolean): string => {
    const channel =
      attribution === "first_user"
        ? {
            ...bqFirstUserChannelSql(),
            usedFallback: "FALSE",
          }
        : bqSessionLastClickChannelSql({ includeSessionLastClick });

    const unattributedPredicate =
      attribution === "session_last_click"
        ? `ga_session_id IS NULL`
        : `FALSE`;

    return `
    WITH params AS (
      SELECT @start_date AS start_date, @end_date AS end_date
    ),
    base AS (
      SELECT
        user_pseudo_id,
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
        event_name,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'item_id') AS item_id,
        ${channel.source} AS source,
        ${channel.medium} AS medium,
        ${channel.campaign} AS campaign,
        ${channel.usedFallback} AS used_fallback
      FROM ${eventsTable}, params
      WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE(params.start_date))
        AND FORMAT_DATE('%Y%m%d', DATE(params.end_date))
        AND (
          event_name = 'page_view'
          OR event_name IN UNNEST(@lead_events)
        )
    ),
    sessions_by_channel AS (
      SELECT
        source,
        medium,
        campaign,
        COUNT(DISTINCT CONCAT(user_pseudo_id, '-', CAST(ga_session_id AS STRING))) AS sessions,
        COUNTIF(used_fallback) AS fallback_hits
      FROM base
      WHERE event_name = 'page_view'
        AND ga_session_id IS NOT NULL
      GROUP BY source, medium, campaign
    ),
    leads_by_channel AS (
      SELECT
        source,
        medium,
        campaign,
        COUNT(*) AS leads,
        COUNTIF(used_fallback) AS fallback_hits
      FROM base
      WHERE event_name IN UNNEST(@lead_events)
        AND event_name != '__no_lead_events__'
        AND NOT (${unattributedPredicate})
        AND (
          NOT @filter_item_id
          OR item_id = @item_id
        )
      GROUP BY source, medium, campaign
    ),
    orphans AS (
      SELECT
        COUNTIF(
          event_name IN UNNEST(@lead_events)
          AND event_name != '__no_lead_events__'
          AND (${unattributedPredicate})
          AND (NOT @filter_item_id OR item_id = @item_id)
        ) AS leads_unattributed,
        COUNTIF(
          event_name IN UNNEST(@lead_events)
          AND event_name != '__no_lead_events__'
          AND @filter_item_id
          AND (item_id IS NULL OR item_id = '')
        ) AS leads_missing_item_id,
        COUNTIF(used_fallback) AS fallback_hits
      FROM base
    ),
    combined AS (
      SELECT
        COALESCE(s.source, l.source) AS source,
        COALESCE(s.medium, l.medium) AS medium,
        COALESCE(s.campaign, l.campaign) AS campaign,
        COALESCE(s.sessions, 0) AS sessions,
        COALESCE(l.leads, 0) AS leads,
        COALESCE(s.fallback_hits, 0) + COALESCE(l.fallback_hits, 0) AS fallback_hits
      FROM sessions_by_channel s
      FULL OUTER JOIN leads_by_channel l
        ON s.source = l.source AND s.medium = l.medium AND s.campaign = l.campaign
    )
    SELECT
      c.source,
      c.medium,
      c.campaign,
      c.sessions,
      c.leads,
      c.fallback_hits,
      o.leads_unattributed,
      o.leads_missing_item_id,
      o.fallback_hits AS orphan_fallback_hits
    FROM combined c
    CROSS JOIN orphans o
    ORDER BY c.leads DESC, c.sessions DESC
    LIMIT @limit
  `;
  };

  const params = {
    start_date: start,
    end_date: end,
    lead_events: leadEventsParam,
    filter_item_id: filterItemId,
    item_id: itemId || "",
    limit,
  };

  let raw: Record<string, unknown>[];
  let usedSessionLastClickColumn = attribution === "session_last_click";
  try {
    raw = await queryRows(contentRoot, buildSql(attribution === "session_last_click"), params);
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    if (
      attribution === "session_last_click" &&
      /unrecognized name|session_traffic_source_last_click/i.test(msg)
    ) {
      log.warn({ err }, "[analytics] session_traffic_source_last_click unavailable; retrying without it");
      usedSessionLastClickColumn = false;
      warnings.push({
        code: "attribution_fallback_traffic_source",
        message:
          "session_traffic_source_last_click is not available in this BigQuery export; using collected_traffic_source / traffic_source fallback.",
      });
      raw = await queryRows(contentRoot, buildSql(false), params);
    } else {
      throw err;
    }
  }

  const rows = raw.map((r) => {
    const sessions = num(r.sessions);
    const leads = num(r.leads);
    return {
      source: String(r.source || "(direct)"),
      medium: String(r.medium || "(none)"),
      campaign: String(r.campaign || "(not set)"),
      sessions,
      leads,
      lead_rate: sessions > 0 ? leads / sessions : 0,
    };
  });

  const first = raw[0] || {};
  const leadsUnattributed =
    attribution === "session_last_click" ? num(first.leads_unattributed) : 0;
  const leadsMissingItemId = filterItemId ? num(first.leads_missing_item_id) : 0;
  const fallbackHits =
    num(first.orphan_fallback_hits) +
    raw.reduce((s, r) => s + num(r.fallback_hits), 0);

  if (
    attribution === "session_last_click" &&
    usedSessionLastClickColumn &&
    fallbackHits > 0 &&
    !warnings.some((w) => w.code === "attribution_fallback_traffic_source")
  ) {
    warnings.push({
      code: "attribution_fallback_traffic_source",
      message:
        "Some events lacked session last-click / collected source and fell back to traffic_source (often first-user).",
    });
  }

  if (attribution === "session_last_click" && leadsUnattributed > 0) {
    warnings.push({
      code: "leads_unattributed",
      message: `${leadsUnattributed} lead event(s) lacked ga_session_id and were excluded from channel rows (see totals.leads_unattributed).`,
    });
  }

  if (filterItemId && leadsMissingItemId > 0) {
    warnings.push({
      code: "leads_missing_item_id",
      message: `${leadsMissingItemId} lead event(s) in this window had no item_id and were excluded from the product slice.`,
    });
  }

  const totals: Record<string, unknown> = {
    row_count: rows.length,
    sessions: rows.reduce((s, r) => s + r.sessions, 0),
    leads: rows.reduce((s, r) => s + r.leads, 0),
    lead_event_names: leadEventNames,
    attribution,
  };
  if (attribution === "session_last_click") {
    totals.leads_unattributed = leadsUnattributed;
  }
  if (filterItemId) {
    totals.item_id = itemId;
    totals.leads_missing_item_id = leadsMissingItemId;
  }

  if (rows.length === 0 && leadEventNames.length > 0) {
    warnings.push(emptyOkWarning());
  }

  return {
    report: "traffic_source_conversions",
    status: "ok",
    window_days: days,
    as_of: asOf,
    rows,
    totals,
    warnings,
  };
}

/**
 * Validate opts and run one named report. Throws only for unexpected BQ errors;
 * bad args return via thrown ValidationError message for the route to map to 400.
 */
export class AnalyticsReportValidationError extends Error {
  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AnalyticsReportValidationError";
  }
}

/** Same GA4 vs own-counts pick as the page-stats drawer (lazy import: page-stats imports this module). */
async function pickPageDetailSource(opts: {
  site: string;
  contentRoot?: string;
  ci: ContentIndex;
  paths: string[];
  contentType: string | null;
  requested?: AnalyticsSource;
}) {
  const [{ resolveTrafficSource }, { getPathStageIndex, resolvePage }] = await Promise.all([
    import("./page-stats/source"),
    import("./page-stats/resolve"),
  ]);
  let entryContentType = opts.contentType;
  if (!entryContentType && opts.paths[0]) {
    const index = getPathStageIndex(opts.site, opts.ci);
    const page = resolvePage({ site: opts.site, ci: opts.ci, path: opts.paths[0], scope: "url", index });
    entryContentType = page?.entry?.content_type ?? null;
  }
  return resolveTrafficSource({
    site: opts.site,
    contentRoot: opts.contentRoot,
    entryContentType,
    requested: opts.requested,
  });
}

function runFirstPartyPageDetail(opts: {
  site: string;
  windows: TypeWindow[];
  paths: string[];
  days: number;
  daysExplicit: boolean;
  explicitFirstParty: boolean;
  resolveWarnings: AnalyticsWarning[];
}): AnalyticsReportResult {
  const now = Date.now();
  const coverage = latestCoverage(opts.windows, now);
  const planned = planFirstPartyWindow({
    coverage,
    days: opts.days,
    daysExplicit: opts.daysExplicit,
    defaultDays: DEFAULT_DAYS,
    shiftEnd: opts.explicitFirstParty && coverage != null && !coverage.enabled,
    now,
  });
  if (!planned.ok) throw new AnalyticsReportValidationError(planned.error.message, planned.error.details);
  const { plan } = planned;

  flushSite(opts.site);
  const db = getVisitsDb(opts.site);
  if (!db) {
    throw new AnalyticsReportValidationError('No site visit counts stored yet. Use source "ga4".', {
      source: "first_party",
      available_from: null,
      max_days: 0,
    });
  }
  const detail = queryFirstPartyPageDetail(db, opts.paths, plan, now);

  const warnings: AnalyticsWarning[] = [
    ...opts.resolveWarnings,
    {
      code: "first_party_counts",
      message:
        "Site's own visit counts (same as the staff page-stats drawer), not GA4. One session = one counted view of this page; " +
        "reloads, back/forward, bots, logged-in staff and suspected low-quality visits are left out (totals.low_quality_excluded). " +
        "Views count every page view. Not comparable with GA4 sessions.",
    },
    {
      code: "first_party_no_events",
      message:
        "Named events are not collected here, so top_events is empty. See totals.interactions (CTA clicks, form starts, video starts / completes).",
    },
  ];
  if (plan.days_shortened) {
    warnings.push({
      code: "first_party_window_shortened",
      message: `days omitted: shortened to ${plan.days} covered day(s), ${plan.start} to ${plan.end}.`,
    });
  }
  if (plan.window_end_shifted) {
    warnings.push({
      code: "first_party_window_end_shifted",
      message: `Optimize for ads is off for this type: window ends on the switch-off day ${plan.end}, not yesterday.`,
    });
  }
  if (detail.low_sample) {
    warnings.push({
      code: "first_party_low_sample",
      message: `${detail.totals.sessions} session(s), below the page-stats minimum of ${PAGE_STATS_MIN_SESSIONS}: rates and comparisons are unreliable.`,
    });
  }

  return {
    report: "page_detail",
    status: "ok",
    source: "first_party",
    window_days: plan.days,
    window_start: plan.start,
    window_end: plan.end,
    days_shortened: plan.days_shortened,
    window_end_shifted: plan.window_end_shifted,
    low_sample: detail.low_sample,
    as_of: plan.end,
    rows: detail.rows,
    totals: detail.totals,
    warnings,
    resolved_paths: opts.paths,
  };
}

export async function getAnalyticsReport(
  opts: GetAnalyticsReportOpts,
): Promise<AnalyticsReportResult> {
  const report = opts.report;
  if (!ANALYTICS_REPORTS.includes(report)) {
    throw new AnalyticsReportValidationError(
      `Unknown report "${report}". Valid: ${ANALYTICS_REPORTS.join(", ")}`,
    );
  }

  const days = clampDays(opts.days);
  const limit = clampLimit(opts.limit);
  const contentRoot = opts.contentRoot;
  if (
    opts.attribution != null &&
    !ANALYTICS_ATTRIBUTIONS.includes(opts.attribution)
  ) {
    throw new AnalyticsReportValidationError(
      `Unknown attribution "${String(opts.attribution)}". Valid: ${ANALYTICS_ATTRIBUTIONS.join(", ")}`,
    );
  }
  const attribution = parseAttribution(opts.attribution);
  const itemId = (opts.item_id || "").trim() || undefined;
  if (opts.source != null && !ANALYTICS_SOURCES.includes(opts.source)) {
    throw new AnalyticsReportValidationError(
      `Unknown source "${String(opts.source)}". Valid: ${ANALYTICS_SOURCES.join(", ")}`,
    );
  }
  if (opts.source != null && report !== "page_detail") {
    throw new AnalyticsReportValidationError("source applies to page_detail only.");
  }

  let resolvedPaths: string[] | undefined;
  let resolveWarnings: AnalyticsWarning[] = [];
  let sourceWarnings: AnalyticsWarning[] = [];

  if (report === "page_detail") {
    const slugOnly = Boolean((opts.slug || "").trim()) && !(opts.content_type || "").trim() && !(opts.path || "").trim();
    if (slugOnly) {
      throw new AnalyticsReportValidationError(
        'Bare slug is not allowed. Pass content_type with slug, or a public path. Example: content_type="program" slug="ai-fluency".',
      );
    }
    const resolved = resolvePageDetailPaths({
      path: opts.path,
      content_type: opts.content_type,
      slug: opts.slug,
      locale: opts.locale,
      ci: opts.ci,
    });
    if (!resolved.ok) {
      throw new AnalyticsReportValidationError(resolved.error);
    }
    resolvedPaths = resolved.paths;
    resolveWarnings = resolved.warnings;

    const site = opts.site ?? (await import("../site-config")).getDefaultContentFolder();
    const picked = await pickPageDetailSource({
      site,
      contentRoot,
      ci: opts.ci ?? contentIndex,
      paths: resolvedPaths,
      contentType: (opts.content_type || "").trim() || null,
      requested: opts.source,
    });
    if (opts.source === "first_party" && picked.windows.length === 0) {
      throw new AnalyticsReportValidationError(
        picked.contentType
          ? `Content type "${picked.contentType}" has never used the site's own visit counts. Ask staff to turn on Optimize for ads (content type dashboard), or use source "ga4".`
          : 'This path is not a managed page, so it has no site visit counts. Use source "ga4".',
        { source: "first_party", content_type: picked.contentType, available_from: null, max_days: 0 },
      );
    }
    if (picked.source === "first_party") {
      return runFirstPartyPageDetail({
        site,
        windows: picked.windows,
        paths: resolvedPaths,
        days,
        daysExplicit: opts.days != null && Number.isFinite(opts.days),
        explicitFirstParty: opts.source === "first_party",
        resolveWarnings,
      });
    }
    if (opts.source === "ga4" && picked.flaggedNow) {
      sourceWarnings = [
        {
          code: "drawer_uses_first_party",
          message:
            "This page's type has Optimize for ads on: the staff page-stats drawer shows the site's own visit counts, not these GA4 numbers. Omit source to get what staff see.",
        },
      ];
    }
  }

  const cacheKey = [
    contentRoot || "",
    opts.site || "",
    report,
    days,
    limit,
    resolvedPaths?.join(",") || opts.path || "",
    opts.content_type || "",
    opts.slug || "",
    opts.locale || "",
    (opts.event_names || []).join(","),
    report === "traffic_source_conversions" ? attribution : "",
    report === "traffic_source_conversions" ? itemId || "" : "",
    report === "page_detail" ? `ga4:${sourceWarnings.length}` : "",
  ].join("|");

  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.payload;

  const bqStatus = getBigQueryConfigStatus(contentRoot);
  if (!bqStatus.configured) {
    const payload = notConfiguredResult(report, days, [...resolveWarnings, ...sourceWarnings], contentRoot);
    if (resolvedPaths) {
      payload.resolved_paths = resolvedPaths;
      payload.source = "ga4";
    }
    return payload;
  }

  if (!getBigQueryClient(contentRoot)) {
    return emptyResult(report, days, "not_configured", [
      {
        code: "bigquery_client_unavailable",
        message: "Could not create BigQuery client — check GCS_CREDENTIALS_JSON / ADC",
      },
      {
        code: "configure_at",
        message: "Configure project/dataset at /private/tracking/ga4",
      },
      ...resolveWarnings,
      ...sourceWarnings,
    ], resolvedPaths ? { resolved_paths: resolvedPaths, source: "ga4" } : undefined);
  }

  let payload: AnalyticsReportResult;
  try {
    switch (report) {
      case "site_summary":
        payload = await runSiteSummary(days, contentRoot);
        break;
      case "top_pages":
        payload = await runTopPages(days, limit, contentRoot);
        break;
      case "page_detail":
        payload = await runPageDetail(days, resolvedPaths!, contentRoot, [...resolveWarnings, ...sourceWarnings]);
        payload.source = "ga4";
        break;
      case "events_by_name":
        payload = await runEventsByName(days, limit, opts.event_names, contentRoot);
        break;
      case "traffic_sources":
        payload = await runTrafficSources(days, limit, contentRoot);
        break;
      case "traffic_source_conversions":
        payload = await runTrafficSourceConversions(
          days,
          limit,
          attribution,
          itemId,
          contentRoot,
        );
        break;
      default: {
        const _exhaustive: never = report;
        throw new AnalyticsReportValidationError(`Unhandled report: ${_exhaustive}`);
      }
    }
  } catch (err) {
    if (err instanceof AnalyticsReportValidationError) throw err;
    log.error({ err, report }, "[analytics] report query failed");
    throw err;
  }

  cache.set(cacheKey, { expires: Date.now() + TTL_MS, payload });
  return payload;
}

export function clearAnalyticsReportCache(): void {
  cache.clear();
}
