/**
 * Page performance for component insights (nightly).
 *
 * One BigQuery query over the GA4 export: sessions by landing page ×
 * channel × campaign for the last 90 days, with session-level flags for
 * engagement, leads, add_to_cart and begin_checkout. Each insights layout
 * record (page, or shared template = sum of its attached entries) gets:
 *
 *   expected = Σ_channel sessions(page, c) × baseline_rate(c, content_type, stage)
 *              (campaign baseline instead when that campaign feeds 2+ layouts)
 *   lift     = (outcome + k) / (expected + k),  k = 5
 *   factor   = clamp(lift, 0.5, 1.5)
 *
 * outcome = leads + checkouts for decision-stage pages, engaged sessions
 * otherwise. Output: .cache/<site>/page-performance.json (read by the scan).
 */
import fs from "fs";
import path from "path";
import { CACHE_DIR } from "../db-cache";
import {
  fqEventsWildcard,
  getBigQueryClient,
  getBigQueryConfigStatus,
  getBigQuerySettings,
} from "../ecommerce/bigquery-client";
import { normalizeAnalyticsPath } from "../ecommerce/journey-analytics";
import { getLeadConversionEventNames } from "../settings";
import { GOOGLE_CLICK_IDS } from "../ads/paid-detection";
import type { InsightPagePerformance, InsightPageRecord } from "@shared/schema";
import { child } from "../logger";

const log = child({ module: "page-performance" });

export const PERFORMANCE_WINDOW_DAYS = 90;
export const PERFORMANCE_K = 5;
export const PERFORMANCE_CLAMP: [number, number] = [0.5, 1.5];
const MAX_BYTES_BILLED = "20000000000";
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const FILE = "page-performance.json";

export interface PagePerformanceFile {
  generated_at: string;
  window_days: number;
  pages: Record<string, InsightPagePerformance>;
}

export interface ChannelRow {
  path: string;
  channel: string;
  campaign: string | null;
  sessions: number;
  engaged: number;
  leads: number;
  add_to_cart: number;
  checkouts: number;
}

function filePath(contentFolder: string): string {
  return path.join(CACHE_DIR, contentFolder, FILE);
}

export function readPagePerformanceFile(contentFolder: string): PagePerformanceFile | null {
  try {
    return JSON.parse(fs.readFileSync(filePath(contentFolder), "utf8")) as PagePerformanceFile;
  } catch {
    return null;
  }
}

export function readPagePerformance(contentFolder: string): Record<string, InsightPagePerformance> | null {
  return readPagePerformanceFile(contentFolder)?.pages ?? null;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  if (v && typeof v === "object" && "value" in (v as object)) return num((v as { value: unknown }).value);
  return 0;
}

/** Session channel from the landing URL (click ids) and manual medium / source. */
export function bqChannelCaseSql(loc: string, medium: string, source: string): string {
  const clickIds = GOOGLE_CLICK_IDS.map((id) => `'${id}='`).join(", ");
  return `CASE
          WHEN EXISTS (SELECT 1 FROM UNNEST([${clickIds}]) p WHERE STRPOS(${loc}, p) > 0)
            OR ${medium} IN ('cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'paid_social', 'paidsocial', 'display', 'cpm')
            THEN 'paid'
          WHEN ${medium} = 'organic' THEN 'organic'
          WHEN ${medium} IN ('email', 'e-mail', 'newsletter') THEN 'email'
          WHEN ${medium} IN ('social', 'social-network', 'sm')
            OR REGEXP_CONTAINS(${source}, r'facebook|instagram|linkedin|tiktok|twitter|^t\\.co$|youtube') THEN 'social'
          WHEN ${medium} = 'referral' THEN 'referral'
          WHEN ${source} IN ('', '(direct)') THEN 'direct'
          ELSE 'other'
        END`;
}

