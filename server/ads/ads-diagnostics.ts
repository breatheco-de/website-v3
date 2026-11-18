/**
 * Meta (+ shared) Ads checks: gathers Meta sync state, the Meta paid-traffic report over the
 * issue window, a trailing baseline, ad setups (catalog), the in-process landing check
 * (public URL resolver — never an HTTP fetch) and consent counters, then applies the pure rules
 * in shared/ads-diagnostics-rules.ts. Runs only inside an Ads diagnostics job (fork / ads_recheck);
 * results are saved to the validation cache by the web process (see server/ads/diagnostics/).
 */

import { getAdsSettings } from "../settings";
import type { ContentIndex } from "../content-index";
import {
  ADS_ISSUE_WINDOW_DAYS,
  clicksVisitsIssue,
  ga4LedgerGapIssue,
  hasNonPaidMedium,
  leadGapComparable,
  leadGapPct,
  ledgerNotRecordingIssue,
  missingTemplateParams,
  parseTrackingParams,
  severityForSpend,
  sortAdsIssues,
  unclearShareIssue,
  unrecognizedCampaignKey,
  unrecognizedCampaignSeverity,
  ADS_UNCHECKED_REASON_LABELS,
  type AdsGa4SeenRow,
  type AdsIssue,
  type AdsIssueAd,
  type AdsIssueDetails,
  type AdsUncheckedReason,
  type TrackingParamsCoverage,
} from "@shared/ads-diagnostics-rules";
import {
  adsThresholds,
  DEFAULT_UTM_CONVENTION,
  isKnownExternalCampaign,
  type AdsAlertThresholds,
  type KnownExternalCampaign,
  type UtmConventionRejection,
} from "@shared/ads-settings";
import { ADS_CONFIG_FILENAME, adsConfigReadError } from "../ads-config";
import { utmGraceState } from "./utm-convention-history";
import { loadObservedUtmGroups, utmIssues, type DeclaredUtm } from "./utm-issues";
import {
  buildAdsReport,
  makeDestinationResolver,
  type AdsReport,
  type AdsUnrecognizedCampaigns,
  type DestinationResolver,
  type MoneyByCurrency,
} from "./ads-report";
import {
  addDays,
  loadMetaCreatives,
  loadMetaCustomConversions,
  loadMetaPixelEvents,
  loadMetaRows,
  loadMetaState,
  metaConversionNames,
  utcDate,
  type MetaAdsCreatives,
  type MetaAdsSyncState,
} from "./meta-ads-days";
import {
  conversionOverlapIssues,
  conversionStoppedIssues,
  findStoppedConversions,
  leadConversionName,
  pixelLockstepIssues,
} from "./lead-conversion-issues";
import type { MetaAdDayRow } from "./meta-client";
import { lastCompleteGa4Date } from "./paid-detection";
import {
  clicksByAd,
  ga4TaggedSessionsByAd,
  isDubiousUtmContent,
  resolveAdTagging,
  shortTrackingWindow,
} from "./observed-tagging";
import { ledgerLastRecordedAt } from "./lead-ledger";
import { hasMetaData } from "./ads-refresh";
import { loadAdsSetup } from "./ads-setup";
import { adTargetsInWindow, previousUrls } from "./ad-url-history";
import { consentDropPct, loadConsentWindow } from "../legal/legal-diagnostics";
import type { AdsUniverse } from "./diagnostics/grouping";
import {
  accountLocationDiagnosticIssues,
  makeLandingPageLocationsLookup,
} from "./account-location-diagnostics";
import { getDefaultContentRoot } from "../site-config";


export type MetaChecks = {
  generated_at: string;
  window: { start: string; end: string; days: number };
  connected: boolean;
  /** Meta + shared issues (`platform` set); builder ids — identity / grouping happen on save. */
  issues: AdsIssue[];
  /** Spending Meta ads in the window (coverage universe for grouping). */
  universe: AdsUniverse;
  /** Checks skipped for lack of data (never listed as resolved by themselves). */
  suppressed: string[];
};

// ── Lead records vs GA4 ─────────────────────────────────────────────────────
/**
 * `ledger_not_recording` when GA4 sees paid leads but the ledger has none in the window;
 * otherwise `ga4_ledger_gap` over days both sources cover. Skipped gap checks are
 * returned in `suppressed` so they are not listed as Resolved.
 */
export function leadIssues(input: {
  report: Pick<AdsReport, "ga4" | "totals" | "lead_gap_compare">;
  baseline: Pick<AdsReport, "lead_gap_compare">;
  lastRecordedAt: number | null;
  t: AdsAlertThresholds;
}): { issues: AdsIssue[]; suppressed: string[] } {
  const { report, baseline, lastRecordedAt, t } = input;
  const notRecording = ledgerNotRecordingIssue({
    ga4Configured: report.ga4.configured,
    ga4Leads: report.totals.ga4_leads,
    submissions: report.totals.submissions,
    lastRecordedAt,
  });
  const liveNote = "If this is a local or staging copy, leads from the live site are recorded on the live server, not here.";
  if (notRecording) {
    const last = notRecording.lastRecordedAt != null ? new Date(notRecording.lastRecordedAt).toISOString().slice(0, 10) : null;
    return {
      issues: [
        {
          id: "ledger_not_recording",
          code: "ledger_not_recording",
          severity: notRecording.severity,
          title: last ? "Our site stopped recording paid leads" : "Our site hasn't recorded any leads yet",
          why: last
            ? `GA4 counted ${report.totals.ga4_leads} paid leads, but our lead records have none in this period. The last lead was recorded on ${last}.`
            : `GA4 counted ${report.totals.ga4_leads} paid leads, but our lead records are empty, so we can't compare the two.`,
          how_to_fix: `Check that lead forms submit through the site (form and webhook endpoints). ${liveNote}`,
          spend_affected: {},
          scope: {},
          site_fixable: true,
        },
      ],
      suppressed: ["ga4_ledger_gap"],
    };
  }
  const cmp = report.lead_gap_compare;
  if (!report.ga4.configured || !leadGapComparable(cmp)) return { issues: [], suppressed: ["ga4_ledger_gap"] };
  if (!ga4LedgerGapIssue({ current: cmp, baseline: baseline.lead_gap_compare }, t)) return { issues: [], suppressed: [] };
  const gap = leadGapPct(cmp.ga4_leads, cmp.submissions) ?? 0;
  return {
    issues: [
      {
        id: "ga4_ledger_gap",
        code: "ga4_ledger_gap",
        severity: "warning",
        title: "GA4 and our lead records disagree",
        why: `Over the last ${cmp.days} days both sources cover, GA4 counted ${cmp.ga4_leads} paid leads and our server recorded ${cmp.submissions} submissions (${Math.round(gap)}% apart). Some leads are not being measured in one of them.`,
        how_to_fix: "Check the GA4 lead event in Tag Manager (consent, trigger) and that forms submit through the site.",
        spend_affected: {},
        scope: {},
        site_fixable: false,
      },
    ],
    suppressed: [],
  };
}

