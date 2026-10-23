/**
 * Response shape of GET /api/analytics/page-stats (page stats drawer).
 * Every section reports its own status so one failing source never blanks the drawer.
 */

import type { FunnelStage } from "./funnel";
import type {
  CampaignFit,
  CampaignGoal,
  CostMetricId,
  FunnelStepId,
  ObjectiveMetricId,
} from "./page-objectives";

export const PAGE_STATS_WINDOW_DAYS = 28;
/** Below this many sessions in the period, rates read "Too little data". */
export const PAGE_STATS_MIN_SESSIONS = 100;

export type PageStatsScope = "url" | "entry";
export type SectionStatus = "ok" | "not_configured" | "insufficient_data" | "error";

export type Section<T> = {
  status: SectionStatus;
  /** Newest day the data covers (YYYY-MM-DD) or ISO time for live sources. */
  as_of: string | null;
  message?: string;
  data: T | null;
};

export type Money = Record<string, number>;
export type Period = { start: string; end: string };

export type NextRelation = "forward" | "same" | "back" | "unknown" | "exit";

export type TrafficTotals = {
  sessions: number;
  page_views: number;
  entrances: number;
  engaged_sessions: number;
  bounces: number;
  exits: number;
  returning_sessions: number;
  moved_forward: number;
  moved_back: number;
  reached_decision: number;
  lead_later: number;
  form_or_cta: number;
  cta_sessions: number;
  task_clicks: number;
  lost: number;
  form_starts: number;
  video_starts: number;
  video_completes: number;
  intent_events: number;
  median_engaged_seconds: number | null;
  median_session_seconds: number | null;
};

export type PathRow = {
  path: string;
  sessions: number;
  stage: FunnelStage | null;
  relation: NextRelation;
};

export type ChannelRow = {
  channel: string;
  sessions: number;
  engaged: number;
  moved_forward: number;
  reached_decision: number;
  lead_later: number;
  bounces: number;
  prior_sessions: number;
  /** Same-stage benchmark for this channel's primary rate (from the nightly baselines). */
  benchmark_rate: number | null;
};

export type CampaignTrafficRow = {
  source: string;
  medium: string;
  campaign: string;
  sessions: number;
  engaged: number;
  moved_forward: number;
  reached_decision: number;
  lead_later: number;
};

export type CtaRow = {
  section_type: string;
  section_index: number | null;
  label: string;
  destination: string;
  clicks: number;
  sessions: number;
};

export type TrafficFacts = {
  current: TrafficTotals;
  prior: TrafficTotals;
  series: Array<{ day: string; sessions: number; prior_sessions: number }>;
  previous_pages: PathRow[];
  next_pages: PathRow[];
  referrers: Array<{ host: string; sessions: number }>;
  channels: ChannelRow[];
  campaigns: CampaignTrafficRow[];
  devices: Array<{ device: string; sessions: number }>;
  countries: Array<{ country: string; sessions: number }>;
  cta: CtaRow[];
  scroll: Array<{ depth: number; sessions: number }>;
  /** First day each new event was seen anywhere on the site in the window; null = not yet. */
  tracking_since: { cta_click: string | null; scroll_depth: string | null };
  /** Prior-period channel rows (same shape; `prior_sessions` unused). */
  prior_channels: ChannelRow[];
  /** Same-stage pages in the current window (benchmark medians); includes this page. */
  peers: PeerRow[];
};

export type PeerRow = {
  path: string;
  sessions: number;
  engaged: number;
  moved_forward: number;
  reached_decision: number;
  task_sessions: number;
};

export type LeadBreakdownRow = { key: string; count: number };

export type LeadBlock = {
  count: number;
  prior_count: number;
  /** Leads the ledger counts as paid (same rule as the Leads page). */
  paid_count: number;
  by_form: LeadBreakdownRow[];
  by_channel: LeadBreakdownRow[];
  by_campaign: LeadBreakdownRow[];
  by_country: LeadBreakdownRow[];
  by_version: LeadBreakdownRow[];
  series: Array<{ day: string; count: number }>;
};

export type LeadsFacts = {
  converted_here: LeadBlock;
  started_here: LeadBlock;
  /** Leads that both started and converted here (counted in both blocks). */
  both: number;
  excluded_test: number;
  excluded_repeat: number;
  collecting_since: string | null;
};

export type KeywordRow = {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
  expected_ctr: number;
  prior_clicks: number | null;
};

export type OrganicFlag =
  | { kind: "page2"; query: string; position: number; impressions: number }
  | { kind: "low_ctr"; query: string; ctr: number; expected_ctr: number; impressions: number }
  | { kind: "decay"; clicks: number; prior_clicks: number }
  | { kind: "cannibalization"; query: string; other_url: string; impressions: number };

export type OrganicFacts = {
  current: { clicks: number; impressions: number; position: number; ctr: number };
  prior: { clicks: number; impressions: number; position: number; ctr: number };
  expected_ctr: number | null;
  series: Array<{ day: string; clicks: number; impressions: number }>;
  keywords: KeywordRow[];
  keywords_source: "bigquery" | "cache";
  flags: OrganicFlag[];
  target_keyword: string | null;
  target_keyword_rank: number | null;
  index: { indexed: boolean; coverage: string | null; inspected_at: string | null } | null;
};

export type PaidCampaignRow = {
  platform: string | null;
  campaign_id: string | null;
  campaign_name: string;
  goal: CampaignGoal;
  fit: CampaignFit;
  spend: Money;
  impressions: number;
  clicks: number;
  paid_visits: number;
  engaged: number;
  unique_leads: number;
  platform_leads: number;
  cost_per_lead: Money;
  cost_per_visit: Money;
  bounce_rate: number | null;
  low_sample: boolean;
  untagged: boolean;
};