export function buildPagePerformanceSql(eventsTable: string): string {
  return `
    WITH params AS (SELECT @start_date AS start_date, @end_date AS end_date),
    ev AS (
      SELECT
        CONCAT(user_pseudo_id, '-', CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)) AS sid,
        event_timestamp,
        event_name,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS loc,
        (SELECT COALESCE(value.string_value, CAST(value.int_value AS STRING)) FROM UNNEST(event_params) WHERE key = 'session_engaged') AS engaged,
        LOWER(COALESCE(NULLIF(collected_traffic_source.manual_medium, ''), '')) AS medium,
        LOWER(COALESCE(NULLIF(collected_traffic_source.manual_source, ''), '')) AS source,
        NULLIF(collected_traffic_source.manual_campaign_name, '') AS campaign
      FROM ${eventsTable}, params
      WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE(params.start_date))
        AND FORMAT_DATE('%Y%m%d', DATE(params.end_date))
        AND event_name IN UNNEST(@event_names)
    ),
    landing AS (
      SELECT sid,
        ARRAY_AGG(STRUCT(loc, medium, source, campaign) ORDER BY event_timestamp LIMIT 1)[OFFSET(0)] AS first
      FROM ev WHERE event_name = 'page_view' AND sid IS NOT NULL
      GROUP BY sid
    ),
    flags AS (
      SELECT sid,
        LOGICAL_OR(engaged = '1') AS engaged,
        LOGICAL_OR(event_name IN UNNEST(@lead_events)) AS lead,
        LOGICAL_OR(event_name = 'add_to_cart') AS atc,
        LOGICAL_OR(event_name = 'begin_checkout') AS checkout
      FROM ev WHERE sid IS NOT NULL GROUP BY sid
    ),
    sessions AS (
      SELECT
        REGEXP_REPLACE(REGEXP_EXTRACT(l.first.loc, r'^https?://[^/?#]+([^?#]*)'), r'/+$', '') AS path,
        ${bqChannelCaseSql("l.first.loc", "l.first.medium", "l.first.source")} AS channel,
        l.first.campaign AS campaign,
        f.engaged, f.lead, f.atc, f.checkout
      FROM landing l JOIN flags f USING (sid)
    )
    SELECT
      IF(path = '' OR path IS NULL, '/', path) AS path, channel, campaign,
      COUNT(*) AS sessions,
      COUNTIF(engaged) AS engaged,
      COUNTIF(lead) AS leads,
      COUNTIF(atc) AS add_to_cart,
      COUNTIF(checkout) AS checkouts
    FROM sessions
    GROUP BY path, channel, campaign
  `;
}

export type LayoutPathIndex = Map<string, { key: string; contentType: string; stage?: string }>;

export function outcomeMetricForStage(stage: string | undefined): "conversions" | "engaged_sessions" {
  return stage === "decision" ? "conversions" : "engaged_sessions";
}

function outcomeOf(row: ChannelRow, metric: "conversions" | "engaged_sessions"): number {
  return metric === "conversions" ? row.leads + row.checkouts : row.engaged;
}

/**
 * Lift vs expected per layout record. Pure — exported for tests.
 * Rows whose path is not in the index (other pages, unknown URLs) still
 * feed the channel baselines only when they map to a layout.
 */
export function computeLayoutPerformance(
  rows: ChannelRow[],
  index: LayoutPathIndex,
  opts: { windowDays: number; now?: Date; k?: number } = { windowDays: PERFORMANCE_WINDOW_DAYS },
): Record<string, InsightPagePerformance> {
  const k = opts.k ?? PERFORMANCE_K;
  type Mapped = ChannelRow & { key: string; contentType: string; stage?: string; metric: "conversions" | "engaged_sessions" };
  const mapped: Mapped[] = [];
  for (const r of rows) {
    const hit = index.get(normalizeAnalyticsPath(r.path) || r.path);
    if (!hit) continue;
    mapped.push({ ...r, ...hit, metric: outcomeMetricForStage(hit.stage) });
  }

  const baseline = new Map<string, { s: number; o: number }>();
  const campaignLayouts = new Map<string, Set<string>>();
  const bump = (key: string, s: number, o: number) => {
    const b = baseline.get(key) ?? { s: 0, o: 0 };
    b.s += s;
    b.o += o;
    baseline.set(key, b);
  };
  for (const r of mapped) {
    const o = outcomeOf(r, r.metric);
    bump(`ch|${r.channel}|${r.contentType}|${r.stage ?? ""}`, r.sessions, o);
    bump(`ch|${r.channel}|*|${r.metric}`, r.sessions, o);
    if (r.campaign) {
      bump(`cp|${r.campaign}|${r.metric}`, r.sessions, o);
      const set = campaignLayouts.get(r.campaign) ?? new Set<string>();
      set.add(r.key);
      campaignLayouts.set(r.campaign, set);
    }
  }
  const rate = (key: string): number | null => {
    const b = baseline.get(key);
    return b && b.s > 0 ? b.o / b.s : null;
  };

  const acc = new Map<string, { outcome: number; expected: number; sessions: number; metric: string }>();
  for (const r of mapped) {
    const campaignRate =
      r.campaign && (campaignLayouts.get(r.campaign)?.size ?? 0) >= 2 ? rate(`cp|${r.campaign}|${r.metric}`) : null;
    const channelRate =
      rate(`ch|${r.channel}|${r.contentType}|${r.stage ?? ""}`) ?? rate(`ch|${r.channel}|*|${r.metric}`) ?? 0;
    const a = acc.get(r.key) ?? { outcome: 0, expected: 0, sessions: 0, metric: r.metric };
    a.outcome += outcomeOf(r, r.metric);
    a.expected += r.sessions * (campaignRate ?? channelRate);
    a.sessions += r.sessions;
    acc.set(r.key, a);
  }

  const generated_at = (opts.now ?? new Date()).toISOString();
  const out: Record<string, InsightPagePerformance> = {};
  for (const [key, a] of acc) {
    const lift = (a.outcome + k) / (a.expected + k);
    out[key] = {
      factor: Math.round(Math.min(PERFORMANCE_CLAMP[1], Math.max(PERFORMANCE_CLAMP[0], lift)) * 1000) / 1000,
      lift: Math.round(lift * 1000) / 1000,
      outcome: a.outcome,
      expected: Math.round(a.expected * 100) / 100,
      sessions: a.sessions,
      outcome_metric: a.metric,
      window_days: opts.windowDays,
      generated_at,
    };
  }
  return out;
}

