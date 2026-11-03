/**
 * Per-site Ads settings (site_<name>/ads-config.yml; legacy `ads:` block in settings.yml until
 * migration 004 runs). Non-secret only — the Meta token lives in META_ADS_ACCESS_TOKEN.
 */

import {
  GA4_SEARCH_SOURCES,
  GA4_SOCIAL_SOURCES,
  GA4_VIDEO_SOURCES,
  META_SITE_SOURCES_OUTSIDE_GA4,
  isGa4DisplayMedium,
  isGa4PaidMedium,
} from "./utm-standards";

export interface AdsAlertThresholds {
  /** An issue is an error when it affects ≥ this % of account spend … */
  severity_spend_share_pct: number;
  /** … or ≥ this amount in the account currency. */
  severity_spend_floor: Record<string, number>;
  /** Clicks → visits drop vs trailing 28 days that triggers a warning (percentage points of the ratio). */
  clicks_visits_drop_pct: number;
  /** Clicks → visits ratio below this is always a warning. */
  clicks_visits_floor_pct: number;
  /** Minimum clicks before the clicks → visits ratio is judged. */
  ratio_min_clicks: number;
  /** "Meta: unclear" share above this triggers a warning … */
  unclear_share_pct: number;
  /** … when there are at least this many Meta sessions. */
  unclear_min_sessions: number;
  /** GA4 vs ledger lead gap widening (points) that triggers a warning. */
  ga4_ledger_gap_widen_pts: number;
  /** Fixed gap threshold during the first 28 days of ledger data. */
  ga4_ledger_gap_bootstrap_pct: number;
  /** Spend with zero visits over this many GA4-complete days is an error. */
  zero_visits_complete_days: number;
  /** Rates are greyed out below this many paid visits. */
  min_paid_visits_for_rates: number;
  /** A campaign outside every connected ad account needs at least this many paid visits to be flagged. */
  unrecognized_campaign_min_visits: number;
  /** … and is an error at ≥ this many visits … */
  unrecognized_campaign_error_visits: number;
  /** … or at ≥ this % of paid Meta visits … */
  unrecognized_campaign_error_share_pct: number;
  /** … once the window has at least this many paid Meta visits. */
  unrecognized_campaign_share_min_visits: number;
  /** Two picked lead conversions overlap when both have results on ≥ this % of the ad-days either has results … */
  conversion_overlap_days_pct: number;
  /** … and their totals differ by at most this %. */
  conversion_overlap_count_pct: number;
  /** Pixel events need at least this many hits in 7 days before lockstep is judged … */
  lockstep_min_events: number;
  /** … and fire in lockstep when their totals differ by at most this %. */
  lockstep_count_pct: number;
  /** Meta ad counts as GA4-tagged when at least this many sessions carry its utm_content. */
  tracking_tagged_min_sessions: number;
  /** Minimum Meta link clicks (on complete GA4 days) before a missing-template ad can be confirmed missing. */
  tracking_missing_min_clicks: number;
  /** Max GA4-tagged sessions / clicks (%) still treated as confirmed missing (also the floor for meta_auto). */
  tracking_missing_max_visit_pct: number;
  /** Primary verification window: last N complete GA4 days (diagnostics; reports use their own range). */
  tracking_check_days: number;
  /** A UTM issue with no spend behind it needs at least this many paid visits over the issue window … */
  utm_issue_min_visits: number;
  /** … and is an error at ≥ this many visits. */
  utm_issue_error_visits: number;
}

/** A campaign staff know about but don't connect (agency, partner). Still shown, never counted as a problem. */
export interface KnownExternalCampaign {
  /** Campaign id, or the utm_campaign name when the visits carry no id. */
  key: string;
  note?: string;
}

export interface MetaAdsSettings {
  enabled: boolean;
  /** Ad account ids without the `act_` prefix. */
  ad_account_ids: string[];
  /** Mirror of `AdsSettings.alert_thresholds` (read-compat; written at `ads.alert_thresholds`). */
  alert_thresholds: AdsAlertThresholds;
  known_external_campaigns: KnownExternalCampaign[];
  /** Conversions counted as Meta leads: `fb_pixel_lead` (standard Lead) or numeric custom conversion ids. Empty = standard Lead. */
  lead_conversions: string[];
  /** When `lead_conversions` last changed (ISO), so the card can say numbers were recalculated. */
  lead_conversions_changed_at: string | null;
  /** Pixel event pairs staff marked as meant to fire together (never flagged as lockstep). */
  expected_event_pairs: ExpectedEventPair[];
}

