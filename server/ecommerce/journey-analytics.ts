/**
 * Product journey Page Performance analytics from GA4 BigQuery export.
 * No durable cache — short in-memory TTL only.
 */

import {
  fqEventsWildcard,
  getBigQueryClient,
  getBigQueryConfigStatus,
  getBigQuerySettings,
} from "./bigquery-client";
import {
  buildProductFunnelJourney,
  type JourneyPageRow,
  type ProductFunnelJourney,
} from "./funnel-journey";
import { ecommerceManager } from "./ecommerce-manager";
import { FUNNEL_STAGES, type FunnelStage } from "@shared/funnel";
import { readFunnelBlockFromFile, commonYmlPath } from "../funnel-fields";
import { child } from "../logger";

const log = child({ module: "journey-analytics" });

const TTL_MS = 10 * 60 * 1000;
const DEFAULT_DAYS = 28;

const LEAD_CONVERSION_EVENTS = ["student_application", "request_more_info"] as const;
const ECOMMERCE_INTENT_EVENTS = [
  "view_item",
  "add_to_cart",
  "view_item_list",
  "select_item",
  "click_begin_checkout",
] as const;

/** Events counted for per-page + product lead conversions (keep UI popovers in sync). */
export const JOURNEY_LEAD_CONVERSION_EVENTS = LEAD_CONVERSION_EVENTS;
/** Events counted for per-page + product ecommerce intent (keep UI popovers in sync). */
export const JOURNEY_ECOMMERCE_INTENT_EVENTS = ECOMMERCE_INTENT_EVENTS;

export type PagePathMetrics = {
  sessions: number;
  views: number;
  /** Path-scoped lead conversions for this product (same event set on every stage). */
  conversions: number;
  /** Path-scoped ecommerce intent for this product (same event set on every stage). */
  ecommerce_intent: number;
};

export type JourneyAnalyticsWarning = {
  code: string;
  message: string;
};

export type JourneyPagePerformance = {
  mode: "page_performance";
  status: "ok" | "unavailable" | "not_implemented";
  window_days: number;
  as_of: string;
  warnings: JourneyAnalyticsWarning[];
  /** Per content entry key content_type/slug */
  pages: Record<
    string,
    PagePathMetrics & {
      shared: boolean;
      paths: string[];
    }
  >;
  stages: Record<
    string,
    {
      sessions_distinct: number;
      page_count: number;
    }
  >;
  summary: {
    sessions_product_specific: number;
    sessions_shared: number;
  };
  product: {
    conversions: number;
    ecommerce_intent: number;
    item_id?: string;
    content_slug: string;
  };
};

type CacheEntry = { expires: number; payload: JourneyAnalyticsResult };
const cache = new Map<string, CacheEntry>();

export type JourneyAnalyticsResult =
  | JourneyPagePerformance
  | {
      mode: "stage_flow";
      status: "not_implemented";
      warnings: JourneyAnalyticsWarning[];
      message: string;
    };

/**
 * Normalize a URL or path to a pathname without trailing slash (except root).
 * Does not rewrite locale prefixes — those come from content-type `url_pattern`s
 * via `contentIndex.getAlternateUrls` → `collectPaths`.
 */
export function normalizeAnalyticsPath(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return "";
  try {
    if (/^https?:\/\//i.test(s)) {
      s = new URL(s).pathname;
    }
  } catch {
    // keep raw
  }
  const q = s.indexOf("?");
  if (q >= 0) s = s.slice(0, q);
  const h = s.indexOf("#");
  if (h >= 0) s = s.slice(0, h);
  if (!s.startsWith("/")) s = `/${s}`;
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/**
 * BigQuery expression: event_params → pathname (no origin), trailing slash stripped.
 * Prefer GA4 `page_path` when present; otherwise extract path from `page_location`.
 * Locale segments are left as-is so they match content-type URL patterns.
 */
function bqNormalizedPagePathSql(): string {
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

function collectPaths(row: JourneyPageRow): string[] {
  const out = new Set<string>();
  for (const u of Object.values(row.urls || {})) {
    const p = normalizeAnalyticsPath(u);
    if (p) out.add(p);
  }
  return Array.from(out);
}

function entryKey(row: JourneyPageRow): string {
  return `${row.content_type}/${row.slug}`;
}

function isSharedMembership(
  contentType: string,
  slug: string,
  productSlug: string,
  contentRoot?: string,
): boolean {
  if (contentType === "program" && slug === productSlug) return false;
  const funnel = readFunnelBlockFromFile(commonYmlPath(contentType, slug, contentRoot));
  return funnel.products === "all";
}

function windowBounds(days: number): { start: string; end: string; asOf: string } {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  // Complete days ending yesterday
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end), asOf: fmt(end) };
}

