/**
 * GA4 BigQuery flow for one page (or one entry's locale URLs): a single scan over the current
 * and prior window. Sessions that viewed the page are expanded into their page-view sequence
 * so we know the previous page, the next page, whether a decision page or a lead came later,
 * plus engagement, channel, device, CTA clicks and scroll depth. Every aggregate comes back as
 * rows tagged with `kind` from one UNION ALL query.
 */

import { fqEventsWildcard, getBigQueryClient, getBigQueryConfigStatus, getBigQuerySettings } from "../../ecommerce/bigquery-client";
import { JOURNEY_ECOMMERCE_INTENT_EVENTS, normalizeAnalyticsPath } from "../../ecommerce/journey-analytics";
import { getLeadConversionEventNames } from "../../settings";
import { bqNormalizedPagePathSql } from "../reports";
import { bqChannelCaseSql } from "../page-performance";
import { stageOfPath, type PathStageIndex } from "./resolve";
import { stageRank } from "@shared/page-objectives";
import type { FunnelStage } from "@shared/funnel";
import type {
  CampaignTrafficRow,
  ChannelRow,
  CtaRow,
  NextRelation,
  PathRow,
  Section,
  TrafficFacts,
  TrafficTotals,
} from "@shared/page-stats";
import { child } from "../../logger";

const log = child({ module: "page-stats/ga4-flow" });

const MAX_BYTES_BILLED = "20000000000";
const NONE = "__none__";

const METRIC_SQL = {
  sessions: "COUNT(*)",
  page_views: "SUM(page_views)",
  entrances: "COUNTIF(entrance)",
  engaged_sessions: "COUNTIF(IFNULL(engaged, FALSE))",
  bounces: "COUNTIF(bounce)",
  exits: "COUNTIF(is_exit)",
  returning_sessions: "COUNTIF(IFNULL(session_number, 1) > 1)",
  moved_forward: "COUNTIF(moved_forward)",
  moved_back: "COUNTIF(moved_back)",
  reached_decision: "COUNTIF(reached_decision)",
  lead_later: "COUNTIF(lead_later)",
  form_or_cta: "COUNTIF(cta_clicks > 0 OR form_starts > 0 OR lead_later)",
  cta_sessions: "COUNTIF(cta_clicks > 0)",
  task_clicks: "COUNTIF(task_clicks > 0)",
  lost: "COUNTIF(lost)",
  form_starts: "SUM(form_starts)",
  video_starts: "SUM(video_starts)",
  video_completes: "SUM(video_completes)",
  intent_events: "SUM(intent_events)",
  median_engaged_seconds: "APPROX_QUANTILES(IF(page_seconds > 0, page_seconds, NULL), 2)[OFFSET(1)]",
  median_session_seconds: "APPROX_QUANTILES(duration_s, 2)[OFFSET(1)]",
  clicks: "CAST(NULL AS FLOAT64)",
} as const;

type MetricKey = keyof typeof METRIC_SQL;
const METRIC_KEYS = Object.keys(METRIC_SQL) as MetricKey[];
const LABEL_COLS = ["a", "b", "c", "d"] as const;

function select(opts: {
  kind: string;
  period: string;
  labels?: Partial<Record<(typeof LABEL_COLS)[number], string>>;
  metrics: Partial<Record<MetricKey, string>> | "all";
  from: string;
  where?: string;
  groupBy?: string;
  orderLimit?: string;
}): string {
  const labels = LABEL_COLS.map((c) => `CAST(${opts.labels?.[c] ?? "NULL"} AS STRING) AS ${c}`).join(", ");
  const metrics = METRIC_KEYS.map((k) => {
    const expr = opts.metrics === "all" ? (k === "clicks" ? null : METRIC_SQL[k]) : opts.metrics[k];
    return `CAST(${expr ?? "NULL"} AS FLOAT64) AS ${k}`;
  }).join(", ");
  return `(SELECT '${opts.kind}' AS kind, ${opts.period} AS period, ${labels}, ${metrics}
    FROM ${opts.from}${opts.where ? ` WHERE ${opts.where}` : ""}${opts.groupBy ? ` GROUP BY ${opts.groupBy}` : ""}${opts.orderLimit ? ` ${opts.orderLimit}` : ""})`;
}