export interface ExpectedEventPair {
  pixel_id: string;
  /** Sorted pair of event names. */
  events: [string, string];
  note?: string;
}

/** Standard pixel Lead event key in `lead_conversions` (`offsite_conversion.fb_pixel_lead`). */
export const META_STANDARD_LEAD_KEY = "fb_pixel_lead";
export const MAX_META_LEAD_CONVERSIONS = 50;
export const MAX_EXPECTED_EVENT_PAIRS = 100;

/** Where the Google Ads → BigQuery Data Transfer writes its tables. */
export interface GoogleAdsBigQuerySettings {
  project: string | null;
  dataset: string | null;
}

export interface GoogleAdsSettings {
  enabled: boolean;
  /** Google Ads customer ids (10 digits, no dashes) whose spend this site reports. */
  customer_ids: string[];
  bigquery: GoogleAdsBigQuerySettings;
  /** Extra conversion action names (or ids) counted as Google-reported leads, besides the "Submit lead form" category. */
  lead_conversion_actions: string[];
  known_external_campaigns: KnownExternalCampaign[];
}

export interface AdsSettings {
  meta: MetaAdsSettings;
  google: GoogleAdsSettings;
  /** Shared by every ad platform (`ads.alert_thresholds`; falls back to legacy `ads.meta.alert_thresholds`). */
  alert_thresholds: AdsAlertThresholds;
  /** Lead emails matching any of these (glob with `*`) are flagged `is_test` (still delivered). */
  test_email_patterns: string[];
  /** Parsed `utm_convention` (hand-edited in ads-config.yml; never written by the app). */
  utm_convention: UtmConvention;
  /** Convention values ignored because they are outside the GA4 standard. */
  utm_convention_rejected: UtmConventionRejection[];
}

export const DEFAULT_ADS_ALERT_THRESHOLDS: AdsAlertThresholds = {
  severity_spend_share_pct: 5,
  severity_spend_floor: { USD: 50, EUR: 50 },
  clicks_visits_drop_pct: 30,
  clicks_visits_floor_pct: 25,
  ratio_min_clicks: 100,
  unclear_share_pct: 20,
  unclear_min_sessions: 100,
  ga4_ledger_gap_widen_pts: 15,
  ga4_ledger_gap_bootstrap_pct: 35,
  zero_visits_complete_days: 2,
  min_paid_visits_for_rates: 20,
  unrecognized_campaign_min_visits: 3,
  unrecognized_campaign_error_visits: 20,
  unrecognized_campaign_error_share_pct: 5,
  unrecognized_campaign_share_min_visits: 100,
  conversion_overlap_days_pct: 80,
  conversion_overlap_count_pct: 20,
  lockstep_min_events: 20,
  lockstep_count_pct: 2,
  tracking_tagged_min_sessions: 3,
  tracking_missing_min_clicks: 20,
  tracking_missing_max_visit_pct: 10,
  tracking_check_days: 7,
  utm_issue_min_visits: 5,
  utm_issue_error_visits: 50,
};

export const MAX_KNOWN_EXTERNAL_CAMPAIGNS = 100;
const MAX_KNOWN_CAMPAIGN_CHARS = 200;

export const DEFAULT_GOOGLE_ADS_SETTINGS: GoogleAdsSettings = {
  enabled: false,
  customer_ids: [],
  bigquery: { project: null, dataset: null },
  lead_conversion_actions: [],
  known_external_campaigns: [],
};

/** Values Meta writes for `{{site_source_name}}`. */
export const META_SITE_SOURCE_VALUES: readonly string[] = ["fb", "ig", "msg", "an"];

export const DEFAULT_UTM_CONVENTION: UtmConvention = {
  case: "lowercase",
  separator: "_",
  sources: {
    meta: { canonical: [...META_SITE_SOURCE_VALUES], aliases: ["facebook", "instagram"] },
    google: { canonical: ["google"], aliases: ["adwords"] },
  },
  mediums: { meta: "paid_social", google: "cpc" },
  campaign_pattern: null,
  require_ids: true,
  exceptions: [],
};

