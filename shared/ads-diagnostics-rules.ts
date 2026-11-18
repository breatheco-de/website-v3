/**
 * Pure Ads diagnostics rules (thresholds from ads-config.yml → alert_thresholds).
 * Server gathers inputs; these functions decide whether an issue exists and how severe it is.
 */

import { metaTemplateSource, type AdsAlertThresholds, type UtmConvention, type UtmConventionPlatform } from "./ads-settings";
import { isPaidMedium, type AdPlatform } from "./paid-traffic";
import { isGa4StandardPaidMedium } from "./utm-standards";

export type AdsIssueSeverity = "error" | "warning" | "info";

export type AdsIssueCode =
  | "meta_access_failed"
  | "meta_sync_failing"
  | "spend_zero_visits"
  | "landing_not_live"
  | "ad_url_redirects"
  | "missing_tracking_params"
  | "tracking_params_unchecked"
  | "tracking_params_unverified"
  | "non_paid_medium"
  | "pixel_not_reporting_leads"
  | "lead_conversions_overlap"
  | "pixel_events_lockstep"
  | "lead_conversion_stopped"
  | "ga4_ledger_gap"
  | "ledger_not_recording"
  | "clicks_visits_low"
  | "unclear_share_high"
  | "consent_rate_drop"
  | "off_site_destination"
  | "instant_form_destination"
  | "unmanaged_destination"
  | "unrecognized_campaign"
  | "google_sync_failing"
  | "google_transfer_stale"
  | "google_transfer_missing_account"
  | "google_history_short"
  | "google_account_not_connected"
  | "google_auto_tagging_off"
  | "google_ga4_not_linked"
  | "google_gclid_join_unavailable"
  | "google_destination_policy"
  | "google_conversions_not_reporting"
  | "ads_config_unreadable"
  | "utm_convention_invalid"
  | "account_landing_location_mismatch"
  | "account_landing_location_missing"
  | UtmIssueCode;

/** UTM convention / GA4 standard violations (universal first, then platform rules). */
export type UtmIssueCode =
  | "utm_unfilled_macro"
  | "utm_case_mixed"
  | "utm_bad_chars"
  | "utm_medium_nonstandard"
  | "utm_source_alias"
  | "utm_medium_off_convention"
  | "utm_campaign_pattern"
  | "utm_missing_ids";

/** Which dashboard owns an issue; `shared` = lead records / consent, listed once on the overview. */
export type AdsIssuePlatform = "meta" | "google" | "shared";

export type AdsIssue = {
  id: string;
  code: AdsIssueCode;
  platform?: AdsIssuePlatform;
  severity: AdsIssueSeverity;
  title: string;
  why: string;
  how_to_fix: string;
  /** Spend affected, per currency. */
  spend_affected: Record<string, number>;
  scope: { page_key?: string; url?: string; ad_id?: string; campaign_id?: string; campaign_name?: string; account_id?: string };
  /** True when the fix is on our site (content/redirects) — Solve with AI is offered only then. */
  site_fixable: boolean;
  /** Affected ads and evidence; `ads` is trimmed per request (see `ads_total` / `ads_offset`). */
  details?: AdsIssueDetails;
  /** When this issue first appeared (ISO), from the Issues | Resolved bookkeeping. */
  first_seen?: string;
  /** One-click settings fix staff confirm in the UI (never applied automatically). */
  action?: AdsIssueAction;
  /** Numbers behind conversion / pixel event checks. */
  evidence?: AdsIssueEvidence;
  /** UTM issue that only matches values accepted during a convention change (info until `grace_ends_at`). */
  in_grace?: boolean;
  grace_ends_at?: string;
};

/** Settings writes offered on an issue; the UI asks for confirmation first. */
export type AdsIssueAction =
  | { kind: "unpick_lead_conversion"; label: string; confirm: string; conversion_key: string; conversion_name: string }
  | { kind: "mark_expected_event_pair"; label: string; confirm: string; pixel_id: string; events: [string, string] };

