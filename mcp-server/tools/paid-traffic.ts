/**
 * MCP get_paid_traffic — paid landing pages, spend, and ad tracking health (read-only).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkCap, denyUnlessMetricsView } from "../lib/auth.js";
import { hasCapAnyScope, type CatalogGrant } from "../lib/tool-catalog.js";
import { ok, fail, type McpSideEffect, type NextAction } from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { SITE_PARAM_DESC, MULTI_SITE_TOOL_BLURB } from "../lib/entry-helpers.js";
import { getTokenUsername } from "../lib/oauth.js";
import { buildLoopbackHeaders } from "../lib/loopback.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const INTERNAL_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const SUMMARY_TOP = 5;
const MAX_ISSUE_IDS = 10;
const MAX_ADS_LIMIT = 200;
const MAX_FILTER_IDS = 20;
const DATE_ARG = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const ID_LIST_ARG = z.array(z.string().regex(/^\d+$/, "numeric Meta or Google id")).max(MAX_FILTER_IDS);
const ID_FILTER_KEYS = ["campaign_ids", "adset_ids", "ad_ids"] as const;

function appendIdFilters(params: URLSearchParams, f: Partial<Record<(typeof ID_FILTER_KEYS)[number], string[] | undefined>>): boolean {
  let any = false;
  for (const key of ID_FILTER_KEYS) {
    for (const id of f[key] ?? []) {
      params.append(`${key}[]`, id);
      any = true;
    }
  }
  return any;
}

const NO_MATCH_NEXT_ACTION: NextAction = {
  tool: "get_paid_traffic",
  priority: "recommended",
  reason: "Some filter ids matched nothing in this window; list campaign ids (or ad ids via diagnostics details.ads) and retry",
  args_hint: { mode: "campaigns" },
};

type IssueDetails = {
  ads?: unknown[];
  ads_total?: number;
  ads_offset?: number;
  unchecked?: Array<{ reason: string; ads: number }>;
};
type DiagIssue = { id?: string; code?: string; why?: string; details?: IssueDetails };

const UNCHECKED_WARNINGS: Record<string, (n: number) => string> = {
  account_unreadable: (n) =>
    `${n} ad(s) with spend were not checked: Meta refused to read their ad account on the last sync (see meta.accounts[].sync_error). Staff fix access or the id in Settings → Ads.`,
  setup_fetch_failed: (n) =>
    `${n} ad(s) with spend were not checked: Meta didn't return their setup on the last sync (see details.setup_last_read_at). Re-call with refresh: true (needs ads_settings) or ask staff to Resync.`,
  ad_removed_in_meta: (n) =>
    `${n} ad(s) with spend were removed in Meta, so their URL parameters can't be verified. The spend already happened; nothing to fix.`,
  no_link_found: (n) =>
    `${n} ad(s) with spend have no website link in their setup (e.g. call / message ads), so URL parameters don't apply. Verify in Ads Manager if unexpected.`,
};

/** One warning per unchecked reason across all issues (not just the returned page). */
function uncheckedWarnings(issues: DiagIssue[]): Warning[] {
  const byReason = new Map<string, number>();
  for (const i of issues) {
    if (i.code !== "missing_tracking_params" && i.code !== "tracking_params_unchecked") continue;
    for (const u of i.details?.unchecked ?? []) byReason.set(u.reason, (byReason.get(u.reason) ?? 0) + u.ads);
  }
  return Array.from(byReason.entries())
    .filter(([reason]) => UNCHECKED_WARNINGS[reason])
    .map(([reason, n]) => ({ code: `tracking_unchecked_${reason}`, message: UNCHECKED_WARNINGS[reason]!(n) }));
}

type MetaAccountStatus = { id: string; name?: string; history_loaded?: boolean; sync_error?: string };

/** Unreadable accounts (skipped last sync; others still saved) and accounts still waiting on their first 90-day load. */
export function accountSyncWarnings(accounts: unknown[] | undefined): Warning[] {
  const list = (accounts ?? []) as MetaAccountStatus[];
  const out: Warning[] = [];
  for (const a of list.filter((x) => x.sync_error)) {
    out.push({
      code: "meta_account_unreadable",
      message: `Meta account ${a.id}${a.name ? ` (${a.name})` : ""} was skipped on the last sync: ${a.sync_error}. Other accounts still synced; its spend is the last saved data (or none). Staff fix access or the id in Settings → Ads.`,
    });
  }
  const pending = list.filter((x) => !x.sync_error && x.history_loaded === false).map((x) => x.id);
  if (pending.length > 0) {
    out.push({
      code: "meta_account_not_synced",
      message: `Meta account(s) ${pending.join(", ")} have not finished their first 90-day load; spend for them may be missing. The next sync (automatic or refresh: true) loads 90 days.`,
    });
  }
  return out;
}

type AdsRunInfo = {
  never_run?: boolean;
  last_run?: { finished_at?: string | null; skipped?: Array<{ platform: string; reason: string }> } | null;
  active?: Array<{ job_id: string; kind: string; lane: string; status: string }>;
  last_failed?: { kind: string; error: string } | null;
  busy?: { code: string; message: string } | null;
};
type IssueVerify = { action?: string; state?: string; label?: string; verify?: { kind?: string } };
type ActionIssue = DiagIssue & { verify?: IssueVerify; affected_ads?: string[]; affected_ads_total?: number };

/** Standing facts for every diagnostics read (dense; staff copy lives in the UI). */
const ADS_DIAGNOSTICS_MODEL: Warning = {
  code: "ads_diagnostics_model",
  message:
    "Issues come from the last Run / Re-check, not this read: numbers are as of issues[].measured_at over issues[].window (28 days). " +
    "Sync updates KPIs only; it never opens or closes issues. Runs skip pending (marked-fixed) issues and never override a Mark / Undo / Re-check made after the Run started. " +
    "Issues on a platform the last Run skipped carry not_checked (not fixed, not re-evaluated).",
};