export const DEFAULT_ADS_SETTINGS: AdsSettings = {
  meta: {
    enabled: false,
    ad_account_ids: [],
    alert_thresholds: { ...DEFAULT_ADS_ALERT_THRESHOLDS },
    known_external_campaigns: [],
    lead_conversions: [],
    lead_conversions_changed_at: null,
    expected_event_pairs: [],
  },
  google: { ...DEFAULT_GOOGLE_ADS_SETTINGS, bigquery: { project: null, dataset: null } },
  alert_thresholds: { ...DEFAULT_ADS_ALERT_THRESHOLDS },
  test_email_patterns: [],
  utm_convention: cloneConvention(DEFAULT_UTM_CONVENTION),
  utm_convention_rejected: [],
};

/** Thresholds for any platform, tolerant of settings objects built before `alert_thresholds` moved up a level. */
export function adsThresholds(settings: Pick<AdsSettings, "meta"> & { alert_thresholds?: AdsAlertThresholds }): AdsAlertThresholds {
  return settings.alert_thresholds ?? settings.meta.alert_thresholds;
}

function num(raw: unknown, fallback: number, min = 0, max = 1_000_000): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeAdAccountId(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim().replace(/^act_/i, "");
  return /^\d{5,20}$/.test(s) ? s : null;
}

/** Google Ads customer id: 10 digits; dashes (123-456-7890) are stripped. */
export function normalizeGoogleCustomerId(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim().replace(/-/g, "");
  return /^\d{10}$/.test(s) ? s : null;
}