/** Checks that aren't about one ad platform (lead records, consent). Listed once on the overview. */
export const SHARED_ISSUE_CODES = new Set<AdsIssue["code"]>([
  "ga4_ledger_gap",
  "ledger_not_recording",
  "consent_rate_drop",
  "ads_config_unreadable",
  "utm_convention_invalid",
]);

// ── ads-config.yml / UTM convention ─────────────────────────────────────────
/** Shared issues about ads-config.yml itself: unreadable file, convention values outside the GA4 standard. */
export function adsConfigIssues(input: { readError: string | null; rejected: UtmConventionRejection[] }): AdsIssue[] {
  const out: AdsIssue[] = [];
  if (input.readError) {
    out.push({
      id: "ads_config_unreadable",
      code: "ads_config_unreadable",
      severity: "error",
      title: "Ads settings file can't be read",
      why: `${ADS_CONFIG_FILENAME} has an error (${input.readError}). Meta, Google and GA4 syncs are paused until the file is fixed, so numbers here stop updating. Checks use the last settings that could be read.`,
      how_to_fix: `Fix the YAML in ${ADS_CONFIG_FILENAME} (in the site's content folder), or restore the last good version from Cloud Sync. Syncs resume on their own once the file reads.`,
      spend_affected: {},
      scope: {},
      site_fixable: true,
    });
  }
  if (input.rejected.length > 0) {
    const list = input.rejected.map((r) => `${r.field}: "${r.value}" ${r.reason}; using ${r.default_used}`).join(". ");
    out.push({
      id: "utm_convention_invalid",
      code: "utm_convention_invalid",
      severity: "error",
      title: "UTM convention has non-standard values",
      why: `Some values in ${ADS_CONFIG_FILENAME} → utm_convention are outside GA4's standard and are ignored: ${list}. The templates and checks use the defaults for those fields.`,
      how_to_fix: `Edit utm_convention in ${ADS_CONFIG_FILENAME} to use standard values, or remove the field to keep the default.`,
      spend_affected: {},
      scope: {},
      site_fixable: true,
    });
  }
  return out;
}

// ── Tracking params coverage ────────────────────────────────────────────────
function addSpend(into: MoneyByCurrency, from: MoneyByCurrency): void {
  for (const [cur, v] of Object.entries(from)) into[cur] = (into[cur] ?? 0) + v;
}

function spendTotal(spend: MoneyByCurrency): number {
  return Object.values(spend).reduce((s, v) => s + v, 0);
}

function roundMoney(spend: MoneyByCurrency): MoneyByCurrency {
  const out: MoneyByCurrency = {};
  for (const [cur, v] of Object.entries(spend)) out[cur] = Math.round(v * 100) / 100;
  return out;
}

// ── Per-ad index ────────────────────────────────────────────────────────────
type AccountsState = MetaAdsSyncState["accounts"];

/** One Meta ad over the window plus how its setup was classified. */
export type IndexedAd = AdsIssueAd & {
  /** Spend summed across currencies — ordering only. */
  total: number;
  state: "checked" | "unchecked" | "instant_form";
};

function uncheckedReasonFor(accountId: string, accounts: AccountsState | undefined): AdsUncheckedReason {
  const a = accounts?.[accountId];
  if (a?.sync_error) return "account_unreadable";
  return !a?.setup_read_at || a.setup_error ? "setup_fetch_failed" : "ad_removed_in_meta";
}

/** Oldest successful ad-setup read across `accountIds`; null when any of them was never read. */
export function setupLastReadAt(accounts: AccountsState | undefined, accountIds: string[]): string | null {
  if (!accounts || accountIds.length === 0) return null;
  let oldest: string | null = null;
  for (const id of accountIds) {
    const at = accounts[id]?.setup_read_at;
    if (!at) return null;
    if (!oldest || at < oldest) oldest = at;
  }
  return oldest;
}

/** Sums each ad's rows and classifies it against its last-read setup (checked / unchecked + reason / Instant Form). */
export function indexAds(input: { creatives: MetaAdsCreatives["ads"]; rows: MetaAdDayRow[]; accounts?: AccountsState }): Map<string, IndexedAd> {
  const out = new Map<string, IndexedAd & { instantLeads: number; lastRowDate: string }>();
  for (const r of input.rows) {
    let a = out.get(r.ad_id);
    if (!a) {
      const c = input.creatives[r.ad_id];
      a = {
        ad_id: r.ad_id,
        ad_name: r.ad_name,
        adset_id: r.adset_id,
        adset_name: r.adset_name,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        account_id: r.account_id,
        effective_status: c?.effective_status ?? null,
        spend: {},
        link_clicks: 0,
        impressions: 0,
        landing_page_views: 0,
        last_spend_date: null,
        landing_url: c?.links[0] ?? null,
        url_tags: c?.url_tags ?? null,
        total: 0,
        state: "checked",
        instantLeads: 0,
        lastRowDate: r.date,
      };
      out.set(r.ad_id, a);
    }
    if (r.date >= a.lastRowDate) {
      a.lastRowDate = r.date;
      a.ad_name = r.ad_name;
      a.adset_name = r.adset_name;
      a.campaign_name = r.campaign_name;
    }
    a.spend[r.currency] = (a.spend[r.currency] ?? 0) + r.spend;
    a.total += r.spend;
    a.link_clicks += r.link_clicks ?? 0;
    a.impressions += r.impressions ?? 0;
    a.landing_page_views += r.landing_page_views ?? 0;
    a.instantLeads += r.instant_form_leads ?? 0;
    if (r.spend > 0 && (!a.last_spend_date || r.date > a.last_spend_date)) a.last_spend_date = r.date;
  }
  const result = new Map<string, IndexedAd>();
  for (const [adId, full] of Array.from(out.entries())) {
    const { instantLeads, lastRowDate: _lastRowDate, ...a } = full;
    a.spend = roundMoney(a.spend);
    const c = input.creatives[adId];
    if (c?.instant_form || (instantLeads > 0 && !c?.links.length)) {
      a.state = "instant_form";
    } else if (!c) {
      a.state = "unchecked";
      a.unchecked_reason = uncheckedReasonFor(a.account_id, input.accounts);
    } else if (c.links.length === 0) {
      a.state = "unchecked";
      a.unchecked_reason = "no_link_found";
    } else {
      const params = { ...parseTrackingParams(c.links[0]), ...parseTrackingParams(c.url_tags) };
      const missing = missingTemplateParams(params);
      if (missing.length > 0) a.missing = missing;
      if (isDubiousUtmContent(adId, params)) a.dubious_utm_content = true;
      if (hasNonPaidMedium(params)) a.medium = params.utm_medium!;
    }
    result.set(adId, a);
  }
  return result;
}

/** Public shape of an indexed ad (drops ordering/classification internals). */
export function toIssueAd(a: IndexedAd): AdsIssueAd {
  const { total: _total, state: _state, ...ad } = a;
  return ad;
}