/**
 * ads-config.yml / UTM convention warnings the server attaches to diagnostics reads
 * (utm_convention_changed, utm_convention_invalid, ads_config_unreadable). Moved out of the
 * payload so they appear once, in `warnings`, with their structured fields.
 */
export function takeUtmWarnings(data: Record<string, unknown>): Warning[] {
  const list = (Array.isArray(data.utm_warnings) ? data.utm_warnings : []) as Warning[];
  delete data.utm_warnings;
  return list;
}

/** Run state → warnings (never-run, running, failed, skipped platforms). */
export function adsRunWarnings(run: AdsRunInfo | undefined): Warning[] {
  if (!run) return [];
  const out: Warning[] = [];
  if (run.never_run) {
    out.push({ code: "ads_never_run", message: "No Run has finished on this site yet, so issues are empty. Start one with update_ads_issue action run (background, ~1–3 min)." });
  }
  const running = (run.active ?? []).filter((j) => j.status === "running" || j.status === "queued");
  if (running.some((j) => j.kind === "run")) {
    out.push({ code: "ads_run_in_progress", message: "A Run is in progress; issues update when it finishes. Re-call get_paid_traffic in ~1 minute. New Runs and big Re-checks return 409 ads_run_busy meanwhile." });
  } else if (running.length > 0) {
    out.push({ code: "ads_recheck_in_progress", message: `${running.length} Re-check(s) queued or running; affected issues show recheck_queued.` });
  }
  if (run.last_failed) {
    out.push({ code: "ads_last_job_failed", message: `Last ${run.last_failed.kind} failed: ${run.last_failed.error} Issues were left as they were.` });
  }
  for (const s of run.last_run?.skipped ?? []) {
    out.push({ code: "ads_platform_not_checked", message: `${s.platform} was not checked in the last Run (${s.reason}). Its issues stay as last checked — not fixed, not re-evaluated.` });
  }
  if (run.busy?.code === "ads_sync_active") {
    out.push({ code: "ads_sync_active", message: run.busy.message });
  }
  return out;
}

const MAX_ISSUE_ACTIONS = 5;

/** Per-issue next step: Re-check (instant / ready), Mark as fixed (needs report), nothing while waiting. */
export function adsIssueNextActions(issues: ActionIssue[], run: AdsRunInfo | undefined): NextAction[] {
  if (run?.never_run) {
    return [{ tool: "update_ads_issue", priority: "recommended", reason: "No Run yet: start a full Run to find issues", args_hint: { action: "run" } }];
  }
  const out: NextAction[] = [];
  for (const i of issues) {
    if (!i.id || out.length >= MAX_ISSUE_ACTIONS) break;
    const action = i.verify?.action;
    if (action === "recheck" || action === "recheck_ready") {
      out.push({
        tool: "update_ads_issue",
        priority: action === "recheck_ready" ? "recommended" : "optional",
        reason: action === "recheck_ready" ? `${i.id}: ready to confirm the fix` : `${i.id}: after fixing it in the ad platform or site, Re-check confirms right away`,
        args_hint: { action: "recheck", issue_id: i.id },
      });
    } else if (action === "mark_fixed") {
      out.push({
        tool: "update_ads_issue",
        priority: "optional",
        reason: `${i.id}: needs new data to confirm (${i.verify?.verify?.kind}); after fixing, mark as fixed with a report — it stays pending until verified`,
        args_hint: { action: "mark_fixed", issue_id: i.id, report: "What you changed, where (account / campaign / ad ids)" },
      });
    }
  }
  return out;
}

const LIST_AFFECTED_ADS = 20;

/** List mode: cap affected_ads (ids) per issue; issue_ids returns the full list. */
function slimAffectedAds<T extends ActionIssue>(issues: T[]): T[] {
  return issues.map((i) =>
    Array.isArray(i.affected_ads) && i.affected_ads.length > LIST_AFFECTED_ADS ? { ...i, affected_ads: i.affected_ads.slice(0, LIST_AFFECTED_ADS) } : i,
  );
}

function truncatedAds(issues: DiagIssue[]): Array<{ id: string; shown: number; total: number; next_offset: number }> {
  const out: Array<{ id: string; shown: number; total: number; next_offset: number }> = [];
  for (const i of issues) {
    const d = i.details;
    if (!d || !i.id) continue;
    const shown = d.ads?.length ?? 0;
    const end = (d.ads_offset ?? 0) + shown;
    if (end < (d.ads_total ?? 0)) out.push({ id: i.id, shown, total: d.ads_total ?? 0, next_offset: end });
  }
  return out;
}

type Warning = { code: string; message: string };
type Money = Record<string, number>;
type RefreshStatus = {
  state: "idle" | "queued" | "running" | "failed" | "worker_down";
  error: string | null;
  retry_after: string | null;
  [k: string]: unknown;
};

const REFRESH_WARNING_CODES = new Set(["meta_refresh_in_progress", "meta_refresh_failed", "jobs_worker_down"]);
const GOOGLE_STATUS_WARNING_CODES = new Set(["google_data_through", "google_transfer_stale", "google_account_not_synced", "google_network_not_split"]);

type PlatformCard = { connected?: boolean; status?: string; open_errors?: number; open_warnings?: number };