/** 123-456-7890 display form. */
export function formatGoogleCustomerId(id: string): string {
  return /^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

const BQ_PROJECT_RE = /^[a-z][a-z0-9-]{4,62}$/;
const BQ_DATASET_RE = /^[A-Za-z0-9_]{1,1024}$/;
const MAX_LEAD_CONVERSION_ACTIONS = 50;

export function parseGoogleAdsSettings(raw: unknown): GoogleAdsSettings {
  const g = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ids = Array.isArray(g.customer_ids) ? g.customer_ids : [];
  const bq = (g.bigquery && typeof g.bigquery === "object" ? g.bigquery : {}) as Record<string, unknown>;
  const project = typeof bq.project === "string" && BQ_PROJECT_RE.test(bq.project.trim()) ? bq.project.trim() : null;
  const dataset = typeof bq.dataset === "string" && BQ_DATASET_RE.test(bq.dataset.trim()) ? bq.dataset.trim() : null;
  const actions = Array.isArray(g.lead_conversion_actions) ? g.lead_conversion_actions : [];
  const seen = new Set<string>();
  const lead_conversion_actions: string[] = [];
  for (const a of actions) {
    if (typeof a !== "string" && typeof a !== "number") continue;
    const v = String(a).trim().slice(0, 200);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    lead_conversion_actions.push(v);
    if (lead_conversion_actions.length >= MAX_LEAD_CONVERSION_ACTIONS) break;
  }
  return {
    enabled: g.enabled === true,
    customer_ids: Array.from(new Set(ids.map(normalizeGoogleCustomerId).filter((x): x is string => !!x))),
    bigquery: { project, dataset },
    lead_conversion_actions,
    known_external_campaigns: parseKnownExternalCampaigns(g.known_external_campaigns),
  };
}

export function parseAdsAlertThresholds(raw: unknown): AdsAlertThresholds {
  const d = DEFAULT_ADS_ALERT_THRESHOLDS;
  if (!raw || typeof raw !== "object") return { ...d, severity_spend_floor: { ...d.severity_spend_floor } };
  const r = raw as Record<string, unknown>;
  const floors: Record<string, number> = {};
  const rawFloors = r.severity_spend_floor;
  if (rawFloors && typeof rawFloors === "object" && !Array.isArray(rawFloors)) {
    for (const [cur, v] of Object.entries(rawFloors as Record<string, unknown>)) {
      const code = cur.trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(code)) floors[code] = num(v, 50);
    }
  }
  return {
    severity_spend_share_pct: num(r.severity_spend_share_pct, d.severity_spend_share_pct, 0, 100),
    severity_spend_floor: Object.keys(floors).length > 0 ? floors : { ...d.severity_spend_floor },
    clicks_visits_drop_pct: num(r.clicks_visits_drop_pct, d.clicks_visits_drop_pct, 0, 100),
    clicks_visits_floor_pct: num(r.clicks_visits_floor_pct, d.clicks_visits_floor_pct, 0, 100),
    ratio_min_clicks: Math.round(num(r.ratio_min_clicks, d.ratio_min_clicks, 1)),
    unclear_share_pct: num(r.unclear_share_pct, d.unclear_share_pct, 0, 100),
    unclear_min_sessions: Math.round(num(r.unclear_min_sessions, d.unclear_min_sessions, 1)),
    ga4_ledger_gap_widen_pts: num(r.ga4_ledger_gap_widen_pts, d.ga4_ledger_gap_widen_pts, 0, 100),
    ga4_ledger_gap_bootstrap_pct: num(r.ga4_ledger_gap_bootstrap_pct, d.ga4_ledger_gap_bootstrap_pct, 0, 100),
    zero_visits_complete_days: Math.round(num(r.zero_visits_complete_days, d.zero_visits_complete_days, 1, 30)),
    min_paid_visits_for_rates: Math.round(num(r.min_paid_visits_for_rates, d.min_paid_visits_for_rates, 1)),
    unrecognized_campaign_min_visits: Math.round(num(r.unrecognized_campaign_min_visits, d.unrecognized_campaign_min_visits, 1)),
    unrecognized_campaign_error_visits: Math.round(num(r.unrecognized_campaign_error_visits, d.unrecognized_campaign_error_visits, 1)),
    unrecognized_campaign_error_share_pct: num(r.unrecognized_campaign_error_share_pct, d.unrecognized_campaign_error_share_pct, 0, 100),
    unrecognized_campaign_share_min_visits: Math.round(
      num(r.unrecognized_campaign_share_min_visits, d.unrecognized_campaign_share_min_visits, 1),
    ),
    conversion_overlap_days_pct: num(r.conversion_overlap_days_pct, d.conversion_overlap_days_pct, 0, 100),
    conversion_overlap_count_pct: num(r.conversion_overlap_count_pct, d.conversion_overlap_count_pct, 0, 100),
    lockstep_min_events: Math.round(num(r.lockstep_min_events, d.lockstep_min_events, 1)),
    lockstep_count_pct: num(r.lockstep_count_pct, d.lockstep_count_pct, 0, 100),
    tracking_tagged_min_sessions: Math.round(num(r.tracking_tagged_min_sessions, d.tracking_tagged_min_sessions, 1)),
    tracking_missing_min_clicks: Math.round(num(r.tracking_missing_min_clicks, d.tracking_missing_min_clicks, 1)),
    tracking_missing_max_visit_pct: num(r.tracking_missing_max_visit_pct, d.tracking_missing_max_visit_pct, 0, 100),
    tracking_check_days: Math.round(num(r.tracking_check_days, d.tracking_check_days, 3, 28)),
    utm_issue_min_visits: Math.round(num(r.utm_issue_min_visits, d.utm_issue_min_visits, 1)),
    utm_issue_error_visits: Math.round(num(r.utm_issue_error_visits, d.utm_issue_error_visits, 1)),
  };
}

/** `fb_pixel_lead` or a numeric custom conversion id (also accepts `offsite_conversion.custom.<id>`). */
export function normalizeMetaLeadConversionKey(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim().replace(/^offsite_conversion\.custom\./i, "").replace(/^offsite_conversion\./i, "");
  if (s.toLowerCase() === META_STANDARD_LEAD_KEY) return META_STANDARD_LEAD_KEY;
  return /^\d{6,25}$/.test(s) ? s : null;
}

export function parseMetaLeadConversions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const k = normalizeMetaLeadConversionKey(item);
    if (!k || out.includes(k)) continue;
    out.push(k);
    if (out.length >= MAX_META_LEAD_CONVERSIONS) break;
  }
  return out;
}

/** Stable id for a pixel event pair (events sorted). */
export function eventPairKey(pixelId: string, a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `${pixelId}|${x}|${y}`;
}