function summarizeUnchecked(ads: IndexedAd[]): NonNullable<AdsIssueDetails["unchecked"]> {
  const by = new Map<AdsUncheckedReason, { ads: number; spend: MoneyByCurrency }>();
  for (const a of ads) {
    if (!a.unchecked_reason) continue;
    const cur = by.get(a.unchecked_reason) ?? { ads: 0, spend: {} };
    cur.ads += 1;
    addSpend(cur.spend, a.spend);
    by.set(a.unchecked_reason, cur);
  }
  return Array.from(by.entries()).map(([reason, v]) => ({ reason, ads: v.ads, spend: roundMoney(v.spend) }));
}

/** Which ads with spend are missing the URL parameters template (or tag themselves as unpaid). */
export function trackingParamsCoverage(input: {
  creatives: MetaAdsCreatives;
  rows: MetaAdDayRow[];
  windowDays: number;
  accounts?: AccountsState;
  /** Oldest successful ad-setup read; falls back to the creatives file timestamp when omitted. */
  setupReadAt?: string | null;
  index?: Map<string, IndexedAd>;
}): TrackingParamsCoverage {
  const index = input.index ?? indexAds({ creatives: input.creatives.ads, rows: input.rows, accounts: input.accounts });
  const missingByCampaign = new Map<string, { spend: MoneyByCurrency; ads: number; missing: Set<string>; name: string }>();
  const nonPaidByCampaign = new Map<string, { spend: MoneyByCurrency; medium: string; name: string }>();
  const unchecked: IndexedAd[] = [];
  let checked = 0;
  let missingAds = 0;
  for (const a of Array.from(index.values())) {
    if (a.total <= 0 || a.state === "instant_form") continue;
    if (a.state === "unchecked") {
      unchecked.push(a);
      continue;
    }
    checked += 1;
    if (a.missing || a.dubious_utm_content) {
      missingAds += 1;
      const m = missingByCampaign.get(a.campaign_id) ?? { spend: {} as MoneyByCurrency, ads: 0, missing: new Set<string>(), name: a.campaign_name };
      m.ads += 1;
      a.missing?.forEach((k) => m.missing.add(k));
      if (a.dubious_utm_content) m.missing.add("utm_content");
      addSpend(m.spend, a.spend);
      missingByCampaign.set(a.campaign_id, m);
    }
    if (a.medium) {
      const n = nonPaidByCampaign.get(a.campaign_id) ?? { spend: {} as MoneyByCurrency, medium: a.medium, name: a.campaign_name };
      addSpend(n.spend, a.spend);
      nonPaidByCampaign.set(a.campaign_id, n);
    }
  }
  return {
    window_days: input.windowDays,
    checked_at: input.setupReadAt !== undefined ? input.setupReadAt : input.creatives.fetched_at || null,
    checked_ads: checked,
    missing_ads: missingAds,
    unchecked: summarizeUnchecked(unchecked),
    campaigns: Array.from(missingByCampaign.entries())
      .map(([id, m]) => ({ id, name: m.name, ads: m.ads, missing: Array.from(m.missing), spend: m.spend }))
      .sort((a, b) => spendTotal(b.spend) - spendTotal(a.spend)),
    non_paid_campaigns: Array.from(nonPaidByCampaign.entries())
      .map(([id, n]) => ({ id, name: n.name, medium: n.medium, spend: n.spend }))
      .sort((a, b) => spendTotal(b.spend) - spendTotal(a.spend)),
  };
}

type AdSpendInfo = { spend: MoneyByCurrency; campaign_id: string; campaign_name: string };

/**
 * One warning per ad URL that goes through our content redirects before reaching a page.
 * Our redirects keep the query string, so tracking survives; the extra hop only costs time.
 */
export function adUrlRedirectIssues(input: {
  spendByAd: Map<string, AdSpendInfo>;
  creatives: MetaAdsCreatives["ads"];
  resolve: DestinationResolver;
  skipUrls?: Set<string | undefined>;
}): AdsIssue[] {
  type Top = { adId: string; total: number; campaign_id: string; campaign_name: string };
  const byUrl = new Map<string, { final: string; hops: number; page_key: string; spend: MoneyByCurrency; top: Top }>();
  for (const [adId, info] of Array.from(input.spendByAd.entries())) {
    const total = spendTotal(info.spend);
    const c = input.creatives[adId];
    if (total <= 0 || !c || c.instant_form || c.links.length === 0) continue;
    const bare = c.links[0]!.split("?")[0]!;
    if (input.skipUrls?.has(bare)) continue;
    let link: URL;
    try {
      link = new URL(c.links[0]!);
    } catch {
      continue;
    }
    const r = input.resolve(link.hostname, link.pathname);
    if (r.kind !== "entry" || r.redirect_chain.length === 0) continue;
    const top: Top = { adId, total, campaign_id: info.campaign_id, campaign_name: info.campaign_name };
    const cur = byUrl.get(bare) ?? { final: `https://${r.host}${r.path}`, hops: r.redirect_chain.length, page_key: r.key, spend: {}, top };
    addSpend(cur.spend, info.spend);
    if (total > cur.top.total) cur.top = top;
    byUrl.set(bare, cur);
  }
  return Array.from(byUrl.entries()).map(([bare, a]) => ({
    id: `ad_url_redirects:${bare}`,
    code: "ad_url_redirects",
    severity: "warning",
    title: `Ad points to an old URL: ${bare}`,
    why: `This URL redirects to ${a.final}${a.hops > 1 ? ` through ${a.hops} redirects` : ""}. Every click waits for the extra step before the page loads.`,
    how_to_fix: `Update the ad URL in Meta to ${a.final}.`,
    spend_affected: a.spend,
    scope: { url: bare, page_key: a.page_key, ad_id: a.top.adId, campaign_id: a.top.campaign_id, campaign_name: a.top.campaign_name },
    site_fixable: false,
  }));
}

/**
 * Ads linking to one of our own URLs that is not live (no page, no redirect to a live page), per
 * bare URL. Answered in-process by the public URL resolver (same rules as the live site) — no
 * HTTP request, so runtime outages (5xx / DNS) are not covered here.
 */
export function landingNotLiveIssues(input: {
  ads: IndexedAd[];
  resolve: DestinationResolver;
  totalSpend: MoneyByCurrency;
  t: AdsAlertThresholds;
  detailsFor: (ads: IndexedAd[]) => AdsIssueDetails;
}): AdsIssue[] {
  const byBare = new Map<string, { ads: IndexedAd[]; path: string }>();
  for (const a of input.ads) {
    if (a.state !== "checked" || !a.landing_url) continue;
    let link: URL;
    try {
      link = new URL(a.landing_url);
    } catch {
      continue;
    }
    const r = input.resolve(link.hostname, link.pathname);
    if (r.kind !== "missing_page") continue;
    const bare = a.landing_url.split("?")[0]!;
    const cur = byBare.get(bare) ?? { ads: [], path: r.path };
    cur.ads.push(a);
    byBare.set(bare, cur);
  }
  return Array.from(byBare.entries()).map(([bare, g]) => {
    const spend: MoneyByCurrency = {};
    g.ads.forEach((a) => addSpend(spend, a.spend));
    const top = g.ads[0]!;
    return {
      id: `landing_not_live:${bare}`,
      code: "landing_not_live",
      severity: severityForSpend(spend, input.totalSpend, input.t),
      title: `Ad links to a page that isn't live: ${bare}`,
      why: `${g.ads.length} ad${g.ads.length === 1 ? "" : "s"} send people to ${g.path}, which isn't a live page on this site and doesn't redirect to one. People who click see a "page not found".`,
      how_to_fix: "Publish the page, add a redirect to the right live page, or change the ad URL in Meta. Then press Re-check.",
      spend_affected: roundMoney(spend),
      scope: { url: bare, ad_id: top.ad_id, campaign_id: top.campaign_id, campaign_name: top.campaign_name },
      site_fixable: true,
      details: input.detailsFor(g.ads),
    };
  });
}