/** One next action per connected platform with open issues, pointing at its full diagnostics. */
export function overviewNextActions(platforms: Partial<Record<"meta" | "google", PlatformCard>> | undefined): NextAction[] {
  const out: NextAction[] = [];
  for (const p of ["meta", "google"] as const) {
    const c = platforms?.[p];
    const open = (c?.open_errors ?? 0) + (c?.open_warnings ?? 0);
    if (!c?.connected || open === 0) continue;
    out.push({
      tool: "get_paid_traffic",
      priority: (c.open_errors ?? 0) > 0 ? "recommended" : "optional",
      reason: `${p === "meta" ? "Meta" : "Google Ads"}: ${c.open_errors ?? 0} error(s), ${c.open_warnings ?? 0} warning(s); list them with evidence and how to fix`,
      args_hint: { mode: "diagnostics", platform: p },
    });
  }
  return out;
}

/** Re-call only while a refresh is queued/running; point at setup docs when it failed or cannot run. */
function refreshNextActions(refresh: RefreshStatus | undefined, mode: string, platform?: string): NextAction[] {
  if (refresh?.state === "queued" || refresh?.state === "running") {
    return [
      { tool: "get_paid_traffic", priority: "recommended", reason: "Ad data is refreshing; re-call in ~1 minute", args_hint: platform ? { mode, platform } : { mode } },
    ];
  }
  if (refresh?.state === "failed" || refresh?.state === "worker_down") {
    return [
      {
        tool: "explain_site",
        priority: "optional",
        reason:
          "Refresh didn't run (numbers are the last cached sync); do not loop. Staff retry with Sync now in Settings → Ads (agents with ads_settings may pass refresh: true once)",
        args_hint: { topic: "ads" },
      },
    ];
  }
  return [];
}
type PageRow = {
  key: string;
  title: string;
  url: string;
  path: string;
  kind: string;
  content_type: string | null;
  slug: string | null;
  locale: string | null;
  spend: Money;
  paid_visits: number;
  unique_leads: number;
  submissions: number;
  conversion_rate: number | null;
  cost_per_lead: Money;
  low_sample: boolean;
  campaigns?: unknown[];
  versions?: unknown[];
  [k: string]: unknown;
};
type Report = {
  window: unknown;
  platform: string;
  attribution: unknown;
  meta: { connected: boolean; last_synced_at: string | null; accounts: unknown[] };
  google?: { connected: boolean; data_through: string | null; accounts: unknown[]; [k: string]: unknown };
  google_networks?: unknown;
  ga4: { configured: boolean; last_export_date: string | null };
  refreshing: boolean;
  refresh?: RefreshStatus;
  collecting_since: string | null;
  covered_days: unknown;
  data_gaps?: { meta_missing_days: number; ga4_missing_days: number };
  filters?: Record<(typeof ID_FILTER_KEYS)[number], string[]>;
  totals: Record<string, unknown>;
  lead_conversions?: unknown;
  pages: PageRow[];
  destinations: PageRow[];
  campaigns: unknown[];
  thresholds: unknown;
  meta_platforms?: unknown;
  url_changes?: unknown[];
  url_changes_total?: number;
  warnings: Warning[];
};

/** Summary keeps the costliest ad link switches; entries rows carry their own `url_changes`. */
const SUMMARY_URL_CHANGES = 10;

function internalHeaders(mcpToken?: string, site?: string): Record<string, string> {
  return buildLoopbackHeaders(mcpToken, { site });
}

function moneyTotal(m: Money | undefined): number {
  return Object.values(m ?? {}).reduce((a, b) => a + b, 0);
}

type SortKey = "spend" | "paid_visits" | "unique_leads" | "conversion_rate" | "cost_per_lead";

const PAGE_CAMPAIGNS_TOP = 3;

/** Top campaigns for `group: page`; the untagged row only fills a slot when fewer real campaigns exist. */
function topCampaigns(campaigns: unknown[]): unknown[] {
  const isUntagged = (c: unknown) => !!(c && typeof c === "object" && (c as { untagged?: boolean }).untagged);
  const tagged = campaigns.filter((c) => !isUntagged(c));
  const top = tagged.slice(0, PAGE_CAMPAIGNS_TOP);
  if (top.length < PAGE_CAMPAIGNS_TOP) top.push(...campaigns.filter(isUntagged));
  return top;
}

const CAMPAIGN_IDENTITY_KEYS = new Set(["platform", "campaign_id", "campaign_name"]);
const CAMPAIGN_RATE_KEYS = new Set(["ctr", "conversion_rate", "meta_conversion_rate", "bounce_rate"]);

/** Drop zero counts, null rates, empty money and false flags from a campaign ref. Absent count = 0; absent rate / money = no denominator; a computed 0 rate stays. */
export function compactCampaignRef(c: unknown): unknown {
  if (!c || typeof c !== "object") return c;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c as Record<string, unknown>)) {
    if (!CAMPAIGN_IDENTITY_KEYS.has(k)) {
      if (v == null || v === false) continue;
      if (v === 0 && !CAMPAIGN_RATE_KEYS.has(k)) continue;
      if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      if (Array.isArray(v) && v.length === 0) continue;
    }
    out[k] = v;
  }
  return out;
}

function sortPages(rows: PageRow[], sort: SortKey): PageRow[] {
  const val = (r: PageRow): number | null => {
    switch (sort) {
      case "spend":
        return moneyTotal(r.spend);
      case "cost_per_lead":
        return r.unique_leads > 0 ? moneyTotal(r.cost_per_lead) : null;
      case "conversion_rate":
        return r.low_sample ? null : r.conversion_rate;
      default:
        return r[sort];
    }
  };
  const asc = sort === "cost_per_lead";
  return [...rows].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return asc ? av - bv : bv - av;
  });
}