export function parseExpectedEventPairs(raw: unknown): ExpectedEventPair[] {
  if (!Array.isArray(raw)) return [];
  const out: ExpectedEventPair[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const pixel = typeof rec.pixel_id === "string" || typeof rec.pixel_id === "number" ? String(rec.pixel_id).trim() : "";
    const events = Array.isArray(rec.events) ? rec.events.map((e) => (typeof e === "string" ? e.trim().slice(0, 100) : "")) : [];
    if (!/^\d{5,25}$/.test(pixel) || events.length !== 2 || !events[0] || !events[1] || events[0] === events[1]) continue;
    const [a, b] = [events[0], events[1]].sort() as [string, string];
    const key = eventPairKey(pixel, a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    const note = typeof rec.note === "string" ? rec.note.trim().slice(0, 200) : "";
    out.push(note ? { pixel_id: pixel, events: [a, b], note } : { pixel_id: pixel, events: [a, b] });
    if (out.length >= MAX_EXPECTED_EVENT_PAIRS) break;
  }
  return out;
}

export function isExpectedEventPair(list: ExpectedEventPair[], pixelId: string, a: string, b: string): boolean {
  const key = eventPairKey(pixelId, a, b);
  return list.some((p) => eventPairKey(p.pixel_id, p.events[0], p.events[1]) === key);
}

/** Effective keys counted as Meta leads (standard Lead when nothing is picked). */
export function effectiveMetaLeadKeys(picked: readonly string[] | undefined): string[] {
  return picked && picked.length > 0 ? [...picked] : [META_STANDARD_LEAD_KEY];
}

/** Trimmed, deduped by key (case-insensitive), capped. Accepts `{ key, note }` objects or bare strings. */
export function parseKnownExternalCampaigns(raw: unknown): KnownExternalCampaign[] {
  if (!Array.isArray(raw)) return [];
  const out: KnownExternalCampaign[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const rec = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const rawKey = typeof item === "string" || typeof item === "number" ? String(item) : rec?.key;
    if (typeof rawKey !== "string" && typeof rawKey !== "number") continue;
    const key = String(rawKey).trim().slice(0, MAX_KNOWN_CAMPAIGN_CHARS);
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    const note = typeof rec?.note === "string" ? rec.note.trim().slice(0, MAX_KNOWN_CAMPAIGN_CHARS) : "";
    out.push(note ? { key, note } : { key });
    if (out.length >= MAX_KNOWN_EXTERNAL_CAMPAIGNS) break;
  }
  return out;
}

export function isKnownExternalCampaign(list: KnownExternalCampaign[], key: string): boolean {
  const k = key.trim().toLowerCase();
  return list.some((c) => c.key.toLowerCase() === k);
}

export function parseAdsSettings(raw: unknown): AdsSettings {
  if (!raw || typeof raw !== "object") {
    const thresholds = parseAdsAlertThresholds(undefined);
    return {
      meta: {
        ...DEFAULT_ADS_SETTINGS.meta,
        alert_thresholds: thresholds,
        known_external_campaigns: [],
        lead_conversions: [],
        expected_event_pairs: [],
      },
      google: parseGoogleAdsSettings(undefined),
      alert_thresholds: thresholds,
      test_email_patterns: [],
      utm_convention: parseUtmConvention(undefined).convention,
      utm_convention_rejected: [],
    };
  }
  const r = raw as Record<string, unknown>;
  const meta = (r.meta && typeof r.meta === "object" ? r.meta : {}) as Record<string, unknown>;
  const ids = Array.isArray(meta.ad_account_ids) ? meta.ad_account_ids : [];
  const patterns = Array.isArray(r.test_email_patterns) ? r.test_email_patterns : [];
  const thresholds = parseAdsAlertThresholds(r.alert_thresholds ?? meta.alert_thresholds);
  return {
    meta: {
      enabled: meta.enabled === true,
      ad_account_ids: Array.from(new Set(ids.map(normalizeAdAccountId).filter((x): x is string => !!x))),
      alert_thresholds: thresholds,
      known_external_campaigns: parseKnownExternalCampaigns(meta.known_external_campaigns),
      lead_conversions: parseMetaLeadConversions(meta.lead_conversions),
      lead_conversions_changed_at:
        typeof meta.lead_conversions_changed_at === "string" && !Number.isNaN(Date.parse(meta.lead_conversions_changed_at))
          ? meta.lead_conversions_changed_at
          : null,
      expected_event_pairs: parseExpectedEventPairs(meta.expected_event_pairs),
    },
    google: parseGoogleAdsSettings(r.google),
    alert_thresholds: thresholds,
    test_email_patterns: Array.from(
      new Set(
        patterns
          .filter((p): p is string => typeof p === "string")
          .map((p) => p.trim().toLowerCase())
          .filter((p) => p.length > 0 && p.length <= 200),
      ),
    ),
    ...(() => {
      const parsed = parseUtmConvention(r.utm_convention);
      return { utm_convention: parsed.convention, utm_convention_rejected: parsed.rejected };
    })(),
  };
}

/** Glob match (`*` wildcard, case-insensitive). Used for test-lead email patterns. */
export function emailMatchesPattern(email: string, pattern: string): boolean {
  const escaped = pattern
    .trim()
    .toLowerCase()
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  if (!escaped) return false;
  return new RegExp(`^${escaped}$`).test(email.trim().toLowerCase());
}

// ── UTM convention (ads-config.yml → utm_convention; edited in the file only) ──

export type UtmConventionPlatform = "meta" | "google";
export const UTM_CONVENTION_PLATFORMS: readonly UtmConventionPlatform[] = ["meta", "google"];

export interface UtmSourceRule {
  /** Values that are correct in utm_source (lowercase). */
  canonical: string[];
  /** Known wrong spellings, named in the issue copy (anything outside `canonical` is still flagged). */
  aliases: string[];
}

export interface UtmConvention {
  /** `lowercase`: source and medium must be lowercase. `any`: case is not checked. */
  case: "lowercase" | "any";
  /** Word separator suggested in issue copy for campaign names. */
  separator: "_" | "-";
  sources: Record<UtmConventionPlatform, UtmSourceRule>;
  mediums: Record<UtmConventionPlatform, string>;
  /** Regex utm_campaign must match (literal values only); null = not checked. */
  campaign_pattern: string | null;
  /** Google / GA4-observed traffic must carry numeric utm_id + utm_term. */
  require_ids: boolean;
  /** Campaign ids or utm_campaign names whose UTM issues are info only. */
  exceptions: KnownExternalCampaign[];
}

export type UtmConventionRejection = { field: string; value: string; reason: string; default_used: string };

function cloneConvention(c: UtmConvention): UtmConvention {
  return {
    ...c,
    sources: {
      meta: { canonical: [...c.sources.meta.canonical], aliases: [...c.sources.meta.aliases] },
      google: { canonical: [...c.sources.google.canonical], aliases: [...c.sources.google.aliases] },
    },
    mediums: { ...c.mediums },
    exceptions: c.exceptions.map((e) => ({ ...e })),
  };
}

function utmValueList(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return Array.from(new Set(list.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase()).filter(Boolean))).slice(0, 50);
}

