import type { AdsIssue, UtmGrace } from "@shared/ads-diagnostics-rules";
import type { UtmConvention, UtmConventionRejection } from "@shared/ads-settings";
import type { AttributionModel } from "@shared/paid-attribution";
import type { AdPlatform, GoogleNetworkRow, MetaPlacementRow } from "@shared/paid-traffic";
import type { AdsRefreshStatus } from "@shared/ads-refresh-status";
import type { AdsIssueRow, AdsResolvedRow, AdsRunInfo } from "@shared/ads-issues";

export type { AdsIssueRow, AdsResolvedRow, AdsRunInfo };

export type MoneyByCurrency = Record<string, number>;

export type AdsWarning = { code: string; message: string };

/** Read-only UTM convention (edited in ads-config.yml only). */
export type AdsUtmConventionView = {
  file: string;
  config_error: string | null;
  convention: UtmConvention;
  rejected: UtmConventionRejection[];
  meta_template: string;
  google_template: string;
  grace: UtmGrace & { accepted_old_values: string[] };
  grace_days: number;
  history_file: string;
  standard: { paid_medium_regex: string; display_mediums: readonly string[]; doc_url: string };
};

export type AdsVersionRow = {
  variant: string;
  paid_visits: number;
  unique_leads: number;
  submissions: number;
  conversion_rate: number | null;
  low_sample: boolean;
  /** Non-paid GA4 sessions whose first page test was this version (missing on older snapshots). */
  organic_visits?: number;
  organic_leads?: number;
};

export type AdsCampaignRef = {
  platform: AdPlatform | null;
  campaign_id: string | null;
  campaign_name: string;
  /** Paid visits / site leads we couldn't tie to a known campaign id. Never carries spend. */
  untagged?: true;
  paid_visits: number;
  engaged_sessions: number;
  spend: MoneyByCurrency;
  clicks: number;
  impressions: number;
  landing_page_views: number;
  meta_leads: number;
  /** Meta leads in the 7-day click window; the rest of `meta_leads` saw the ad only. */
  pixel_leads_click: number;
  google_leads: number;
  unique_leads: number;
  cost_per_visit: MoneyByCurrency;
  ctr: number | null;
  cpc: MoneyByCurrency;
  conversion_rate: number | null;
  cost_per_lead: MoneyByCurrency;
  meta_conversion_rate: number | null;
  meta_cost_per_lead: MoneyByCurrency;
  bounce_rate: number | null;
  low_sample: boolean;
  tag_texts?: Array<{ text: string; visits: number }>;
  visits_by_platform?: Partial<Record<AdPlatform, number>>;
};

/** Destinations with no page URL to show (their `title` is the label). */
export const NO_URL_DESTINATION_KINDS = new Set<AdsPageRow["kind"]>(["instant_form", "unknown_destination", "google_lead_form", "calls", "video_views", "app"]);