export type AdsIssueEvidence =
  | {
      kind: "conversion_overlap";
      conversions: Array<{ key: string; name: string; count: number; optimized_ads: number }>;
      /** Ad-days where either conversion had results. */
      ad_days: number;
      /** Share of those ad-days where both had results (0–100). */
      both_days_pct: number;
      /** Count difference relative to the larger count (0–100). */
      count_diff_pct: number;
      /** Leads Meta likely counts twice (the smaller count). */
      estimated_extra: number;
    }
  | {
      kind: "event_lockstep";
      pixel_id: string;
      pixel_name: string;
      since: string;
      events: Array<{ event: string; total: number }>;
      hours_compared: number;
      /** Hours with identical counts (0–100). */
      hours_matching_pct: number;
      count_diff_pct: number;
    }
  | {
      kind: "conversion_stopped";
      conversion_key: string;
      conversion_name: string;
      reason: "missing" | "archived" | "not_shared";
      /** not_shared: selected accounts with spend that can't see it. */
      accounts: string[];
    };

/** Why an ad with spend could not be checked against the URL parameters template. */
export type AdsUncheckedReason = "account_unreadable" | "setup_fetch_failed" | "ad_removed_in_meta" | "no_link_found";

export const ADS_UNCHECKED_REASON_LABELS: Record<AdsUncheckedReason, string> = {
  account_unreadable: "Meta wouldn't let us read this ad account on the last sync",
  setup_fetch_failed: "Meta didn't return this ad's setup on the last sync",
  ad_removed_in_meta: "This ad was removed in Meta",
  no_link_found: "We couldn't find a website link in this ad",
};

/** One Meta ad behind an issue, summed over the issue window. */
export type AdsIssueAd = {
  ad_id: string;
  ad_name: string;
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  campaign_name: string;
  account_id: string;
  /** Meta's status at the last setup read (ACTIVE, PAUSED, …); null when the setup was never read. */
  effective_status: string | null;
  spend: Record<string, number>;
  link_clicks: number;
  impressions: number;
  landing_page_views: number;
  last_spend_date: string | null;
  landing_url: string | null;
  url_tags: string | null;
  /** Template params this ad lacks (missing_tracking_params). */
  missing?: string[];
  /** Setup has utm_content that is neither {{ad.id}} nor this ad's id. */
  dubious_utm_content?: boolean;
  /** utm_medium the ad sets when it is not a paid medium (non_paid_medium). */
  medium?: string;
  unchecked_reason?: AdsUncheckedReason;
  /** GA4 sessions with utm_content = this ad id over the check window. */
  ga4_tagged_sessions?: number;
  /** Meta link clicks summed on the same complete GA4 days as ga4_tagged_sessions. */
  checked_clicks?: number;
  /** Where tagging evidence came from for this issue row. */
  tagging_source?: "setup" | "meta_auto" | "none";
  /** Last URL versions (newest first, current included) when the ad's link changed; dates are YYYY-MM-DD (UTC). `from: null` = live before URL history started. */
  previous_urls?: Array<{ v: number; url: string; from: string | null; to: string }>;
};

/** GA4 paid visits that landed on a destination with no synced ad behind it. */
export type AdsGa4SeenRow = {
  platform: string | null;
  source: string;
  medium: string;
  campaign: string;
  /** utm_id when present. */
  campaign_id: string | null;
  /** utm_term (ad set id in our template) when present. */
  adset_id: string | null;
  /** utm_content (ad id in our template) when present. */
  ad_id: string | null;
  visits: number;
  leads: number;
  first_seen: string;
  last_seen: string;
};

export type AdsUnrecognizedCampaignPage = { key: string; url: string; title: string; visits: number };

/** Meta-tagged GA4 visits to our pages from a campaign no connected ad account knows. */
export type AdsUnrecognizedCampaign = {
  key: string;
  campaign_id: string | null;
  campaign_name: string;
  visits: number;
  leads: number;
  /** Visits with no ad id (utm_content) tag. */
  untagged_visits: number;
  pages: AdsUnrecognizedCampaignPage[];
  ga4_seen: AdsGa4SeenRow[];
  first_seen: string;
  last_seen: string;
};