/**
 * Parses `utm_convention`. Values outside the GA4 default channel group (see shared/utm-standards.ts)
 * are ignored and reported in `rejected`; that field then uses the default.
 */
export function parseUtmConvention(raw: unknown): { convention: UtmConvention; rejected: UtmConventionRejection[] } {
  const d = DEFAULT_UTM_CONVENTION;
  const out = cloneConvention(d);
  const rejected: UtmConventionRejection[] = [];
  if (raw == null) return { convention: out, rejected };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    rejected.push({ field: "utm_convention", value: String(raw), reason: "must be a map of settings", default_used: "the default convention" });
    return { convention: out, rejected };
  }
  const r = raw as Record<string, unknown>;

  if (r.case != null) {
    if (r.case === "lowercase" || r.case === "any") out.case = r.case;
    else rejected.push({ field: "case", value: String(r.case), reason: "must be lowercase or any", default_used: d.case });
  }
  if (r.separator != null) {
    if (r.separator === "_" || r.separator === "-") out.separator = r.separator;
    else rejected.push({ field: "separator", value: String(r.separator), reason: 'must be "_" or "-"', default_used: d.separator });
  }

  const sources = r.sources && typeof r.sources === "object" ? (r.sources as Record<string, unknown>) : {};
  const mediums = r.mediums && typeof r.mediums === "object" ? (r.mediums as Record<string, unknown>) : {};
  for (const p of UTM_CONVENTION_PLATFORMS) {
    const s = sources[p] && typeof sources[p] === "object" ? (sources[p] as Record<string, unknown>) : null;
    if (s) {
      if (s.canonical != null) {
        const kept: string[] = [];
        for (const v of utmValueList(s.canonical)) {
          const reason = utmSourceRejection(p, v);
          if (reason) rejected.push({ field: `sources.${p}.canonical`, value: v, reason, default_used: d.sources[p].canonical.join(", ") });
          else kept.push(v);
        }
        out.sources[p].canonical = kept.length > 0 ? kept : [...d.sources[p].canonical];
      }
      if (s.aliases != null) out.sources[p].aliases = utmValueList(s.aliases);
      out.sources[p].aliases = out.sources[p].aliases.filter((a) => !out.sources[p].canonical.includes(a));
    }
    const m = mediums[p];
    if (m != null) {
      const v = typeof m === "string" ? m.trim().toLowerCase() : String(m);
      const reason = typeof m === "string" ? utmMediumRejection(p, v) : "must be text";
      if (reason) rejected.push({ field: `mediums.${p}`, value: v, reason, default_used: d.mediums[p] });
      else out.mediums[p] = v;
    }
  }

  if (r.campaign_pattern != null && r.campaign_pattern !== "") {
    const v = String(r.campaign_pattern);
    try {
      new RegExp(v);
      out.campaign_pattern = v.slice(0, 500);
    } catch {
      rejected.push({ field: "campaign_pattern", value: v, reason: "is not a valid regular expression", default_used: "not checked" });
    }
  }
  if (typeof r.require_ids === "boolean") out.require_ids = r.require_ids;
  out.exceptions = parseKnownExternalCampaigns(r.exceptions);
  return { convention: out, rejected };
}