/** Coverage over the fixed issue window (same days Diagnostics checks), read from the last sync. */
export function loadTrackingParamsCoverage(site: string, accountIds: string[], now = new Date()): TrackingParamsCoverage {
  const end = addDays(utcDate(now), -1);
  const start = addDays(end, -(ADS_ISSUE_WINDOW_DAYS - 1));
  const accounts = loadMetaState(site).accounts;
  return trackingParamsCoverage({
    creatives: loadMetaCreatives(site),
    rows: loadMetaRows(site, start, end, accountIds),
    windowDays: ADS_ISSUE_WINDOW_DAYS,
    accounts,
    setupReadAt: setupLastReadAt(accounts, accountIds),
  });
}

// ── Unrecognized campaigns ──────────────────────────────────────────────────
/** One issue per campaign sending paid Meta visits to our pages that no connected account knows. */
export function unrecognizedCampaignIssues(input: {
  data: AdsUnrecognizedCampaigns;
  t: AdsAlertThresholds;
  known: KnownExternalCampaign[];
}): AdsIssue[] {
  const out: AdsIssue[] = [];
  for (const c of input.data.campaigns) {
    const known = isKnownExternalCampaign(input.known, c.key) || (!!c.campaign_id && isKnownExternalCampaign(input.known, c.campaign_id));
    const severity = unrecognizedCampaignSeverity({ visits: c.visits, paidMetaVisits: input.data.paid_meta_visits, known }, input.t);
    if (!severity) continue;
    const label = c.campaign_name && c.campaign_name !== c.campaign_id ? c.campaign_name : (c.campaign_id ?? c.key);
    const visits = `${c.visits} paid Meta visit${c.visits === 1 ? "" : "s"}`;
    out.push({
      id: `unrecognized_campaign:${c.key}`,
      code: "unrecognized_campaign",
      severity,
      title: known ? `Known external campaign: ${label}` : `Campaign we can't see: ${label}`,
      why: known
        ? `${visits} came from this campaign. Staff marked it as known, so it isn't counted as a problem. Its spend isn't counted here.`
        : `${visits} came from this campaign, but it isn't in any connected ad account. Its spend isn't counted here.`,
      how_to_fix: known
        ? "Nothing to fix. Remove it from Known external campaigns in Settings → Ads to flag it again."
        : "Find the campaign in Meta Business Manager. If it's yours, connect its ad account in Settings → Ads. If someone else runs it on purpose, mark it as known.",
      spend_affected: {},
      scope: { campaign_id: c.campaign_id ?? undefined, campaign_name: label },
      site_fixable: false,
      details: {
        ads: [],
        ads_total: 0,
        ads_offset: 0,
        ga4_seen: c.ga4_seen,
        ga4_untagged_visits: c.untagged_visits,
        pages: c.pages,
        ga4_totals: { visits: c.visits, leads: c.leads },
      },
    });
  }
  return out;
}

/** GA4-only off-site copy; names the flagged unrecognized campaign when it sends most of these visits. */
export function ga4OnlyOffSiteWhy(visits: number, tags: AdsGa4SeenRow[], flagged: Map<string, string>): string {
  const base = `None of your ads link here. GA4 counted ${visits} visit${visits === 1 ? "" : "s"} here as paid from their ad tags. Usually these are people who clicked an ad earlier and moved on to this site.`;
  const byKey = new Map<string, number>();
  for (const g of tags) {
    const k = unrecognizedCampaignKey({ utm_id: g.campaign_id, campaign: g.campaign });
    if (k) byKey.set(k.key, (byKey.get(k.key) ?? 0) + g.visits);
  }
  const top = Array.from(byKey.entries()).sort((a, b) => b[1] - a[1])[0];
  if (!top || !flagged.has(top[0]) || top[1] * 2 < visits) return base;
  return `${base} Most come from campaign ${flagged.get(top[0]) || top[0]} (flagged separately).`;
}