export type AdsIssueDetails = {
  ads: AdsIssueAd[];
  ads_total: number;
  ads_offset: number;
  unchecked?: Array<{ reason: AdsUncheckedReason; ads: number; spend: Record<string, number> }>;
  ga4_seen?: AdsGa4SeenRow[];
  /** GA4 paid visits on this destination with no ad id tag (ad set / ad cannot be known). */
  ga4_untagged_visits?: number;
  /** unrecognized_campaign: our pages the campaign sends visitors to, by visits. */
  pages?: AdsUnrecognizedCampaignPage[];
  /** unrecognized_campaign: all GA4 paid visits / leads behind the issue (`ga4_seen` keeps only the top tag groups). */
  ga4_totals?: { visits: number; leads: number };
  /** When the ad setups (links, URL parameters, status) for this issue's account(s) were last read from Meta. */
  setup_last_read_at?: string | null;
  /** utm_* issues: the wrong values, where they were seen and what GA4 does with them. */
  utm?: AdsUtmEvidence;
};

/** One wrong UTM value behind a utm_* issue, merged across ad setups, GA4 visits and lead records. */
export type AdsUtmValue = {
  param: string;
  value: string;
  /** What the convention / GA4 expects instead (null when there is no single right value). */
  expected: string | null;
  in_grace?: boolean;
  seen_in: Array<"setup" | "ga4" | "leads">;
  visits: number;
  leads: number;
  /** Ads whose setup carries this value. */
  ads: number;
};

export type AdsUtmEvidence = {
  /** Params flagged (Fix via Meta replaces utm_source / utm_medium only). */
  params: string[];
  values: AdsUtmValue[];
  /** Where GA4 files these visits today (e.g. "Paid Other"); null when unchanged. */
  ga4_channel: string | null;
  /** The rule broken, in plain English. */
  rule: string;
  visits: number;
  leads: number;
};

/** Ads with spend in the issue window vs the URL parameters template (Settings card + Diagnostics). */
export type TrackingParamsCoverage = {
  window_days: number;
  /** When the ad setups were last read from Meta. */
  checked_at: string | null;
  /** Ads with spend that send people to a website (Instant Form / no-link ads skipped). */
  checked_ads: number;
  missing_ads: number;
  campaigns: Array<{ id: string; name: string; ads: number; missing: string[]; spend: Record<string, number> }>;
  non_paid_campaigns: Array<{ id: string; name: string; medium: string; spend: Record<string, number> }>;
  /** Ads with spend we could not check, by reason. */
  unchecked?: Array<{ reason: AdsUncheckedReason; ads: number; spend: Record<string, number> }>;
};

const SEVERITY_RANK: Record<AdsIssueSeverity, number> = { error: 0, warning: 1, info: 2 };

function spendSum(spend: Record<string, number>): number {
  return Object.values(spend).reduce((s, v) => s + v, 0);
}

/** Severity first, then affected spend (summed across currencies, for ordering only), then id. */
export function sortAdsIssues<T extends Pick<AdsIssue, "id" | "severity" | "spend_affected">>(issues: T[]): T[] {
  return issues.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      spendSum(b.spend_affected) - spendSum(a.spend_affected) ||
      a.id.localeCompare(b.id),
  );
}

/** Problem checks always look at this many days, whatever KPI window staff pick. */
export const ADS_ISSUE_WINDOW_DAYS = 28;

/** KPI window = whole days 1–90 (default 28); issue window is fixed. */
export function resolveAdsDiagnosticsWindows(days: unknown): { kpiDays: number; issueDays: number } {
  const n = Math.floor(Number(days));
  const kpiDays = Number.isFinite(n) && n >= 1 ? Math.min(n, 90) : ADS_ISSUE_WINDOW_DAYS;
  return { kpiDays, issueDays: ADS_ISSUE_WINDOW_DAYS };
}

