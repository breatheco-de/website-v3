/**
 * MCP get_leads_breakdown — the staff Leads page numbers (KPIs, Channel and Source / medium
 * breakdowns, pages, experiments, time to lead) for one site, read-only.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { denyUnlessMetricsView } from "../lib/auth.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import { ok, fail, type McpWarning, type NextAction } from "../lib/respond.js";
import { getMcpSiteConfigs, resolveSiteContext } from "../lib/content.js";
import { SITE_PARAM_DESC, MULTI_SITE_TOOL_BLURB } from "../lib/entry-helpers.js";
import { getTokenUsername } from "../lib/oauth.js";
import {
  LEADS_FILTER_KEYS,
  LEADS_NONE,
  LEADS_PAGE_SIZE,
  LEADS_RANGES,
  LEADS_TTL_BUCKETS,
  hasLeadsFilters,
  leadsQueryToSearchParams,
  type LeadsFilterKey,
  type LeadsFilters,
  type LeadsListResponse,
  type LeadsRange,
  type LeadsStatsResponse,
} from "../../shared/leads-query.js";
import { PAID_LOOKBACK_DAYS } from "../../shared/paid-traffic.js";
import { TRAFFIC_CHANNELS } from "../../shared/traffic-channel.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const INTERNAL_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

/** Most specific first: the filter dropped when nothing matches. */
export const FILTER_DROP_ORDER: readonly LeadsFilterKey[] = [
  "variant",
  "experiment",
  "funnel_persona",
  "funnel_product",
  "product",
  "conversion_path",
  "landing_path",
  "ttl",
  "source",
  "medium",
  "channel",
];

export type LeadsBreakdownArgs = {
  range?: LeadsRange;
  include_test?: boolean;
  include_timeline?: boolean;
  include_leads?: boolean;
  site?: string;
} & LeadsFilters;

function internalHeaders(mcpToken?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (INTERNAL_SECRET) headers.Authorization = `Bearer ${INTERNAL_SECRET}`;
  const username = mcpToken ? getTokenUsername(mcpToken) : undefined;
  if (username) headers["x-mcp-author"] = username;
  return headers;
}

export function filtersFromArgs(args: LeadsBreakdownArgs): LeadsFilters {
  const filters: LeadsFilters = {};
  for (const key of LEADS_FILTER_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) (filters as Record<string, string>)[key] = v.trim();
  }
  return filters;
}

/** Query string for /api/ads/leads(/stats); always page 1 (latest 20 only). */
export function leadsQueryParams(args: LeadsBreakdownArgs, domain?: string): URLSearchParams {
  const p = leadsQueryToSearchParams({
    range: args.range ?? "30d",
    include_test: args.include_test === true,
    page: 1,
    filters: filtersFromArgs(args),
  });
  if (domain) p.set("__site", domain);
  return p;
}