function utmSourceRejection(p: UtmConventionPlatform, v: string): string | null {
  if (p === "meta") {
    return GA4_SOCIAL_SOURCES.has(v) || META_SITE_SOURCES_OUTSIDE_GA4.includes(v)
      ? null
      : "GA4 only files Meta visits as Paid Social when the source is on its social list (fb, ig, facebook, instagram, …)";
  }
  return GA4_SEARCH_SOURCES.has(v) || GA4_VIDEO_SOURCES.has(v)
    ? null
    : "GA4 only files Google visits as Paid Search / Paid Video when the source is on its search or video list (google, youtube)";
}

function utmMediumRejection(p: UtmConventionPlatform, v: string): string | null {
  if (isGa4PaidMedium(v)) return null;
  if (p === "google" && isGa4DisplayMedium(v)) return null;
  return p === "meta"
    ? "GA4 only counts Meta visits as Paid Social when the medium matches ^(.*cp.*|ppc|retargeting|paid.*)$ (e.g. paid_social, cpc)"
    : "GA4 only counts Google visits as paid when the medium matches ^(.*cp.*|ppc|retargeting|paid.*)$ or is a display medium (e.g. cpc, display)";
}

/**
 * utm_source the Meta template writes: `{{site_source_name}}` when the convention accepts at least two of
 * Meta's per-placement values (extra accepted values like `facebook` don't change the template).
 */
export function metaTemplateSource(c: UtmConvention): string {
  const canonical = c.sources.meta.canonical;
  return canonical.filter((v) => META_SITE_SOURCE_VALUES.includes(v)).length > 1 ? "{{site_source_name}}" : canonical[0]!;
}

/** Meta URL parameters template staff paste into every ad (ids enable matching). */
export function metaUtmTemplate(c: UtmConvention = DEFAULT_UTM_CONVENTION): string {
  return `utm_source=${metaTemplateSource(c)}&utm_medium=${c.mediums.meta}&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`;
}

/**
 * Google Ads final URL suffix staff add at account level. Fallback for matching visits when
 * GA4 isn't linked to Google Ads and gclid can't be joined (same id slots as the Meta template).
 */
export function googleUrlSuffixTemplate(c: UtmConvention = DEFAULT_UTM_CONVENTION): string {
  return `utm_source=${c.sources.google.canonical[0]}&utm_medium=${c.mediums.google}&utm_campaign={campaignid}&utm_id={campaignid}&utm_term={adgroupid}&utm_content={creative}`;
}
