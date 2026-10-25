/**
 * Ads (paid traffic) routes.
 *
 * Settings (ads_settings):
 *   GET/PUT /api/settings/ads/meta        — accounts, lead conversions, thresholds, known external campaigns, expected event pairs, test email patterns, sync status
 *   POST    /api/settings/ads/meta/known-campaigns — mark one campaign as known (idempotent append)
 *   GET     /api/ads/meta/conversions     — lead conversion picker options (?account_ids=a,b&picked=k1,k2 → per-account availability + overlap)
 *   POST    /api/ads/meta/lead-conversions/unpick — remove one pick (issue fix action; idempotent)
 *   POST    /api/ads/meta/expected-event-pairs    — mark two pixel events as meant to fire together (idempotent append)
 *   GET     /api/settings/ads/meta/accounts — ad accounts the token can read (picker options)
 *   POST    /api/settings/ads/meta/test   — probe token + accounts (read-only)
 *   POST    /api/ads/meta/sync            — Sync now / Load older history
 *   GET/PUT /api/settings/ads/google      — Google Ads accounts, BigQuery transfer dataset, lead conversion actions, sync status
 *   GET     /api/settings/ads/google/accounts — accounts found in the transfer dataset (picker options; manager-account sets expanded)
 *   POST    /api/settings/ads/google/test — probe the transfer dataset (read-only)
 *   GET     /api/settings/ads/google/setup — guided transfer setup checklist (read-only; ?project=&dataset=)
 *   POST    /api/ads/sync                 — Sync now for every connected platform (Meta, Google, GA4)
 * Live-ad edits (ads_edit, staff session only — MCP loopback is refused):
 *   POST /api/ads/meta/tracking-fix/preview — per-ad plan for a missing_tracking_params issue
 *   POST /api/ads/meta/tracking-fix/apply   — add missing URL parameters to the selected ads in Meta
 * Reads (metrics_view):
 *   GET /api/ads/report                   — paid pages / destinations / campaigns;
 *       since / until (≤90 days) and campaign_ids / adset_ids / ad_ids (≤20 each) narrow it
 *   GET /api/content-types/:type/ads-entries — Ads perspective for one content type
 *   GET /api/diagnostics/ads              — Diagnostics Ads (read-only: last Run / Re-check + saved 7/28/90 day windows);
 *       ?platform=meta (default) | google | overview; ?summary=1 = worst status (Global tab; platform=meta for Meta only);
 *       Meta: issue_ids (≤10) / ads_limit / ads_offset page each issue's stored ads (top 50; affected_ads lists all);
 *       campaign_ids / adset_ids / ad_ids keep issues touching those ads. Google: issue_ids only.
 *   POST /api/diagnostics/ads/run         — start a full Run (background; 409 when a Run or Sync is busy)
 *   POST /api/diagnostics/ads/recheck     — Re-check one issue or resource (instant or ready-to-confirm only)
 *   POST /api/diagnostics/ads/mark-fixed  — pending verification (MCP must send report); /undo reopens it
 *   GET /api/ads/leads, GET /api/ads/leads/stats, GET /api/ads/leads/:id — Leads page: newest-first page of 20 + KPIs / UTC timeline / breakdowns + one lead's details
 *   GET /api/ads/export, GET /api/ads/leads/export — snapshots for local "Download from production"
 * Dev only (metrics_view): /api/ads/pull-production(/origin), /api/ads/leads/pull-production
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { api } from "../rate-limit/api";
import { getDefaultContentFolder, getDefaultContentRoot } from "../site-config";
import { AdsConfigUnreadableError, getAdsConfigStatus, getAdsSettings, updateAdsSettings } from "../settings";
import { utmConventionView } from "../ads/utm-convention-view";
import { ADS_CONFIG_FILENAME } from "../ads-config";
import { markFileAsModified } from "../sync-state";
import { isMcpLoopbackRequest, requireCapability, resolveIssueActor } from "./_helpers";
import { child } from "../logger";
import {
  MAX_EXPECTED_EVENT_PAIRS,
  MAX_KNOWN_EXTERNAL_CAMPAIGNS,
  MAX_META_LEAD_CONVERSIONS,
  META_STANDARD_LEAD_KEY,
  metaUtmTemplate,
  isExpectedEventPair,
  isKnownExternalCampaign,
  normalizeAdAccountId,
  normalizeGoogleCustomerId,
  normalizeMetaLeadConversionKey,
  DEFAULT_UTM_CONVENTION,
  type UtmConvention,
} from "@shared/ads-settings";
import { LEAD_ID_PATTERN, LEADS_NONE, parseLeadsQuery, type LeadsLocalCopy } from "@shared/leads-query";
import { parseAttributionModel } from "@shared/paid-attribution";
import type { AdPlatform } from "@shared/paid-traffic";
import {
  GOOGLE_BACKFILL_DAYS,
  GOOGLE_CONVERSION_REFRESH_DAYS,
  GOOGLE_REFRESH_DAYS,
  GOOGLE_RETENTION_DAYS,
  GOOGLE_TRANSFER_LAG_DAYS,
  googleDataThrough,
  googleExpectedThrough,
  isGoogleConfiguredSettings,
  listGoogleDayDates,
  loadGoogleSetups,
  loadGoogleState,
} from "../ads/google-ads-days";
import { testGoogleTransfer } from "../ads/google-ads-bq";
import { checkGoogleSetup } from "../ads/google-ads-setup";
import { resolveBigQueryCredentials } from "../ecommerce/bigquery-client";
import {
  isMetaTokenConfigured,
  listMetaAdAccounts,
  MetaApiError,
  META_GRAPH_VERSION,
  testMetaConnection,
} from "../ads/meta-client";
import { listMetaDayDates, loadMetaState, META_BACKFILL_DAYS, META_REFRESH_DAYS, META_RETENTION_DAYS } from "../ads/meta-ads-days";
import { isGa4Configured, loadPaidLandingState } from "../ads/paid-detection";
import { getAdsRefreshStatus, hasMetaData, requestAdsRefresh } from "../ads/ads-refresh";
import { isRefreshActive } from "@shared/ads-refresh-status";
import { AdsPlatformRequiredError, AdsReportRangeError } from "../ads/ads-report";
import { assembleAdsReportFromRollups } from "../ads/ads-rollups";
import { loadTrackingParamsCoverage } from "../ads/ads-diagnostics";
import { adsOverviewSummary, buildAdsDiagnosticsOverview } from "../ads/ads-diagnostics-overview";
import {
  ADS_DETAIL_ADS_LIMIT,
  ADS_LIST_ADS_LIMIT,
  AdsIdFilterError,
  clampAdsLimit,
  clampAdsOffset,
  filterIssuesByIds,
  hasAdIdFilters,
  parseAdIdFilters,
  parseIssueIds,
  trimIssueAds,
} from "../ads/ads-query";
import { adsIssueCounts, readGoogleDiagnostics, readMetaDiagnostics } from "../ads/diagnostics/read";
import { adsValidationCache } from "../ads/diagnostics/save";
import { startAdsForkJob } from "../ads/diagnostics/fork-service";
import { requestAdsRecheck } from "../ads/diagnostics/recheck";
import { markAdsIssueFixed, undoAdsIssueFixed } from "../ads/diagnostics/actions";
import type { AdsCheckPlatform, AdsRecheckScope } from "@shared/ads-issues";
import { fetchAdsForFix, replaceAdUrlTags } from "../ads/meta-write";
import { listLeadConversionOptions } from "../ads/meta-conversion-options";
import { applyTrackingFix, previewTrackingFix, type TrackingFixDeps } from "../ads/tracking-fix";
import { TRACKING_FIX_MAX_ADS, TRACKING_FIX_REPLACE_CODES, trackingFixModeFor } from "@shared/ads-tracking-fix";
import type { AdsIssue, UtmGrace } from "@shared/ads-diagnostics-rules";

const log = child({ module: "routes/ads" });

const ADS_ISSUE_ID = /^ads:(meta|google|shared):[a-z0-9_]{1,60}:(account|campaign|adset|ad|none):[\w.-]{1,80}(:[\w.-]{1,80})?$/;

const TRACKING_FIX_ISSUE_ID = new RegExp(
  `^ads:meta:(missing_tracking_params|${Array.from(TRACKING_FIX_REPLACE_CODES).join("|")}):(campaign|adset|ad|account):\\d{1,30}$`,
);

const trackingFixSchema = z.object({
  issue_id: z.string().regex(TRACKING_FIX_ISSUE_ID),
});

const trackingFixApplySchema = trackingFixSchema.extend({
  ad_ids: z.array(z.string().regex(/^\d{1,30}$/)).min(1).max(TRACKING_FIX_MAX_ADS),
});

const adsIssueActionSchema = z.object({
  issue_id: z.string().regex(ADS_ISSUE_ID),
  report: z.string().max(2000).optional(),
  model: z.string().max(120).optional(),
});

const adsRecheckSchema = z.union([
  z.object({ issue_id: z.string().regex(ADS_ISSUE_ID) }),
  z.object({
    platform: z.enum(["meta", "google"]),
    level: z.enum(["account", "campaign", "adset", "ad"]),
    id: z.string().regex(/^[\w-]{1,40}$/),
  }),
]);

const adsRunSchema = z.object({ platforms: z.array(z.enum(["meta", "google"])).min(1).max(2).optional() });

/**
 * The open issue Fix via Meta can act on (evidence keeps up to 50 ads): missing tracking params,
 * or a utm_* issue with Meta ads behind it (GA4-only / Google evidence gets no fix).
 */
