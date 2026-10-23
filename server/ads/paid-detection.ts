/**
 * GA4 BigQuery paid-landing detector. One query per export day:
 * landing = first page_view of each session; paid candidates keep their
 * campaign signals (classified at report time with shared/paid-traffic),
 * everything else rolls into an organic baseline per path. Consent-denied
 * cookieless page views are counted separately.
 *
 * Cache: `.cache/{site}/paid-landing-days/{date}.json` + `paid-landing-state.json`.
 */

import fs from "fs";
import path from "path";
import { CACHE_DIR } from "../db-cache";
import { fqEventsWildcard, getBigQueryClient, getBigQueryConfigStatus, getBigQuerySettings } from "../ecommerce/bigquery-client";
import { bqNormalizedPagePathSql } from "../analytics/reports";
import {
  adIdFromTag,
  googleNetworkOf,
  normalizeLandingPath,
  PAID_MEDIUMS,
  CLICK_ID_PARAMS,
  type ClickIdParam,
  type GoogleAdNetwork,
} from "@shared/paid-traffic";
import { normalizeGoogleCustomerId } from "@shared/ads-settings";
import { getAdsSettings, getLeadConversionEventNames } from "../settings";
import { adsConfigReadError } from "../ads-config";
import { isGoogleConfiguredSettings, loadGoogleState } from "./google-ads-days";
import { child } from "../logger";
import { addDays, dateRange, shortDateRange, utcDate, type SyncStepCallback } from "./meta-ads-days";

const log = child({ module: "ads/paid-detection" });

export const PAID_LANDING_BACKFILL_DAYS = 90;
export const PAID_LANDING_RETENTION_DAYS = 395;
/** GA4 daily export is treated as final this many days after the date. */
export const GA4_COMPLETE_LAG_DAYS = 2;
const MAX_DAYS_PER_RUN = 30;
/** Re-reads after a schema bump run in one sync (one cheap query per cached day). */
const MAX_UPGRADE_DAYS_PER_RUN = PAID_LANDING_RETENTION_DAYS;
const MAX_BYTES_BILLED = "5000000000";

export type PaidLandingCandidateRow = {
  host: string;
  path: string;
  source: string;
  medium: string;
  campaign: string;
  click_id_type: ClickIdParam | null;
  utm_id: string | null;
  utm_term: string | null;
  utm_content: string | null;
  experiment_id: string | null;
  variant: string | null;
  sessions: number;
  engaged_sessions: number;
  engagement_ms: number;
  lead_events: number;
  sessions_with_lead: number;
  /** Google Ads ids for this visit: GA4's Google Ads link first, else the gclid → ClickStats join. */
  gads_customer_id?: string | null;
  gads_campaign_id?: string | null;
  gads_ad_group_id?: string | null;
  gads_network?: GoogleAdNetwork | null;
  gads_match?: "ga4_link" | "gclid" | null;
};

export type OrganicBaselineRow = {
  host: string;
  path: string;
  sessions: number;
  engaged_sessions: number;
  engagement_ms: number;
  sessions_with_lead: number;
  /** First page test seen in the session (absent on days synced before per-version organic). */
  experiment_id?: string | null;
  variant?: string | null;
};

export type CookielessRow = { host: string; path: string; page_views: number };

/** Sessions GA4 credits to ads (carried-over last click / Google Ads link) with no ad evidence on this visit. */
export type AttributedOnlyRow = { host: string; sessions: number };

/**
 * 2 = candidates carry Google Ads ids (GA4 link / gclid join).
 * 3 = paid only from per-visit evidence (landing URL / collected_traffic_source); adds attributed_only.
 * Days below the current version are re-read on the next sync.
 */
export const PAID_LANDING_SCHEMA_VERSION = 3;

export type PaidLandingDayFile = {
  date: string;
  fetched_at: string;
  complete: boolean;
  schema_version?: number;
  candidates: PaidLandingCandidateRow[];
  organic: OrganicBaselineRow[];
  cookieless: CookielessRow[];
  /** Google Ads ids were requested (GA4 link / gclid join). Days without them are re-read once Google is connected. */
  google_ids?: boolean;
  attributed_only?: AttributedOnlyRow[];
  /** False when the export lacked session_traffic_source_last_click, so attributed_only could not be counted. */
  attributed_measured?: boolean;
};

