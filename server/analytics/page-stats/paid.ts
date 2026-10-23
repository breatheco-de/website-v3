/**
 * Paid lens for one page from the Meta + Google ads report (same numbers as Diagnostics → Ads):
 * this page's row(s), its campaigns joined with each campaign's goal from the ad setup, ad URL
 * changes and the open ads diagnostics issues that point at this page.
 */

import { assembleAdsReportFromRollups } from "../../ads/ads-rollups";
import { loadAdsSetup } from "../../ads/ads-setup";
import { adsIssueCounts } from "../../ads/diagnostics/read";
import type { AdsCampaignRef, AdsPageRow, AdsReport } from "../../ads/ads-report";
import type { ContentIndex } from "../../content-index";
import { normalizeLandingPath } from "@shared/paid-traffic";
import {
  campaignFit,
  campaignGoalFromGoogle,
  campaignGoalFromMeta,
  type CampaignGoal,
} from "@shared/page-objectives";
import type { FunnelStage } from "@shared/funnel";
import type { Money, PaidCampaignRow, PaidFacts, PaidIssueRow, Section } from "@shared/page-stats";
import { stageCostBenchmark } from "./benchmarks";

type MoneyMap = Record<string, number>;

function addMoney(a: MoneyMap, b: MoneyMap | undefined): MoneyMap {
  const out = { ...a };
  for (const [c, v] of Object.entries(b ?? {})) out[c] = Math.round(((out[c] ?? 0) + v) * 100) / 100;
  return out;
}

function divMoney(m: MoneyMap, n: number): Money {
  if (n <= 0) return {};
  const out: Money = {};
  for (const [c, v] of Object.entries(m)) out[c] = Math.round((v / n) * 100) / 100;
  return out;
}

function hasSpend(m: MoneyMap): boolean {
  return Object.values(m).some((v) => v > 0);
}

function spendTotal(m: MoneyMap): number {
  let total = 0;
  for (const v of Object.values(m)) total += v;
  return total;
}

/** Sum the report rows that land on any of the page's paths. */
function rowsFor(report: AdsReport, paths: Set<string>): AdsPageRow[] {
  return report.pages.filter((r) => r.kind === "entry" && paths.has(normalizeLandingPath(r.path)));
}

type Summed = {
  spend: MoneyMap;
  impressions: number;
  clicks: number;
  landing_page_views: number;
  paid_visits: number;
  engaged: number;
  unique_leads: number;
  meta_leads: number;
  meta_click_leads: number;
  google_leads: number;
  matched_visits: number;
  ratio_clicks: number;
  organic: PaidFacts["organic"];
  low_sample: boolean;
};

function sum(rows: AdsPageRow[]): Summed {
  const s: Summed = {
    spend: {}, impressions: 0, clicks: 0, landing_page_views: 0, paid_visits: 0, engaged: 0, unique_leads: 0,
    meta_leads: 0, meta_click_leads: 0, google_leads: 0, matched_visits: 0, ratio_clicks: 0, organic: null, low_sample: true,
  };
  let orgSessions = 0;
  let orgBounced = 0;
  let orgLeads = 0;
  for (const r of rows) {
    s.spend = addMoney(s.spend, r.spend);
    s.impressions += r.impressions;
    s.clicks += r.clicks;
    s.landing_page_views += r.landing_page_views;
    s.paid_visits += r.paid_visits;
    s.engaged += r.engaged_sessions;
    s.unique_leads += r.unique_leads;
    s.meta_leads += r.meta_leads;
    s.meta_click_leads += r.pixel_leads_click;
    s.google_leads += r.google_leads;
    s.matched_visits += r.matched_visits;
    if (r.clicks_to_visits !== null && r.clicks_to_visits > 0) s.ratio_clicks += r.matched_visits / r.clicks_to_visits;
    s.low_sample = s.low_sample && r.low_sample;
    if (r.organic) {
      orgSessions += r.organic.sessions;
      orgBounced += (r.organic.bounce_rate ?? 0) * r.organic.sessions;
      orgLeads += (r.organic.lead_rate ?? 0) * r.organic.sessions;
    }
  }
  if (orgSessions > 0) {
    s.organic = { sessions: orgSessions, bounce_rate: orgBounced / orgSessions, lead_rate: orgLeads / orgSessions };
  }
  return s;
}