/**
 * Error only when the issue touches enough money: ≥ share % of total spend in any
 * currency, or ≥ that currency's floor. Otherwise it is a warning.
 * A currency without a configured floor falls back to the share rule only.
 */
export function severityForSpend(
  affected: Record<string, number>,
  totalSpend: Record<string, number>,
  t: AdsAlertThresholds,
): "error" | "warning" {
  for (const [cur, amount] of Object.entries(affected)) {
    if (amount <= 0) continue;
    const total = totalSpend[cur] ?? 0;
    if (total > 0 && (amount / total) * 100 >= t.severity_spend_share_pct) return "error";
    const floor = t.severity_spend_floor[cur];
    if (floor != null && amount >= floor) return "error";
  }
  return "warning";
}

/** Currencies with spend but no configured floor (settings prompt). */
export function currenciesMissingFloor(totalSpend: Record<string, number>, t: AdsAlertThresholds): string[] {
  return Object.keys(totalSpend).filter((c) => (totalSpend[c] ?? 0) > 0 && t.severity_spend_floor[c] == null);
}

/** Clicks → visits above this ratio means GA4 and Meta are measuring different traffic, not a loss. */
export const CLICKS_VISITS_MISMATCH_RATIO = 1.1;

export function isClicksVisitsMismatch(ratio: number | null | undefined): boolean {
  return ratio != null && ratio > CLICKS_VISITS_MISMATCH_RATIO;
}

/** Clicks → visits: warn below the floor, or on a relative drop vs the trailing baseline. Mismatched windows never warn. */
export function clicksVisitsIssue(
  current: { clicks: number; visits: number },
  baselineRatio: number | null,
  t: AdsAlertThresholds,
): { ratio: number; reason: "floor" | "drop" } | null {
  if (current.clicks < t.ratio_min_clicks) return null;
  const ratio = current.visits / current.clicks;
  if (isClicksVisitsMismatch(ratio)) return null;
  if (ratio * 100 < t.clicks_visits_floor_pct) return { ratio, reason: "floor" };
  if (baselineRatio != null && baselineRatio > 0 && !isClicksVisitsMismatch(baselineRatio)) {
    const dropPct = ((baselineRatio - ratio) / baselineRatio) * 100;
    if (dropPct >= t.clicks_visits_drop_pct) return { ratio, reason: "drop" };
  }
  return null;
}

const META_ID_RE = /^\d{6,25}$/;

/**
 * Which campaign a Meta-tagged visit belongs to: numeric utm_id, else numeric
 * utm_campaign (some setups put the id there), else the utm_campaign name.
 * Null when the visit has no campaign tag at all.
 */
export function unrecognizedCampaignKey(c: { utm_id: string | null; campaign: string | null }): {
  key: string;
  campaign_id: string | null;
  campaign_name: string;
} | null {
  const utmId = (c.utm_id ?? "").trim();
  const name = (c.campaign ?? "").trim();
  const nameIsTag = name !== "" && name !== "(not set)" && name !== "(direct)" && name !== "(organic)";
  if (META_ID_RE.test(utmId)) return { key: utmId, campaign_id: utmId, campaign_name: nameIsTag && name !== utmId ? name : utmId };
  if (META_ID_RE.test(name)) return { key: name, campaign_id: name, campaign_name: name };
  if (nameIsTag) return { key: name, campaign_id: null, campaign_name: name };
  return null;
}

/**
 * Severity for a campaign outside every connected ad account. Known external
 * campaigns are always info; the share rule only applies with enough paid Meta visits.
 */
export function unrecognizedCampaignSeverity(
  input: { visits: number; paidMetaVisits: number; known: boolean },
  t: AdsAlertThresholds,
): AdsIssueSeverity | null {
  if (input.visits < t.unrecognized_campaign_min_visits) return null;
  if (input.known) return "info";
  if (input.visits >= t.unrecognized_campaign_error_visits) return "error";
  if (
    input.paidMetaVisits >= t.unrecognized_campaign_share_min_visits &&
    (input.visits / input.paidMetaVisits) * 100 >= t.unrecognized_campaign_error_share_pct
  ) {
    return "error";
  }
  return "warning";
}

