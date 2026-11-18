/**
 * Google Ads diagnostics (`/private/diagnostics/ads/google`): BigQuery transfer health,
 * account coverage, visit matching (GA4 link / gclid join / URL suffix), spend that never
 * reaches the site, and Google-reported leads. Pure rules in `googleIssues`; the build
 * gathers the Google-only report, sync state and GA4 paid-landing state.
 * Issue state lives in its own file so Meta and Google Resolved lists never mix.
 */

import { getAdsSettings } from "../settings";
import type { ContentIndex } from "../content-index";
import {
  ADS_ISSUE_WINDOW_DAYS,
  parseTrackingParams,
  severityForSpend,
  sortAdsIssues,
  type AdsIssue,
  type UtmGrace,
} from "@shared/ads-diagnostics-rules";
import {
  adsThresholds,
  DEFAULT_GOOGLE_ADS_SETTINGS,
  formatGoogleCustomerId,
  isKnownExternalCampaign,
  type AdsAlertThresholds,
  type GoogleAdsSettings,
  type UtmConvention,
} from "@shared/ads-settings";
import { googleSuffixHasIds } from "@shared/paid-traffic";
import { buildAdsReport, type AdsReport, type MoneyByCurrency } from "./ads-report";
import { GOOGLE_BACKFILL_DAYS, loadGoogleSetups, loadGoogleState, type GoogleAdsSetups, type GoogleAdsSyncState } from "./google-ads-days";
import { addDays, utcDate } from "./meta-ads-days";
import { lastCompleteGa4Date, loadPaidLandingState, type PaidLandingState } from "./paid-detection";
import { utmGraceState } from "./utm-convention-history";
import { loadObservedUtmGroups, utmIssues, type DeclaredUtm, type ObservedUtmGroup } from "./utm-issues";
import { loadAdsSetup } from "./ads-setup";
import {
  accountLocationDiagnosticIssues,
  makeLandingPageLocationsLookup,
} from "./account-location-diagnostics";
import { getDefaultContentRoot } from "../site-config";

/** Transfer more than this many days behind "expected through" is an error, not a warning. */
export const GOOGLE_STALE_ERROR_DAYS = 3;
/** Google spend without a reported landing page above this share of Google spend is a warning. */
export const GOOGLE_UNKNOWN_DESTINATION_WARN_PCT = 20;

export type GoogleChecks = {
  generated_at: string;
  window: { start: string; end: string; days: number };
  connected: boolean;
  issues: AdsIssue[];
};

export const NO_SITE_KINDS = new Set(["google_lead_form", "calls", "video_views", "app"]);
const NO_SITE_COPY: Record<string, { label: string; why: string }> = {
  google_lead_form: { label: "Google lead forms", why: "people fill a form inside Google, so no site visit happens" },
  calls: { label: "Calls", why: "people call from the ad without visiting the site" },
  video_views: { label: "Video views", why: "YouTube video campaigns pay for views, not site visits" },
  app: { label: "App campaigns", why: "app campaigns send people to an app store" },
};