// ── Build ───────────────────────────────────────────────────────────────────
export async function buildAdsDiagnostics(opts: {
  site: string;
  contentRoot?: string;
  /** Explicit window (post-fix verification); default = the fixed issue window ending yesterday. */
  window?: { since: string; until: string };
  /** Worker processes pass a light index for the site (no site-context map). */
  contentIndex?: ContentIndex;
  now?: Date;
}): Promise<MetaChecks> {
  const now = opts.now ?? new Date();
  const issueDays = ADS_ISSUE_WINDOW_DAYS;
  const settings = getAdsSettings(opts.contentRoot);
  const t = adsThresholds(settings);
  const report = buildAdsReport({
    site: opts.site,
    contentRoot: opts.contentRoot,
    ...(opts.window ? { since: opts.window.since, until: opts.window.until } : { days: issueDays }),
    platform: "meta",
    includeGa4Ads: true,
    includeMetaPlatforms: false,
    noRefresh: true,
    contentIndex: opts.contentIndex,
    now,
  });
  const baseline = buildAdsReport({
    site: opts.site,
    contentRoot: opts.contentRoot,
    contentIndex: opts.contentIndex,
    days: 28,
    platform: "meta",
    includeMetaPlatforms: false,
    noRefresh: true,
    now: new Date(Date.parse(`${report.window.start}T12:00:00.000Z`)),
  });
  const connected = hasMetaData(opts.site, opts.contentRoot);
  const metaState = loadMetaState(opts.site);
  const issues: AdsIssue[] = [];
  const totalSpend = report.totals.spend;

  // Per-ad index over the issue window — the evidence behind every ad-level issue
  const creatives = loadMetaCreatives(opts.site).ads;
  const metaRows = connected ? loadMetaRows(opts.site, report.window.start, report.window.end, settings.meta.ad_account_ids) : [];
  const adIndex = indexAds({ creatives, rows: metaRows, accounts: metaState.accounts });
  const spendingAds = Array.from(adIndex.values())
    .filter((a) => a.total > 0)
    .sort((a, b) => b.total - a.total || a.ad_id.localeCompare(b.ad_id));
  const resolveDest = makeDestinationResolver(opts.site, opts.contentIndex);
  const bareOf = (a: IndexedAd): string | null => (a.state === "checked" && a.landing_url ? a.landing_url.split("?")[0]! : null);
  const metaSetup = connected ? loadAdsSetup(opts.site, "meta") : null;
  const adsByDest = new Map<string, IndexedAd[]>();
  for (const a of spendingAds) {
    const setupAd = metaSetup?.ads[a.ad_id];
    const prevUrls = previousUrls(setupAd);
    if (prevUrls.length > 0) a.previous_urls = prevUrls;
    const keys = new Set<string>();
    if (a.state === "instant_form") keys.add("dest:instant_form");
    else if (bareOf(a)) {
      try {
        const u = new URL(a.landing_url!);
        keys.add(resolveDest(u.hostname, u.pathname).key);
      } catch {
        /* unparseable link */
      }
    }
    // Every page the ad pointed to during the window (URL history), not only today's link.
    const tz = setupAd ? metaSetup?.accounts[setupAd.account_id]?.timezone : null;
    for (const t of adTargetsInWindow(setupAd, report.window.start, report.window.end, tz)) {
      keys.add(t.kind === "instant_form" ? "dest:instant_form" : resolveDest(t.host, t.path).key);
    }
    for (const key of Array.from(keys)) {
      const list = adsByDest.get(key) ?? [];
      list.push(a);
      adsByDest.set(key, list);
    }
  }
  const adsOnBare = (bare: string | undefined) => spendingAds.filter((a) => bareOf(a) === bare);
  const campaignAds = (campaignId: string) => spendingAds.filter((a) => a.campaign_id === campaignId);
  const accountOf = (ads: IndexedAd[]): string | undefined => {
    const ids = new Set(ads.map((a) => a.account_id));
    return ids.size === 1 ? Array.from(ids)[0] : undefined;
  };
  const detailsFor = (ads: IndexedAd[], extra: Partial<AdsIssueDetails> = {}): AdsIssueDetails => {
    const accountIds = ads.length > 0 ? Array.from(new Set(ads.map((a) => a.account_id))) : settings.meta.ad_account_ids;
    return {
      ads: ads.map(toIssueAd),
      ads_total: ads.length,
      ads_offset: 0,
      setup_last_read_at: setupLastReadAt(metaState.accounts, accountIds),
      ...extra,
    };
  };

  // Access / sync
  if (metaState.last_error && (metaState.last_error_kind === "auth" || metaState.last_error_kind === "permission")) {
    issues.push({
      id: "meta_access_failed",
      code: "meta_access_failed",
      severity: "error",
      title: "Meta rejected our access",
      why: `Meta said: ${metaState.last_error}. Spend and ad data stop updating until access works again.`,
      how_to_fix:
        "Ask an admin to check the System User token (ads_read) and that it still has access to each ad account, then press Test connection in Settings → Ads.",
      spend_affected: {},
      scope: {},
      site_fixable: false,
    });
  } else if ((metaState.consecutive_failures ?? 0) >= 2) {
    issues.push({
      id: "meta_sync_failing",
      code: "meta_sync_failing",
      severity: "error",
      title: "Meta sync keeps failing",
      why: `The last ${metaState.consecutive_failures} syncs failed (${metaState.last_error ?? "unknown error"}). Numbers here may be out of date.`,
      how_to_fix: "Press Sync now in Settings → Ads. If it fails again, check the error and the ad account ids.",
      spend_affected: {},
      scope: {},
      site_fixable: false,
    });
  }

  // Spend with zero visits over GA4-complete days
  const completeCutoff = lastCompleteGa4Date(now);
  const completeDays = Math.max(
    0,
    Math.round((Date.parse(`${completeCutoff < report.window.end ? completeCutoff : report.window.end}T00:00:00Z`) - Date.parse(`${report.window.start}T00:00:00Z`)) / 86_400_000) + 1,
  );
  if (report.ga4.configured && completeDays >= t.zero_visits_complete_days) {
    for (const row of report.pages) {
      if (Object.keys(row.spend).length === 0 || row.paid_visits > 0 || row.clicks === 0) continue;
      // Only URL-changeover days fed this page: that day's split is approximate, not evidence of a broken page.
      if (row.url_change_spend && spendTotal(row.url_change_spend) >= spendTotal(row.spend) - 0.01) continue;
      const ads = adsByDest.get(row.key) ?? [];
      issues.push({
        id: `spend_zero_visits:${row.key}`,
        code: "spend_zero_visits",
        severity: severityForSpend(row.spend, totalSpend, t),
        title: `Ads spend but no visits: ${row.title}`,
        why: `Meta reports ${row.clicks} clicks to ${row.url}, but GA4 saw no paid visits over ${completeDays} complete days. The page may be broken, redirecting, or losing the tracking parameters.`,
        how_to_fix: "Open the ad's URL in a private window and check it loads. Confirm the ad URL parameters use the template below.",
        spend_affected: row.spend,
        scope: { page_key: row.key, url: row.url, account_id: accountOf(ads) },
        site_fixable: true,
        details: detailsFor(ads),
      });
    }
  }

  // Non-paid medium now; missing / unchecked tracking wait until after probes (broken-link skip)
  const coverage = trackingParamsCoverage({ creatives: { fetched_at: "", ads: creatives }, rows: metaRows, windowDays: issueDays, index: adIndex });
  for (const n of coverage.non_paid_campaigns) {
    const camp = campaignAds(n.id);
    issues.push({
      id: `non_paid_medium:${n.id}`,
      code: "non_paid_medium",
      severity: severityForSpend(n.spend, totalSpend, t),
      title: `Ads tagged as unpaid traffic: ${n.name}`,
      why: `These ads use utm_medium=${n.medium}, which analytics treats as unpaid social. Their visits will not show as paid here or in GA4.`,
      how_to_fix: "Change utm_medium to paid_social (use the template below).",
      spend_affected: n.spend,
      scope: { campaign_id: n.id, campaign_name: n.name, account_id: accountOf(camp) },
      site_fixable: false,
      details: detailsFor(camp.filter((a) => a.medium)),
    });
  }

  // Own landing pages that aren't live (in-process public URL resolver — never an HTTP fetch)
  const notLive = landingNotLiveIssues({ ads: spendingAds, resolve: resolveDest, totalSpend, t, detailsFor });
  issues.push(...notLive);
  const notLiveAds = new Set(notLive.flatMap((i) => (i.details?.ads ?? []).map((a) => a.ad_id)));

  // Ads whose URL goes through one of our content redirects (paths only — www/http hops are not checked)
  const spendByAd = new Map(spendingAds.map((a) => [a.ad_id, { spend: a.spend, campaign_id: a.campaign_id, campaign_name: a.campaign_name }]));
  for (const issue of adUrlRedirectIssues({ spendByAd, creatives, resolve: resolveDest })) {
    const ads = adsOnBare(issue.scope.url);
    issues.push({ ...issue, scope: { ...issue.scope, account_id: accountOf(ads) }, details: detailsFor(ads) });
  }

  // Pages that aren't live / zero-visit pages — skip confirmed-missing for those ads only
  const zeroVisitPages = new Set(
    issues.filter((i) => i.code === "spend_zero_visits" && i.scope.page_key).map((i) => i.scope.page_key!),
  );
  const adsOnZeroVisit = new Set<string>();
  for (const [key, list] of Array.from(adsByDest.entries())) {
    if (!zeroVisitPages.has(key)) continue;
    for (const a of list) adsOnZeroVisit.add(a.ad_id);
  }

  // GA4-verified missing / dubious / unchecked tracking
  const knownAdIds = new Set(Array.from(adIndex.keys()));
  const shortWin = shortTrackingWindow(now, t.tracking_check_days);
  const issueSince = report.window.start;
  const issueUntil = report.window.end;
  const shortGa4 = report.ga4.configured
    ? ga4TaggedSessionsByAd(opts.site, shortWin.since, shortWin.until, knownAdIds)
    : { sessions: new Map<string, number>(), completeDates: new Set<string>() };
  const issueGa4 = report.ga4.configured
    ? ga4TaggedSessionsByAd(opts.site, issueSince, issueUntil, knownAdIds)
    : { sessions: new Map<string, number>(), completeDates: new Set<string>() };
  const shortClicksMap = clicksByAd(metaRows, shortGa4.completeDates);
  const issueClicksMap = clicksByAd(metaRows, issueGa4.completeDates);

  type Tracked = IndexedAd & { tagging_source: "none"; checked_clicks: number; ga4_tagged_sessions: number; verdict: "missing" | "unverified" };
  const confirmedByCampaign = new Map<string, Tracked[]>();
  const unverifiedByCampaign = new Map<string, Tracked[]>();

  const classifyChecked = (a: IndexedAd): Tracked | "meta_auto" | null => {
    const needs = !!(a.missing?.length || a.dubious_utm_content);
    if (!needs) return null;
    if (!report.ga4.configured) {
      const onlyUtmId = !a.dubious_utm_content && a.missing?.length === 1 && a.missing[0] === "utm_id";
      return {
        ...a,
        tagging_source: "none",
        checked_clicks: a.link_clicks,
        ga4_tagged_sessions: 0,
        verdict: onlyUtmId ? "unverified" : "missing",
      };
    }
    const resolved = resolveAdTagging({
      shortClicks: shortClicksMap.get(a.ad_id) ?? 0,
      shortSessions: shortGa4.sessions.get(a.ad_id) ?? 0,
      shortCompleteDays: shortGa4.completeDates.size,
      fallbackClicks: issueClicksMap.get(a.ad_id) ?? 0,
      fallbackSessions: issueGa4.sessions.get(a.ad_id) ?? 0,
      fallbackCompleteDays: issueGa4.completeDates.size,
      thresholds: t,
    });
    if (resolved.state === "meta_auto") return "meta_auto";
    const onlyUtmId = !a.dubious_utm_content && a.missing?.length === 1 && a.missing[0] === "utm_id";
    const verdict: "missing" | "unverified" = resolved.state === "unverified" || onlyUtmId ? "unverified" : "missing";
    if (verdict === "missing" && (notLiveAds.has(a.ad_id) || adsOnZeroVisit.has(a.ad_id))) return null;
    return {
      ...a,
      tagging_source: "none",
      checked_clicks: resolved.checked_clicks,
      ga4_tagged_sessions: resolved.ga4_tagged_sessions,
      verdict,
    };
  };

  for (const a of spendingAds) {
    if (a.state !== "checked") continue;
    const c = classifyChecked(a);
    if (!c || c === "meta_auto") continue;
    const map = c.verdict === "missing" ? confirmedByCampaign : unverifiedByCampaign;
    const list = map.get(a.campaign_id) ?? [];
    list.push(c);
    map.set(a.campaign_id, list);
  }

  const evidenceDetails = (ads: Tracked[], extra: Partial<AdsIssueDetails> = {}) =>
    detailsFor(
      ads.map((a) => {
        const { verdict: _v, ...rest } = a;
        return rest;
      }),
      extra,
    );

  // Unchecked setups: drop ads GA4 already proves as meta_auto; fold the rest into
  // confirmed-missing for that campaign (same drawer), else emit tracking_params_unchecked.
  const uncheckedByCampaign = new Map<string, IndexedAd[]>();
  for (const a of spendingAds) {
    if (a.state !== "unchecked") continue;
    if (report.ga4.configured) {
      const resolved = resolveAdTagging({
        shortClicks: shortClicksMap.get(a.ad_id) ?? 0,
        shortSessions: shortGa4.sessions.get(a.ad_id) ?? 0,
        shortCompleteDays: shortGa4.completeDates.size,
        fallbackClicks: issueClicksMap.get(a.ad_id) ?? 0,
        fallbackSessions: issueGa4.sessions.get(a.ad_id) ?? 0,
        fallbackCompleteDays: issueGa4.completeDates.size,
        thresholds: t,
      });
      if (resolved.state === "meta_auto") continue;
    }
    const list = uncheckedByCampaign.get(a.campaign_id) ?? [];
    list.push(a);
    uncheckedByCampaign.set(a.campaign_id, list);
  }

  for (const [campaignId, ads] of Array.from(confirmedByCampaign.entries())) {
    const spend: MoneyByCurrency = {};
    const missingKeys = new Set<string>();
    ads.forEach((a) => {
      addSpend(spend, a.spend);
      a.missing?.forEach((k) => missingKeys.add(k));
      if (a.dubious_utm_content) missingKeys.add("utm_content");
    });
    const folded = uncheckedByCampaign.get(campaignId) ?? [];
    uncheckedByCampaign.delete(campaignId);
    folded.forEach((a) => addSpend(spend, a.spend));
    const checkDays = t.tracking_check_days;
    const dubious = ads.some((a) => a.dubious_utm_content);
    const ga4On = report.ga4.configured;
    const evidenceAds = [
      ...ads.map((a) => {
        const { verdict: _v, ...rest } = a;
        return rest;
      }),
      ...folded,
    ];
    const missingList = Array.from(missingKeys).join(", ") || "tracking parameters";
    const why = !ga4On
      ? dubious
        ? `${ads.length} ad(s) in this campaign have wrong or incomplete URL parameters (e.g. utm_content that is not this ad's id), so visits and leads can't be matched to them.`
        : `${ads.length} ad(s) in this campaign are missing ${missingList}, so visits and leads can't be matched to them.`
      : dubious
        ? `${ads.length} ad(s) in this campaign have wrong or incomplete URL parameters (e.g. utm_content that is not this ad's id). GA4 received almost no visits with these ads' ids over the last ${checkDays} complete days, so visits and leads can't be matched to them.`
        : `${ads.length} ad(s) in this campaign are missing ${missingList}. GA4 received almost no visits with these ads' ids over the last ${checkDays} complete days, so visits and leads can't be matched to them.`;
    issues.push({
      id: `missing_tracking_params:${campaignId}`,
      code: "missing_tracking_params",
      severity: "warning",
      title: `Ads missing tracking parameters: ${ads[0]!.campaign_name}`,
      why,
      how_to_fix: dubious
        ? "In Meta Ads Manager, paste the URL parameters template below into each ad (Tracking → URL parameters) so utm_content uses {{ad.id}}. Staff with Edit live ads can use Fix via Meta here instead."
        : "In Meta Ads Manager, paste the URL parameters template below into each ad (Tracking → URL parameters). Staff with Edit live ads can use Fix via Meta here instead.",
      spend_affected: roundMoney(spend),
      scope: { campaign_id: campaignId, campaign_name: ads[0]!.campaign_name, account_id: accountOf(ads) },
      site_fixable: false,
      details: detailsFor(evidenceAds, folded.length ? { unchecked: summarizeUnchecked(folded) } : {}),
    });
  }

  for (const [campaignId, ads] of Array.from(unverifiedByCampaign.entries())) {
    const spend: MoneyByCurrency = {};
    ads.forEach((a) => addSpend(spend, a.spend));
    issues.push({
      id: `tracking_params_unverified:${campaignId}`,
      code: "tracking_params_unverified",
      severity: "info",
      title: `Not enough data to confirm tracking: ${ads[0]!.campaign_name}`,
      why: `${ads.length} ad(s) in this campaign look incomplete in Meta, but there aren't enough recent clicks (or complete Google Analytics days) to confirm whether visits arrive tagged.`,
      how_to_fix: "We'll check again automatically once there are more complete days of clicks. No Fix via Meta until tracking is confirmed missing.",
      spend_affected: roundMoney(spend),
      scope: { campaign_id: campaignId, campaign_name: ads[0]!.campaign_name, account_id: accountOf(ads) },
      site_fixable: false,
      details: evidenceDetails(ads),
    });
  }

  for (const [campaignId, ads] of Array.from(uncheckedByCampaign.entries())) {
    const summary = summarizeUnchecked(ads);
    const spend: MoneyByCurrency = {};
    ads.forEach((a) => addSpend(spend, a.spend));
    issues.push({
      id: `tracking_params_unchecked:${campaignId}`,
      code: "tracking_params_unchecked",
      severity: "info",
      title: `Couldn't check tracking parameters: ${ads[0]!.campaign_name}`,
      why: `${ads.length} ad(s) with spend in this campaign could not be checked against the URL parameters template (${summary
        .map((u) => `${u.ads}: ${ADS_UNCHECKED_REASON_LABELS[u.reason]}`)
        .join("; ")}).`,
      how_to_fix:
        "Press Resync to read the ad setups from Meta again. Removed ads need no action; ads without a website link cannot carry URL parameters.",
      spend_affected: roundMoney(spend),
      scope: { campaign_id: campaignId, campaign_name: ads[0]!.campaign_name, account_id: accountOf(ads) },
      site_fixable: false,
      details: detailsFor(ads, { unchecked: summary }),
    });
  }

  // Pixel not reporting leads while the site records Meta leads
  const pickedConversions = settings.meta.lead_conversions ?? [];
  const conversionNames = connected ? metaConversionNames(opts.site) : new Map<string, string>();
  const floorHit = Object.entries(totalSpend).some(([c, v]) => v >= (t.severity_spend_floor[c] ?? Infinity));
  if (connected && floorHit && report.totals.meta_leads === 0 && report.totals.unique_leads > 0) {
    const counted =
      pickedConversions.length > 0
        ? `the conversions picked in Settings → Ads → Meta (${pickedConversions.map((k) => leadConversionName(k, conversionNames)).join(", ")})`
        : "the standard Lead event (no conversions are picked in Settings → Ads → Meta)";
    issues.push({
      id: "pixel_not_reporting_leads",
      code: "pixel_not_reporting_leads",
      severity: "warning",
      title: "Meta pixel is not reporting leads",
      why: `Our site recorded ${report.totals.unique_leads} leads from Meta ads, but Meta reports none for ${counted}. Meta cannot optimize campaigns for leads it does not see.`,
      how_to_fix:
        pickedConversions.length > 0
          ? "In Tag Manager, check the Meta tags behind the picked conversions fire on the lead forms and respect consent. If your leads use other conversions, pick those instead."
          : "Pick the conversions your lead forms fire in Settings → Ads → Meta. If they should fire the standard Lead event, check the Meta pixel Lead tag in Tag Manager.",
      spend_affected: totalSpend,
      scope: {},
      site_fixable: false,
    });
  }

  // Lead conversions: double counting, pixel events in lockstep, picks Meta stopped reporting
  if (connected) {
    issues.push(...conversionOverlapIssues({ rows: metaRows, picked: pickedConversions, names: conversionNames, creatives, t }));
    issues.push(...pixelLockstepIssues({ pixels: loadMetaPixelEvents(opts.site), expected: settings.meta.expected_event_pairs ?? [], t }));
    const stopped = findStoppedConversions({
      picked: pickedConversions,
      customConversions: loadMetaCustomConversions(opts.site),
      accountIds: settings.meta.ad_account_ids,
      accountsWithSpend: new Set(spendingAds.map((a) => a.account_id)),
    });
    const accountNames = Object.fromEntries(Object.entries(metaState.accounts ?? {}).map(([id, a]) => [id, a?.name]));
    issues.push(...conversionStoppedIssues({ stopped, accountNames }));
  }

  // GA4 vs ledger: not recording, or gap over shared days
  let lastRecordedAt: number | null = null;
  try {
    lastRecordedAt = ledgerLastRecordedAt(opts.site);
  } catch {
    /* ledger optional */
  }
  const leads = leadIssues({ report, baseline, lastRecordedAt, t });
  issues.push(...leads.issues);

  // Clicks → visits: matched visits / link clicks from tagged on-site ads on GA4-exported days
  const baseRatio =
    baseline.totals.ratio_clicks >= t.ratio_min_clicks ? baseline.totals.matched_visits / baseline.totals.ratio_clicks : null;
  const cv = report.ga4.configured
    ? clicksVisitsIssue({ clicks: report.totals.ratio_clicks, visits: report.totals.matched_visits }, baseRatio, t)
    : null;
  if (cv) {
    issues.push({
      id: "clicks_visits_low",
      code: "clicks_visits_low",
      severity: "warning",
      title: cv.reason === "floor" ? "Few ad clicks become visits" : "Ad clicks → visits dropped",
      why: `Only ${Math.round(cv.ratio * 100)}% of Meta clicks from tagged ads show up as visits matched to an ad${
        cv.reason === "drop" && baseRatio ? ` (was ${Math.round(baseRatio * 100)}% in the previous 28 days)` : ""
      }. Slow pages, consent rejections or missing tracking parameters cause this.`,
      how_to_fix: "Check page speed on mobile, the consent rate in Diagnostics → Legal, and that ads use the URL template.",
      spend_affected: {},
      scope: {},
      site_fixable: true,
    });
  }

  const unclear = unclearShareIssue(report.totals.paid_visits, report.totals.unclear_visits, t);
  if (unclear != null) {
    issues.push({
      id: "unclear_share_high",
      code: "unclear_share_high",
      severity: "warning",
      title: "Many Meta visits cannot be classified",
      why: `${Math.round(unclear)}% of Meta visits only have Meta's click id and no campaign tags, so we cannot tell paid from organic posts.`,
      how_to_fix: "Add the URL parameters template to every ad.",
      spend_affected: {},
      scope: {},
      site_fixable: false,
    });
  }

  // Campaigns sending paid Meta visits that no connected account knows (skipped while Meta access/sync is failing)
  const metaBroken = issues.some((i) => i.code === "meta_access_failed" || i.code === "meta_sync_failing");
  const unrecognizedIssues =
    connected && !metaBroken && report.unrecognized_campaigns
      ? unrecognizedCampaignIssues({ data: report.unrecognized_campaigns, t, known: settings.meta.known_external_campaigns })
      : [];
  issues.push(...unrecognizedIssues);
  const flaggedCampaignKeys = new Map(unrecognizedIssues.map((i) => [i.id.slice("unrecognized_campaign:".length), i.scope.campaign_name ?? ""]));

  // Consent — owned by Diagnostics → Legal; info here so it never counts toward Ads totals
  const consentWindow = loadConsentWindow(opts.site, issueDays, now);
  const drop = consentDropPct(consentWindow.current, consentWindow.trailing);
  if (drop != null) {
    issues.push({
      id: "consent_rate_drop",
      code: "consent_rate_drop",
      severity: "info",
      title: "Fewer visitors accept tracking",
      why: `In countries where we ask, the accept rate fell ${Math.round(drop)}% vs the previous 28 days. Fewer accepts means fewer measured visits, not fewer real visits.`,
      how_to_fix: "See Diagnostics → Legal for the consent breakdown and how to fix it.",
      spend_affected: {},
      scope: {},
      site_fixable: false,
    });
  }

  // Info rows for non-page destinations
  for (const d of report.destinations) {
    const code =
      d.kind === "instant_form" ? "instant_form_destination" : d.kind === "off_site" || d.kind === "other_site" ? "off_site_destination" : "unmanaged_destination";
    if (d.kind === "unknown_destination") continue;
    const ads = adsByDest.get(d.key) ?? [];
    if (d.kind === "missing_page" && ads.some((a) => notLiveAds.has(a.ad_id))) continue;
    const ga4Seen = ads.length === 0 && (d.ga4_ads?.length ?? 0) > 0 ? { ga4_seen: d.ga4_ads, ga4_untagged_visits: d.ga4_untagged_visits ?? 0 } : {};
    const ga4OnlyOffSite = code === "off_site_destination" && ads.length === 0 && d.paid_visits > 0;
    issues.push({
      id: `${code}:${d.key}`,
      code,
      severity: code === "unmanaged_destination" && (Object.keys(d.spend).length > 0 || d.paid_visits > 0) ? "warning" : "info",
      title: `${d.kind_label}: ${d.kind === "instant_form" ? "Meta Instant Forms" : d.url}`,
      why:
        d.kind === "instant_form"
          ? "These ads collect leads inside Meta. Leads and spend come from Meta; no site visit happens."
          : d.kind === "missing_page"
            ? "Paid visits land on a URL that is not a page we manage (it may have been deleted)."
            : ga4OnlyOffSite
              ? ga4OnlyOffSiteWhy(d.paid_visits, d.ga4_ads ?? [], flaggedCampaignKeys)
              : "One or more of your ads send people to a site we don't manage here.",
      how_to_fix:
        d.kind === "missing_page"
          ? "Point the ads to a live page, or restore / redirect this URL."
          : ga4OnlyOffSite
            ? "Nothing to fix here."
            : "No action needed unless this is unexpected.",
      spend_affected: d.spend,
      scope: { page_key: d.key, url: d.url, account_id: accountOf(ads) },
      site_fixable: d.kind === "missing_page",
      details: detailsFor(ads, ga4Seen),
    });
  }

  // Restricted ad accounts vs landing Locations (live ads-setup catalog only)
  if (connected && metaSetup) {
    const contentRoot = opts.contentRoot || getDefaultContentRoot();
    issues.push(
      ...accountLocationDiagnosticIssues({
        platform: "meta",
        account_locations: settings.meta.account_locations,
        catalog: metaSetup,
        pageLocations: makeLandingPageLocationsLookup(contentRoot),
      }),
    );
  }

  // ads-config.yml + UTM convention / GA4 standard (declared ad tags, GA4 visits, lead records)
  issues.push(...adsConfigIssues({ readError: adsConfigReadError(opts.contentRoot), rejected: settings.utm_convention_rejected ?? [] }));
  const convention = settings.utm_convention ?? DEFAULT_UTM_CONVENTION;
  const grace = utmGraceState(opts.site, convention, now);
  const observed = loadObservedUtmGroups(opts.site, report.window.start, report.window.end);
  const declared: DeclaredUtm[] = spendingAds
    .filter((a) => a.state === "checked" && creatives[a.ad_id])
    .map((a) => {
      const c = creatives[a.ad_id]!;
      return {
        campaign_id: a.campaign_id,
        campaign_name: a.campaign_name,
        account_id: a.account_id,
        params: { ...parseTrackingParams(c.links[0]), ...parseTrackingParams(c.url_tags) },
        spend: a.spend,
        ad: toIssueAd(a),
      };
    });
  const utmDetails = (ads: AdsIssueAd[]): AdsIssueDetails => ({
    ads,
    ads_total: ads.length,
    ads_offset: 0,
    setup_last_read_at: setupLastReadAt(metaState.accounts, ads.length > 0 ? Array.from(new Set(ads.map((a) => a.account_id))) : settings.meta.ad_account_ids),
  });
  const utmBase = { convention, grace, totalSpend, t, nonPaidCampaigns: new Set(coverage.non_paid_campaigns.map((n) => n.id)) };
  issues.push(
    ...utmIssues({
      ...utmBase,
      platform: "meta",
      declared,
      observed: observed.filter((g) => g.platform === "meta"),
      known: settings.meta.known_external_campaigns,
      detailsFor: utmDetails,
    }),
    ...utmIssues({
      ...utmBase,
      platform: "shared",
      declared: [],
      observed: observed.filter((g) => g.platform !== "meta" && g.platform !== "google"),
      known: [],
    }),
  );

  for (const i of issues) i.platform ??= SHARED_ISSUE_CODES.has(i.code) ? "shared" : "meta";
  sortAdsIssues(issues);
  const accountNames: Record<string, string> = {};
  for (const [id, a] of Object.entries(metaState.accounts ?? {})) if (a?.name) accountNames[id] = a.name;
  return {
    generated_at: now.toISOString(),
    window: { start: report.window.start, end: report.window.end, days: report.window.days },
    connected,
    issues,
    universe: {
      account_names: accountNames,
      ads: spendingAds.map((a) => ({
        ad_id: a.ad_id,
        adset_id: a.adset_id,
        campaign_id: a.campaign_id,
        account_id: a.account_id,
        ad_name: a.ad_name,
        adset_name: a.adset_name,
        campaign_name: a.campaign_name,
        spend: a.spend,
      })),
    },
    suppressed: leads.suppressed,
  };
}