function strParam(key: string): string {
  return `(SELECT COALESCE(value.string_value, CAST(value.int_value AS STRING), CAST(value.double_value AS STRING)) FROM UNNEST(event_params) WHERE key = '${key}' LIMIT 1)`;
}

function intParam(key: string): string {
  return `(SELECT COALESCE(value.int_value, CAST(value.double_value AS INT64), SAFE_CAST(value.string_value AS INT64)) FROM UNNEST(event_params) WHERE key = '${key}' LIMIT 1)`;
}

export function buildPageFlowSql(eventsTable: string): string {
  const pathExpr = bqNormalizedPagePathSql();
  const channel = bqChannelCaseSql("IFNULL(first_loc, '')", "IFNULL(first_medium, '')", "IFNULL(first_source, '')");
  const cur = "period = 'current'";
  return `
    WITH ev AS (
      SELECT
        CONCAT(user_pseudo_id, '-', CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING)) AS sid,
        event_date,
        event_timestamp,
        event_name,
        IF(${pathExpr} = '', '/', ${pathExpr}) AS path,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_location') AS loc,
        (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_referrer') AS referrer,
        (SELECT COALESCE(value.string_value, CAST(value.int_value AS STRING)) FROM UNNEST(event_params) WHERE key = 'session_engaged') AS engaged_flag,
        (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_number') AS session_number,
        LOWER(COALESCE(NULLIF(collected_traffic_source.manual_medium, ''), '')) AS medium,
        LOWER(COALESCE(NULLIF(collected_traffic_source.manual_source, ''), '')) AS source,
        NULLIF(collected_traffic_source.manual_campaign_name, '') AS campaign,
        device.category AS device,
        geo.country AS country,
        ${strParam("section_type")} AS section_type,
        ${intParam("section_index")} AS section_index,
        ${strParam("label")} AS label,
        ${strParam("destination")} AS destination,
        ${intParam("depth")} AS depth
      FROM ${eventsTable}
      WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE(@start)) AND FORMAT_DATE('%Y%m%d', DATE(@end))
    ),
    hit_sessions AS (
      SELECT sid FROM ev
      WHERE event_name = 'page_view' AND sid IS NOT NULL
      GROUP BY sid
      HAVING LOGICAL_OR(path IN UNNEST(@paths)) AND NOT LOGICAL_OR(STARTS_WITH(path, '/private'))
    ),
    sev AS (SELECT ev.* FROM ev JOIN hit_sessions USING (sid)),
    sess AS (
      SELECT
        sid,
        MIN(event_date) AS day,
        ARRAY_AGG(IF(event_name = 'page_view', STRUCT(event_timestamp AS ts, path, referrer, loc, medium, source, campaign), NULL) IGNORE NULLS ORDER BY event_timestamp) AS views,
        ARRAY_AGG(IF(event_name IN UNNEST(@lead_events), event_timestamp, NULL) IGNORE NULLS) AS lead_ts,
        LOGICAL_OR(engaged_flag = '1') AS engaged,
        MIN(session_number) AS session_number,
        ANY_VALUE(device) AS device,
        ANY_VALUE(country) AS country,
        (MAX(event_timestamp) - MIN(event_timestamp)) / 1000000 AS duration_s,
        MAX(IF(path IN UNNEST(@paths), event_timestamp, NULL)) AS page_last_ts,
        COUNTIF(event_name = 'page_view' AND path IN UNNEST(@paths)) AS page_views,
        COUNTIF(event_name = 'cta_click' AND path IN UNNEST(@paths)) AS cta_clicks,
        COUNTIF(event_name = 'cta_click' AND path IN UNNEST(@paths) AND IFNULL(destination, '') != ''
          AND NOT STARTS_WITH(destination, '/') AND NOT STARTS_WITH(destination, '#')) AS task_clicks,
        COUNTIF(event_name = 'form_start' AND path IN UNNEST(@paths)) AS form_starts,
        COUNTIF(event_name = 'video_start' AND path IN UNNEST(@paths)) AS video_starts,
        COUNTIF(event_name = 'video_complete' AND path IN UNNEST(@paths)) AS video_completes,
        COUNTIF(event_name IN UNNEST(@intent_events) AND path IN UNNEST(@paths)) AS intent_events
      FROM sev
      GROUP BY sid
    ),
    hit AS (
      SELECT s.*, (SELECT MIN(o) FROM UNNEST(s.views) v WITH OFFSET o WHERE v.path IN UNNEST(@paths)) AS hit_o
      FROM sess s
    ),
    flow AS (
      SELECT
        h.* EXCEPT (views, lead_ts),
        IF(h.day >= @cur_start_s, 'current', 'prior') AS period,
        ARRAY_LENGTH(h.views) AS view_count,
        h.hit_o = 0 AS entrance,
        IF(h.hit_o > 0, h.views[OFFSET(h.hit_o - 1)].path, NULL) AS prev_path,
        NET.HOST(h.views[OFFSET(h.hit_o)].referrer) AS ref_host,
        NET.HOST(h.views[OFFSET(h.hit_o)].loc) AS page_host,
        (SELECT v.path FROM UNNEST(h.views) v WITH OFFSET o WHERE o > h.hit_o AND v.path NOT IN UNNEST(@paths) ORDER BY o LIMIT 1) AS next_path,
        EXISTS (SELECT 1 FROM UNNEST(h.views) v WITH OFFSET o WHERE o > h.hit_o AND v.path IN UNNEST(@decision_paths)) AS reached_decision,
        EXISTS (SELECT 1 FROM UNNEST(h.lead_ts) t WHERE t >= h.views[OFFSET(h.hit_o)].ts) AS lead_later,
        -- Time on page: until the next page view, or the last event on the page for exits; capped at 30 min.
        LEAST(1800, (COALESCE(
          IF(h.hit_o + 1 < ARRAY_LENGTH(h.views), h.views[OFFSET(h.hit_o + 1)].ts, NULL),
          h.page_last_ts
        ) - h.views[OFFSET(h.hit_o)].ts) / 1000000) AS page_seconds,
        h.views[OFFSET(0)].loc AS first_loc,
        h.views[OFFSET(0)].medium AS first_medium,
        h.views[OFFSET(0)].source AS first_source,
        h.views[OFFSET(0)].campaign AS first_campaign
      FROM hit h
      WHERE h.hit_o IS NOT NULL
    ),
    ranked AS (
      SELECT f.*,
        ${channel} AS channel,
        CASE
          WHEN next_path IS NULL THEN -1
          WHEN next_path IN UNNEST(@post_paths) THEN 4
          WHEN next_path IN UNNEST(@decision_paths) THEN 3
          WHEN next_path IN UNNEST(@consideration_paths) THEN 2
          WHEN next_path IN UNNEST(@awareness_paths) THEN 1
          ELSE 0
        END AS next_rank
      FROM flow f
    ),
    s AS (
      SELECT r.*,
        (next_rank > 0 AND next_rank > @stage_rank AND (@stage_rank > 0 OR next_rank >= 2)) AS moved_forward,
        (next_rank > 0 AND @stage_rank > 0 AND next_rank < @stage_rank) AS moved_back,
        (entrance AND view_count = 1 AND NOT IFNULL(engaged, FALSE)) AS bounce,
        (next_path IS NULL) AS is_exit,
        ((next_path IS NULL AND NOT IFNULL(engaged, FALSE))
          OR REGEXP_CONTAINS(IFNULL(next_path, ''), r'contact|support|help|soporte|contacto|ayuda')) AS lost
      FROM ranked r
    ),
    page_ev AS (
      SELECT ev.*, IF(event_date >= @cur_start_s, 'current', 'prior') AS period
      FROM ev
      WHERE event_name IN ('cta_click', 'scroll_depth') AND path IN UNNEST(@paths)
    ),
    -- Same-stage pages in the current window, for benchmark medians (same scan, no extra bytes).
    peer_views AS (
      SELECT
        sid,
        path,
        event_timestamp AS ts,
        LEAD(path) OVER (PARTITION BY sid ORDER BY event_timestamp) AS next_path,
        MAX(IF(path IN UNNEST(@decision_paths), event_timestamp, NULL)) OVER (PARTITION BY sid) AS last_decision_ts
      FROM ev
      WHERE event_name = 'page_view' AND sid IS NOT NULL AND event_date >= @cur_start_s AND NOT STARTS_WITH(path, '/private')
    ),
    peer_engaged AS (
      SELECT sid, LOGICAL_OR(engaged_flag = '1') AS engaged FROM ev
      WHERE sid IS NOT NULL AND event_date >= @cur_start_s GROUP BY sid
    ),
    peer_tasks AS (
      SELECT path, COUNT(DISTINCT sid) AS sessions FROM ev
      WHERE event_name = 'cta_click' AND event_date >= @cur_start_s AND path IN UNNEST(@peer_paths)
        AND IFNULL(destination, '') != '' AND NOT STARTS_WITH(destination, '/') AND NOT STARTS_WITH(destination, '#')
      GROUP BY path
    ),
    peer AS (
      SELECT
        v.path,
        COUNT(DISTINCT v.sid) AS sessions,
        COUNT(DISTINCT IF(e.engaged, v.sid, NULL)) AS engaged,
        COUNT(DISTINCT IF(
          CASE
            WHEN v.next_path IN UNNEST(@post_paths) THEN 4
            WHEN v.next_path IN UNNEST(@decision_paths) THEN 3
            WHEN v.next_path IN UNNEST(@consideration_paths) THEN 2
            WHEN v.next_path IN UNNEST(@awareness_paths) THEN 1
            ELSE 0
          END > @stage_rank, v.sid, NULL)) AS moved_forward,
        COUNT(DISTINCT IF(v.last_decision_ts > v.ts, v.sid, NULL)) AS reached_decision
      FROM peer_views v
      LEFT JOIN peer_engaged e USING (sid)
      WHERE v.path IN UNNEST(@peer_paths)
      GROUP BY v.path
    ),
    peer_out AS (
      SELECT p.*, IFNULL(t.sessions, 0) AS task_sessions FROM peer p LEFT JOIN peer_tasks t USING (path)
    )
    ${[
      select({ kind: "totals", period: "period", metrics: "all", from: "s", groupBy: "period" }),
      select({ kind: "day", period: "period", labels: { a: "day" }, metrics: { sessions: METRIC_SQL.sessions }, from: "s", groupBy: "period, day" }),
      select({
        kind: "prev", period: "'current'", labels: { a: "IFNULL(prev_path, '(entrance)')" },
        metrics: { sessions: METRIC_SQL.sessions }, from: "s", where: cur, groupBy: "1, 2, 3", orderLimit: "ORDER BY sessions DESC LIMIT 25",
      }),
      select({
        kind: "next", period: "'current'", labels: { a: "IFNULL(next_path, '(exit)')" },
        metrics: { sessions: METRIC_SQL.sessions }, from: "s", where: cur, groupBy: "1, 2, 3", orderLimit: "ORDER BY sessions DESC LIMIT 30",
      }),
      select({
        kind: "ref", period: "'current'", labels: { a: "REGEXP_REPLACE(ref_host, r'^www\\.', '')" },
        metrics: { sessions: METRIC_SQL.sessions }, from: "s",
        where: `${cur} AND entrance AND ref_host IS NOT NULL AND REGEXP_REPLACE(ref_host, r'^www\\.', '') != REGEXP_REPLACE(IFNULL(page_host, ''), r'^www\\.', '')`,
        groupBy: "1, 2, 3", orderLimit: "ORDER BY sessions DESC LIMIT 20",
      }),
      select({
        kind: "channel", period: "period", labels: { a: "channel" },
        metrics: {
          sessions: METRIC_SQL.sessions, engaged_sessions: METRIC_SQL.engaged_sessions, moved_forward: METRIC_SQL.moved_forward,
          reached_decision: METRIC_SQL.reached_decision, lead_later: METRIC_SQL.lead_later, bounces: METRIC_SQL.bounces,
          task_clicks: METRIC_SQL.task_clicks,
        },
        from: "s", groupBy: "period, channel",
      }),
      select({
        kind: "campaign", period: "'current'",
        labels: { a: "IFNULL(first_source, '')", b: "IFNULL(first_medium, '')", c: "IFNULL(first_campaign, '')" },
        metrics: {
          sessions: METRIC_SQL.sessions, engaged_sessions: METRIC_SQL.engaged_sessions, moved_forward: METRIC_SQL.moved_forward,
          reached_decision: METRIC_SQL.reached_decision, lead_later: METRIC_SQL.lead_later,
        },
        from: "s", where: `${cur} AND (channel = 'paid' OR first_campaign IS NOT NULL)`,
        groupBy: "1, 2, 3, 4, 5", orderLimit: "ORDER BY sessions DESC LIMIT 25",
      }),
      select({
        kind: "device", period: "'current'", labels: { a: "IFNULL(device, '(unknown)')" },
        metrics: { sessions: METRIC_SQL.sessions }, from: "s", where: cur, groupBy: "1, 2, 3",
      }),
      select({
        kind: "country", period: "'current'", labels: { a: "IFNULL(country, '(unknown)')" },
        metrics: { sessions: METRIC_SQL.sessions }, from: "s", where: cur, groupBy: "1, 2, 3", orderLimit: "ORDER BY sessions DESC LIMIT 12",
      }),
      select({
        kind: "cta", period: "'current'",
        labels: { a: "IFNULL(section_type, '')", b: "section_index", c: "IFNULL(label, '')", d: "IFNULL(destination, '')" },
        metrics: { clicks: "COUNT(*)", sessions: "COUNT(DISTINCT sid)" },
        from: "page_ev", where: `event_name = 'cta_click' AND ${cur}`,
        groupBy: "1, 2, 3, 4, 5, 6", orderLimit: "ORDER BY clicks DESC LIMIT 30",
      }),
      select({
        kind: "scroll", period: "'current'", labels: { a: "depth" },
        metrics: { sessions: "COUNT(DISTINCT sid)" }, from: "page_ev", where: `event_name = 'scroll_depth' AND ${cur}`, groupBy: "1, 2, 3",
      }),
      select({
        kind: "since", period: "'current'", labels: { a: "event_name", b: "MIN(event_date)" },
        metrics: {}, from: "ev", where: "event_name IN ('cta_click', 'scroll_depth')", groupBy: "event_name",
      }),
      select({
        kind: "peer", period: "'current'", labels: { a: "path" },
        metrics: {
          sessions: "sessions", engaged_sessions: "engaged", moved_forward: "moved_forward",
          reached_decision: "reached_decision", task_clicks: "task_sessions",
        },
        from: "peer_out",
      }),
    ].join("\n    UNION ALL\n    ")}
  `;
}