function addMoney(into: MoneyByCurrency, from: MoneyByCurrency): void {
  for (const [c, v] of Object.entries(from)) into[c] = Math.round(((into[c] ?? 0) + v) * 100) / 100;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export type GoogleIssueInput = {
  /** Google-only report over the issue window. */
  report: AdsReport;
  state: GoogleAdsSyncState;
  setups: GoogleAdsSetups;
  settings: GoogleAdsSettings;
  paidState: PaidLandingState;
  t: AdsAlertThresholds;
  now: Date;
  /** UTM convention checks (final URL suffixes + paid Google visits / leads); skipped when omitted. */
  utm?: { convention: UtmConvention; grace: UtmGrace; observed: ObservedUtmGroup[] };
};

/** Pure: every Google issue for one build. */
export function googleIssues(input: GoogleIssueInput): AdsIssue[] {
  const { report, state, setups, settings, paidState, t, now } = input;
  const g = report.google;
  const issues: AdsIssue[] = [];
  const totalSpend = report.totals.spend;
  const today = utcDate(now);
  const push = (i: Omit<AdsIssue, "platform">) => issues.push({ ...i, platform: "google" });

  // Sync / access
  if ((state.consecutive_failures ?? 0) >= 2) {
    const denied = /access denied|permission|403/i.test(state.last_error ?? "");
    push({
      id: "google_sync_failing",
      code: "google_sync_failing",
      severity: "error",
      title: denied ? "We can't read the Google Ads transfer" : "Google Ads sync keeps failing",
      why: `The last ${state.consecutive_failures} syncs failed (${state.last_error ?? "unknown error"}). Google numbers here may be out of date.`,
      how_to_fix: denied
        ? "Give the server's service account BigQuery Data Viewer on the transfer dataset and Job User on the project, then press Test connection in Settings → Ads → Google Ads."
        : "Press Sync now in Settings → Ads → Google Ads. If it fails again, check the project and dataset there.",
      spend_affected: {},
      scope: {},
      site_fixable: false,
    });
  }

  // Transfer late
  if (g.data_through && g.data_through < g.expected_through) {
    const behind = daysBetween(g.data_through, g.expected_through);
    push({
      id: "google_transfer_stale",
      code: "google_transfer_stale",
      severity: behind > GOOGLE_STALE_ERROR_DAYS ? "error" : "warning",
      title: "Google Ads transfer is late",
      why: `BigQuery has Google data through ${g.data_through}, but should have it through ${g.expected_through} (${behind} day(s) behind). Newer Google spend and leads are missing, not zero.`,
      how_to_fix: "In Google Cloud → BigQuery → Data transfers, open the Google Ads transfer and check its run history. Re-authorize it if runs fail.",
      spend_affected: {},
      scope: {},
      site_fixable: false,
    });
  }

  // Ticked accounts the transfer doesn't cover
  const available = new Set(state.available_customers ?? []);
  for (const id of settings.customer_ids) {
    const c = state.customers[id];
    const subAccounts = state.manager_customers?.[id];
    const missing = (state.available_customers && !available.has(id)) || /no tables/i.test(c?.sync_error ?? "");
    if (subAccounts) {
      push({
        id: `google_transfer_missing_account:${id}`,
        code: "google_transfer_missing_account",
        severity: "error",
        title: `Manager account ticked instead of its accounts: ${formatGoogleCustomerId(id)}`,
        why: `${formatGoogleCustomerId(id)} is the manager account the transfer runs on. Spend belongs to the accounts under it (${subAccounts.map(formatGoogleCustomerId).join(", ")}), so nothing is counted for the manager itself.`,
        how_to_fix: "In Settings → Ads → Google Ads, untick the manager account and tick the accounts this site reports on.",
        spend_affected: {},
        scope: { account_id: id },
        site_fixable: false,
      });
    } else if (missing) {
      push({
        id: `google_transfer_missing_account:${id}`,
        code: "google_transfer_missing_account",
        severity: "error",
        title: `Google Ads account not in the transfer: ${c?.name || formatGoogleCustomerId(id)}`,
        why: `Account ${formatGoogleCustomerId(id)} is ticked in Settings, but the BigQuery transfer has no tables for it. Its spend is missing from every report.`,
        how_to_fix:
          "In Google Cloud → BigQuery → Data transfers, edit the Google Ads transfer and include this account (or its manager account). Or untick it in Settings → Ads → Google Ads.",
        spend_affected: {},
        scope: { account_id: id },
        site_fixable: false,
      });
    } else if (c?.sync_error) {
      push({
        id: `google_transfer_missing_account:${id}`,
        code: "google_transfer_missing_account",
        severity: "warning",
        title: `Couldn't read Google Ads account: ${c.name || formatGoogleCustomerId(id)}`,
        why: `The last sync couldn't read ${formatGoogleCustomerId(id)}: ${c.sync_error} Other accounts are unaffected.`,
        how_to_fix: "Press Sync now in Settings → Ads → Google Ads. If it keeps failing, check the transfer tables for this account in BigQuery.",
        spend_affected: {},
        scope: { account_id: id },
        site_fixable: false,
      });
    }
  }

  // Short history
  const wantedSince = addDays(today, -(GOOGLE_BACKFILL_DAYS - 7));
  for (const id of settings.customer_ids) {
    const c = state.customers[id];
    if (!c?.first_date || !c.history_loaded_at || c.first_date <= wantedSince) continue;
    push({
      id: `google_history_short:${id}`,
      code: "google_history_short",
      severity: "info",
      title: `Google history starts ${c.first_date}: ${c.name || formatGoogleCustomerId(id)}`,
      why: `The BigQuery transfer only has data for this account since ${c.first_date}, so trends and comparisons before then are empty.`,
      how_to_fix: "In the Google Ads transfer, use Schedule backfill for the older dates you need. The next sync picks them up.",
      spend_affected: {},
      scope: { account_id: id },
      site_fixable: false,
    });
  }

  // Paid Google visits from accounts nobody ticked
  for (const u of g.unconnected_accounts) {
    if (u.paid_visits < t.unrecognized_campaign_min_visits) continue;
    if (isKnownExternalCampaign(settings.known_external_campaigns, u.customer_id)) continue;
    push({
      id: `google_account_not_connected:${u.customer_id}`,
      code: "google_account_not_connected",
      severity: "info",
      title: `Google Ads account not connected: ${formatGoogleCustomerId(u.customer_id)}`,
      why: `${u.paid_visits} paid visits came from Google Ads account ${formatGoogleCustomerId(u.customer_id)}, which isn't ticked here. Its visits and leads show, but its spend doesn't.`,
      how_to_fix: available.has(u.customer_id)
        ? "Tick it in Settings → Ads → Google Ads if this site should report its spend."
        : "Add it to the BigQuery transfer, then tick it in Settings → Ads → Google Ads. If an agency runs it, you can ignore this.",
      spend_affected: {},
      scope: { account_id: u.customer_id },
      site_fixable: false,
    });
  }

  // Auto-tagging off and no id suffix
  const campaignSpend = new Map(report.campaigns.filter((c) => c.platform === "google" && c.campaign_id).map((c) => [c.campaign_id!, c]));
  for (const id of settings.customer_ids) {
    if (state.customers[id]?.auto_tagging !== false) continue;
    const spend: MoneyByCurrency = {};
    const names: string[] = [];
    for (const [cid, info] of Object.entries(setups.campaigns)) {
      if (info.customer_id !== id || googleSuffixHasIds(info.final_url_suffix)) continue;
      const c = campaignSpend.get(cid);
      if (!c || Object.keys(c.spend).length === 0) continue;
      addMoney(spend, c.spend);
      names.push(c.campaign_name);
    }
    if (names.length === 0) continue;
    push({
      id: `google_auto_tagging_off:${id}`,
      code: "google_auto_tagging_off",
      severity: severityForSpend(spend, totalSpend, t),
      title: `Auto-tagging is off: ${state.customers[id]?.name || formatGoogleCustomerId(id)}`,
      why: `Without auto-tagging (or the URL suffix), visits from ${names.length} campaign(s) can't be tied to Google Ads, so they look like search or unpaid traffic.`,
      how_to_fix: "In Google Ads → Admin → Account settings, turn on Auto-tagging. If you can't, paste the URL suffix from Settings → Ads → Google Ads into Final URL suffix.",
      spend_affected: spend,
      scope: { account_id: id },
      site_fixable: false,
    });
  }

  // Visit matching
  const vm = g.visit_match;
  const googleVisits = vm.ga4_link + vm.gclid + vm.tags + vm.none;
  if (googleVisits >= t.min_paid_visits_for_rates && vm.ga4_link === 0) {
    const exportLacks = paidState.google_link_available === false;
    push({
      id: "google_ga4_not_linked",
      code: "google_ga4_not_linked",
      severity: vm.gclid + vm.tags > 0 ? "info" : "warning",
      title: "GA4 isn't linked to Google Ads",
      why: exportLacks
        ? "The GA4 export doesn't include Google Ads campaign fields yet, so we match visits by click id or URL suffix only."
        : `None of the ${googleVisits} paid Google visits carried GA4's Google Ads campaign, so matching falls back to click ids and the URL suffix.`,
      how_to_fix: "In GA4 → Admin → Product links → Google Ads links, link each account. Campaign fields appear in the export from the next day.",
      spend_affected: {},
      scope: {},
      site_fixable: false,
    });
  }
  if (paidState.gclid_join_error) {
    push({
      id: "google_gclid_join_unavailable",
      code: "google_gclid_join_unavailable",
      severity: vm.ga4_link === 0 && googleVisits > 0 ? "warning" : "info",
      title: "Can't join Google clicks to GA4 visits",
      why: `Joining the visit's click id to Google's click table failed: ${paidState.gclid_join_error} Visits are matched by the GA4 link and URL suffix only.`,
      how_to_fix:
        "Keep the GA4 export and the Google Ads transfer in the same BigQuery location (e.g. both US), and give the service account read access to both datasets.",
      spend_affected: {},
      scope: {},
      site_fixable: false,
    });
  }

  // Spend that never reaches the site
  const googleSpendTotal = Object.values(totalSpend).reduce((a, b) => a + b, 0);
  for (const d of report.destinations) {
    if (Object.keys(d.spend).length === 0) continue;
    if (NO_SITE_KINDS.has(d.kind)) {
      const copy = NO_SITE_COPY[d.kind]!;
      push({
        id: `google_destination_policy:${d.kind}`,
        code: "google_destination_policy",
        severity: "info",
        title: `Spend that doesn't reach the site: ${copy.label}`,
        why: `This spend is real, but ${copy.why}. It's listed under Other destinations and left out of cost per lead and cost per visit.`,
        how_to_fix: "Nothing to fix. Compare it with Google-reported leads for these campaigns instead of site leads.",
        spend_affected: d.spend,
        scope: { page_key: d.key },
        site_fixable: false,
      });
    } else if (d.kind === "unknown_destination" && googleSpendTotal > 0) {
      const share = (Object.values(d.spend).reduce((a, b) => a + b, 0) / googleSpendTotal) * 100;
      push({
        id: "google_destination_policy:unknown",
        code: "google_destination_policy",
        severity: share >= GOOGLE_UNKNOWN_DESTINATION_WARN_PCT ? "warning" : "info",
        title: "Google spend without a landing page",
        why: `${Math.round(share)}% of Google spend has no landing page in the transfer (often Performance Max or brand-new ads). We can't put it on a page.`,
        how_to_fix: "Usually fills in after a day. If it stays high, check that the transfer includes landing page stats.",
        spend_affected: d.spend,
        scope: { page_key: d.key },
        site_fixable: false,
      });
    }
  }

  // Google not counting leads the site records
  const floorHit = Object.entries(totalSpend).some(([c, v]) => v >= (t.severity_spend_floor[c] ?? Infinity));
  if (floorHit && report.totals.google_leads === 0 && report.totals.unique_leads > 0) {
    push({
      id: "google_conversions_not_reporting",
      code: "google_conversions_not_reporting",
      severity: "warning",
      title: "Google Ads isn't counting leads",
      why: `Our site recorded ${report.totals.unique_leads} leads from Google ads, but Google reports none in the lead actions we count. Smart bidding can't optimize for leads it doesn't see.`,
      how_to_fix:
        "Check the Google Ads conversion tag fires on the lead form (Tag Manager). If your lead action isn't in the Submit lead form category, pick it under Google-reported leads in Settings → Ads → Google Ads.",
      spend_affected: totalSpend,
      scope: {},
      site_fixable: false,
    });
  }

  // Spend with zero visits over GA4-complete days (Google landing pages)
  const completeCutoff = lastCompleteGa4Date(now);
  const lastDay = completeCutoff < report.window.end ? completeCutoff : report.window.end;
  const completeDays = Math.max(0, daysBetween(report.window.start, lastDay) + 1);
  if (report.ga4.configured && completeDays >= t.zero_visits_complete_days && googleVisits > 0) {
    for (const row of report.pages) {
      if (Object.keys(row.spend).length === 0 || row.paid_visits > 0 || row.clicks === 0) continue;
      push({
        id: `spend_zero_visits:google:${row.key}`,
        code: "spend_zero_visits",
        severity: severityForSpend(row.spend, totalSpend, t),
        title: `Google ads spend but no visits: ${row.title}`,
        why: `Google reports ${row.clicks} clicks to ${row.url}, but GA4 saw no paid Google visits over ${completeDays} complete days. The page may be broken or redirecting.`,
        how_to_fix: "Open the ad's final URL in a private window and check it loads. Check redirects keep the gclid parameter.",
        spend_affected: row.spend,
        scope: { page_key: row.key, url: row.url },
        site_fixable: true,
      });
    }
  }

  // UTM convention / GA4 standard: campaign final URL suffixes + paid Google visits and leads
  if (input.utm) {
    const ticked = new Set(settings.customer_ids);
    const declared: DeclaredUtm[] = [];
    for (const [cid, info] of Object.entries(setups.campaigns)) {
      if (!info.final_url_suffix?.trim() || (ticked.size > 0 && !ticked.has(info.customer_id))) continue;
      const c = campaignSpend.get(cid);
      declared.push({
        campaign_id: cid,
        campaign_name: c?.campaign_name || info.name || cid,
        account_id: info.customer_id,
        params: parseTrackingParams(info.final_url_suffix),
        spend: c?.spend ?? {},
      });
    }
    for (const i of utmIssues({
      platform: "google",
      convention: input.utm.convention,
      grace: input.utm.grace,
      declared,
      observed: input.utm.observed,
      totalSpend,
      t,
      known: settings.known_external_campaigns,
    })) {
      push(i);
    }
  }

  return issues;
}

export async function buildGoogleAdsDiagnostics(opts: {
  site: string;
  contentRoot?: string;
  /** Explicit window (post-fix verification); default = the fixed issue window ending yesterday. */
  window?: { since: string; until: string };
  contentIndex?: ContentIndex;
  now?: Date;
}): Promise<GoogleChecks> {
  const now = opts.now ?? new Date();
  const settings = getAdsSettings(opts.contentRoot);
  const google = settings.google ?? DEFAULT_GOOGLE_ADS_SETTINGS;
  const t = adsThresholds(settings);
  const report = buildAdsReport({
    site: opts.site,
    contentRoot: opts.contentRoot,
    ...(opts.window ? { since: opts.window.since, until: opts.window.until } : { days: ADS_ISSUE_WINDOW_DAYS }),
    platform: "google",
    includeMetaPlatforms: false,
    noRefresh: true,
    contentIndex: opts.contentIndex,
    now,
  });
  const connected = report.google.connected;
  const convention = settings.utm_convention;
  const issues = connected
    ? googleIssues({
        report,
        state: loadGoogleState(opts.site),
        setups: loadGoogleSetups(opts.site),
        settings: google,
        paidState: loadPaidLandingState(opts.site),
        t,
        now,
        ...(convention
          ? {
              utm: {
                convention,
                grace: utmGraceState(opts.site, convention, now),
                observed: loadObservedUtmGroups(opts.site, report.window.start, report.window.end).filter((g) => g.platform === "google"),
              },
            }
          : {}),
      })
    : [];
  if (connected) {
    const contentRoot = opts.contentRoot || getDefaultContentRoot();
    issues.push(
      ...accountLocationDiagnosticIssues({
        platform: "google",
        account_locations: google.account_locations,
        catalog: loadAdsSetup(opts.site, "google"),
        pageLocations: makeLandingPageLocationsLookup(contentRoot),
      }),
    );
  }
  sortAdsIssues(issues);
  return {
    generated_at: now.toISOString(),
    window: { start: report.window.start, end: report.window.end, days: report.window.days },
    connected,
    issues,
  };
}