export type PaidLandingState = {
  last_success_at?: string;
  last_error?: string;
  consecutive_failures: number;
  /** Latest date that had a GA4 export table. */
  last_export_date?: string;
  /** Last run: GA4 export had the Google Ads link fields (`session_traffic_source_last_click.google_ads_campaign`). */
  google_link_available?: boolean | null;
  /** Last run: why the gclid → ClickStats join was skipped (e.g. datasets in different locations); null = worked. */
  gclid_join_error?: string | null;
  /** Last run joined this many ClickStats tables. */
  gclid_join_tables?: number;
};

export const PAID_LANDING_DAYS_DIR = "paid-landing-days";
export const PAID_LANDING_STATE_FILE = "paid-landing-state.json";

function dir(site: string): string {
  return path.join(CACHE_DIR, site, PAID_LANDING_DAYS_DIR);
}

function statePath(site: string): string {
  return path.join(CACHE_DIR, site, PAID_LANDING_STATE_FILE);
}

function readJson<T>(file: string): T | null {
  try {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), "utf-8");
  fs.renameSync(tmp, file);
}

export function listPaidLandingDates(site: string): string[] {
  const d = dir(site);
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort();
}

export function loadPaidLandingDay(site: string, date: string): PaidLandingDayFile | null {
  const f = readJson<PaidLandingDayFile>(path.join(dir(site), `${date}.json`));
  return f && f.date === date && Array.isArray(f.candidates) ? f : null;
}

export function loadPaidLandingState(site: string): PaidLandingState {
  return readJson<PaidLandingState>(statePath(site)) ?? { consecutive_failures: 0 };
}

export function loadPaidLandingDays(site: string, since: string, until: string): PaidLandingDayFile[] {
  return listPaidLandingDates(site)
    .filter((d) => d >= since && d <= until)
    .map((d) => loadPaidLandingDay(site, d))
    .filter((f): f is PaidLandingDayFile => !!f);
}

export type PaidLandingSnapshot = {
  paid_landing_days: PaidLandingDayFile[];
  paid_landing_state: PaidLandingState;
};

/** Every cached GA4 paid-landing day on or after `since` (for "Download from production"). */
export function exportPaidLandingSnapshot(site: string, since: string): PaidLandingSnapshot {
  return {
    paid_landing_days: listPaidLandingDates(site)
      .filter((d) => d >= since)
      .map((d) => loadPaidLandingDay(site, d))
      .filter((f): f is PaidLandingDayFile => !!f),
    paid_landing_state: loadPaidLandingState(site),
  };
}

/** Writes a snapshot under `stagingRoot` using the live cache layout; the caller swaps it in. */
export function stagePaidLandingSnapshot(stagingRoot: string, snap: PaidLandingSnapshot): void {
  fs.mkdirSync(path.join(stagingRoot, PAID_LANDING_DAYS_DIR), { recursive: true });
  for (const f of snap.paid_landing_days) writeJson(path.join(stagingRoot, PAID_LANDING_DAYS_DIR, `${f.date}.json`), f);
  writeJson(path.join(stagingRoot, PAID_LANDING_STATE_FILE), snap.paid_landing_state);
}

export function isGa4Configured(contentRoot?: string): boolean {
  return getBigQueryConfigStatus(contentRoot).configured;
}

export function lastCompleteGa4Date(now = new Date()): string {
  return addDays(utcDate(now), -GA4_COMPLETE_LAG_DAYS);
}

/** A cached day is stale when it predates the current schema, or lacks Google ids now that Google is connected. */
function needsUpgrade(f: PaidLandingDayFile, google: boolean): boolean {
  if ((f.schema_version ?? 1) < PAID_LANDING_SCHEMA_VERSION) return true;
  return google && f.google_ids === false;
}