const NON_EFFECTS = [
  "Read-only: does not change Meta or Google Ads campaigns, settings, or lead delivery.",
  "refresh: true only queues reads (Meta API + Google Ads BigQuery transfer tables into .cache); it never changes campaigns, ads, or budgets, and cannot make Google's daily transfer run sooner.",
  "Test leads (staff session / test email pattern) are excluded from lead counts.",
  "Meta-reported leads, Google-reported leads and site leads are separate sources — never summed.",
];

const DIAG_PLATFORMS = new Set(["meta", "google"]);

const DIAG_READ_NON_EFFECT = "diagnostics is a read: it never runs checks, probes landing pages or opens / closes issues (use update_ads_issue run / recheck / mark_fixed / undo).";

export function registerPaidTrafficTools(mcp: McpServer, mcpToken?: string, grants?: CatalogGrant[]): void {
  mcp.tool(
    "get_paid_traffic",
    "Paid traffic by landing page: ad spend (Meta Marketing API + Google Ads BigQuery transfer), paid visits (GA4 BigQuery export), and site leads (lead ledger), " +
      "plus ad tracking health. Requires metrics_view. Exclusive mode per call: " +
      "summary (totals + lead_conversions: which Meta conversions / site forms sit behind the lead counts + top pages) | campaigns | entries (managed pages, paginated) | destinations (spend that did not land on a managed page, incl. Google lead forms / calls / video views / app — excluded from cost per lead) | diagnostics. " +
      "diagnostics without platform → cross-platform overview (platforms.meta / platforms.google cards with top_issues, shared lead-tracking issues, totals; next_actions per platform with open issues). diagnostics with platform meta | google → that platform's full issue list (Meta: evidence; landing_not_live = ad URL resolves to no live page (in-process, no HTTP probe); unrecognized_campaign = paid Meta visits from a campaign not in any connected account. Google: transfer health, matching, networks). " +
      "diagnostics is a cache read: issues come from the last Run / Re-check (run { never_run, last_run { checked, skipped }, active, last_failed, busy }); change them with update_ads_issue (run | recheck | mark_fixed | undo). " +
      "Each issue: stable id (ads:{platform}:{code}:{level}:{resource}), level + resource_id, affected_ads (ad ids; list mode caps 20, affected_ads_total = all), measured_at + window, verify { verify { kind instant | after_sync | fresh_days }, state open | pending, action recheck | mark_fixed | recheck_ready | wait, verify_after, waits_for_sync, ready_to_verify, progress (min_data x of y), label }, last_check (partly_fixed / couldnt_check notes), recheck_queued, not_checked. " +
      "Google data lags 1–2 days (google_data_through warning; google_transfer_stale when older). google_leads (Submit lead form conversions + staff-picked actions) are never summed with Meta or site leads. " +
      "Consent surfaces only as warnings (consent_estimates, consent_rate_drop); the consent breakdown is staff-only (Diagnostics → Legal). " +
      "days 1–90 ending yesterday (default 28). diagnostics: KPIs read the saved 7 / 28 / 90 day windows (other values snap up); issues and open_errors/open_warnings (open only; pending excluded) always cover the last 28 days (issue_window_days). Credit: one lead → one landing page (model last_paid default | first_paid), 30-day lookback, no split; the form page never gets credit. " +
      "Money is per currency (never converted). Soft status not_configured when neither Meta nor GA4 export is set up. " +
      "diagnostics issues sort severity → spend affected; each carries scope (campaign/account ids), first_seen and details { ads (top 3 by spend unless issue_ids), ads_total, ads_offset, unchecked reasons, ga4_seen for destinations with no synced ad, setup_last_read_at }. " +
      "Pass issue_ids (≤10) for up to ads_limit ads with evidence per issue (default 50; evidence keeps the top 50 by spend; page with ads_offset) and the full affected_ads list. " +
      "Refresh status (refresh.state): meta_refresh_in_progress → re-call in ~1 minute; meta_refresh_failed / jobs_worker_down → numbers are the last cached sync, do not re-call in a loop (staff retry via Sync now). refresh.progress { done, total, label } only while running (uneven steps; not a time estimate). " +
      "refresh: true (any mode, needs ads_settings) queues a Meta + Google + GA4 read first; without the grant → refresh_not_allowed warning and the cached read proceeds. " +
      "Filters: campaign_ids / adset_ids / ad_ids (≤20 each; OR within a level, AND across levels; Google ad groups go in adset_ids) narrow spend, GA4 visits (matched by link tags; parents filled from synced ads) and leads (by last-clicked ad); untagged visits are left out (untagged_visits_excluded = floor). " +
      "When both Meta and Google are connected, id filters need platform meta | google (error code platform_required_for_ids). Leads recorded before per-platform ids → lead_platform_legacy warning (platform guessed from UTMs). " +
      "since / until (YYYY-MM-DD, ≤90 days, within ~13 months) replace days; gaps → data_gaps warning (missing, not zero). diagnostics: id filters keep issues touching those ads; since/until ignored. " +
      "summary / diagnostics carry meta_platforms (Facebook vs Instagram) and google_networks (Search / Display / YouTube / PMax…; google_network_not_split when visits can't be tied to a network); see explain topic ads. " +
      "Read-only — not GSC (get_organic_traffic), not general GA4 reports (get_analytics_report). " +
      MULTI_SITE_TOOL_BLURB,
    {
      mode: z.enum(["summary", "campaigns", "entries", "destinations", "diagnostics"]).describe("Exclusive mode for this call"),
      days: z.number().int().min(1).max(90).optional().describe("Lookback days ending yesterday (default 28). diagnostics: KPI window only (snaps to 7 / 28 / 90); issues stay on the last 28 days."),
      platform: z
        .enum(["all", "meta", "google", "microsoft", "tiktok", "linkedin", "x", "snapchat", "pinterest", "other"])
        .optional()
        .describe(
          "Report modes: filter spend, paid visits and leads by ad platform (default all; spend exists for meta and google). Required with id filters when both are connected. diagnostics: meta | google for that platform's issues; omit (or all) for the overview.",
        ),
      currency: z
        .string()
        .optional()
        .describe(
          "ISO currency filter, e.g. USD. Omit for all currencies (returned per currency). Like account: narrows spend, paid visits and leads to ads in accounts of that currency; non-Meta / unclear visits excluded; untagged Meta visits → totals.unassigned_visits, visits with ids from unsynced accounts → totals.unsynced_account_visits.",
        ),
      account: z
        .string()
        .optional()
        .describe(
          "Ad account filter: Meta id (digits; act_ prefix optional) or Google customer id (123-456-7890). Narrows spend, paid visits (matched by utm_id / utm_term / utm_content to that account's synced ads) and leads (by last-clicked ad ids). Excludes non-Meta and unclear visits. Untagged Meta visits → totals.unassigned_visits + row.unassigned_visits; visits with ids from unsynced accounts → totals.unsynced_account_visits (warning visits_not_tied_to_account; visits are a floor).",
        ),
      content_type: z.string().optional().describe("entries/summary: limit pages to one CMS content type"),
      model: z.enum(["last_paid", "first_paid"]).optional().describe("Lead credit model (default last_paid)"),
      campaign_ids: ID_LIST_ARG.optional().describe(`Meta or Google campaign ids (≤${MAX_FILTER_IDS}); AND with adset_ids / ad_ids`),
      adset_ids: ID_LIST_ARG.optional().describe(`Meta ad set or Google ad group ids (≤${MAX_FILTER_IDS})`),
      ad_ids: ID_LIST_ARG.optional().describe(`Meta or Google ad ids (≤${MAX_FILTER_IDS}; Performance Max has campaign level only)`),
      since: DATE_ARG.optional().describe("Window start (UTC, inclusive). Overrides days; with only since, the window runs days (default 90) forward, capped at yesterday."),
      until: DATE_ARG.optional().describe("Window end (UTC, inclusive; clamped to yesterday). With only until, the window is days (default 28) back from it. Max span 90 days."),
      group: z
        .enum(["page", "campaign"])
        .optional()
        .describe("entries only: page (default, campaigns trimmed to top 3 by spend per row + campaigns_total) or campaign (full campaign list per row)"),
      split_by_version: z.boolean().optional().describe("entries only: include per-variant rows from experiment_exposure"),
      sort: z
        .enum(["spend", "paid_visits", "unique_leads", "conversion_rate", "cost_per_lead"])
        .optional()
        .describe("entries/destinations sort (default spend). Low-sample rows sort last for rates."),
      limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Page size (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`),
      offset: z.number().int().min(0).optional().describe("Pagination offset (default 0)"),
      issue_ids: z
        .array(z.string())
        .max(MAX_ISSUE_IDS)
        .optional()
        .describe(`diagnostics: up to ${MAX_ISSUE_IDS} issue ids to return with bigger ads lists (other issues omitted)`),
      ads_limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_ADS_LIMIT)
        .optional()
        .describe(`diagnostics: ads per issue (default 3 in the list, 50 with issue_ids; max ${MAX_ADS_LIMIT})`),
      ads_offset: z.number().int().min(0).optional().describe("diagnostics: offset into each issue's ads (default 0)"),
      refresh: z
        .boolean()
        .optional()
        .describe(
          "Queue a read of every connected source before reading: Meta (last 10 days + ad setups; 90 days while an account has history_loaded false), Google transfer tables (10 days spend / 30 days conversions + reloaded days), GA4. Needs ads_settings. Never changes campaigns; cannot force Google's transfer.",
        ),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async ({
      mode,
      days,
      platform,
      currency,
      account,
      content_type,
      model,
      campaign_ids,
      adset_ids,
      ad_ids,
      since,
      until,
      group,
      split_by_version,
      sort,
      limit,
      offset,
      issue_ids,
      ads_limit,
      ads_offset,
      refresh: refreshRequested,
      site,
    }) => {
      const denied = await denyUnlessMetricsView(mcpToken, grants);
      if (denied) return denied;
      const siteResult = resolveSiteContext(site);
      if (!siteResult.ok) return fail(siteResult.error);
      const domain = siteResult.domain;
      const lim = limit ?? DEFAULT_LIMIT;
      const off = offset ?? 0;

      try {
        const refreshWarningsOut: Warning[] = [];
        const refreshEffects: McpSideEffect[] = [];
        if (refreshRequested) {
          const allowed = !mcpToken || (grants ? hasCapAnyScope(grants, "ads_settings") : await checkCap(mcpToken, "ads_settings"));
          if (!allowed) {
            refreshWarningsOut.push({
              code: "refresh_not_allowed",
              message: "refresh needs the ads_settings capability; returned the last cached sync instead. Ask staff to Resync in Settings → Ads.",
            });
          } else {
            const syncParams = new URLSearchParams();
            const syncRes = await fetch(`http://127.0.0.1:${MAIN_SERVER_PORT}/api/ads/sync?${syncParams}`, {
              method: "POST",
              headers: internalHeaders(mcpToken, domain),
              body: JSON.stringify({ mode: "refresh" }),
            });
            const syncBody = (await syncRes.json().catch(() => ({}))) as { error?: string; refresh?: RefreshStatus };
            if (!syncRes.ok) {
              refreshWarningsOut.push({ code: "refresh_failed", message: `Ads refresh did not start: ${syncBody.error ?? `HTTP ${syncRes.status}`}` });
            } else {
              const state = syncBody.refresh?.state ?? "unknown";
              refreshEffects.push(
                {
                  kind: "meta_sync_enqueued",
                  summary: `Queued a Meta read if Meta is connected (last 10 days of ad data + ad setups; job state ${state}). Reads from Meta only.`,
                  paths: [".cache/{site}/meta-ads-days/", ".cache/{site}/ads-setup/meta.json", ".cache/{site}/meta-ads-state.json"],
                },
                {
                  kind: "google_sync_enqueued",
                  summary: `Queued a Google Ads read if Google is connected (BigQuery transfer tables: 10 days spend, 30 days conversions, reloaded days; same job, state ${state}). Does not make Google's transfer run sooner.`,
                  paths: [
                    ".cache/{site}/google-ads-days/",
                    ".cache/{site}/google-ads-network-days/",
                    ".cache/{site}/ads-setup/google.json",
                    ".cache/{site}/google-ads-state.json",
                  ],
                },
              );
            }
          }
        }

        if (mode === "diagnostics") {
          if (platform && platform !== "all" && !DIAG_PLATFORMS.has(platform)) {
            return fail(`diagnostics supports platform meta or google (omit it for the cross-platform overview); got ${platform}.`, {
              code: "diagnostics_platform_unsupported",
            });
          }
          const hasIdFilters = [campaign_ids, adset_ids, ad_ids].some((l) => (l?.length ?? 0) > 0);
          const detailArgs = (issue_ids?.length ?? 0) > 0 || hasIdFilters;
          let diagPlatform: "overview" | "meta" | "google" = platform === "meta" || platform === "google" ? platform : "overview";
          if (diagPlatform === "overview" && detailArgs) {
            diagPlatform = "meta";
            refreshWarningsOut.push({
              code: "diagnostics_platform_defaulted",
              message: "issue_ids / id filters need a platform; used meta. Pass platform: google for Google issue ids (ads:google:…).",
            });
          }

          if (diagPlatform === "overview") {
            const params = new URLSearchParams({ platform: "overview", days: String(days ?? 28) });
            const res = await fetch(`http://127.0.0.1:${MAIN_SERVER_PORT}/api/diagnostics/ads?${params}`, { headers: internalHeaders(mcpToken, domain) });
            const data = (await res.json()) as Record<string, unknown> & { platforms?: Partial<Record<"meta" | "google", PlatformCard>> };
            if (!res.ok) return fail((data.error as string) || `Server error: ${res.status}`);
            const warnings: Warning[] = [...refreshWarningsOut, ADS_DIAGNOSTICS_MODEL, ...adsRunWarnings(data.run as AdsRunInfo | undefined)];
            if (since || until) {
              warnings.push({ code: "range_ignored_in_diagnostics", message: "since / until are ignored in diagnostics; use a report mode for a custom range." });
            }
            const shared = (Array.isArray(data.shared_issues) ? data.shared_issues : []) as DiagIssue[];
            const consentDrop = shared.find((i) => i.code === "consent_rate_drop");
            if (consentDrop) {
              warnings.push({
                code: "consent_rate_drop",
                message: `${consentDrop.why ?? "Ask-region accept rate dropped."} Consent breakdown is staff-only in Diagnostics → Legal.`,
              });
            }
            return ok(
              {
                message: `Ads diagnostics overview (${data.window_days}d): ${String(data.status)}`,
                ...data,
                shared_issues: shared.filter((i) => i.code !== "consent_rate_drop"),
                non_effects: [...NON_EFFECTS, DIAG_READ_NON_EFFECT],
              },
              {
                warnings,
                side_effects: refreshEffects,
                next_actions: (data.run as AdsRunInfo | undefined)?.never_run ? adsIssueNextActions([], data.run as AdsRunInfo) : overviewNextActions(data.platforms),
              },
            );
          }

          if (diagPlatform === "google") {
            const params = new URLSearchParams({ platform: "google", days: String(days ?? 28) });
            for (const id of issue_ids ?? []) params.append("issue_ids[]", id);
            const res = await fetch(`http://127.0.0.1:${MAIN_SERVER_PORT}/api/diagnostics/ads?${params}`, { headers: internalHeaders(mcpToken, domain) });
            const data = (await res.json()) as Record<string, unknown>;
            if (!res.ok) return fail((data.error as string) || `Server error: ${res.status}`);
            const run = data.run as AdsRunInfo | undefined;
            const warnings: Warning[] = [
              ...refreshWarningsOut,
              ADS_DIAGNOSTICS_MODEL,
              ...adsRunWarnings(run),
              ...takeUtmWarnings(data),
              ...((Array.isArray(data.warnings) ? data.warnings : []) as Warning[]).filter(
                (w) => REFRESH_WARNING_CODES.has(w.code) || GOOGLE_STATUS_WARNING_CODES.has(w.code),
              ),
            ];
            if (since || until) {
              warnings.push({ code: "range_ignored_in_diagnostics", message: "since / until are ignored in diagnostics; use a report mode for a custom range." });
            }
            if (hasIdFilters || ads_limit != null || ads_offset != null) {
              warnings.push({
                code: "google_diagnostics_args_ignored",
                message: "Google diagnostics ignores id filters and ads_limit / ads_offset (no per-ad evidence lists yet). Use report modes with platform google to narrow by ids.",
              });
            }
            for (const id of (Array.isArray(data.missing_issue_ids) ? data.missing_issue_ids : []) as string[]) {
              warnings.push({ code: "issue_not_found", message: `Issue ${id} is not open in Google diagnostics (resolved, or wrong id / platform).` });
            }
            const issues = (Array.isArray(data.issues) ? data.issues : []) as ActionIssue[];
            const detail = (issue_ids?.length ?? 0) > 0;
            const googlePage = detail ? issues : slimAffectedAds(issues.slice(off, off + lim));
            return ok(
              {
                message: detail
                  ? `Google Ads diagnostics detail for ${issues.length} issue(s)`
                  : `Google Ads diagnostics (KPIs ${data.window_days}d, issues ${data.issue_window_days}d): ${String(data.status)}`,
                ...(data.status === "not_connected" ? { status_detail: "Google Ads not connected — see Settings → Ads → Google" } : {}),
                ...data,
                issues: googlePage,
                issues_total: issues.length,
                non_effects: [...NON_EFFECTS, DIAG_READ_NON_EFFECT],
              },
              {
                warnings,
                side_effects: refreshEffects,
                next_actions: [...refreshNextActions(data.refresh as RefreshStatus | undefined, "diagnostics", "google"), ...adsIssueNextActions(googlePage, run)],
              },
            );
          }

          const params = new URLSearchParams({ platform: "meta", days: String(days ?? 28) });
          for (const id of issue_ids ?? []) params.append("issue_ids[]", id);
          if (ads_limit != null) params.set("ads_limit", String(ads_limit));
          if (ads_offset != null) params.set("ads_offset", String(ads_offset));
          const filtered = appendIdFilters(params, { campaign_ids, adset_ids, ad_ids });
          const res = await fetch(`http://127.0.0.1:${MAIN_SERVER_PORT}/api/diagnostics/ads?${params}`, { headers: internalHeaders(mcpToken, domain) });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) return fail((data.error as string) || `Server error: ${res.status}`);
          refreshWarningsOut.push(...takeUtmWarnings(data));
          if (since || until) {
            refreshWarningsOut.push({
              code: "range_ignored_in_diagnostics",
              message: "since / until are ignored in diagnostics: issues always cover the last 28 days and KPIs follow days. Use a report mode (summary / campaigns / entries / destinations) for a custom range.",
            });
          }
          if (filtered) {
            refreshWarningsOut.push({
              code: "diagnostics_filtered",
              message:
                "Issues are narrowed to those touching the filtered campaign / ad set / ad ids (plus sync and setup issues with no ad scope); each issue's ads list and ads_total show matching ads only. KPIs, open_errors / open_warnings and status still cover every ad.",
            });
          }
          const refresh = data.refresh as RefreshStatus | undefined;
          const run = data.run as AdsRunInfo | undefined;
          refreshWarningsOut.push(ADS_DIAGNOSTICS_MODEL, ...adsRunWarnings(run));

          if (issue_ids && issue_ids.length > 0) {
            const detailIssues = (Array.isArray(data.issues) ? data.issues : []) as ActionIssue[];
            const missing = (Array.isArray(data.missing_issue_ids) ? data.missing_issue_ids : []) as string[];
            const filteredOut = (Array.isArray(data.filtered_out_issue_ids) ? data.filtered_out_issue_ids : []) as string[];
            const warnings: Warning[] = [
              ...refreshWarningsOut,
              ...missing.map((id) => ({
                code: "issue_not_found",
                message: `Issue ${id} is not open (resolved, or wrong id). Re-list with mode diagnostics.`,
              })),
              ...filteredOut.map((id) => ({
                code: "issue_filtered_out",
                message: `Issue ${id} is open but touches none of the filtered campaign / ad set / ad ids. Drop the id filters to see it.`,
              })),
              ...truncatedAds(detailIssues).map((t) => ({
                code: "ads_truncated",
                message: `${t.id}: showing ${t.shown} of ${t.total} ads with evidence; re-call with issue_ids [${t.id}] and ads_offset ${t.next_offset}. Evidence keeps the top 50 ads by spend; affected_ads lists every ad id.`,
              })),
              ...uncheckedWarnings(detailIssues),
            ];
            return ok(
              {
                message: `Ads diagnostics detail for ${detailIssues.length} issue(s) (issues ${data.issue_window_days}d)`,
                ...data,
                non_effects: [...NON_EFFECTS, DIAG_READ_NON_EFFECT],
              },
              { warnings, side_effects: refreshEffects, next_actions: [...refreshNextActions(refresh, "diagnostics"), ...adsIssueNextActions(detailIssues, run)] },
            );
          }

          const warnings: Warning[] = [
            ...refreshWarningsOut,
            ...((Array.isArray(data.warnings) ? data.warnings : []) as Warning[]).filter((w) => REFRESH_WARNING_CODES.has(w.code)),
          ];
          const allIssues = (Array.isArray(data.issues) ? data.issues : []) as ActionIssue[];
          const consentDrop = allIssues.find((i) => i.code === "consent_rate_drop");
          if (consentDrop) {
            warnings.push({
              code: "consent_rate_drop",
              message: `${consentDrop.why ?? "Ask-region accept rate dropped."} Consent breakdown is staff-only in Diagnostics → Legal.`,
            });
          }
          const issues = allIssues.filter((i) => i.code !== "consent_rate_drop");
          warnings.push(...uncheckedWarnings(issues));
          const page = slimAffectedAds(issues.slice(off, off + lim));
          const truncated = truncatedAds(page);
          if (truncated.length > 0) {
            warnings.push({
              code: "ads_truncated",
              message: `${truncated.length} issue(s) on this page list only their top ads by spend; pass issue_ids (≤${MAX_ISSUE_IDS}) for up to 50 each with evidence. affected_ads is capped at ${LIST_AFFECTED_ADS} ids here (affected_ads_total = all).`,
            });
          }
          const { consent: _consent, kpis: rawKpis, ...rest } = data as Record<string, unknown> & { kpis?: Record<string, unknown> };
          const { consent_accept_pct: _acceptPct, ...kpis } = rawKpis ?? {};
          return ok(
            {
              message: `Ads diagnostics (KPIs ${data.window_days}d, issues ${data.issue_window_days}d): ${String(data.status)}`,
              ...(data.status === "not_connected" ? { status_detail: "Meta not connected — only GA4/consent checks ran" } : {}),
              ...rest,
              kpis,
              issues: page,
              issues_total: issues.length,
              non_effects: [...NON_EFFECTS, DIAG_READ_NON_EFFECT],
            },
            {
              warnings,
              side_effects: refreshEffects,
              next_actions: [...refreshNextActions(refresh, "diagnostics"), ...adsIssueNextActions(page, run)],
            },
          );
        }

        const params = new URLSearchParams();
        if (days != null) params.set("days", String(days));
        if (platform) params.set("platform", platform);
        if (currency) params.set("currency", currency);
        if (account) params.set("account", account);
        if (content_type) params.set("content_type", content_type);
        if (model) params.set("model", model);
        if (split_by_version && mode === "entries") params.set("split_by_version", "1");
        if (since) params.set("since", since);
        if (until) params.set("until", until);
        appendIdFilters(params, { campaign_ids, adset_ids, ad_ids });
        const res = await fetch(`http://127.0.0.1:${MAIN_SERVER_PORT}/api/ads/report?${params}`, { headers: internalHeaders(mcpToken, domain) });
        const data = (await res.json()) as Report & { error?: string; code?: string };
        if (!res.ok) {
          if (data.code === "platform_required_for_ids") {
            return fail(data.error || "Pass platform meta or google with id filters when both are connected.", {
              code: data.code,
              hint: "Re-call with platform: \"meta\" or platform: \"google\" (ids are per platform).",
            });
          }
          return fail(data.error || `Server error: ${res.status}`);
        }

        const warnings: Warning[] = [...refreshWarningsOut, ...(data.warnings ?? []), ...accountSyncWarnings(data.meta.accounts)];
        const notConfigured = !data.meta.connected && !data.google?.connected && !data.ga4.configured;
        const next_actions: NextAction[] = notConfigured ? [] : refreshNextActions(data.refresh, mode);
        if (notConfigured) {
          next_actions.push({
            tool: "explain_site",
            priority: "recommended",
            reason: "Setup: Meta token + accounts and/or Google Ads BigQuery transfer, GA4 export",
            args_hint: { topic: "ads" },
          });
        }
        if (warnings.some((w) => w.code === "filter_no_match")) next_actions.push(NO_MATCH_NEXT_ACTION);

        const base = {
          ...(notConfigured ? { status: "not_configured" } : { status: "ok" }),
          window: data.window,
          platform: data.platform,
          attribution: data.attribution,
          covered_days: data.covered_days,
          ...(data.data_gaps ? { data_gaps: data.data_gaps } : {}),
          ...(data.filters && ID_FILTER_KEYS.some((k) => data.filters![k]?.length) ? { filters: data.filters } : {}),
          collecting_since: data.collecting_since,
          meta: data.meta,
          ...(data.google ? { google: data.google } : {}),
          ga4: data.ga4,
          refreshing: data.refreshing,
          refresh: data.refresh,
          thresholds: data.thresholds,
          non_effects: NON_EFFECTS,
        };
        const meta = { warnings, side_effects: refreshEffects, next_actions };

        if (mode === "summary") {
          const top = sortPages(data.pages, "spend")
            .slice(0, SUMMARY_TOP)
            .map(({ campaigns: _c, versions: _v, ...r }) => r);
          return ok(
            {
              message: "Paid traffic summary",
              ...base,
              totals: data.totals,
              ...(data.lead_conversions ? { lead_conversions: data.lead_conversions } : {}),
              pages_total: data.pages.length,
              destinations_total: data.destinations.length,
              campaigns_total: data.campaigns.length,
              top_pages: top,
              ...(data.meta_platforms ? { meta_platforms: data.meta_platforms } : {}),
              ...(data.google_networks ? { google_networks: data.google_networks } : {}),
              ...(data.url_changes?.length ? { url_changes: data.url_changes.slice(0, SUMMARY_URL_CHANGES), url_changes_total: data.url_changes_total ?? data.url_changes.length } : {}),
            },
            meta,
          );
        }

        if (mode === "campaigns") {
          return ok(
            {
              message: "Paid traffic by campaign",
              ...base,
              total: data.campaigns.length,
              offset: off,
              limit: lim,
              campaigns: data.campaigns.slice(off, off + lim),
            },
            meta,
          );
        }

        const source = mode === "destinations" ? data.destinations : data.pages;
        const sorted = sortPages(source, sort ?? "spend");
        const pageRows = sorted.slice(off, off + lim).map((r) => {
          const all = r.campaigns ?? [];
          if (group === "campaign" || mode === "destinations") return { ...r, campaigns: all.map(compactCampaignRef) };
          return { ...r, campaigns: topCampaigns(all).map(compactCampaignRef), campaigns_total: all.length };
        });
        return ok(
          {
            message: mode === "destinations" ? "Paid traffic to other destinations" : "Paid traffic by landing page",
            ...base,
            total: source.length,
            offset: off,
            limit: lim,
            has_more: off + lim < source.length,
            [mode === "destinations" ? "destinations" : "entries"]: pageRows,
          },
          meta,
        );
      } catch (e) {
        return fail(`get_paid_traffic failed: ${(e as Error).message}`);
      }
    },
  );
}