export function unclearShareIssue(paid: number, unclear: number, t: AdsAlertThresholds): number | null {
  const total = paid + unclear;
  if (total < t.unclear_min_sessions) return null;
  const share = (unclear / total) * 100;
  return share > t.unclear_share_pct ? share : null;
}

/** Relative gap between GA4 lead events and ledger submissions, in percent (0–100). */
export function leadGapPct(ga4Leads: number, ledgerSubmissions: number): number | null {
  const max = Math.max(ga4Leads, ledgerSubmissions);
  if (max === 0) return null;
  return (Math.abs(ga4Leads - ledgerSubmissions) / max) * 100;
}

export const LEAD_GAP_MIN_OVERLAP_DAYS = 7;

/** GA4 paid leads vs ledger submissions over the days both sources cover (GA4-exported, on/after the ledger's first full day). */
export type LeadGapCompare = { days: number; ga4_leads: number; submissions: number };

/** Enough shared days and at least one ledger submission — otherwise the gap says nothing. */
export function leadGapComparable(c: LeadGapCompare): boolean {
  return c.days >= LEAD_GAP_MIN_OVERLAP_DAYS && c.submissions > 0;
}

/**
 * Until the trailing 28 days are comparable a fixed gap threshold applies; afterwards
 * we warn only when the gap widens by ≥ N points vs that baseline.
 */
export function ga4LedgerGapIssue(
  cmp: { current: LeadGapCompare; baseline: LeadGapCompare },
  t: AdsAlertThresholds,
): boolean {
  if (!leadGapComparable(cmp.current)) return false;
  const gapPct = leadGapPct(cmp.current.ga4_leads, cmp.current.submissions);
  if (gapPct == null) return false;
  const baselineGapPct = leadGapComparable(cmp.baseline) ? leadGapPct(cmp.baseline.ga4_leads, cmp.baseline.submissions) : null;
  if (baselineGapPct == null) return gapPct >= t.ga4_ledger_gap_bootstrap_pct;
  return gapPct - baselineGapPct >= t.ga4_ledger_gap_widen_pts;
}

/**
 * GA4 sees paid leads but the ledger has none in the window. Info when the ledger never
 * recorded a non-test lead (new setup / local copy); warning when it did and stopped.
 */
export function ledgerNotRecordingIssue(input: {
  ga4Configured: boolean;
  ga4Leads: number;
  submissions: number;
  /** Latest non-test ledger row (ms), any time. */
  lastRecordedAt: number | null;
}): { severity: "info" | "warning"; lastRecordedAt: number | null } | null {
  if (!input.ga4Configured || input.ga4Leads <= 0 || input.submissions > 0) return null;
  return { severity: input.lastRecordedAt == null ? "info" : "warning", lastRecordedAt: input.lastRecordedAt };
}

/** Ask-region accept rate drop vs trailing 28 days (relative %, volume guard 100 impressions). */
export function consentRateDrop(
  current: { shown: number; granted: number; decided: number },
  baselineRate: number | null,
  minImpressions = 100,
  dropPct = 30,
): number | null {
  if (current.shown < minImpressions || current.decided === 0 || baselineRate == null || baselineRate <= 0) return null;
  const rate = current.granted / current.decided;
  const drop = ((baselineRate - rate) / baselineRate) * 100;
  return drop >= dropPct ? drop : null;
}