export type PaidLandingFetchPlan = {
  /** Missing or not-yet-final days in the backfill window, newest first. */
  missing: string[];
  /** Every other cached complete day (whole retention) that needs a re-read, newest first. */
  upgrade: string[];
};

/** Days to (re)query: missing / incomplete in the backfill window, then stale cached days anywhere in retention. */
export function paidLandingDatesToFetch(site: string, now = new Date(), google = false): PaidLandingFetchPlan {
  const until = addDays(utcDate(now), -1);
  const since = addDays(until, -(PAID_LANDING_BACKFILL_DAYS - 1));
  const completeCutoff = lastCompleteGa4Date(now);
  const floor = addDays(utcDate(now), -PAID_LANDING_RETENTION_DAYS);
  const missing: string[] = [];
  const queued = new Set<string>();
  for (const d of dateRange(since, until).reverse()) {
    const f = loadPaidLandingDay(site, d);
    if (!f || (!f.complete && d <= completeCutoff) || d > completeCutoff) {
      missing.push(d);
      queued.add(d);
    }
  }
  const upgrade: string[] = [];
  for (const d of listPaidLandingDates(site).reverse()) {
    if (queued.has(d) || d < floor || d > until) continue;
    const f = loadPaidLandingDay(site, d);
    if (f && needsUpgrade(f, google)) upgrade.push(d);
  }
  return { missing, upgrade };
}

/** One run: up to 30 missing days, then every stale cached day so a rule change finishes in a single sync. */
function runDates(plan: PaidLandingFetchPlan): string[] {
  return [...plan.missing.slice(0, MAX_DAYS_PER_RUN), ...plan.upgrade.slice(0, MAX_UPGRADE_DAYS_PER_RUN)];
}

function googleWanted(contentRoot?: string): boolean {
  return isGoogleConfiguredSettings(getAdsSettings(contentRoot).google);
}

/** GA4 days `syncPaidLandingDays` will query on a run starting now; 0 when GA4 isn't configured. */
export function planPaidLandingSteps(site: string, contentRoot?: string, now = new Date()): number {
  if (!isGa4Configured(contentRoot)) return 0;
  return runDates(paidLandingDatesToFetch(site, now, googleWanted(contentRoot))).length;
}

/** Cached days in [since, until] still at an older schema (normally 0; >0 after a failed re-read run). */
export function countOldRuleDays(days: PaidLandingDayFile[]): number {
  return days.filter((d) => (d.schema_version ?? 1) < PAID_LANDING_SCHEMA_VERSION).length;
}

/** ClickStats tables for ticked accounts, as recorded by the last Google sync. */
export function paidLandingClickStats(site: string, contentRoot?: string): PaidLandingClickStats[] {
  const g = getAdsSettings(contentRoot).google;
  if (!isGoogleConfiguredSettings(g)) return [];
  const state = loadGoogleState(site);
  const out: PaidLandingClickStats[] = [];
  for (const cid of g!.customer_ids) {
    const cs = state.customers[cid]?.click_stats;
    if (cs) out.push({ customer_id: cid, table: cs.table, columns: cs.columns });
  }
  return out;
}

export type PaidLandingAttempt = Required<PaidLandingSqlOptions>;

/**
 * Next, cheaper query after a failure, or null to give up. Order: drop the ClickStats join
 * (other location / no access), then the Google Ads link field, then session_traffic_source_last_click.
 */
export function nextPaidLandingAttempt(prev: PaidLandingAttempt, message: string): PaidLandingAttempt | null {
  if (/google_ads_campaign/i.test(message) && prev.googleLink) return { ...prev, googleLink: false };
  if (/session_traffic_source_last_click/i.test(message) && prev.includeSessionLastClick) {
    return { ...prev, includeSessionLastClick: false, googleLink: false };
  }
  if (prev.clickStats.length > 0) return { ...prev, clickStats: [] };
  return null;
}

/** ClickStats tables joined on the landing gclid (one per ticked Google Ads account). */
export type PaidLandingClickStats = { customer_id: string; table: string; columns: string[] };