export type AdsPageRow = {
  key: string;
  kind:
    | "entry"
    | "instant_form"
    | "off_site"
    | "other_site"
    | "missing_page"
    | "unknown_destination"
    | "google_lead_form"
    | "calls"
    | "video_views"
    | "app";
  kind_label: string;
  host: string;
  path: string;
  url: string;
  content_type: string | null;
  slug: string | null;
  locale: string | null;
  title: string;
  redirected_from: string[];
  paid_visits: number;
  matched_visits: number;
  unclear_visits: number;
  /** Only under an account/currency filter: paid Meta visits with no ad tags (not in `paid_visits`). */
  unassigned_visits: number;
  engaged_sessions: number;
  bounce_rate: number | null;
  avg_engaged_seconds: number | null;
  ga4_leads: number;
  spend: MoneyByCurrency;
  clicks: number;
  untagged_clicks: number;
  landing_page_views: number;
  meta_leads: number;
  instant_form_leads: number;
  /** Google-reported lead conversions (never summed with Meta or site leads). */
  google_leads?: number;
  impressions: number;
  pixel_leads_click: number;
  unique_leads: number;
  submissions: number;
  repeat_submissions: number;
  last_visit_organic: number;
  started_here: number;
  closed_here: number;
  conversion_rate: number | null;
  meta_conversion_rate: number | null;
  ctr: number | null;
  landing_rate: number | null;
  lpv_to_visits: number | null;
  cost_per_visit: MoneyByCurrency;
  cost_per_lead: MoneyByCurrency;
  cpc: MoneyByCurrency;
  cpm: MoneyByCurrency;
  meta_cost_per_lead: MoneyByCurrency;
  clicks_to_visits: number | null;
  organic: { sessions: number; bounce_rate: number | null; lead_rate: number | null } | null;
  low_sample: boolean;
  meta_low_sample: boolean;
  platforms: AdPlatform[];
  /** Every campaign on this row; the untagged row (if any) is last. */
  campaigns: AdsCampaignRef[];
  /** Campaigns (untagged excluded) with enough paid visits for rates. */
  comparable_campaigns?: number;
  versions?: AdsVersionRow[];
  /** Days in the window when an ad moved to / from this page (that day's numbers are approximate). */
  url_change_days?: number;
  url_change_spend?: MoneyByCurrency;
  url_changes?: AdsRowUrlChange[];
  /** Older spend from untagged ads assumed to go to this page (before URL history started). */
  unconfirmed_page_spend?: MoneyByCurrency;
};

export type AdsRowUrlChange = {
  ad_id: string;
  ad_name: string;
  date: string;
  from_url: string;
  to_url: string;
  /** `ga4`: split by where that day's visits landed; `whole_day_new`: no visits seen, all to the new page. */
  basis: "ga4" | "whole_day_new";
  inferred: boolean;
};

export type AdsUrlHistory = { since: string | null; recomputed_at: string | null };

export type AdsCampaignGroup = {
  key: string;
  platform: AdPlatform | null;
  campaign_id: string | null;
  campaign_name: string;
  spend: MoneyByCurrency;
  clicks: number;
  meta_leads: number;
  google_leads?: number;
  paid_visits: number;
  pages: Array<{ key: string; title: string; path: string; paid_visits: number }>;
};

export type AdsGoogleStatus = {
  connected: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  /** Newest day the BigQuery transfer loaded for every connected account. */
  data_through: string | null;
  expected_through: string;
  accounts: Array<{ id: string; name?: string | null; currency?: string | null; history_loaded?: boolean; data_through?: string | null; auto_tagging?: boolean | null; sync_error?: string }>;
  unconnected_accounts: Array<{ customer_id: string; paid_visits: number }>;
  available_accounts: string[];
};

export type AdsGoogleNetworkRow = {
  network: GoogleNetworkRow;
  spend: MoneyByCurrency;
  clicks: number;
  impressions: number;
  paid_visits: number;
};

export type AdsGoogleNetworks = { rows: AdsGoogleNetworkRow[]; not_split_share: number | null };

export type AdsMetaStatus = {
  connected: boolean;
  /** `production_snapshot`: a dev copy downloaded from production that this server cannot re-sync. */
  source?: "sync" | "production_snapshot";
  pulled_at?: string;
  last_date?: string;
  production_origin?: string;
  last_synced_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  accounts: Array<{ id: string; name?: string; currency?: string; history_loaded?: boolean; sync_error?: string }>;
};

export type AdsGa4Status = {
  configured: boolean;
  last_synced_at: string | null;
  last_export_date: string | null;
  last_error: string | null;
  /** GA4 days in the window still read with the older paid-visit rule. */
  old_rule_days?: number;
  attributed_only_unavailable_reason?: string | null;
};

/** Sessions GA4 credits to ads that had no ad evidence on the landing URL (not counted as paid). */
export type AdsAttributedOnlyVisits = { total: number; by_host: Array<{ host: string; sessions: number }> };