export type FlowRow = { kind: string; period: string | null; a: string | null; b: string | null; c: string | null; d: string | null } & Partial<
  Record<MetricKey, number | null>
>;

export type FlowWindow = { start: string; end: string; cur_start: string };

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  if (v && typeof v === "object" && "value" in (v as object)) return num((v as { value: unknown }).value);
  return 0;
}

function optNum(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v);
}

function emptyTotals(): TrafficTotals {
  return {
    sessions: 0, page_views: 0, entrances: 0, engaged_sessions: 0, bounces: 0, exits: 0, returning_sessions: 0,
    moved_forward: 0, moved_back: 0, reached_decision: 0, lead_later: 0, form_or_cta: 0, cta_sessions: 0,
    task_clicks: 0, lost: 0, form_starts: 0, video_starts: 0, video_completes: 0, intent_events: 0,
    median_engaged_seconds: null, median_session_seconds: null,
  };
}

function totalsFrom(r: FlowRow | undefined): TrafficTotals {
  const t = emptyTotals();
  if (!r) return t;
  for (const k of Object.keys(t) as (keyof TrafficTotals)[]) {
    if (k === "median_engaged_seconds" || k === "median_session_seconds") {
      const v = optNum(r[k]);
      t[k] = v === null ? null : Math.round(v * 10) / 10;
    } else {
      t[k] = num(r[k]);
    }
  }
  return t;
}