function findTrackingIssue(site: string, issueId: string): AdsIssue | null {
  const issue = adsValidationCache(site)?.getIssueById(issueId);
  const mode = issue ? trackingFixModeFor(issue.code) : null;
  if (!issue?.ads || !mode) return null;
  if (mode === "replace" && (issue.ads.platform !== "meta" || (issue.ads.evidence.details?.ads?.length ?? 0) === 0)) return null;
  return { ...issue.ads.evidence, id: issue.id };
}

function isBadReportQuery(err: unknown): err is Error {
  return err instanceof AdsReportRangeError || err instanceof AdsIdFilterError;
}

function badQueryBody(err: Error): { error: string; code?: string } {
  return err instanceof AdsPlatformRequiredError ? { error: err.message, code: err.code } : { error: err.message };
}

const PLATFORMS: Array<AdPlatform | "all"> = ["all", "meta", "google", "microsoft", "tiktok", "linkedin", "x", "snapchat", "pinterest", "other"];

/** Save failures: 409 when ads-config.yml can't be parsed (nothing was written), else 400. */
function sendSaveError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof AdsConfigUnreadableError) {
    res.status(409).json({ code: err.code, error: err.message });
    return;
  }
  res.status(400).json({ error: err instanceof Error ? err.message : fallback });
}

function getContentRoot(res: Response): string {
  return (res.locals.site as { contentRoot?: string } | undefined)?.contentRoot ?? getDefaultContentRoot();
}

function getSite(res: Response): string {
  return (res.locals.site as { contentRootName?: string } | undefined)?.contentRootName ?? getDefaultContentFolder();
}

function settingsPayload(res: Response) {
  const contentRoot = getContentRoot(res);
  const site = getSite(res);
  const ads = getAdsSettings(contentRoot);
  const state = loadMetaState(site);
  const days = listMetaDayDates(site);
  const ga4 = loadPaidLandingState(site);
  const refresh = getAdsRefreshStatus(site);
  const trackingParams = hasMetaData(site, contentRoot) ? loadTrackingParamsCoverage(site, ads.meta.ad_account_ids) : null;
  const utm = utmConventionView(site, ads, contentRoot);
  return {
    ads,
    token_configured: isMetaTokenConfigured(),
    api_version: META_GRAPH_VERSION,
    utm_template: utm.meta_template,
    utm_convention: utm,
    config_status: getAdsConfigStatus(contentRoot),
    tracking_params: trackingParams,
    refreshing: isRefreshActive(refresh),
    refresh,
    sync: {
      last_success_at: state.last_success_at ?? null,
      last_attempt_at: state.last_attempt_at ?? null,
      last_error: state.last_error ?? null,
      last_error_kind: state.last_error_kind ?? null,
      consecutive_failures: state.consecutive_failures ?? 0,
      history_since: days[0] ?? null,
      history_until: days[days.length - 1] ?? null,
      accounts: state.accounts,
      pulled_from_production_at: state.pulled_from_production_at ?? null,
      production_origin: state.production_origin ?? null,
      snapshot_last_date: state.snapshot_last_date ?? null,
      backup_pushed_at: state.backup_pushed_at ?? null,
      backup_error: state.backup_error ?? null,
    },
    ga4: {
      configured: isGa4Configured(contentRoot),
      last_success_at: ga4.last_success_at ?? null,
      last_export_date: ga4.last_export_date ?? null,
      last_error: ga4.last_error ?? null,
    },
    policy: {
      refresh_days: META_REFRESH_DAYS,
      backfill_days: META_BACKFILL_DAYS,
      retention_days: META_RETENTION_DAYS,
      cache_dir: `.cache/${site}/meta-ads-days`,
    },
  };
}