export type AdsReport = {
  window: { start: string; end: string; days: number };
  platform: AdPlatform | "all";
  attribution: { model: AttributionModel; lookback_days: 30; basis: "browser_observed"; url_history?: AdsUrlHistory };
  meta: AdsMetaStatus;
  google?: AdsGoogleStatus;
  ga4: AdsGa4Status;
  refreshing: boolean;
  refresh: AdsRefreshStatus;
  collecting_since: string | null;
  covered_days: { covered: number; total: number };
  consent: { mode: "advanced"; ask_region_reject_pct: number | null; ask_region_shown: number };
  totals: {
    spend: MoneyByCurrency;
    tracked_spend: MoneyByCurrency;
    clicks: number;
    landing_page_views: number;
    paid_visits: number;
    unclear_visits: number;
    matched_visits: number;
    unmatched_meta_visits: number;
    unassigned_visits: number;
    unsynced_account_visits: number;
    ratio_clicks: number;
    untagged_clicks: number;
    impressions: number;
    pixel_leads_click: number;
    meta_leads: number;
    instant_form_leads: number;
    google_leads?: number;
    ga4_leads: number;
    unique_leads: number;
    submissions: number;
    repeat_submissions: number;
    test_submissions: number;
    /** Undefined on reports saved before this field existed; null = can't measure. */
    attributed_only_visits?: AdsAttributedOnlyVisits | null;
    unconfirmed_page_spend?: MoneyByCurrency;
  };
  meta_split_days?: { covered: number; total: number };
  pages: AdsPageRow[];
  destinations: AdsPageRow[];
  campaigns: AdsCampaignGroup[];
  google_networks?: AdsGoogleNetworks;
  thresholds: { min_paid_visits_for_rates: number };
  warnings: AdsWarning[];
};

export type AdsEntriesResponse = Pick<
  AdsReport,
  "window" | "platform" | "attribution" | "meta" | "ga4" | "refreshing" | "refresh" | "covered_days" | "consent" | "thresholds" | "warnings"
> & { entries: AdsPageRow[] };

export type AdsMetaPlatformRow = {
  platform: MetaPlacementRow;
  spend: MoneyByCurrency;
  clicks: number;
  meta_leads: number;
  paid_visits: number;
  unique_leads: number;
  cost_per_lead: MoneyByCurrency | null;
  conversion_rate: number | null;
  low_sample: boolean;
};

export type AdsMetaPlatforms = {
  rows: AdsMetaPlatformRow[];
  excluded_spend: { instant_form: MoneyByCurrency; off_site: MoneyByCurrency; unknown: MoneyByCurrency };
  spend_since: string | null;
  spend_partial: boolean;
  not_split_share: number | null;
};

export type AdsMetaConversionCount = { key: string; name: string; count: number };
export type AdsSiteConversionCount = { name: string; count: number };

/** GET /api/ads/meta/conversions — Settings → Ads → Meta lead conversion picker. */
export type MetaLeadConversionOptions = {
  token_configured: boolean;
  options: Array<{
    key: string;
    name: string;
    pixel_id: string | null;
    pixel_name: string | null;
    custom_event_type: string | null;
    last_fired_time: string | null;
    archived: boolean;
    accounts: string[];
    missing_accounts: string[];
  }>;
  accounts: Array<{ id: string; source: "live" | "cache" | "none"; error?: string }>;
  unlisted_picked: Array<{ key: string; name: string }>;
  overlaps: Array<{ keys: [string, string]; names: [string, string]; both_days_pct: number; count_diff_pct: number }>;
};