function ymd(d: string): string {
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function relationTo(currentStage: FunnelStage | null, next: FunnelStage | null): NextRelation {
  const a = stageRank(currentStage);
  const b = stageRank(next);
  if (!b) return "unknown";
  if (!a) return b >= 2 ? "forward" : "same";
  return b > a ? "forward" : b < a ? "back" : "same";
}

/** Raw UNION ALL rows → TrafficFacts (pure; exported for tests). */
export function parsePageFlowRows(
  rows: FlowRow[],
  ctx: { stage: FunnelStage | null; index: PathStageIndex | null; window: FlowWindow },
): TrafficFacts {
  const byKind = (kind: string, period?: string) =>
    rows.filter((r) => r.kind === kind && (period === undefined || r.period === period));
  const classify = (path: string, sentinel: string): PathRow => {
    if (path === sentinel) {
      return { path, sessions: 0, stage: null, relation: sentinel === "(exit)" ? "exit" : "unknown" };
    }
    const stage = ctx.index ? stageOfPath(ctx.index, path) : null;
    return { path, sessions: 0, stage, relation: relationTo(ctx.stage, stage) };
  };

  const dayCounts = new Map<string, number>();
  for (const r of byKind("day")) dayCounts.set(`${r.period}|${ymd(r.a ?? "")}`, num(r.sessions));
  const days = Math.round((Date.parse(`${ctx.window.end}T00:00:00Z`) - Date.parse(`${ctx.window.cur_start}T00:00:00Z`)) / 86_400_000) + 1;
  const series: TrafficFacts["series"] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(ctx.window.cur_start, i);
    const priorDay = addDays(day, -days);
    series.push({
      day,
      sessions: dayCounts.get(`current|${day}`) ?? 0,
      prior_sessions: dayCounts.get(`prior|${priorDay}`) ?? 0,
    });
  }

  const priorChannels = new Map(byKind("channel", "prior").map((r) => [r.a ?? "other", num(r.sessions)]));
  const channels: ChannelRow[] = byKind("channel", "current")
    .map((r) => ({
      channel: r.a ?? "other",
      sessions: num(r.sessions),
      engaged: num(r.engaged_sessions),
      moved_forward: num(r.moved_forward),
      reached_decision: num(r.reached_decision),
      lead_later: num(r.lead_later),
      bounces: num(r.bounces),
      prior_sessions: priorChannels.get(r.a ?? "other") ?? 0,
      benchmark_rate: null,
    }))
    .sort((x, y) => y.sessions - x.sessions);

  const campaigns: CampaignTrafficRow[] = byKind("campaign").map((r) => ({
    source: r.a ?? "",
    medium: r.b ?? "",
    campaign: r.c ?? "",
    sessions: num(r.sessions),
    engaged: num(r.engaged_sessions),
    moved_forward: num(r.moved_forward),
    reached_decision: num(r.reached_decision),
    lead_later: num(r.lead_later),
  }));

  const cta: CtaRow[] = byKind("cta").map((r) => {
    const idx = r.b !== null && r.b !== undefined && r.b !== "" ? Number(r.b) : NaN;
    return {
      section_type: r.a ?? "",
      section_index: Number.isFinite(idx) ? idx : null,
      label: r.c ?? "",
      destination: r.d ?? "",
      clicks: num(r.clicks),
      sessions: num(r.sessions),
    };
  });

  const since = new Map(byKind("since").map((r) => [r.a ?? "", r.b ? ymd(r.b) : null]));

  return {
    current: totalsFrom(byKind("totals", "current")[0]),
    prior: totalsFrom(byKind("totals", "prior")[0]),
    series,
    previous_pages: byKind("prev").map((r) => ({ ...classify(r.a ?? "", "(entrance)"), sessions: num(r.sessions) })),
    next_pages: byKind("next").map((r) => ({ ...classify(r.a ?? "", "(exit)"), sessions: num(r.sessions) })),
    referrers: byKind("ref").map((r) => ({ host: r.a ?? "", sessions: num(r.sessions) })),
    channels,
    campaigns,
    devices: byKind("device").map((r) => ({ device: r.a ?? "", sessions: num(r.sessions) })).sort((x, y) => y.sessions - x.sessions),
    countries: byKind("country").map((r) => ({ country: r.a ?? "", sessions: num(r.sessions) })),
    cta,
    scroll: byKind("scroll")
      .map((r) => ({ depth: Number(r.a), sessions: num(r.sessions) }))
      .filter((r) => Number.isFinite(r.depth))
      .sort((x, y) => x.depth - y.depth),
    tracking_since: { cta_click: since.get("cta_click") ?? null, scroll_depth: since.get("scroll_depth") ?? null },
    prior_channels: byKind("channel", "prior").map((r) => ({
      channel: r.a ?? "other",
      sessions: num(r.sessions),
      engaged: num(r.engaged_sessions),
      moved_forward: num(r.moved_forward),
      reached_decision: num(r.reached_decision),
      lead_later: num(r.lead_later),
      bounces: num(r.bounces),
      prior_sessions: 0,
      benchmark_rate: null,
    })),
    peers: byKind("peer").map((r) => ({
      path: r.a ?? "",
      sessions: num(r.sessions),
      engaged: num(r.engaged_sessions),
      moved_forward: num(r.moved_forward),
      reached_decision: num(r.reached_decision),
      task_sessions: num(r.task_clicks),
    })),
  };
}