const thresholdsSchema = z
  .object({
    severity_spend_share_pct: z.number().min(0).max(100),
    severity_spend_floor: z.record(z.string().regex(/^[A-Za-z]{3}$/), z.number().min(0)),
    clicks_visits_drop_pct: z.number().min(0).max(100),
    clicks_visits_floor_pct: z.number().min(0).max(100),
    ratio_min_clicks: z.number().int().min(1),
    unclear_share_pct: z.number().min(0).max(100),
    unclear_min_sessions: z.number().int().min(1),
    ga4_ledger_gap_widen_pts: z.number().min(0).max(100),
    ga4_ledger_gap_bootstrap_pct: z.number().min(0).max(100),
    zero_visits_complete_days: z.number().int().min(1).max(30),
    min_paid_visits_for_rates: z.number().int().min(1),
    unrecognized_campaign_min_visits: z.number().int().min(1),
    unrecognized_campaign_error_visits: z.number().int().min(1),
    unrecognized_campaign_error_share_pct: z.number().min(0).max(100),
    unrecognized_campaign_share_min_visits: z.number().int().min(1),
    conversion_overlap_days_pct: z.number().min(0).max(100),
    conversion_overlap_count_pct: z.number().min(0).max(100),
    lockstep_min_events: z.number().int().min(1),
    lockstep_count_pct: z.number().min(0).max(100),
    tracking_tagged_min_sessions: z.number().int().min(1),
    tracking_missing_min_clicks: z.number().int().min(1),
    tracking_missing_max_visit_pct: z.number().min(0).max(100),
    tracking_check_days: z.number().int().min(3).max(28),
    utm_issue_min_visits: z.number().int().min(1),
    utm_issue_error_visits: z.number().int().min(1),
  })
  .partial();

const leadConversionKeySchema = z.union([z.string().trim().max(60), z.number()]);

const expectedEventPairSchema = z.object({
  pixel_id: z.string().trim().regex(/^\d{5,25}$/),
  events: z.tuple([z.string().trim().min(1).max(100), z.string().trim().min(1).max(100)]),
  note: z.string().trim().max(200).optional(),
});

const knownCampaignSchema = z.object({
  key: z.string().trim().min(1).max(200),
  note: z.string().trim().max(200).optional(),
});

const googleUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  customer_ids: z.array(z.union([z.string(), z.number()])).max(50).optional(),
  bigquery: z
    .object({
      project: z.string().trim().max(64).nullable().optional(),
      dataset: z.string().trim().max(1024).nullable().optional(),
    })
    .optional(),
  lead_conversion_actions: z.array(z.string().trim().max(200)).max(50).optional(),
  known_external_campaigns: z.array(knownCampaignSchema).max(MAX_KNOWN_EXTERNAL_CAMPAIGNS).optional(),
});

const googleProbeSchema = z.object({
  project: z.string().trim().regex(/^[a-z][a-z0-9-]{4,62}$/, "GCP project ids are lowercase letters, digits and dashes"),
  dataset: z.string().trim().regex(/^[A-Za-z0-9_]{1,1024}$/, "Dataset ids are letters, digits and underscores"),
});

function googleSettingsPayload(res: Response) {
  const contentRoot = getContentRoot(res);
  const site = getSite(res);
  const ads = getAdsSettings(contentRoot);
  const state = loadGoogleState(site);
  const setups = loadGoogleSetups(site);
  const days = listGoogleDayDates(site);
  const refresh = getAdsRefreshStatus(site);
  const ticked = new Set(ads.google.customer_ids);
  const utm = utmConventionView(site, ads, contentRoot);
  return {
    google: ads.google,
    configured: isGoogleConfiguredSettings(ads.google),
    credentials_source: resolveBigQueryCredentials().source,
    url_suffix_template: utm.google_template,
    utm_convention: utm,
    refreshing: isRefreshActive(refresh),
    refresh,
    sync: {
      last_success_at: state.last_success_at ?? null,
      last_attempt_at: state.last_attempt_at ?? null,
      last_error: state.last_error ?? null,
      consecutive_failures: state.consecutive_failures ?? 0,
      data_through: googleDataThrough(state, ads.google.customer_ids),
      expected_through: googleExpectedThrough(),
      history_since: days[0] ?? null,
      history_until: days[days.length - 1] ?? null,
      customers: state.customers,
      available_customers: state.available_customers ?? [],
      unticked_customers: (state.available_customers ?? []).filter((id) => !ticked.has(id)),
      manager_customers: state.manager_customers ?? {},
    },
    conversion_actions: setups.conversion_actions,
    policy: {
      refresh_days: GOOGLE_REFRESH_DAYS,
      conversion_refresh_days: GOOGLE_CONVERSION_REFRESH_DAYS,
      backfill_days: GOOGLE_BACKFILL_DAYS,
      retention_days: GOOGLE_RETENTION_DAYS,
      transfer_lag_days: GOOGLE_TRANSFER_LAG_DAYS,
      cache_dir: `.cache/${site}/google-ads-days`,
    },
  };
}

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  ad_account_ids: z.array(z.union([z.string(), z.number()])).max(50).optional(),
  alert_thresholds: thresholdsSchema.optional(),
  known_external_campaigns: z.array(knownCampaignSchema).max(MAX_KNOWN_EXTERNAL_CAMPAIGNS).optional(),
  lead_conversions: z.array(leadConversionKeySchema).max(MAX_META_LEAD_CONVERSIONS).optional(),
  expected_event_pairs: z.array(expectedEventPairSchema).max(MAX_EXPECTED_EVENT_PAIRS).optional(),
  test_email_patterns: z.array(z.string().max(200)).max(100).optional(),
});

function parseReportQuery(req: Request) {
  const q = req.query as Record<string, unknown>;
  const platformRaw = typeof q.platform === "string" ? q.platform : "all";
  const platform = (PLATFORMS as string[]).includes(platformRaw) ? (platformRaw as AdPlatform | "all") : "all";
  const day = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    days: q.days != null && q.days !== "" ? Number(q.days) || 28 : undefined,
    since: day(q.since),
    until: day(q.until),
    ...parseAdIdFilters(q),
    platform,
    currency: typeof q.currency === "string" && /^[A-Za-z]{3}$/.test(q.currency) ? q.currency.toUpperCase() : null,
    account: typeof q.account === "string" ? (q.account.includes("-") ? normalizeGoogleCustomerId(q.account) : normalizeAdAccountId(q.account)) : null,
    content_type: typeof q.content_type === "string" && q.content_type.trim() ? q.content_type.trim() : null,
    model: parseAttributionModel(q.model),
    split_by_version: q.split_by_version === "1" || q.split_by_version === "true",
  };
}