export type PaidLandingSqlOptions = {
  includeSessionLastClick: boolean;
  /** Read `session_traffic_source_last_click.google_ads_campaign` (GA4 ↔ Google Ads link). */
  googleLink?: boolean;
  clickStats?: PaidLandingClickStats[];
};

function clickStatsSelect(c: PaidLandingClickStats): string {
  const col = (name: string) => (c.columns.includes(name) ? `CAST(${name} AS STRING)` : "CAST(NULL AS STRING)");
  const cid = c.customer_id.replace(/\D/g, "");
  const ownRows = c.columns.includes("customer_id") ? `\n        AND CAST(customer_id AS STRING) = '${cid}'` : "";
  return `SELECT click_view_gclid AS gclid, '${cid}' AS customer_id, ${col("campaign_id")} AS campaign_id,
        ${col("ad_group_id")} AS ad_group_id, ${col("segments_ad_network_type")} AS network
      FROM \`${c.table.replace(/`/g, "")}\`
      WHERE segments_date BETWEEN DATE_SUB(PARSE_DATE('%Y%m%d', @suffix), INTERVAL 1 DAY) AND PARSE_DATE('%Y%m%d', @suffix)
        AND click_view_gclid IS NOT NULL${ownRows}`;
}

/** Click ids that prove a session started from a Google Ads click (gates the GA4 ↔ Google Ads link fields). */
export const GOOGLE_CLICK_IDS = ["gclid", "gbraid", "wbraid", "dclid"] as const;

const ATTRIBUTED_TOP_HOSTS = 10;
export const ATTRIBUTED_OTHER_HOST = "(other)";

export type AttributedOnlyVisits = { total: number; by_host: AttributedOnlyRow[] };

/**
 * Window total of sessions GA4 credits to ads without per-visit evidence. Null when a day was read
 * without GA4's last-click field (can't measure, not zero). Days on an older schema contribute nothing.
 */
export function summarizeAttributedOnly(days: PaidLandingDayFile[]): AttributedOnlyVisits | null {
  const byHost = new Map<string, number>();
  for (const d of days) {
    if ((d.schema_version ?? 1) < PAID_LANDING_SCHEMA_VERSION) continue;
    if (d.attributed_measured === false) return null;
    for (const r of d.attributed_only ?? []) byHost.set(r.host, (byHost.get(r.host) ?? 0) + r.sessions);
  }
  const sorted = Array.from(byHost.entries())
    .map(([host, sessions]) => ({ host, sessions }))
    .sort((a, b) => b.sessions - a.sessions);
  const top = sorted.slice(0, ATTRIBUTED_TOP_HOSTS);
  const rest = sorted.slice(ATTRIBUTED_TOP_HOSTS).reduce((s, r) => s + r.sessions, 0);
  if (rest > 0) top.push({ host: ATTRIBUTED_OTHER_HOST, sessions: rest });
  return { total: sorted.reduce((s, r) => s + r.sessions, 0), by_host: top };
}

/**
 * Paid evidence is per visit only: click ids / UTMs on the landing URL, else GA4's event-scoped
 * `collected_traffic_source`. GA4's carried-over `session_traffic_source_last_click` (and the
 * first-user `traffic_source`) never make a session paid; with `includeSessionLastClick` they only
 * feed the per-host "attributed" count (GA4 credits ads, we don't) and, behind a Google click id,
 * the Google Ads campaign ids.
 */