function emptyPagePerformance(
  productSlug: string,
  days: number,
  warnings: JourneyAnalyticsWarning[],
  status: "ok" | "unavailable" = "unavailable",
): JourneyPagePerformance {
  const { asOf } = windowBounds(days);
  return {
    mode: "page_performance",
    status,
    window_days: days,
    as_of: asOf,
    warnings,
    pages: {},
    stages: Object.fromEntries(FUNNEL_STAGES.map((s) => [s, { sessions_distinct: 0, page_count: 0 }])),
    summary: { sessions_product_specific: 0, sessions_shared: 0 },
    product: { conversions: 0, ecommerce_intent: 0, content_slug: productSlug },
  };
}

export async function getProductJourneyAnalytics(opts: {
  productSlug: string;
  productContentType?: string;
  mode?: "page_performance" | "stage_flow";
  days?: number;
  contentRoot?: string;
}): Promise<JourneyAnalyticsResult> {
  const mode = opts.mode ?? "page_performance";
  const days = Math.min(90, Math.max(1, opts.days ?? DEFAULT_DAYS));
  const productSlug = opts.productSlug;
  const contentType = opts.productContentType || "program";

  if (mode === "stage_flow") {
    return {
      mode: "stage_flow",
      status: "not_implemented",
      warnings: [
        {
          code: "stage_flow_not_implemented",
          message:
            "Stage flow (previous-stage path filtering) is not implemented yet. Use mode=page_performance.",
        },
      ],
      message:
        "Coming soon — will show only sessions that moved between stages in this journey.",
    };
  }

  const cacheKey = `${opts.contentRoot || ""}|${productSlug}|${days}|page_performance`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.payload;

  const bqStatus = getBigQueryConfigStatus(opts.contentRoot);
  if (!bqStatus.configured) {
    const payload = emptyPagePerformance(productSlug, days, [
      ...bqStatus.warnings.map((m) => ({
        code: "bigquery_not_configured",
        message: m,
      })),
      {
        code: "configure_at",
        message: "Configure project/dataset at /private/tracking/ga4",
      },
    ]);
    return payload;
  }

  const client = getBigQueryClient(opts.contentRoot);
  if (!client) {
    return emptyPagePerformance(productSlug, days, [
      {
        code: "bigquery_client_unavailable",
        message: "Could not create BigQuery client — check GCS_CREDENTIALS_JSON / ADC",
      },
    ]);
  }

  const journey = buildProductFunnelJourney(productSlug, contentType, opts.contentRoot);
  const settings = getBigQuerySettings(opts.contentRoot);
  const { start, end, asOf } = windowBounds(days);
  const eventsTable = fqEventsWildcard(settings);

  const pageMeta: Array<{
    key: string;
    stage: string;
    shared: boolean;
    paths: string[];
  }> = [];

  const exclusivePaths = new Set<string>();
  const sharedPaths = new Set<string>();

  const pushRow = (row: JourneyPageRow, stage: string) => {
    const paths = collectPaths(row);
    const shared = isSharedMembership(row.content_type, row.slug, productSlug, opts.contentRoot);
    const key = entryKey(row);
    pageMeta.push({ key, stage, shared, paths });
    for (const p of paths) {
      if (shared) sharedPaths.add(p);
      else exclusivePaths.add(p);
    }
  };

  pushRow(journey.locked, "decision");
  for (const stage of FUNNEL_STAGES) {
    for (const row of journey.stages[stage] || []) {
      pushRow(row, stage);
    }
  }

  const allPaths = Array.from(new Set(pageMeta.flatMap((p) => p.paths)));
  const product =
    ecommerceManager.findProductByCmsEntry(contentType, productSlug) ||
    ecommerceManager.getAllProducts().find((x) => x.content_slug === productSlug);
  const itemId = product?.product_id;
  const identityValues = [productSlug, itemId].filter(Boolean) as string[];

  const warnings: JourneyAnalyticsWarning[] = [];

  try {
    const pagePathExpr = bqNormalizedPagePathSql();

    const pathMetricsSql = `
      WITH params AS (
        SELECT @start_date AS start_date, @end_date AS end_date
      ),
      base AS (
        SELECT
          user_pseudo_id,
          (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
          event_name,
          ${pagePathExpr} AS page_path,
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'item_id') AS item_id,
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'program_id') AS program_id,
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'program') AS program
        FROM ${eventsTable}, params
        WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE(params.start_date))
          AND FORMAT_DATE('%Y%m%d', DATE(params.end_date))
          AND event_name IN UNNEST(@traffic_and_action_events)
      ),
      cleaned AS (
        SELECT
          user_pseudo_id,
          ga_session_id,
          event_name,
          item_id,
          program_id,
          program,
          CASE WHEN page_path = '' THEN '/' ELSE page_path END AS page_path
        FROM base
        WHERE page_path IS NOT NULL AND page_path != ''
          AND page_path IN UNNEST(@paths)
      ),
      with_product AS (
        SELECT
          *,
          (
            @has_product_ids
            AND (
              item_id IN UNNEST(@ids)
              OR program_id IN UNNEST(@ids)
              OR program IN UNNEST(@ids)
            )
          ) AS matches_product
        FROM cleaned
      )
      SELECT
        page_path,
        COUNTIF(event_name = 'page_view') AS views,
        COUNT(DISTINCT IF(event_name = 'page_view', CONCAT(user_pseudo_id, '-', CAST(ga_session_id AS STRING)), NULL)) AS sessions,
        COUNTIF(event_name IN UNNEST(@lead_events) AND matches_product) AS conversions,
        COUNTIF(event_name IN UNNEST(@ecommerce_events) AND matches_product) AS ecommerce_intent
      FROM with_product
      GROUP BY page_path
    `;

    const stageSessionsSql = `
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
        WHERE page_path IN UNNEST(@paths)
      )
      SELECT COUNT(DISTINCT CONCAT(user_pseudo_id, '-', CAST(ga_session_id AS STRING))) AS sessions
      FROM cleaned
    `;

    const productEventsSql = `
      WITH params AS (
        SELECT @start_date AS start_date, @end_date AS end_date
      ),
      base AS (
        SELECT
          event_name,
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'item_id') AS item_id,
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'program_id') AS program_id,
          (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'program') AS program
        FROM ${eventsTable}, params
        WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE(params.start_date))
          AND FORMAT_DATE('%Y%m%d', DATE(params.end_date))
          AND event_name IN UNNEST(@event_names)
      )
      SELECT
        event_name,
        COUNT(*) AS event_count
      FROM base
      WHERE item_id IN UNNEST(@ids)
         OR program_id IN UNNEST(@ids)
         OR program IN UNNEST(@ids)
      GROUP BY event_name
    `;

    const location = settings.location || undefined;
    const trafficAndActionEvents = [
      "page_view",
      ...LEAD_CONVERSION_EVENTS,
      ...ECOMMERCE_INTENT_EVENTS,
    ];
    const pathRows =
      allPaths.length > 0
        ? (
            await client.query({
              query: pathMetricsSql,
              params: {
                start_date: start,
                end_date: end,
                paths: allPaths,
                has_product_ids: identityValues.length > 0,
                ids: identityValues.length > 0 ? identityValues : ["__none__"],
                traffic_and_action_events: trafficAndActionEvents,
                lead_events: [...LEAD_CONVERSION_EVENTS],
                ecommerce_events: [...ECOMMERCE_INTENT_EVENTS],
              },
              location,
              maximumBytesBilled: "5000000000",
            })
          )[0]
        : [];

    const byPath = new Map<string, PagePathMetrics>();
    for (const row of pathRows as Array<Record<string, unknown>>) {
      const path = normalizeAnalyticsPath(String(row.page_path || ""));
      byPath.set(path, {
        sessions: Number(row.sessions || 0),
        views: Number(row.views || 0),
        conversions: identityValues.length > 0 ? Number(row.conversions || 0) : 0,
        ecommerce_intent: identityValues.length > 0 ? Number(row.ecommerce_intent || 0) : 0,
      });
    }

    const pages: JourneyPagePerformance["pages"] = {};
    for (const meta of pageMeta) {
      let sessions = 0;
      let views = 0;
      let conversions = 0;
      let ecommerce_intent = 0;
      for (const p of meta.paths) {
        const m = byPath.get(p);
        if (!m) continue;
        sessions += m.sessions;
        views += m.views;
        conversions += m.conversions;
        ecommerce_intent += m.ecommerce_intent;
      }
      pages[meta.key] = {
        sessions,
        views,
        conversions,
        ecommerce_intent,
        shared: meta.shared,
        paths: meta.paths,
      };
    }

    const stages: JourneyPagePerformance["stages"] = {};
    for (const stage of FUNNEL_STAGES) {
      const stagePaths = Array.from(
        new Set(pageMeta.filter((m) => m.stage === stage).flatMap((m) => m.paths)),
      );
      let sessionsDistinct = 0;
      if (stagePaths.length > 0) {
        const [rows] = await client.query({
          query: stageSessionsSql,
          params: { start_date: start, end_date: end, paths: stagePaths },
          location,
          maximumBytesBilled: "5000000000",
        });
        sessionsDistinct = Number((rows as Array<Record<string, unknown>>)[0]?.sessions || 0);
      }
      stages[stage] = {
        sessions_distinct: sessionsDistinct,
        page_count: pageMeta.filter((m) => m.stage === stage).length,
      };
    }

    const distinctForPaths = async (paths: string[]): Promise<number> => {
      if (paths.length === 0) return 0;
      const [rows] = await client.query({
        query: stageSessionsSql,
        params: { start_date: start, end_date: end, paths },
        location,
        maximumBytesBilled: "5000000000",
      });
      return Number((rows as Array<Record<string, unknown>>)[0]?.sessions || 0);
    };

    const sessions_product_specific = await distinctForPaths(Array.from(exclusivePaths));
    const sessions_shared = await distinctForPaths(Array.from(sharedPaths));

    let conversions = 0;
    let ecommerce_intent = 0;
    if (identityValues.length > 0) {
      const [leadRows] = await client.query({
        query: productEventsSql,
        params: {
          start_date: start,
          end_date: end,
          event_names: [...LEAD_CONVERSION_EVENTS],
          ids: identityValues,
        },
        location,
        maximumBytesBilled: "5000000000",
      });
      for (const row of leadRows as Array<Record<string, unknown>>) {
        conversions += Number(row.event_count || 0);
      }
      const [ecomRows] = await client.query({
        query: productEventsSql,
        params: {
          start_date: start,
          end_date: end,
          event_names: [...ECOMMERCE_INTENT_EVENTS],
          ids: identityValues,
        },
        location,
        maximumBytesBilled: "5000000000",
      });
      for (const row of ecomRows as Array<Record<string, unknown>>) {
        ecommerce_intent += Number(row.event_count || 0);
      }
      if (conversions === 0 && ecommerce_intent === 0) {
        warnings.push({
          code: "product_params_may_be_missing",
          message:
            "No product-scoped events matched item_id/program_id/program. Confirm GTM exports these params to GA4→BQ.",
        });
      }
    } else {
      warnings.push({
        code: "no_product_identity",
        message: `No ecommerce product_id for slug ${productSlug}`,
      });
    }

    const payload: JourneyPagePerformance = {
      mode: "page_performance",
      status: "ok",
      window_days: days,
      as_of: asOf,
      warnings,
      pages,
      stages,
      summary: { sessions_product_specific, sessions_shared },
      product: {
        conversions,
        ecommerce_intent,
        item_id: itemId,
        content_slug: productSlug,
      },
    };
    cache.set(cacheKey, { expires: Date.now() + TTL_MS, payload });
    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err, productSlug }, "[JourneyAnalytics] query failed");
    return emptyPagePerformance(productSlug, days, [
      { code: "bigquery_query_failed", message },
      {
        code: "configure_at",
        message: "Check /private/tracking/ga4 and GCS_CREDENTIALS_JSON / ADC",
      },
    ]);
  }
}

/** Test helper — clear TTL cache */
export function clearJourneyAnalyticsCache(): void {
  cache.clear();
}