function compact(d: string): string {
  return d.replace(/-/g, "");
}

export async function queryPageFlow(opts: {
  paths: string[];
  stage: FunnelStage | null;
  index: PathStageIndex | null;
  window: FlowWindow;
  contentRoot?: string;
}): Promise<Section<TrafficFacts>> {
  const status = getBigQueryConfigStatus(opts.contentRoot);
  if (!status.configured) {
    return { status: "not_configured", as_of: null, message: "GA4 BigQuery export is not connected (Settings → Tracking → BigQuery).", data: null };
  }
  const client = getBigQueryClient(opts.contentRoot);
  if (!client) return { status: "not_configured", as_of: null, message: "BigQuery client unavailable.", data: null };
  const settings = getBigQuerySettings(opts.contentRoot);
  const leadEvents = getLeadConversionEventNames(opts.contentRoot);
  const list = (xs: string[] | undefined) => (xs && xs.length > 0 ? xs : [NONE]);
  const paths = Array.from(new Set(opts.paths.map(normalizeAnalyticsPath).filter(Boolean)));
  const byStage = opts.index?.pathsByStage;
  try {
    const [raw] = await client.query({
      query: buildPageFlowSql(fqEventsWildcard(settings)),
      params: {
        start: opts.window.start,
        end: opts.window.end,
        cur_start_s: compact(opts.window.cur_start),
        paths: list(paths),
        decision_paths: list(byStage?.decision),
        consideration_paths: list(byStage?.consideration),
        awareness_paths: list(byStage?.awareness),
        post_paths: list(byStage?.["post-enrollment"]),
        stage_rank: stageRank(opts.stage),
        peer_paths: list(opts.stage ? byStage?.[opts.stage] : undefined),
        lead_events: list(leadEvents),
        intent_events: list([...JOURNEY_ECOMMERCE_INTENT_EVENTS]),
      },
      location: settings.location || undefined,
      maximumBytesBilled: MAX_BYTES_BILLED,
    });
    const rows = ((raw || []) as Record<string, unknown>[]).map((r) => r as FlowRow);
    const data = parsePageFlowRows(rows, { stage: opts.stage, index: opts.index, window: opts.window });
    return {
      status: data.current.sessions < 1 && data.prior.sessions < 1 ? "insufficient_data" : "ok",
      as_of: opts.window.end,
      ...(data.current.sessions < 1 ? { message: "No GA4 sessions viewed this page in the period." } : {}),
      data,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err, paths }, "[page-stats] GA4 flow query failed");
    return { status: "error", as_of: null, message, data: null };
  }
}