export type AdsDiagnostics = {
  generated_at: string;
  window_days: number;
  issue_window_days: number;
  status: "not_connected" | "ok" | "warnings" | "errors";
  meta: AdsMetaStatus;
  ga4: AdsGa4Status;
  refreshing: boolean;
  refresh: AdsRefreshStatus;
  collecting_since: string | null;
  kpis: {
    tracked_spend: MoneyByCurrency;
    spend: MoneyByCurrency;
    open_errors: number;
    open_warnings: number;
    meta_leads: number;
    site_leads: number;
    /** Missing on snapshots built before lead conversions shipped. */
    meta_conversions?: AdsMetaConversionCount[];
    site_conversions?: AdsSiteConversionCount[];
    /** Empty = nothing picked in Settings → Ads → Meta, counting the standard Lead event. */
    meta_lead_conversions_picked?: string[];
    lead_conversions_changed_at?: string | null;
    meta_conversions_incomplete_days?: number;
    snapshot_lacks_conversions?: boolean;
    repeat_submissions: number;
    clicks_to_visits_pct: number | null;
    clicks_to_visits_mismatch: boolean;
    unmatched_meta_visits: number;
    untagged_clicks: number;
    meta_unclear_pct: number | null;
    consent_accept_pct: number | null;
  };
  missing_floor_currencies: string[];
  /** When Meta spend started following each ad's link history (drives the 14-day notice). */
  url_history?: AdsUrlHistory | null;
  /** Missing on snapshots built before the placement split shipped. */
  meta_platforms?: AdsMetaPlatforms | null;
  /** From the last Run / Re-check (saved), not built on this read. */
  issues: AdsIssueRow[];
  resolved: AdsResolvedRow[];
  utm_template: string;
  /** Missing on servers before the UTM validator shipped. */
  utm_convention?: AdsUtmConventionView;
  warnings: AdsWarning[];
  run: AdsRunInfo;
};

export type AdsDiagnosticsStatus = AdsDiagnostics["status"];

/** GET /api/diagnostics/ads?platform=google */
export type GoogleAdsDiagnostics = {
  generated_at: string;
  platform: "google";
  window_days: number;
  issue_window_days: number;
  status: AdsDiagnosticsStatus;
  google: AdsGoogleStatus & { visit_match: { ga4_link: number; gclid: number; tags: number; none: number } };
  ga4: AdsGa4Status;
  refreshing: boolean;
  refresh: AdsRefreshStatus;
  collecting_since: string | null;
  kpis: {
    spend: MoneyByCurrency;
    tracked_spend: MoneyByCurrency;
    no_site_spend: MoneyByCurrency;
    open_errors: number;
    open_warnings: number;
    google_leads: number;
    site_leads: number;
    paid_visits: number;
    clicks: number;
    clicks_to_visits_pct: number | null;
    matched_visits_pct: number | null;
  };
  networks: AdsGoogleNetworks | null;
  matching: { ga4_link_available: boolean | null; gclid_join_tables: number; gclid_join_error: string | null };
  issues: AdsIssueRow[];
  resolved: AdsResolvedRow[];
  url_suffix_template: string;
  utm_convention?: AdsUtmConventionView;
  warnings: AdsWarning[];
  run: AdsRunInfo;
};

export type AdsPlatformCard = {
  connected: boolean;
  status: AdsDiagnosticsStatus;
  open_errors: number;
  open_warnings: number;
  spend: MoneyByCurrency;
  platform_leads: number;
  site_leads: number;
  last_synced_at: string | null;
  data_through?: string | null;
  top_issues: Array<Pick<AdsIssue, "id" | "code" | "title" | "severity">>;
};

/** GET /api/diagnostics/ads?platform=overview */
export type AdsDiagnosticsOverview = {
  generated_at: string;
  platform: "overview";
  window_days: number;
  status: AdsDiagnosticsStatus;
  open_errors: number;
  open_warnings: number;
  platforms: { meta: AdsPlatformCard; google: AdsPlatformCard };
  shared_issues: AdsIssueRow[];
  totals: { spend: MoneyByCurrency; site_leads: number; paid_visits: number };
  run: AdsRunInfo;
};

/** GET /api/diagnostics/ads?issue_ids=… — full ads lists for a few issues. */
export type AdsIssueDetailResponse = {
  generated_at: string;
  issue_window_days: number;
  issues: AdsIssueRow[];
  missing_issue_ids: string[];
  run: AdsRunInfo;
};