/** Public paths → layout record (template records collect every attached entry's URLs). */
export function buildLayoutPathIndex(
  records: InsightPageRecord[],
  urlsFor: (contentType: string, slug: string) => Record<string, string>,
): LayoutPathIndex {
  const index: LayoutPathIndex = new Map();
  for (const r of records) {
    if (r.kind === "overlay") continue;
    const slugs = r.kind === "shared_template" ? (r.slugs ?? []) : r.slug ? [r.slug] : [];
    for (const slug of slugs) {
      let urls: Record<string, string> = {};
      try {
        urls = urlsFor(r.contentType, slug) ?? {};
      } catch {
        urls = {};
      }
      for (const u of Object.values(urls)) {
        const p = typeof u === "string" ? normalizeAnalyticsPath(u) : "";
        if (p) index.set(p, { key: r.key, contentType: r.contentType, ...(r.funnelStage ? { stage: r.funnelStage } : {}) });
      }
    }
  }
  return index;
}

export async function runPagePerformanceJob(opts: {
  contentFolder: string;
  contentRoot?: string;
  records: InsightPageRecord[];
  urlsFor: (contentType: string, slug: string) => Record<string, string>;
}): Promise<{ ok: boolean; pages?: number; skipped?: string; error?: string }> {
  const status = getBigQueryConfigStatus(opts.contentRoot);
  if (!status.configured) return { ok: true, skipped: "bigquery_not_configured" };
  const client = getBigQueryClient(opts.contentRoot);
  if (!client) return { ok: true, skipped: "bigquery_client_unavailable" };
  const settings = getBigQuerySettings(opts.contentRoot);
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (PERFORMANCE_WINDOW_DAYS - 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const leadEvents = getLeadConversionEventNames(opts.contentRoot);
  try {
    const [raw] = await client.query({
      query: buildPagePerformanceSql(fqEventsWildcard(settings)),
      params: {
        start_date: fmt(start),
        end_date: fmt(end),
        lead_events: leadEvents.length ? leadEvents : ["__none__"],
        event_names: ["page_view", "user_engagement", "add_to_cart", "begin_checkout", ...leadEvents],
      },
      location: settings.location || undefined,
      maximumBytesBilled: MAX_BYTES_BILLED,
    });
    const rows: ChannelRow[] = ((raw || []) as Record<string, unknown>[]).map((r) => ({
      path: String(r.path ?? ""),
      channel: String(r.channel ?? "other"),
      campaign: typeof r.campaign === "string" && r.campaign ? r.campaign : null,
      sessions: num(r.sessions),
      engaged: num(r.engaged),
      leads: num(r.leads),
      add_to_cart: num(r.add_to_cart),
      checkouts: num(r.checkouts),
    }));
    const index = buildLayoutPathIndex(opts.records, opts.urlsFor);
    const pages = computeLayoutPerformance(rows, index, { windowDays: PERFORMANCE_WINDOW_DAYS });
    const file: PagePerformanceFile = {
      generated_at: new Date().toISOString(),
      window_days: PERFORMANCE_WINDOW_DAYS,
      pages,
    };
    const p = filePath(opts.contentFolder);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(file, null, 2));
    log.info({ pages: Object.keys(pages).length, rows: rows.length }, "[page-performance] refreshed");
    return { ok: true, pages: Object.keys(pages).length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, "[page-performance] query failed");
    return { ok: false, error: message };
  }
}

export function pagePerformanceIsStale(contentFolder: string, now = Date.now()): boolean {
  const f = readPagePerformanceFile(contentFolder);
  return !f || now - Date.parse(f.generated_at) > REFRESH_AFTER_MS;
}