export function registerAdsRoutes(app: Express): void {
  api.get(app, "/api/settings/ads/meta", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    try {
      res.json(settingsPayload(res));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load Ads settings" });
    }
  });

  api.put(app, "/api/settings/ads/meta", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    const parsed = updateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const invalidIds = (parsed.data.ad_account_ids ?? []).filter((id) => !normalizeAdAccountId(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ error: `Invalid ad account id(s): ${invalidIds.join(", ")}. Use the numeric id (with or without act_).` });
    }
    const invalidConversions = (parsed.data.lead_conversions ?? []).filter((k) => !normalizeMetaLeadConversionKey(k));
    if (invalidConversions.length > 0) {
      return res.status(400).json({
        error: `Invalid lead conversion(s): ${invalidConversions.join(", ")}. Use "${META_STANDARD_LEAD_KEY}" or a numeric custom conversion id.`,
      });
    }
    try {
      const contentRoot = getContentRoot(res);
      const site = getSite(res);
      const before = getAdsSettings(contentRoot).meta;
      const next = updateAdsSettings(
        {
          meta: {
            enabled: parsed.data.enabled,
            ad_account_ids: parsed.data.ad_account_ids?.map((id) => normalizeAdAccountId(id)!),
            alert_thresholds: parsed.data.alert_thresholds,
            known_external_campaigns: parsed.data.known_external_campaigns,
            lead_conversions: parsed.data.lead_conversions?.map((k) => normalizeMetaLeadConversionKey(k)!),
            expected_event_pairs: parsed.data.expected_event_pairs,
          },
          test_email_patterns: parsed.data.test_email_patterns,
        },
        contentRoot,
      );
      markFileAsModified(ADS_CONFIG_FILENAME, undefined, undefined, contentRoot);
      const newAccounts = next.meta.ad_account_ids.filter((id) => !before.ad_account_ids.includes(id));
      const justEnabled = next.meta.enabled && !before.enabled;
      let sync_requested = false;
      if (next.meta.enabled && next.meta.ad_account_ids.length > 0 && isMetaTokenConfigured() && (justEnabled || newAccounts.length > 0)) {
        const mode = listMetaDayDates(site).length > 0 && newAccounts.length === 0 ? "refresh" : "backfill";
        sync_requested = isRefreshActive(await requestAdsRefresh(site, contentRoot, mode, { manual: true }));
      }
      res.json({ success: true, sync_requested, ...settingsPayload(res) });
    } catch (err) {
      log.warn({ err }, "[ads] failed to save settings");
      sendSaveError(res, err, "Failed to save Ads settings");
    }
  });

  api.post(app, "/api/settings/ads/meta/known-campaigns", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    const parsed = knownCampaignSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    try {
      const contentRoot = getContentRoot(res);
      const current = getAdsSettings(contentRoot).meta.known_external_campaigns;
      if (isKnownExternalCampaign(current, parsed.data.key)) {
        return res.json({ success: true, already_known: true, known_external_campaigns: current });
      }
      if (current.length >= MAX_KNOWN_EXTERNAL_CAMPAIGNS) {
        return res.status(400).json({ error: `Known external campaigns is full (${MAX_KNOWN_EXTERNAL_CAMPAIGNS}). Remove one in Settings → Ads first.` });
      }
      const entry = parsed.data.note ? { key: parsed.data.key, note: parsed.data.note } : { key: parsed.data.key };
      const next = updateAdsSettings({ meta: { known_external_campaigns: [...current, entry] } }, contentRoot);
      markFileAsModified(ADS_CONFIG_FILENAME, undefined, undefined, contentRoot);
      res.json({ success: true, already_known: false, known_external_campaigns: next.meta.known_external_campaigns });
    } catch (err) {
      log.warn({ err }, "[ads] failed to add known external campaign");
      sendSaveError(res, err, "Failed to save known campaign");
    }
  });

  api.get(app, "/api/ads/meta/conversions", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    const q = req.query as Record<string, unknown>;
    const list = (v: unknown) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);
    const contentRoot = getContentRoot(res);
    const settings = getAdsSettings(contentRoot);
    const rawIds = list(q.account_ids);
    const accountIds = rawIds
      ? rawIds.map(normalizeAdAccountId).filter((x): x is string => !!x).slice(0, 50)
      : settings.meta.ad_account_ids;
    const rawPicked = list(q.picked);
    const picked = rawPicked
      ? rawPicked.map(normalizeMetaLeadConversionKey).filter((x): x is string => !!x).slice(0, MAX_META_LEAD_CONVERSIONS)
      : undefined;
    try {
      res.json(await listLeadConversionOptions({ site: getSite(res), settings, accountIds, picked }));
    } catch (err) {
      log.warn({ err }, "[ads] failed to list Meta conversions");
      res.status(500).json({ error: err instanceof Error ? err.message : "Could not list Meta conversions" });
    }
  });

  api.post(app, "/api/ads/meta/lead-conversions/unpick", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    const key = normalizeMetaLeadConversionKey((req.body ?? {}).key);
    if (!key) {
      return res.status(400).json({ error: `Invalid lead conversion. Use "${META_STANDARD_LEAD_KEY}" or a numeric custom conversion id.` });
    }
    try {
      const contentRoot = getContentRoot(res);
      const current = getAdsSettings(contentRoot).meta.lead_conversions;
      if (!current.includes(key)) return res.json({ success: true, already_unpicked: true, lead_conversions: current });
      const next = updateAdsSettings({ meta: { lead_conversions: current.filter((k) => k !== key) } }, contentRoot);
      markFileAsModified(ADS_CONFIG_FILENAME, undefined, undefined, contentRoot);
      res.json({
        success: true,
        already_unpicked: false,
        lead_conversions: next.meta.lead_conversions,
        lead_conversions_changed_at: next.meta.lead_conversions_changed_at,
      });
    } catch (err) {
      log.warn({ err }, "[ads] failed to unpick lead conversion");
      sendSaveError(res, err, "Failed to unpick lead conversion");
    }
  });

  api.post(app, "/api/ads/meta/expected-event-pairs", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    const parsed = expectedEventPairSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const { pixel_id, note } = parsed.data;
    const [a, b] = parsed.data.events;
    if (a === b) return res.status(400).json({ error: "Pick two different events." });
    try {
      const contentRoot = getContentRoot(res);
      const current = getAdsSettings(contentRoot).meta.expected_event_pairs;
      if (isExpectedEventPair(current, pixel_id, a, b)) {
        return res.json({ success: true, already_expected: true, expected_event_pairs: current });
      }
      if (current.length >= MAX_EXPECTED_EVENT_PAIRS) {
        return res.status(400).json({ error: `Expected event pairs is full (${MAX_EXPECTED_EVENT_PAIRS}). Remove one in Settings → Ads first.` });
      }
      const events = [a, b].sort() as [string, string];
      const entry = note ? { pixel_id, events, note } : { pixel_id, events };
      const next = updateAdsSettings({ meta: { expected_event_pairs: [...current, entry] } }, contentRoot);
      markFileAsModified(ADS_CONFIG_FILENAME, undefined, undefined, contentRoot);
      res.json({ success: true, already_expected: false, expected_event_pairs: next.meta.expected_event_pairs });
    } catch (err) {
      log.warn({ err }, "[ads] failed to add expected event pair");
      sendSaveError(res, err, "Failed to save expected event pair");
    }
  });

  api.get(app, "/api/settings/ads/meta/accounts", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    if (!isMetaTokenConfigured()) return res.json({ token_configured: false, accounts: [] });
    try {
      res.json({ token_configured: true, accounts: await listMetaAdAccounts() });
    } catch (err) {
      log.warn({ err }, "[ads] failed to list Meta ad accounts");
      res.json({
        token_configured: true,
        accounts: [],
        error: err instanceof Error ? err.message : "Could not list ad accounts",
        error_kind: err instanceof MetaApiError ? err.kind : "other",
      });
    }
  });

  api.post(app, "/api/settings/ads/meta/test", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    const body = (req.body ?? {}) as { ad_account_ids?: unknown };
    const ids = Array.isArray(body.ad_account_ids)
      ? body.ad_account_ids.map(normalizeAdAccountId).filter((x): x is string => !!x)
      : getAdsSettings(getContentRoot(res)).meta.ad_account_ids;
    try {
      res.json(await testMetaConnection(ids));
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Connection test failed" });
    }
  });

  api.post(app, "/api/ads/meta/sync", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    const mode = (req.body as { mode?: unknown } | undefined)?.mode === "older" ? "older" : "refresh";
    const site = getSite(res);
    const contentRoot = getContentRoot(res);
    const meta = getAdsSettings(contentRoot).meta;
    if (mode === "older" && (!meta.enabled || meta.ad_account_ids.length === 0 || !isMetaTokenConfigured())) {
      return res.status(400).json({ error: "Connect Meta (token + at least one enabled ad account) before loading history." });
    }
    const refresh = await requestAdsRefresh(site, contentRoot, mode, { manual: true });
    res.json({ success: true, requested: isRefreshActive(refresh), mode, refreshing: isRefreshActive(refresh), refresh });
  });

  api.post(app, "/api/ads/sync", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    const refresh = await requestAdsRefresh(getSite(res), getContentRoot(res), "refresh", { manual: true });
    res.json({ success: true, requested: isRefreshActive(refresh), mode: "refresh", refreshing: isRefreshActive(refresh), refresh });
  });

  api.get(app, "/api/settings/ads/google", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    try {
      res.json(googleSettingsPayload(res));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load Google Ads settings" });
    }
  });

  api.put(app, "/api/settings/ads/google", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    const parsed = googleUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const invalidIds = (parsed.data.customer_ids ?? []).filter((id) => !normalizeGoogleCustomerId(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ error: `Invalid Google Ads customer id(s): ${invalidIds.join(", ")}. Use the 10-digit id (123-456-7890).` });
    }
    const bq = parsed.data.bigquery;
    if (bq?.project && !/^[a-z][a-z0-9-]{4,62}$/.test(bq.project)) return res.status(400).json({ error: "Invalid GCP project id." });
    if (bq?.dataset && !/^[A-Za-z0-9_]{1,1024}$/.test(bq.dataset)) return res.status(400).json({ error: "Invalid BigQuery dataset id." });
    try {
      const contentRoot = getContentRoot(res);
      const site = getSite(res);
      const before = getAdsSettings(contentRoot).google;
      const next = updateAdsSettings(
        {
          google: {
            enabled: parsed.data.enabled,
            customer_ids: parsed.data.customer_ids?.map((id) => normalizeGoogleCustomerId(id)!),
            bigquery: bq ? { project: bq.project || null, dataset: bq.dataset || null } : undefined,
            lead_conversion_actions: parsed.data.lead_conversion_actions,
            known_external_campaigns: parsed.data.known_external_campaigns,
          },
        },
        contentRoot,
      );
      markFileAsModified(ADS_CONFIG_FILENAME, undefined, undefined, contentRoot);
      const g = next.google;
      const newAccounts = g.customer_ids.filter((id) => !before.customer_ids.includes(id));
      const datasetChanged = g.bigquery.project !== before.bigquery.project || g.bigquery.dataset !== before.bigquery.dataset;
      let sync_requested = false;
      if (isGoogleConfiguredSettings(g) && ((g.enabled && !before.enabled) || newAccounts.length > 0 || datasetChanged)) {
        sync_requested = isRefreshActive(await requestAdsRefresh(site, contentRoot, "refresh", { manual: true }));
      }
      res.json({ success: true, sync_requested, ...googleSettingsPayload(res) });
    } catch (err) {
      log.warn({ err }, "[ads] failed to save Google Ads settings");
      sendSaveError(res, err, "Failed to save Google Ads settings");
    }
  });

  api.get(app, "/api/settings/ads/google/accounts", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    const saved = getAdsSettings(getContentRoot(res)).google.bigquery;
    const parsed = googleProbeSchema.safeParse({ project: req.query.project ?? saved.project ?? "", dataset: req.query.dataset ?? saved.dataset ?? "" });
    if (!parsed.success) return res.json({ configured: false, accounts: [], error: "Set the BigQuery project and dataset first." });
    const result = await testGoogleTransfer(parsed.data.project, parsed.data.dataset);
    res.json({
      configured: true,
      accounts: result.customers,
      managers: result.managers ?? {},
      ...(result.ok ? {} : { error: result.error, error_kind: result.error_kind }),
    });
  });

  api.get(app, "/api/settings/ads/google/setup", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    const q = req.query as { project?: unknown; dataset?: unknown };
    const project = typeof q.project === "string" && q.project.trim() ? q.project.trim() : null;
    const dataset = typeof q.dataset === "string" && q.dataset.trim() ? q.dataset.trim() : null;
    if (project && !googleProbeSchema.shape.project.safeParse(project).success) {
      return res.status(400).json({ error: "GCP project ids are lowercase letters, digits and dashes" });
    }
    if (dataset && !googleProbeSchema.shape.dataset.safeParse(dataset).success) {
      return res.status(400).json({ error: "Dataset ids are letters, digits and underscores" });
    }
    try {
      const contentRoot = getContentRoot(res);
      res.json(
        await checkGoogleSetup({
          contentRoot,
          project,
          dataset,
          savedGoogle: getAdsSettings(contentRoot).google,
          backfillDays: GOOGLE_BACKFILL_DAYS,
        }),
      );
    } catch (err) {
      log.warn({ err }, "[ads] google setup check failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Setup check failed" });
    }
  });

  api.post(app, "/api/settings/ads/google/test", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "ads_settings");
    if (!auth.authorized) return;
    const saved = getAdsSettings(getContentRoot(res)).google;
    const body = (req.body ?? {}) as { project?: unknown; dataset?: unknown; customer_ids?: unknown };
    const parsed = googleProbeSchema.safeParse({ project: body.project ?? saved.bigquery.project ?? "", dataset: body.dataset ?? saved.bigquery.dataset ?? "" });
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Set the BigQuery project and dataset." });
    const wanted = Array.isArray(body.customer_ids)
      ? body.customer_ids.map(normalizeGoogleCustomerId).filter((x): x is string => !!x)
      : saved.customer_ids;
    const result = await testGoogleTransfer(parsed.data.project, parsed.data.dataset);
    const found = new Set(result.customers.map((c) => c.id));
    const managers = result.managers ?? {};
    res.json({
      ...result,
      missing_customers: result.ok ? wanted.filter((id) => !found.has(id) && !managers[id]) : [],
      ticked_managers: result.ok ? wanted.filter((id) => !!managers[id]) : [],
    });
  });

  api.get(app, "/api/ads/report", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    try {
      const q = parseReportQuery(req);
      const report = await assembleAdsReportFromRollups({ site: getSite(res), contentRoot: getContentRoot(res), ...q });
      res.json(report);
    } catch (err) {
      if (isBadReportQuery(err)) return res.status(400).json(badQueryBody(err));
      log.warn({ err }, "[ads] report failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to build Ads report" });
    }
  });

  api.get(app, "/api/content-types/:type/ads-entries", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    try {
      const q = parseReportQuery(req);
      const report = await assembleAdsReportFromRollups({
        site: getSite(res),
        contentRoot: getContentRoot(res),
        ...q,
        content_type: req.params.type,
        includeMetaPlatforms: false,
      });
      const locale = typeof req.query.locale === "string" && req.query.locale.trim() ? req.query.locale.trim() : null;
      const search = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
      const entries = report.pages.filter(
        (p) =>
          (!locale || p.locale === locale) &&
          (!search || (p.slug ?? "").toLowerCase().includes(search) || p.title.toLowerCase().includes(search) || p.path.toLowerCase().includes(search)),
      );
      res.json({
        entries,
        window: report.window,
        platform: report.platform,
        attribution: report.attribution,
        meta: report.meta,
        ga4: report.ga4,
        refreshing: report.refreshing,
        refresh: report.refresh,
        covered_days: report.covered_days,
        consent: report.consent,
        thresholds: { min_paid_visits_for_rates: report.thresholds.min_paid_visits_for_rates },
        warnings: report.warnings,
      });
    } catch (err) {
      if (isBadReportQuery(err)) return res.status(400).json(badQueryBody(err));
      log.warn({ err }, "[ads] ads-entries failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load Ads entries" });
    }
  });

  api.get(app, "/api/diagnostics/ads", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    try {
      const site = getSite(res);
      const contentRoot = getContentRoot(res);
      const platformParam = typeof req.query.platform === "string" ? req.query.platform : "meta";
      if (!["meta", "google", "overview"].includes(platformParam)) {
        return res.status(400).json({ error: "platform must be meta, google or overview" });
      }
      if (req.query.summary === "1") {
        if (req.query.platform === "meta") {
          const c = adsIssueCounts(site, ["meta", "shared"]);
          const connected = hasMetaData(site, contentRoot);
          return res.json({
            status: !connected ? "not_connected" : c.open_errors > 0 ? "errors" : c.open_warnings > 0 ? "warnings" : "ok",
            open_errors: c.open_errors,
            open_warnings: c.open_warnings,
            never_run: c.run.never_run,
          });
        }
        return res.json(adsOverviewSummary(site, contentRoot));
      }
      if (platformParam === "overview") {
        return res.json(await buildAdsDiagnosticsOverview({ site, contentRoot, days: req.query.days }));
      }
      const issueIds = parseIssueIds(req.query.issue_ids);
      const detail = issueIds.length > 0;
      if (platformParam === "google") {
        const d = await readGoogleDiagnostics({ site, contentRoot, days: req.query.days });
        if (!detail) return res.json(d);
        const wanted = new Set(issueIds);
        return res.json({
          generated_at: d.generated_at,
          platform: "google",
          issue_window_days: d.issue_window_days,
          status: d.status,
          refreshing: d.refreshing,
          refresh: d.refresh,
          url_suffix_template: d.url_suffix_template,
          utm_warnings: d.utm_warnings,
          run: d.run,
          issues: d.issues.filter((i) => wanted.has(i.id)),
          missing_issue_ids: issueIds.filter((id) => !d.issues.some((i) => i.id === id)),
        });
      }
      const idFilters = parseAdIdFilters(req.query as Record<string, unknown>);
      const filtersEcho = hasAdIdFilters(idFilters)
        ? { filters: { campaign_ids: idFilters.campaign_ids ?? [], adset_ids: idFilters.adset_ids ?? [], ad_ids: idFilters.ad_ids ?? [] } }
        : {};
      const adsLimit = clampAdsLimit(req.query.ads_limit, detail ? ADS_DETAIL_ADS_LIMIT : ADS_LIST_ADS_LIMIT);
      const adsOffset = clampAdsOffset(req.query.ads_offset);
      const d = await readMetaDiagnostics({ site, contentRoot, days: req.query.days });
      const issues = filterIssuesByIds(d.issues, idFilters);
      if (!detail) {
        return res.json({ ...d, issues: trimIssueAds(issues, adsLimit, adsOffset), ...filtersEcho });
      }
      const wanted = new Set(issueIds);
      const found = issues.filter((i) => wanted.has(i.id));
      const filteredOut = d.issues.filter((i) => wanted.has(i.id) && !found.some((f) => f.id === i.id)).map((i) => i.id);
      res.json({
        generated_at: d.generated_at,
        issue_window_days: d.issue_window_days,
        status: d.status,
        refreshing: d.refreshing,
        refresh: d.refresh,
        utm_template: d.utm_template,
        utm_warnings: d.utm_warnings,
        run: d.run,
        issues: trimIssueAds(found, adsLimit, adsOffset),
        missing_issue_ids: issueIds.filter((id) => !found.some((i) => i.id === id) && !filteredOut.includes(id)),
        ...(filteredOut.length > 0 ? { filtered_out_issue_ids: filteredOut } : {}),
        ...filtersEcho,
      });
    } catch (err) {
      if (isBadReportQuery(err)) return res.status(400).json(badQueryBody(err));
      log.warn({ err }, "[ads] diagnostics failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read Ads diagnostics" });
    }
  });

  api.post(app, "/api/diagnostics/ads/run", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const parsed = adsRunSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    const site = getSite(res);
    const platforms: AdsCheckPlatform[] = parsed.data.platforms ?? ["meta", "google"];
    const started = startAdsForkJob({ site, contentRoot: getContentRoot(res), kind: "run", mode: "full", platforms, requestedBy: auth.username ?? null });
    if (!started.ok) return res.status(409).json({ error: started.message, code: started.code, active_job_id: started.active_job_id ?? null });
    res.status(202).json({ job_id: started.job.job_id, status: started.job.status, lane: "fork" });
  });

  api.post(app, "/api/diagnostics/ads/recheck", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const parsed = adsRecheckSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    const scope: AdsRecheckScope =
      "issue_id" in parsed.data
        ? { type: "issue", issue_id: parsed.data.issue_id }
        : { type: "resource", platform: parsed.data.platform, level: parsed.data.level, id: parsed.data.id };
    const out = requestAdsRecheck({ site: getSite(res), contentRoot: getContentRoot(res), scope, requestedBy: auth.username ?? null });
    if (!out.ok) return res.status(out.status).json({ error: out.message, code: out.code });
    res.status(202).json({ job_id: out.job_id, lane: out.lane, coalesced: out.coalesced ?? false });
  });

  api.post(app, "/api/diagnostics/ads/mark-fixed", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const parsed = adsIssueActionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    const out = await markAdsIssueFixed({
      site: getSite(res),
      issueId: parsed.data.issue_id,
      by: auth.username ?? "staff",
      actor: resolveIssueActor(req, { model: parsed.data.model }),
      report: parsed.data.report,
    });
    if (!out.ok) return res.status(out.status).json({ error: out.message, code: out.code });
    res.json(out);
  });

  api.post(app, "/api/diagnostics/ads/undo", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const parsed = adsIssueActionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    const out = await undoAdsIssueFixed({ site: getSite(res), issueId: parsed.data.issue_id });
    if (!out.ok) return res.status(out.status).json({ error: out.message, code: out.code });
    res.json(out);
  });

  const trackingFixDeps = (site: string, contentRoot: string): TrackingFixDeps => ({
    writeConfigured: isMetaTokenConfigured,
    fetchAds: fetchAdsForFix,
    replace: replaceAdUrlTags,
    requestRefresh: async () => isRefreshActive(await requestAdsRefresh(site, contentRoot, "refresh", { manual: true })),
    template: metaUtmTemplate(getAdsSettings(contentRoot).utm_convention),
  });

  api.post(app, "/api/ads/meta/tracking-fix/preview", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    if (isMcpLoopbackRequest(req)) return res.status(403).json({ error: "Live-ad edits are staff UI only." });
    const auth = await requireCapability(req, res, "ads_edit");
    if (!auth.authorized) return;
    const parsed = trackingFixSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    try {
      const site = getSite(res);
      const contentRoot = getContentRoot(res);
      const issue = findTrackingIssue(site, parsed.data.issue_id);
      if (!issue) return res.status(404).json({ error: "This issue is no longer open. Reload the Ads tab." });
      res.json(await previewTrackingFix(issue, trackingFixDeps(site, contentRoot)));
    } catch (err) {
      log.warn({ err }, "[ads] tracking-fix preview failed");
      const status = err instanceof MetaApiError && (err.kind === "auth" || err.kind === "permission") ? 502 : 500;
      res.status(status).json({
        error: err instanceof Error ? err.message : "Failed to read ads from Meta",
        ...(err instanceof MetaApiError ? { error_kind: err.kind } : {}),
      });
    }
  });

  api.post(app, "/api/ads/meta/tracking-fix/apply", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    if (isMcpLoopbackRequest(req)) return res.status(403).json({ error: "Live-ad edits are staff UI only." });
    const auth = await requireCapability(req, res, "ads_edit");
    if (!auth.authorized) return;
    const parsed = trackingFixApplySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    if (!isMetaTokenConfigured()) {
      return res.status(409).json({ error: "Meta isn't connected on this server. Ask an admin to add the Meta access token." });
    }
    try {
      const site = getSite(res);
      const contentRoot = getContentRoot(res);
      const issue = findTrackingIssue(site, parsed.data.issue_id);
      if (!issue) return res.status(404).json({ error: "This issue is no longer open. Reload the Ads tab." });
      const result = await applyTrackingFix(
        { issue, adIds: parsed.data.ad_ids, actor: auth.username ?? null, site },
        trackingFixDeps(site, contentRoot),
      );
      res.json(result);
    } catch (err) {
      log.warn({ err }, "[ads] tracking-fix apply failed");
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to update ads in Meta",
        ...(err instanceof MetaApiError ? { error_kind: err.kind } : {}),
      });
    }
  });

  registerAdsProductionPullRoutes(app);
  registerLeadsRoutes(app);
}