function campaignGoals(site: string): (platform: string | null, campaignId: string | null) => CampaignGoal {
  const meta = loadAdsSetup(site, "meta");
  const google = loadAdsSetup(site, "google");
  const metaAdsetGoal = new Map<string, string>();
  for (const a of Object.values(meta.adsets)) {
    const g = a.delivery?.optimization_goal;
    if (g && !metaAdsetGoal.has(a.campaign_id)) metaAdsetGoal.set(a.campaign_id, g);
  }
  return (platform, campaignId) => {
    if (!campaignId) return "unknown";
    if (platform === "meta") {
      const c = meta.campaigns[campaignId];
      return campaignGoalFromMeta(c?.extras?.objective, metaAdsetGoal.get(campaignId));
    }
    if (platform === "google") return campaignGoalFromGoogle(google.campaigns[campaignId]?.extras?.channel_type);
    return "unknown";
  };
}

function campaignRows(rows: AdsPageRow[], stage: FunnelStage | null, goalOf: ReturnType<typeof campaignGoals>): PaidCampaignRow[] {
  const merged = new Map<string, AdsCampaignRef>();
  for (const r of rows) {
    for (const c of r.campaigns) {
      const key = `${c.platform ?? ""}|${c.campaign_id ?? c.campaign_name}|${c.untagged ? "u" : ""}`;
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, { ...c, spend: { ...c.spend } });
        continue;
      }
      prev.spend = addMoney(prev.spend, c.spend);
      prev.paid_visits += c.paid_visits;
      prev.engaged_sessions += c.engaged_sessions;
      prev.clicks += c.clicks;
      prev.impressions += c.impressions;
      prev.unique_leads += c.unique_leads;
      prev.meta_leads += c.meta_leads;
      prev.google_leads += c.google_leads;
      prev.low_sample = prev.low_sample && c.low_sample;
    }
  }
  return [...merged.values()]
    .map((c) => {
      const goal = c.untagged ? "unknown" : goalOf(c.platform, c.campaign_id);
      return {
        platform: c.platform,
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        goal,
        fit: campaignFit(stage, goal),
        spend: c.spend,
        impressions: c.impressions,
        clicks: c.clicks,
        paid_visits: c.paid_visits,
        engaged: c.engaged_sessions,
        unique_leads: c.unique_leads,
        platform_leads: c.meta_leads + c.google_leads,
        cost_per_lead: divMoney(c.spend, c.unique_leads),
        cost_per_visit: divMoney(c.spend, c.paid_visits),
        bounce_rate: c.paid_visits > 0 ? 1 - c.engaged_sessions / c.paid_visits : null,
        low_sample: c.low_sample,
        untagged: !!c.untagged,
      } satisfies PaidCampaignRow;
    })
    .sort((a, b) => spendTotal(b.spend) - spendTotal(a.spend) || b.paid_visits - a.paid_visits);
}

function pageIssues(site: string, rows: AdsPageRow[], paths: Set<string>): PaidIssueRow[] {
  const keys = new Set(rows.map((r) => r.key));
  try {
    return adsIssueCounts(site)
      .rows.filter((i) => i.verify.state === "open")
      .filter((i) => {
        if (i.scope.page_key && keys.has(i.scope.page_key)) return true;
        if (!i.scope.url) return false;
        try {
          return paths.has(normalizeLandingPath(new URL(i.scope.url, "https://x.invalid").pathname));
        } catch {
          return false;
        }
      })
      .slice(0, 8)
      .map((i) => ({ id: i.id, code: i.code, severity: i.severity, title: i.title, platform: i.platform ?? null }));
  } catch {
    return [];
  }
}

/** Ads-report denominator of the stage's cost metric (consideration has none in the report). */
function costDenominator(stage: FunnelStage | null, r: AdsPageRow): number | null {
  if (stage === "awareness") return r.engaged_sessions;
  if (stage === "decision") return r.unique_leads;
  return null;
}