export type PaidSplitRow = {
  key: string;
  label: string;
  spend: Money;
  clicks: number;
  paid_visits: number;
  unique_leads: number;
  cost_per_lead: Money | null;
};

export type PaidIssueRow = {
  id: string;
  code: string;
  severity: string;
  title: string;
  platform: string | null;
};

export type PaidFacts = {
  connected: { meta: boolean; google: boolean };
  spend: Money;
  prior_spend: Money;
  impressions: number;
  clicks: number;
  landing_page_views: number;
  paid_visits: number;
  engaged_paid: number;
  unique_leads: number;
  prior_unique_leads: number;
  meta_leads: number;
  meta_click_leads: number;
  google_leads: number;
  cost_per_lead: Money;
  prior_cost_per_lead: Money;
  cost_per_visit: Money;
  ctr: number | null;
  clicks_to_visits: number | null;
  landing_rate: number | null;
  bounce_rate: number | null;
  organic: { sessions: number; bounce_rate: number | null; lead_rate: number | null } | null;
  campaigns: PaidCampaignRow[];
  placements: PaidSplitRow[];
  networks: PaidSplitRow[];
  versions: Array<{ variant: string; paid_visits: number; unique_leads: number; conversion_rate: number | null; low_sample: boolean }>;
  url_changes: Array<{ date: string; ad_name: string; from_url: string; to_url: string }>;
  issues: PaidIssueRow[];
  low_sample: boolean;
  min_paid_visits_for_rates: number;
  /** Median stage cost metric over other same-stage pages (null when the stage has no ads-report denominator). */
  stage_cost_benchmark: { cost: Money | null; pages: number } | null;
};

export type LinksFacts = {
  inbound: Array<{ entry_key: string; path: string | null }>;
  inbound_count: number;
  outbound: Array<{ path: string; stage: FunnelStage | null; sessions: number }>;
  /** True when the page links to no page in the next stage. */
  no_next_stage_link: boolean;
};

export type ChangeMarker = { day: string; writes: number };
export type ChangesFacts = { markers: ChangeMarker[] };

export type TargetSource = "settings" | "benchmark" | "previous_period" | "none";

export type ObjectiveFunnelStep = {
  id: FunnelStepId;
  label: string;
  paid: number | null;
  organic: number | null;
  total: number | null;
  /** Share lost from the previous step (0–1). */
  loss_from_previous: number | null;
  loss_cause: string | null;
};

/** Drops below this share are not called out as the biggest drop. */
export const FUNNEL_BIG_DROP_MIN = 0.3;

/**
 * Index of the step with the largest loss from the step before it, or -1. Impressions → clicks
 * is skipped: that drop is the click-through rate, and 95%+ there is normal.
 */
export function biggestFunnelDrop(funnel: ObjectiveFunnelStep[]): number {
  let best = -1;
  for (let i = 1; i < funnel.length; i++) {
    const loss = funnel[i]!.loss_from_previous;
    if (loss === null || loss < FUNNEL_BIG_DROP_MIN || funnel[i - 1]!.id === "impressions") continue;
    if (best === -1 || loss > funnel[best]!.loss_from_previous!) best = i;
  }
  return best;
}

export type ObjectiveDriver = {
  label: string;
  kind: "channel" | "campaign";
  contribution: number;
  rate: number | null;
  cost: Money | null;
};

export type ObjectiveBlock = {
  stage: FunnelStage;
  job: string;
  primary: {
    id: ObjectiveMetricId;
    label: string;
    value: number | null;
    numerator: number;
    denominator: number;
    prior_value: number | null;
    target: number | null;
    target_source: TargetSource;
    benchmark: number | null;
    status: "on_track" | "behind" | "too_little_data" | "no_target";
  };
  cost: {
    id: CostMetricId;
    label: string;
    value: Money | null;
    prior_value: Money | null;
    target: Money | null;
    target_source: TargetSource;
    benchmark: Money | null;
    status: "on_track" | "behind" | "too_little_data" | "no_target" | "no_spend";
  } | null;
  funnel: ObjectiveFunnelStep[];
  drivers: ObjectiveDriver[];
  dragging: ObjectiveDriver | null;
};

export type FindingTone = "good" | "warn" | "bad" | "info";

export type FindingLink =
  | { kind: "seo_modal" }
  | { kind: "funnel_tab" }
  | { kind: "leads"; filter: "conversion_path" | "landing_path"; path: string }
  | { kind: "ads_diagnostics"; platform: "meta" | "google" | null }
  | { kind: "targets" }
  | { kind: "url"; href: string; label: string };

export type Finding = {
  id: string;
  tone: FindingTone;
  title: string;
  evidence: string;
  action: string;
  link: FindingLink | null;
  /** Higher = moves the objective more (used for ranking). */
  weight: number;
};

export type PageAdvice = {
  verdict: { tone: FindingTone; text: string };
  findings: Finding[];
};

export type PageStatsResponse = {
  path: string;
  paths: string[];
  scope: PageStatsScope;
  window: { days: number; current: Period; prior: Period };
  entry: { content_type: string; slug: string; locale: string; key: string; title: string | null } | null;
  locale_urls: Record<string, string>;
  stage: FunnelStage | null;
  objective: ObjectiveBlock | null;
  advice: PageAdvice;
  sections: {
    traffic: Section<TrafficFacts>;
    leads: Section<LeadsFacts>;
    organic: Section<OrganicFacts>;
    paid: Section<PaidFacts>;
    links: Section<LinksFacts>;
    changes: Section<ChangesFacts>;
  };
  generated_at: string;
};

export type StageBenchmarks = Partial<
  Record<FunnelStage, { rate: number | null; cost: Money | null; pages: number }>
>;