/**
 * Leads page (/private/store/leads), metrics_view:
 *   GET /api/ads/leads        — newest-first page of 20 ledger leads (?range, include_test, page, filters)
 *   GET /api/ads/leads/stats  — KPIs, UTC timeline and breakdowns for the same params
 *   GET /api/ads/leads/:id    — one lead's full ledger row (no browser_hash); 404 when unknown
 */
/** Product / persona tracking keys for the funnel filters and breakdowns; null when unreadable. */
async function leadsTrackingIndex(res: Response) {
  try {
    const { loadTrackingKeyIndex } = await import("../product/tracking-key-index");
    return loadTrackingKeyIndex(getContentRoot(res));
  } catch (err) {
    log.warn({ err }, "[ads] tracking key index unavailable for leads");
    return null;
  }
}

function registerLeadsRoutes(app: Express): void {
  api.get(app, "/api/ads/leads", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const parsed = parseLeadsQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return void res.status(400).json({ error: parsed.error });
    try {
      const { listLeadsPage } = await import("../ads/leads-query");
      const trackingIndex = parsed.query.filters.funnel_persona ? await leadsTrackingIndex(res) : null;
      res.json(listLeadsPage(getSite(res), parsed.query, undefined, trackingIndex));
    } catch (err) {
      log.warn({ err }, "[ads] leads list failed");
      res.status(500).json({ error: "Failed to load leads" });
    }
  });

  api.get(app, "/api/ads/leads/stats", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const parsed = parseLeadsQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) return void res.status(400).json({ error: parsed.error });
    const site = getSite(res);
    try {
      const { getLeadsStats } = await import("../ads/leads-query");
      let convention: UtmConvention | undefined;
      try {
        convention = getAdsSettings(getContentRoot(res)).utm_convention;
      } catch {
        convention = undefined;
      }
      let grace: UtmGrace | null = null;
      try {
        const { utmGraceState } = await import("../ads/utm-convention-history");
        grace = utmGraceState(site, convention ?? DEFAULT_UTM_CONVENTION);
      } catch {
        grace = null;
      }
      let localCopy: LeadsLocalCopy | undefined;
      if (process.env.NODE_ENV !== "production") {
        const { readLeadsPullState } = await import("../ads/leads-pull-production");
        localCopy = readLeadsPullState(site);
      }
      const trackingIndex = await leadsTrackingIndex(res);
      const stats = getLeadsStats(site, parsed.query, { convention, grace, localCopy, trackingIndex });
      const productFilter = parsed.query.filters.product;
      if (productFilter && productFilter !== LEADS_NONE) {
        const { findCatalogProduct } = await import("../ads/lead-product");
        const product = findCatalogProduct({
          contentRoot: getContentRoot(res),
          productId: productFilter,
          productSlug: productFilter,
        });
        stats.product_name = product?.name ?? productFilter;
      }
      res.json(stats);
    } catch (err) {
      log.warn({ err }, "[ads] leads stats failed");
      res.status(500).json({ error: "Failed to load lead stats" });
    }
  });

  api.get(app, "/api/ads/leads/:id", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const id = String(req.params.id ?? "");
    if (!LEAD_ID_PATTERN.test(id)) return void res.status(400).json({ error: "Invalid lead ID" });
    try {
      const { getLeadDetail } = await import("../ads/leads-query");
      const lead = getLeadDetail(getSite(res), id);
      if (!lead) return void res.status(404).json({ error: "Lead not found" });
      res.json(lead);
    } catch (err) {
      log.warn({ err }, "[ads] lead detail failed");
      res.status(500).json({ error: "Failed to load lead" });
    }
  });
}