export function buildPaidLandingSql(eventsTable: string, opts: boolean | PaidLandingSqlOptions): string {
  const o: PaidLandingSqlOptions = typeof opts === "boolean" ? { includeSessionLastClick: opts } : opts;
  const lastClick = o.includeSessionLastClick;
  const link = lastClick && !!o.googleLink;
  const clickStats = o.clickStats ?? [];
  const gadsField = (f: string) =>
    link ? `CAST(session_traffic_source_last_click.google_ads_campaign.${f} AS STRING)` : "CAST(NULL AS STRING)";
  const lastClickMedium = lastClick
    ? `COALESCE(NULLIF(session_traffic_source_last_click.manual_campaign.medium, ''),
            NULLIF(session_traffic_source_last_click.cross_channel_campaign.medium, ''))`
    : "CAST(NULL AS STRING)";
  const clickIdAlternation = [...CLICK_ID_PARAMS, "utm_id"].join("|");
  const param = (key: string) =>
    `REGEXP_EXTRACT(landing.page_location, r'[?&]${key}=([^&#]+)')`;
  const firstClickId = `CASE
      ${CLICK_ID_PARAMS.map((c) => `WHEN ${param(c)} IS NOT NULL THEN '${c}'`).join("\n      ")}
      ELSE NULL END`;
  const joined =
    clickStats.length > 0
      ? `clicks AS (
      SELECT gclid, ANY_VALUE(customer_id) AS customer_id, ANY_VALUE(campaign_id) AS campaign_id,
        ANY_VALUE(ad_group_id) AS ad_group_id, ANY_VALUE(network) AS network
      FROM (${clickStats.map(clickStatsSelect).join("\n      UNION ALL\n      ")})
      GROUP BY gclid
    ),
    matched AS (
      SELECT l.*, k.customer_id AS k_cid, k.campaign_id AS k_campaign, k.ad_group_id AS k_ad_group, k.network AS k_network
      FROM landed l LEFT JOIN clicks k ON l.gclid IS NOT NULL AND k.gclid = l.gclid
    )`
      : `matched AS (
      SELECT *, CAST(NULL AS STRING) AS k_cid, CAST(NULL AS STRING) AS k_campaign, CAST(NULL AS STRING) AS k_ad_group, CAST(NULL AS STRING) AS k_network
      FROM landed
    )`;
  return `
    WITH base AS (
      SELECT
        user_pseudo_id,
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS sid,
        event_name,
        event_timestamp,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS page_location,
        ${bqNormalizedPagePathSql()} AS page_path,
        (SELECT COALESCE(value.string_value, CAST(value.int_value AS STRING)) FROM UNNEST(event_params) WHERE key = 'session_engaged') AS session_engaged,
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec') AS engagement_time_msec,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'experiment_id') AS experiment_id,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'variant') AS variant,
        NULLIF(collected_traffic_source.manual_source, '') AS ct_source,
        NULLIF(collected_traffic_source.manual_medium, '') AS ct_medium,
        NULLIF(collected_traffic_source.manual_campaign_name, '') AS ct_campaign,
        ${lastClickMedium} AS lc_medium,
        ${gadsField("customer_id")} AS gads_cid,
        ${gadsField("campaign_id")} AS gads_campaign,
        ${gadsField("ad_group_id")} AS gads_ad_group,
        ${gadsField("campaign_name")} AS gads_campaign_name
      FROM ${eventsTable}
      WHERE _TABLE_SUFFIX = @suffix
    ),
    sessions AS (
      SELECT
        ARRAY_AGG(IF(event_name = 'page_view', STRUCT(page_location, page_path, lc_medium, gads_cid, gads_campaign, gads_ad_group, gads_campaign_name), NULL)
          IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS landing,
        ARRAY_AGG(IF(ct_source IS NOT NULL OR ct_medium IS NOT NULL, STRUCT(ct_source, ct_medium, ct_campaign), NULL)
          IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS collected,
        ARRAY_AGG(IF(event_name = 'experiment_exposure', STRUCT(experiment_id, variant), NULL)
          IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS exposure,
        MAX(IF(session_engaged = '1', 1, 0)) AS engaged,
        SUM(COALESCE(engagement_time_msec, 0)) AS engagement_ms,
        COUNTIF(event_name IN UNNEST(@lead_events)) AS leads
      FROM base
      WHERE user_pseudo_id IS NOT NULL AND sid IS NOT NULL
      GROUP BY user_pseudo_id, sid
    ),
    tagged AS (
      SELECT
        *,
        REGEXP_EXTRACT(landing.page_location, r'^https?://([^/?#:]+)') AS host,
        REGEXP_EXTRACT(landing.page_location, r'[?&]gclid=([^&#]+)') AS gclid,
        REGEXP_CONTAINS(COALESCE(landing.page_location, ''), r'[?&](${GOOGLE_CLICK_IDS.join("|")})=') AS google_click,
        REGEXP_CONTAINS(COALESCE(landing.page_location, ''), r'[?&](${clickIdAlternation})=') AS has_click_id,
        COALESCE(${param("utm_source")}, collected.ct_source) AS v_source,
        COALESCE(${param("utm_medium")}, collected.ct_medium) AS v_medium,
        COALESCE(${param("utm_campaign")}, collected.ct_campaign) AS v_campaign
      FROM sessions
      WHERE landing IS NOT NULL
    ),
    landed AS (
      SELECT
        *,
        (has_click_id OR LOWER(v_medium) IN UNNEST(@paid_mediums)) AS is_candidate
      FROM tagged
    ),
    ${joined}
    SELECT
      'candidate' AS kind,
      host,
      landing.page_path AS path,
      COALESCE(v_source, '(direct)') AS source,
      COALESCE(v_medium, '(none)') AS medium,
      COALESCE(v_campaign, IF(google_click, landing.gads_campaign_name, NULL), '(not set)') AS campaign,
      ${firstClickId} AS click_id_type,
      ${param("utm_id")} AS utm_id,
      ${param("utm_term")} AS utm_term,
      ${param("utm_content")} AS utm_content,
      exposure.experiment_id AS experiment_id,
      exposure.variant AS variant,
      COUNT(*) AS sessions,
      SUM(engaged) AS engaged_sessions,
      SUM(engagement_ms) AS engagement_ms,
      SUM(leads) AS lead_events,
      COUNTIF(leads > 0) AS sessions_with_lead,
      0 AS page_views,
      COALESCE(IF(google_click, landing.gads_cid, NULL), k_cid) AS gads_customer_id,
      COALESCE(IF(google_click, landing.gads_campaign, NULL), k_campaign) AS gads_campaign_id,
      COALESCE(IF(google_click, landing.gads_ad_group, NULL), k_ad_group) AS gads_ad_group_id,
      k_network AS gads_network,
      CASE WHEN google_click AND landing.gads_campaign IS NOT NULL THEN 'ga4_link' WHEN k_campaign IS NOT NULL THEN 'gclid' END AS gads_match
    FROM matched
    WHERE is_candidate
    GROUP BY host, path, source, medium, campaign, click_id_type, utm_id, utm_term, utm_content, experiment_id, variant,
      gads_customer_id, gads_campaign_id, gads_ad_group_id, gads_network, gads_match
    UNION ALL
    SELECT
      'organic', host, landing.page_path, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      exposure.experiment_id, exposure.variant,
      COUNT(*), SUM(engaged), SUM(engagement_ms), SUM(leads), COUNTIF(leads > 0), 0, NULL, NULL, NULL, NULL, NULL
    FROM landed
    WHERE NOT is_candidate
    GROUP BY host, landing.page_path, exposure.experiment_id, exposure.variant
    UNION ALL${
      lastClick
        ? `
    SELECT
      'attributed', host, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      COUNT(*), 0, 0, 0, 0, 0, NULL, NULL, NULL, NULL, NULL
    FROM landed
    WHERE NOT is_candidate AND (LOWER(landing.lc_medium) IN UNNEST(@paid_mediums) OR landing.gads_campaign IS NOT NULL)
    GROUP BY host
    UNION ALL`
        : ""
    }
    SELECT
      'cookieless', REGEXP_EXTRACT(page_location, r'^https?://([^/?#:]+)'), page_path,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, 0, COUNT(*), NULL, NULL, NULL, NULL, NULL
    FROM base
    WHERE user_pseudo_id IS NULL AND event_name = 'page_view'
    GROUP BY 2, 3
  `;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  if (v && typeof v === "object" && "value" in (v as object)) return num((v as { value: unknown }).value);
  return 0;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

export function parsePaidLandingRows(
  raw: Record<string, unknown>[],
): Pick<PaidLandingDayFile, "candidates" | "organic" | "cookieless"> & { attributed_only: AttributedOnlyRow[] } {
  const candidates: PaidLandingCandidateRow[] = [];
  const organic: OrganicBaselineRow[] = [];
  const cookieless: CookielessRow[] = [];
  const attributed_only: AttributedOnlyRow[] = [];
  for (const r of raw) {
    const host = (str(r.host) ?? "").toLowerCase().replace(/^www\./, "");
    const p = normalizeLandingPath(str(r.path) ?? "/");
    if (r.kind === "attributed") {
      const sessions = num(r.sessions);
      if (sessions <= 0) continue;
      const same = attributed_only.find((a) => a.host === host);
      if (same) same.sessions += sessions;
      else attributed_only.push({ host, sessions });
    } else if (r.kind === "cookieless") {
      cookieless.push({ host, path: p, page_views: num(r.page_views) });
    } else if (r.kind === "organic") {
      const experimentId = str(r.experiment_id);
      const variant = str(r.variant);
      organic.push({
        host,
        path: p,
        sessions: num(r.sessions),
        engaged_sessions: num(r.engaged_sessions),
        engagement_ms: num(r.engagement_ms),
        sessions_with_lead: num(r.sessions_with_lead),
        ...(experimentId ? { experiment_id: experimentId } : {}),
        ...(variant ? { variant } : {}),
      });
    } else {
      const clickId = str(r.click_id_type) as ClickIdParam | null;
      const gadsMatch = r.gads_match === "ga4_link" || r.gads_match === "gclid" ? r.gads_match : null;
      const gads: Partial<PaidLandingCandidateRow> = gadsMatch
        ? {
            gads_customer_id: normalizeGoogleCustomerId(str(r.gads_customer_id)),
            gads_campaign_id: adIdFromTag(str(r.gads_campaign_id)),
            gads_ad_group_id: adIdFromTag(str(r.gads_ad_group_id)),
            gads_network: str(r.gads_network) ? googleNetworkOf(str(r.gads_network)) : null,
            gads_match: gadsMatch,
          }
        : {};
      candidates.push({
        ...gads,
        host,
        path: p,
        source: str(r.source) ?? "(direct)",
        medium: str(r.medium) ?? "(none)",
        campaign: str(r.campaign) ?? "(not set)",
        click_id_type: clickId && (CLICK_ID_PARAMS as string[]).includes(clickId) ? clickId : null,
        utm_id: str(r.utm_id),
        utm_term: str(r.utm_term),
        utm_content: str(r.utm_content),
        experiment_id: str(r.experiment_id),
        variant: str(r.variant),
        sessions: num(r.sessions),
        engaged_sessions: num(r.engaged_sessions),
        engagement_ms: num(r.engagement_ms),
        lead_events: num(r.lead_events),
        sessions_with_lead: num(r.sessions_with_lead),
      });
    }
  }
  attributed_only.sort((a, b) => b.sessions - a.sessions);
  return { candidates, organic, cookieless, attributed_only };
}

type DayQueryResult = Pick<PaidLandingDayFile, "candidates" | "organic" | "cookieless" | "attributed_only"> & {
  attempt: PaidLandingAttempt;
  /** Set when the ClickStats join was requested but dropped. */
  join_error: string | null;
};

async function queryDay(date: string, contentRoot: string | undefined, first: PaidLandingAttempt): Promise<DayQueryResult> {
  const client = getBigQueryClient(contentRoot);
  if (!client) throw new Error("bigquery_client_unavailable");
  const settings = getBigQuerySettings(contentRoot);
  const leadEvents = getLeadConversionEventNames(contentRoot);
  const params = {
    suffix: date.replace(/-/g, ""),
    lead_events: leadEvents.length > 0 ? leadEvents : ["__no_lead_events__"],
    paid_mediums: [...PAID_MEDIUMS],
  };
  const run = async (attempt: PaidLandingAttempt) => {
    const [rows] = await client.query({
      query: buildPaidLandingSql(fqEventsWildcard(settings), attempt),
      params,
      location: settings.location || undefined,
      maximumBytesBilled: MAX_BYTES_BILLED,
    });
    return (rows || []) as Record<string, unknown>[];
  };
  let attempt = first;
  let joinError: string | null = null;
  for (;;) {
    try {
      const raw = await run(attempt);
      return { ...parsePaidLandingRows(raw), attempt, join_error: joinError };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const next = nextPaidLandingAttempt(attempt, msg);
      if (!next) throw err;
      if (attempt.clickStats.length > 0 && next.clickStats.length === 0) joinError = msg.slice(0, 300);
      attempt = next;
    }
  }
}

export type PaidLandingSyncResult = { ok: boolean; fetched: string[]; error?: string; skipped?: "ga4_not_configured" | "ads_config_unreadable" };

export async function syncPaidLandingDays(
  site: string,
  contentRoot?: string,
  now = new Date(),
  onStep?: SyncStepCallback,
): Promise<PaidLandingSyncResult> {
  if (!isGa4Configured(contentRoot)) return { ok: false, fetched: [], skipped: "ga4_not_configured" };
  if (adsConfigReadError(contentRoot) != null) return { ok: false, fetched: [], skipped: "ads_config_unreadable" };
  const state = loadPaidLandingState(site);
  const completeCutoff = lastCompleteGa4Date(now);
  const fetched: string[] = [];
  const google = googleWanted(contentRoot);
  let attempt: PaidLandingAttempt = {
    includeSessionLastClick: true,
    googleLink: google,
    clickStats: google ? paidLandingClickStats(site, contentRoot) : [],
  };
  const requestedJoin = attempt.clickStats.length > 0;
  try {
    const plan = paidLandingDatesToFetch(site, now, google);
    const dates = runDates(plan);
    const startedAt = Date.now();
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      onStep?.(`GA4: day ${i + 1} of ${dates.length} (${shortDateRange(date, date)})`);
      const { attempt: used, join_error, ...rows } = await queryDay(date, contentRoot, attempt);
      if (join_error) state.gclid_join_error = join_error;
      // Later days skip what already failed (same datasets, same error).
      attempt = used;
      const hasData = rows.candidates.length + rows.organic.length + rows.cookieless.length > 0;
      writeJson(path.join(dir(site), `${date}.json`), {
        date,
        fetched_at: new Date().toISOString(),
        complete: date <= completeCutoff,
        schema_version: PAID_LANDING_SCHEMA_VERSION,
        google_ids: google,
        attributed_measured: used.includeSessionLastClick,
        ...rows,
      } satisfies PaidLandingDayFile);
      if (hasData && (!state.last_export_date || date > state.last_export_date)) state.last_export_date = date;
      fetched.push(date);
    }
    const upgraded = Math.min(plan.upgrade.length, MAX_UPGRADE_DAYS_PER_RUN);
    if (upgraded > 0) {
      log.info({ site, upgraded_days: upgraded, ms: Date.now() - startedAt }, "[paid-detection] re-read cached GA4 days at the current schema");
    }
    const floor = addDays(utcDate(now), -PAID_LANDING_RETENTION_DAYS);
    for (const d of listPaidLandingDates(site)) {
      if (d >= floor) break;
      try {
        fs.unlinkSync(path.join(dir(site), `${d}.json`));
      } catch {
        /* ignore */
      }
    }
    if (google && dates.length > 0) {
      state.google_link_available = attempt.googleLink;
      state.gclid_join_tables = attempt.clickStats.length;
      if (attempt.clickStats.length > 0 || !requestedJoin) state.gclid_join_error = null;
    }
    state.last_success_at = new Date().toISOString();
    state.last_error = undefined;
    state.consecutive_failures = 0;
    writeJson(statePath(site), state);
    return { ok: true, fetched };
  } catch (err) {
    state.last_error = err instanceof Error ? err.message : String(err);
    state.consecutive_failures = (state.consecutive_failures || 0) + 1;
    writeJson(statePath(site), state);
    log.warn({ err, site }, "[paid-detection] GA4 paid-landing sync failed");
    return { ok: false, fetched, error: state.last_error };
  }
}