/** Parse `url_tags` / a destination query string into lowercase params. */
export function parseTrackingParams(raw: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  const q = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
  for (const part of q.split(/[&#]/)) {
    const [k, v = ""] = part.split("=");
    if (k) out[k.trim().toLowerCase()] = decodeSafe(v.trim());
  }
  return out;
}

function decodeSafe(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Which required template params an ad is missing (ids enable matching). */
export function missingTemplateParams(params: Record<string, string>): string[] {
  const required = ["utm_source", "utm_medium", "utm_id", "utm_content"];
  return required.filter((k) => !params[k]);
}

export function hasNonPaidMedium(params: Record<string, string>): boolean {
  return !!params.utm_medium && !params.utm_medium.includes("{{") && !isPaidMedium(params.utm_medium);
}

/** Tracking params lost across redirects (present on the ad URL, missing on the final URL). */
export function droppedParams(original: string, final: string): string[] {
  const a = parseTrackingParams(original);
  const b = parseTrackingParams(final);
  return Object.keys(a).filter((k) => (k.startsWith("utm_") || k.endsWith("clid")) && !(k in b));
}

// ── UTM convention / GA4 standard ───────────────────────────────────────────

/** Old convention values still accepted while a change settles (28 days). */
export type UtmGrace = {
  active: boolean;
  changed_at: string | null;
  ends_at: string | null;
  accepted: Partial<Record<UtmConventionPlatform, { sources: string[]; mediums: string[] }>>;
  campaign_patterns: string[];
};

export const NO_UTM_GRACE: UtmGrace = { active: false, changed_at: null, ends_at: null, accepted: {}, campaign_patterns: [] };

export type UtmViolation = { code: UtmIssueCode; param: string; value: string; expected: string | null; in_grace?: boolean };

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_term", "utm_content"] as const;
const UTM_MACRO_RE = /\{\{[^}]*\}\}|\{[a-z_]+\}/i;
const UTM_BAD_CHARS_RE = /[^a-z0-9._+-]/i;
const UTM_NUMERIC_ID_RE = /^\d{6,25}$/;

export function isUtmMacro(v: string | null | undefined): boolean {
  return !!v && UTM_MACRO_RE.test(v);
}

function conventionPlatform(platform: AdPlatform | string | null): UtmConventionPlatform | null {
  return platform === "meta" || platform === "google" ? platform : null;
}

function graceAccepts(grace: UtmGrace | null | undefined, p: UtmConventionPlatform, kind: "sources" | "mediums", v: string): boolean {
  return !!grace?.active && (grace.accepted[p]?.[kind] ?? []).includes(v);
}

function safeTest(pattern: string, v: string): boolean {
  try {
    return new RegExp(pattern).test(v);
  } catch {
    return true;
  }
}

/** Human list of correct sources ("fb, ig, msg or an"). */
export function utmExpectedSources(c: UtmConvention, p: UtmConventionPlatform): string {
  const list = c.sources[p].canonical;
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}` : list[0]!;
}

/**
 * UTM problems in one set of params. Universal rules apply to any paid traffic; platform rules
 * only where the convention defines the platform (meta, google). `declared` = an ad setup / URL
 * suffix, where macros are expected; `observed` = values GA4 or our lead records received.
 * Meta ids stay on missing_tracking_params; utm_medium_off_convention is skipped for unpaid
 * mediums (non_paid_medium) and for mediums already flagged as non-standard.
 */
export function utmViolations(input: {
  params: Record<string, string | null | undefined>;
  platform: AdPlatform | string | null;
  convention: UtmConvention;
  grace?: UtmGrace | null;
  kind: "declared" | "observed";
}): UtmViolation[] {
  const { params, convention: c, grace, kind } = input;
  const out: UtmViolation[] = [];
  const raw = (k: string) => (params[k] ?? "").toString();
  const anyUtm = UTM_KEYS.some((k) => raw(k).trim() !== "");
  if (!anyUtm) return out;

  if (kind === "observed") {
    for (const k of UTM_KEYS) {
      const v = raw(k);
      if (v && isUtmMacro(v)) out.push({ code: "utm_unfilled_macro", param: k, value: v, expected: null });
    }
  }
  for (const k of ["utm_source", "utm_medium"]) {
    const v = raw(k);
    if (!v || isUtmMacro(v)) continue;
    if (c.case === "lowercase" && v !== v.toLowerCase()) out.push({ code: "utm_case_mixed", param: k, value: v, expected: v.toLowerCase() });
    if (v !== v.trim() || UTM_BAD_CHARS_RE.test(v.trim())) {
      out.push({ code: "utm_bad_chars", param: k, value: v, expected: v.trim().toLowerCase().replace(/[^a-z0-9._+-]+/g, c.separator) });
    }
  }

  const p = conventionPlatform(input.platform);
  const mediumRaw = raw("utm_medium");
  const medium = mediumRaw.trim().toLowerCase();
  const mediumIsMacro = isUtmMacro(mediumRaw);
  const nonstandard = !!medium && !mediumIsMacro && isPaidMedium(medium) && !isGa4StandardPaidMedium(medium);
  if (nonstandard) out.push({ code: "utm_medium_nonstandard", param: "utm_medium", value: mediumRaw, expected: p ? c.mediums[p] : null });
  if (!p) return out;

  const sourceRaw = raw("utm_source");
  const source = sourceRaw.trim().toLowerCase();
  if (source) {
    if (isUtmMacro(sourceRaw)) {
      if (kind === "declared" && p === "meta") {
        const want = metaTemplateSource(c);
        if (sourceRaw.replace(/\s+/g, "") !== want) out.push({ code: "utm_source_alias", param: "utm_source", value: sourceRaw, expected: want });
      }
    } else if (!c.sources[p].canonical.includes(source)) {
      const v: UtmViolation = { code: "utm_source_alias", param: "utm_source", value: sourceRaw, expected: kind === "declared" && p === "meta" ? metaTemplateSource(c) : utmExpectedSources(c, p) };
      if (graceAccepts(grace, p, "sources", source)) v.in_grace = true;
      out.push(v);
    }
  }

  if (medium && !mediumIsMacro && isPaidMedium(medium) && !nonstandard && medium !== c.mediums[p]) {
    const v: UtmViolation = { code: "utm_medium_off_convention", param: "utm_medium", value: mediumRaw, expected: c.mediums[p] };
    if (graceAccepts(grace, p, "mediums", medium)) v.in_grace = true;
    out.push(v);
  }

  const campaign = raw("utm_campaign");
  if (c.campaign_pattern && campaign && !isUtmMacro(campaign) && !safeTest(c.campaign_pattern, campaign)) {
    const v: UtmViolation = { code: "utm_campaign_pattern", param: "utm_campaign", value: campaign, expected: c.campaign_pattern };
    if (grace?.active && grace.campaign_patterns.some((old) => safeTest(old, campaign))) v.in_grace = true;
    out.push(v);
  }

  if (p === "google" && c.require_ids) {
    for (const k of ["utm_id", "utm_term"]) {
      const v = raw(k).trim();
      const ok = v !== "" && (isUtmMacro(v) ? kind === "declared" : UTM_NUMERIC_ID_RE.test(v));
      if (!ok) out.push({ code: "utm_missing_ids", param: k, value: v, expected: k === "utm_id" ? "{campaignid}" : "{adgroupid}" });
    }
  }
  return out;
}

/** Codes whose issue never escalates past info. */
const UTM_INFO_CODES = new Set<UtmIssueCode>(["utm_campaign_pattern"]);

/**
 * Severity for one utm_* issue. Grace / exceptions / known external campaigns → info.
 * With spend behind it: the spend rule (unfilled macros are always errors). Without spend:
 * skipped below `utm_issue_min_visits`, error at ≥ `utm_issue_error_visits`.
 */
export function utmIssueSeverity(
  code: UtmIssueCode,
  input: { spend: Record<string, number>; totalSpend: Record<string, number>; visits: number; inGrace: boolean; excepted: boolean },
  t: AdsAlertThresholds,
): AdsIssueSeverity | null {
  const hasSpend = Object.values(input.spend).some((v) => v > 0);
  if (!hasSpend && input.visits < t.utm_issue_min_visits) return null;
  if (input.inGrace || input.excepted || UTM_INFO_CODES.has(code)) return "info";
  if (code === "utm_unfilled_macro") return "error";
  if (hasSpend) return severityForSpend(input.spend, input.totalSpend, t);
  return input.visits >= t.utm_issue_error_visits ? "error" : "warning";
}