/** Refuse dev-only routes on production; returns true when the handler should stop. */
function refuseInProduction(res: Response, what: string): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  res.status(403).json({ error: "dev_only", message: `${what} is only available in development.` });
  return true;
}

type PullFailure = { success: boolean; reason?: string; code?: string; productionOrigin: string; envVar?: string; not_supported?: boolean };

function sendPullFailure(res: Response, result: PullFailure, fallback: string) {
  if (result.code === "production_staff_token_required") {
    return res.status(401).json({ ...result, error: result.reason ?? fallback });
  }
  res.status(result.not_supported ? 502 : 400).json({ ...result, error: result.reason ?? fallback });
}

/**
 * "Download from production" (Diagnostics / Settings → Ads):
 *   GET  /api/ads/export                   — production side: cached Meta + GA4 files (?days, default 90)
 *   GET  /api/ads/leads/export             — production side: lead-ledger rows + consent_daily (?since ms)
 *   GET  /api/ads/pull-production/origin   — dev only: which production origin a download would use
 *   POST /api/ads/pull-production          — dev only: replace local Ads cache with production's
 *   POST /api/ads/leads/pull-production    — dev only: replace local leads + consent with production's
 */
function registerAdsProductionPullRoutes(app: Express): void {
  api.get(app, "/api/ads/export", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    try {
      const { buildAdsExport, clampExportDays } = await import("../ads/pull-production");
      res.json(buildAdsExport(getSite(res), clampExportDays(req.query.days)));
    } catch (err) {
      log.warn({ err }, "[ads] export failed");
      res.status(500).json({ error: "Failed to export Ads data" });
    }
  });

  api.get(app, "/api/ads/leads/export", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    try {
      const { buildLeadsExport, defaultLeadsSince } = await import("../ads/leads-pull-production");
      const raw = Number(req.query.since);
      const since = Number.isFinite(raw) && raw > 0 ? raw : defaultLeadsSince();
      res.json(buildLeadsExport(getSite(res), since));
    } catch (err) {
      log.warn({ err }, "[ads] leads export failed");
      res.status(500).json({ error: "Failed to export leads" });
    }
  });

  api.get(app, "/api/ads/pull-production/origin", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    if (refuseInProduction(res, "Downloading production ad data")) return;
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const { resolveProductionOrigin } = await import("../dev-production-fetch");
    res.json({ productionOrigin: resolveProductionOrigin(getSite(res)) });
  });

  api.post(app, "/api/ads/pull-production", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    if (refuseInProduction(res, "Downloading production ad data")) return;
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const site = getSite(res);
    try {
      const { pullProductionAds } = await import("../ads/pull-production");
      const body = (req.body ?? {}) as { productionOrigin?: unknown; days?: unknown };
      const result = await pullProductionAds(site, {
        productionOrigin: typeof body.productionOrigin === "string" ? body.productionOrigin : undefined,
        days: typeof body.days === "number" ? body.days : undefined,
      });
      if (!result.success) return sendPullFailure(res, result, "Failed to download production ad data");
      res.json({
        ...result,
        education:
          "Replaced local Meta and GA4 ad data with production's. Leads were not changed by this call. Nothing was uploaded to production.",
      });
    } catch (err) {
      log.error({ err, site }, "[ads] pull-production failed");
      res.status(500).json({ error: "Failed to download production ad data" });
    }
  });

  api.post(app, "/api/ads/leads/pull-production", { rate: "staffWrite" }, async (req: Request, res: Response) => {
    if (refuseInProduction(res, "Downloading production leads")) return;
    const auth = await requireCapability(req, res, "metrics_view");
    if (!auth.authorized) return;
    const site = getSite(res);
    try {
      const { pullProductionLeads } = await import("../ads/leads-pull-production");
      const body = (req.body ?? {}) as { productionOrigin?: unknown; since?: unknown };
      const result = await pullProductionLeads(site, {
        sinceMs: typeof body.since === "number" && body.since > 0 ? body.since : undefined,
        productionOrigin: typeof body.productionOrigin === "string" ? body.productionOrigin : undefined,
      });
      if (!result.success) return sendPullFailure(res, result, "Failed to download production leads");
      res.json({
        ...result,
        education:
          "Replaced local real leads and daily consent counts from `since` onward with production's. Local test leads were kept. Nothing was uploaded to production.",
      });
    } catch (err) {
      log.error({ err, site }, "[ads] leads pull-production failed");
      res.status(500).json({ error: "Failed to download production leads" });
    }
  });
}