/** Same filters minus the most specific one; null when no filter is set. */
export function dropMostSpecificFilter(filters: LeadsFilters): { dropped: LeadsFilterKey; filters: LeadsFilters } | null {
  for (const key of FILTER_DROP_ORDER) {
    if (filters[key]) {
      const next = { ...filters };
      delete next[key];
      return { dropped: key, filters: next };
    }
  }
  return null;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function leadsBreakdownWarnings(opts: {
  stats: LeadsStatsResponse;
  filters: LeadsFilters;
  domain: string;
  otherSites: string[];
}): McpWarning[] {
  const { stats, filters, domain, otherSites } = opts;
  const k = stats.kpis;
  const out: McpWarning[] = [];

  if (otherSites.length > 0) {
    out.push({
      code: "single_site",
      message: `Leads for ${domain} only. Not included: ${otherSites.join(", ")} (call again with site for each; never add sites together without saying so).`,
    });
  }
  if (stats.local_copy) {
    const pulled = stats.local_copy.pulled_at;
    out.push({
      code: "not_production_data",
      message:
        pulled != null
          ? `Not production: this machine's copy of production leads, downloaded ${isoDay(pulled)}. Leads after that are missing.`
          : "Not production: production leads were never downloaded here; counts are local test leads only. Do not report them as real numbers.",
    });
  }
  if (hasLeadsFilters(filters) && k.in_range === 0) {
    out.push({
      code: "filters_match_nothing",
      message:
        "No leads match these filters in this range. Values must match exactly (source / medium are lowercased; paths include the locale prefix; empty = \"(none)\"). Copy values from breakdown rows' filter.",
    });
  }
  out.push({
    code: "paid_count_differs_from_paid_traffic",
    message:
      `kpis.paid uses the Leads page rule: paid platform or (leads recorded since channel tracking) an ad click within ${PAID_LOOKBACK_DAYS} days; fbclid alone is meta_unclear, not paid. get_paid_traffic credits leads with its own rules, so its lead counts differ. Use get_paid_traffic for spend, campaigns and cost per lead; use this tool for the share of leads by channel.`,
  });
  out.push({
    code: "source_medium_differs_from_channel",
    message:
      "source_medium groups by the UTM tags on the link; channels uses tags first, then the referring site for untagged visits. They can group the same lead differently; UTMs on leads are never rewritten.",
  });
  const since = stats.tracking_since;
  if (since == null) {
    out.push({
      code: "channel_tracking_partial",
      message: "No lead has a channel yet: channels shows only \"Not tracked yet\" and organic_share is null.",
    });
  } else if (since > stats.start_ms) {
    out.push({
      code: "channel_tracking_partial",
      message: `Channel tracking started ${isoDay(since)}, inside this range. Earlier leads are "Not tracked yet"; organic_share covers only the ${k.tracked} tracked leads.`,
    });
  }
  if (since != null && since > stats.start_ms && since <= stats.end_ms) {
    out.push({
      code: "paid_rule_change_in_range",
      message: `From ${isoDay(since)}, leads with an ad click in the ${PAID_LOOKBACK_DAYS} days before also count as paid; earlier leads keep their old count. Compare across that date with care.`,
    });
  }
  if (k.no_consent > 0) {
    out.push({
      code: "no_consent_leads",
      message: `${k.no_consent} lead(s) from visitors without tracking consent: their channel covers only the converting visit, so organic search is slightly undercounted.`,
    });
  }
  out.push(...funnelWarnings(stats, filters));
  return out;
}

/** Page funnel product / persona notes (breakdowns.funnel_products / funnel_personas, funnel_* filters). */
function funnelWarnings(stats: LeadsStatsResponse, filters: LeadsFilters): McpWarning[] {
  const out: McpWarning[] = [];
  const recorded = (stats.breakdowns.funnel_products ?? []).some((r) => r.key !== LEADS_NONE && r.key !== "__other__");
  if (recorded || filters.funnel_product || filters.funnel_persona) {
    out.push({
      code: "funnel_counts_overlap",
      message:
        "funnel_products / funnel_personas count a lead once per product / persona on the page where the form was sent, so counts and pct can add up past in_range / 100%. Not the same as filter product (the single catalog product the form resolved). Sentinels: all = site-wide page (not added to each product), none = page without a funnel, \"(none)\" = not recorded.",
    });
  }
  const since = stats.funnel_since;
  if (since == null) {
    out.push({
      code: "funnel_tracking_partial",
      message: "No lead has a page product / persona yet: funnel breakdowns show only \"Not recorded yet\".",
    });
  } else if (since > stats.start_ms) {
    out.push({
      code: "funnel_tracking_partial",
      message: `Page product / persona recorded on leads from ${isoDay(since)}, inside this range; earlier leads are "Not recorded yet". No backfill.`,
    });
  }
  if ((stats.funnel_persona_product_unknown ?? 0) > 0) {
    out.push({
      code: "persona_product_unknown",
      message: `${stats.funnel_persona_product_unknown} lead(s) recorded before product_persona pairs (pipeline migration 42) have a persona id several products share: shown as ":persona" / "(product unknown)" rather than guessed. Filter with funnel_persona ":<persona id>".`,
    });
  }
  return out;
}

export function leadsRowsNote(total: number, shown: number): string {
  if (total <= shown) return "All matching leads.";
  return `Latest ${shown} of ${total} matching leads (newest first). Narrow the filters (channel, source / medium, page, form) to see others.`;
}

export function shapeLeadsBreakdown(opts: {
  stats: LeadsStatsResponse;
  list: LeadsListResponse | null;
  domain: string;
  includeTimeline: boolean;
}): Record<string, unknown> {
  const { stats, list, domain, includeTimeline } = opts;
  const payload: Record<string, unknown> = {
    site: domain,
    range: stats.range,
    start_ms: stats.start_ms,
    end_ms: stats.end_ms,
    collecting_since: stats.collecting_since,
    tracking_since: stats.tracking_since,
    product_since: stats.product_since,
    funnel_since: stats.funnel_since,
    kpis: stats.kpis,
    breakdowns: stats.breakdowns,
  };
  if (stats.product_name) payload.product_name = stats.product_name;
  if (stats.funnel_filter_labels) payload.funnel_filter_labels = stats.funnel_filter_labels;
  if (includeTimeline) payload.timeline = stats.timeline;
  if (list) {
    const rows = list.rows.slice(0, LEADS_PAGE_SIZE);
    payload.leads = {
      total: list.total,
      shown: rows.length,
      rows,
      note: leadsRowsNote(list.total, rows.length),
    };
  }
  return payload;
}

export function filtersMatchNothingNextAction(args: LeadsBreakdownArgs, filters: LeadsFilters): NextAction | null {
  const next = dropMostSpecificFilter(filters);
  if (!next) return null;
  const hint: Record<string, unknown> = { ...next.filters };
  if (args.range) hint.range = args.range;
  if (args.include_test) hint.include_test = true;
  if (args.site) hint.site = args.site;
  return {
    tool: "get_leads_breakdown",
    priority: "recommended",
    reason: `No leads matched. Retry without ${next.dropped} and copy exact values from the breakdown rows' filter.`,
    args_hint: hint,
  };
}

async function fetchJson<T>(url: string, mcpToken?: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { headers: internalHeaders(mcpToken) });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: `Main server unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const FILTER_ARG = z.string().trim().min(1).max(300);

export function registerLeadsBreakdownTools(mcp: McpServer, mcpToken?: string, grants?: CatalogGrant[]): void {
  mcp.tool(
    "get_leads_breakdown",
    "Site leads as on the staff Leads page (one site per call): KPIs (paid / organic search / Meta unclear shares, tracked, no consent), " +
      "breakdowns by channel (paid, meta_unclear, organic_search, organic_social, ai_assistant, email, referral, direct, tagged_other; \"(none)\" = not tracked yet) and by UTM source / medium, plus converting / landing pages, experiments, time from first ad click, " +
      "and page funnel products / personas (funnel_products, funnel_personas: one count per product / persona, so shares can pass 100%). Requires metrics_view. " +
      "Channel and source / medium are different views of the same leads (channel uses tags first, then the referring site). " +
      `Paid wins: an ad click within ${PAID_LOOKBACK_DAYS} days keeps a lead paid, only for leads recorded since channel tracking; fbclid alone = meta_unclear. ` +
      "Paid counts differ from get_paid_traffic (use that for spend, campaigns, cost per lead); Search Console clicks → get_organic_traffic. " +
      "range 7d | 30d (default) | 90d | all (same as the page; no custom dates). Test and repeat leads excluded unless include_test. " +
      "include_timeline adds the day / week series; include_leads adds the latest 20 matching leads (newest first, no personal data, no paging — narrow filters instead). " +
      "Breakdown rows carry filter: pass those values back to drill down. Read-only. " +
      MULTI_SITE_TOOL_BLURB,
    {
      range: z.enum(LEADS_RANGES).optional().describe("7d | 30d (default) | 90d | all — UTC days, same as the Leads page"),
      include_test: z.boolean().optional().describe("Include test and repeat leads (default false)"),
      include_timeline: z.boolean().optional().describe("Add timeline (daily up to 120 days, else weekly). Default false"),
      include_leads: z
        .boolean()
        .optional()
        .describe(`Add the latest ${LEADS_PAGE_SIZE} matching leads (newest first; no name / email / phone). Default false; no paging`),
      channel: z.union([z.enum(TRAFFIC_CHANNELS), z.literal(LEADS_NONE)]).optional().describe(`Traffic channel, or "${LEADS_NONE}" for leads recorded before channel tracking`),
      source: FILTER_ARG.optional().describe(`utm_source (case-insensitive), or "${LEADS_NONE}" for untagged`),
      medium: FILTER_ARG.optional().describe(`utm_medium (case-insensitive), or "${LEADS_NONE}" for untagged`),
      conversion_path: FILTER_ARG.optional().describe(`Exact page the form was sent from (with locale prefix), or "${LEADS_NONE}"`),
      landing_path: FILTER_ARG.optional().describe(`Exact first page of the visit, or "${LEADS_NONE}"`),
      experiment: FILTER_ARG.optional().describe("Page experiment id (from breakdowns.experiments filter)"),
      variant: FILTER_ARG.optional().describe("Experiment variant (with experiment)"),
      ttl: z.enum(LEADS_TTL_BUCKETS).optional().describe("Time from first ad click to lead bucket"),
      product: FILTER_ARG.optional().describe(`Catalog product_id or product page slug, or "${LEADS_NONE}"`),
      funnel_product: FILTER_ARG.optional().describe(
        `One product in the page funnel (full slug, as in breakdowns.funnel_products filter), all, none, or "${LEADS_NONE}" (not recorded). Not the same as product`,
      ),
      funnel_persona: FILTER_ARG.optional().describe(
        `One persona as product:persona full ids (":persona" = product unknown), all, none, or "${LEADS_NONE}"; copy from breakdowns.funnel_personas filter`,
      ),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async (args) => {
      const denied = await denyUnlessMetricsView(mcpToken, grants);
      if (denied) return denied;
      const siteResult = resolveSiteContext(args.site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;

      const params = leadsQueryParams(args, domain).toString();
      const base = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/ads/leads`;
      const [statsRes, listRes] = await Promise.all([
        fetchJson<LeadsStatsResponse>(`${base}/stats?${params}`, mcpToken),
        args.include_leads ? fetchJson<LeadsListResponse>(`${base}?${params}`, mcpToken) : Promise.resolve(null),
      ]);
      if (!statsRes.ok) return fail(`Could not load leads: ${statsRes.error}`);
      if (listRes && !listRes.ok) return fail(`Could not load lead rows: ${listRes.error}`);

      const filters = filtersFromArgs(args);
      const otherSites = getMcpSiteConfigs()
        .map((c) => c.domain)
        .filter((d) => d.toLowerCase() !== domain.toLowerCase());
      const warnings = leadsBreakdownWarnings({ stats: statsRes.data, filters, domain, otherSites });
      const next_actions: NextAction[] = [];
      if (warnings.some((w) => w.code === "filters_match_nothing")) {
        const action = filtersMatchNothingNextAction(args, filters);
        if (action) next_actions.push(action);
      }

      return ok(
        shapeLeadsBreakdown({
          stats: statsRes.data,
          list: listRes ? listRes.data : null,
          domain,
          includeTimeline: args.include_timeline === true,
        }),
        { warnings, next_actions },
      );
    },
  );
}