function peerCost(
  report: AdsReport,
  stage: FunnelStage | null,
  peerPaths: string[],
  ownPaths: Set<string>,
): PaidFacts["stage_cost_benchmark"] {
  if (stage !== "awareness" && stage !== "decision") return null;
  const peers = new Set(peerPaths.map(normalizeLandingPath));
  const minVisits = report.thresholds.min_paid_visits_for_rates;
  const rows = report.pages
    .filter((r) => r.kind === "entry")
    .filter((r) => {
      const p = normalizeLandingPath(r.path);
      return peers.has(p) && !ownPaths.has(p);
    })
    .map((r) => ({ spend: r.spend, denominator: costDenominator(stage, r) ?? 0, enough: r.paid_visits >= minVisits }));
  return stageCostBenchmark(rows);
}

export async function queryPagePaid(opts: {
  site: string;
  contentRoot?: string;
  ci: ContentIndex;
  paths: string[];
  stage: FunnelStage | null;
  days: number;
  prior: { start: string; end: string };
  peerPaths?: string[];
}): Promise<Section<PaidFacts>> {
  try {
    const current = await assembleAdsReportFromRollups({
      site: opts.site,
      contentRoot: opts.contentRoot,
      contentIndex: opts.ci,
      days: opts.days,
      noRefresh: true,
    });
    const connected = { meta: current.meta.connected, google: current.google.connected };
    if (!connected.meta && !connected.google) {
      return { status: "not_configured", as_of: null, message: "No ad platform is connected (Settings → Ads).", data: null };
    }
    const prior = await assembleAdsReportFromRollups({
      site: opts.site,
      contentRoot: opts.contentRoot,
      contentIndex: opts.ci,
      since: opts.prior.start,
      until: opts.prior.end,
      noRefresh: true,
    });
    const paths = new Set(opts.paths.map(normalizeLandingPath));
    const rows = rowsFor(current, paths);
    const s = sum(rows);
    const p = sum(rowsFor(prior, paths));
    const minVisits = current.thresholds.min_paid_visits_for_rates;
    const data: PaidFacts = {
      connected,
      spend: s.spend,
      prior_spend: p.spend,
      impressions: s.impressions,
      clicks: s.clicks,
      landing_page_views: s.landing_page_views,
      paid_visits: s.paid_visits,
      engaged_paid: s.engaged,
      unique_leads: s.unique_leads,
      prior_unique_leads: p.unique_leads,
      meta_leads: s.meta_leads,
      meta_click_leads: s.meta_click_leads,
      google_leads: s.google_leads,
      cost_per_lead: divMoney(s.spend, s.unique_leads),
      prior_cost_per_lead: divMoney(p.spend, p.unique_leads),
      cost_per_visit: divMoney(s.spend, s.paid_visits),
      ctr: s.impressions > 0 ? s.clicks / s.impressions : null,
      clicks_to_visits: s.ratio_clicks > 0 ? s.matched_visits / s.ratio_clicks : null,
      landing_rate: s.clicks > 0 && s.landing_page_views > 0 ? s.landing_page_views / s.clicks : null,
      bounce_rate: s.paid_visits > 0 ? 1 - s.engaged / s.paid_visits : null,
      organic: s.organic,
      campaigns: campaignRows(rows, opts.stage, campaignGoals(opts.site)),
      placements: [],
      networks: [],
      versions: [],
      url_changes: rows
        .flatMap((r) => r.url_changes ?? [])
        .slice(0, 5)
        .map((u) => ({ date: u.date, ad_name: u.ad_name, from_url: u.from_url, to_url: u.to_url })),
      issues: pageIssues(opts.site, rows, paths),
      low_sample: s.paid_visits < minVisits,
      min_paid_visits_for_rates: minVisits,
      stage_cost_benchmark: peerCost(current, opts.stage, opts.peerPaths ?? [], paths),
    };
    const empty = rows.length === 0 || (!hasSpend(s.spend) && s.paid_visits === 0);
    return {
      status: empty ? "insufficient_data" : "ok",
      as_of: current.window.end,
      ...(empty ? { message: "No ad spend or paid visits landed on this page in the period." } : {}),
      data,
    };
  } catch (err) {
    return { status: "error", as_of: null, message: err instanceof Error ? err.message : String(err), data: null };
  }
}
