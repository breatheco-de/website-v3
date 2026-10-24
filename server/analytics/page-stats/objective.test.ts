import { describe, expect, it } from "vitest";
import { buildObjective, moneyWithinTarget } from "./objective";
import { buildPageAdvice } from "./advice";
import { campaignFit, campaignGoalFromGoogle, campaignGoalFromMeta } from "@shared/page-objectives";
import { biggestFunnelDrop } from "@shared/page-stats";
import type { LeadBlock, LeadsFacts, ObjectiveFunnelStep, PaidCampaignRow, PaidFacts, TrafficFacts, TrafficTotals } from "@shared/page-stats";

function totals(p: Partial<TrafficTotals> = {}): TrafficTotals {
  return {
    sessions: 0, page_views: 0, entrances: 0, engaged_sessions: 0, bounces: 0, exits: 0, returning_sessions: 0,
    moved_forward: 0, moved_back: 0, reached_decision: 0, lead_later: 0, form_or_cta: 0, cta_sessions: 0,
    task_clicks: 0, lost: 0, form_starts: 0, video_starts: 0, video_completes: 0, intent_events: 0,
    median_engaged_seconds: null, median_session_seconds: null, ...p,
  };
}

function traffic(cur: Partial<TrafficTotals>, prior: Partial<TrafficTotals> = {}, extra: Partial<TrafficFacts> = {}): TrafficFacts {
  return {
    current: totals(cur), prior: totals(prior), series: [], previous_pages: [], next_pages: [], referrers: [],
    channels: [], campaigns: [], devices: [], countries: [], cta: [], scroll: [],
    tracking_since: { cta_click: null, scroll_depth: null }, prior_channels: [], peers: [], ...extra,
  };
}

function block(count: number, prior = 0, paid = 0): LeadBlock {
  return { count, prior_count: prior, paid_count: paid, by_form: [], by_channel: [], by_campaign: [], by_country: [], by_version: [], series: [] };
}

function leads(converted: number, prior = 0): LeadsFacts {
  return { converted_here: block(converted, prior), started_here: block(0), both: 0, excluded_test: 0, excluded_repeat: 0, collecting_since: null };
}

function campaign(p: Partial<PaidCampaignRow>): PaidCampaignRow {
  return {
    platform: "meta", campaign_id: "c1", campaign_name: "Campaign", goal: "leads", fit: "fit", spend: {}, impressions: 0,
    clicks: 0, paid_visits: 0, engaged: 0, unique_leads: 0, platform_leads: 0, cost_per_lead: {}, cost_per_visit: {},
    bounce_rate: null, low_sample: false, untagged: false, ...p,
  };
}

function paid(p: Partial<PaidFacts>): PaidFacts {
  return {
    connected: { meta: true, google: false }, spend: {}, prior_spend: {}, impressions: 0, clicks: 0, landing_page_views: 0,
    paid_visits: 0, engaged_paid: 0, unique_leads: 0, prior_unique_leads: 0, meta_leads: 0, meta_click_leads: 0,
    google_leads: 0, cost_per_lead: {}, prior_cost_per_lead: {}, cost_per_visit: {}, ctr: null, clicks_to_visits: null,
    landing_rate: null, bounce_rate: null, organic: null, campaigns: [], placements: [], networks: [], versions: [],
    url_changes: [], issues: [], low_sample: false, min_paid_visits_for_rates: 20, stage_cost_benchmark: null, ...p,
  };
}

describe("buildObjective", () => {
  it("uses the settings target first, then the benchmark, then the previous period", () => {
    const t = traffic({ sessions: 400, reached_decision: 80 }, { sessions: 300, reached_decision: 90 });
    const base = { stage: "consideration" as const, traffic: t, leads: null, paid: null, organic: null };
    const withSettings = buildObjective({ ...base, target: { rate: 0.25 }, rateBenchmark: 0.1 });
    expect(withSettings.primary).toMatchObject({ value: 0.2, target: 0.25, target_source: "settings", status: "behind" });
    const withBench = buildObjective({ ...base, target: undefined, rateBenchmark: 0.15 });
    expect(withBench.primary).toMatchObject({ target: 0.15, target_source: "benchmark", status: "on_track" });
    const withPrior = buildObjective({ ...base, target: undefined, rateBenchmark: null });
    expect(withPrior.primary.target_source).toBe("previous_period");
    expect(withPrior.primary.target).toBeCloseTo(0.3);
  });

  it("reports too little data below the session minimum", () => {
    const o = buildObjective({
      stage: "awareness", traffic: traffic({ sessions: 40, moved_forward: 10 }), leads: null, paid: null, organic: null,
      target: { rate: 0.1 }, rateBenchmark: null,
    });
    expect(o.primary.status).toBe("too_little_data");
  });

  it("decision conversion uses ledger leads ÷ sessions and cost per lead vs target", () => {
    const o = buildObjective({
      stage: "decision",
      traffic: traffic({ sessions: 500 }),
      leads: leads(20),
      paid: paid({ spend: { USD: 1000 }, unique_leads: 20, cost_per_lead: { USD: 50 } }),
      organic: null,
      target: { rate: 0.05, cost: { USD: 35 } },
      rateBenchmark: null,
    });
    expect(o.primary.value).toBeCloseTo(0.04);
    expect(o.primary.status).toBe("behind");
    expect(o.cost).toMatchObject({ status: "behind", target_source: "settings", value: { USD: 50 } });
  });

  it("builds the funnel from visits when there are no impressions or clicks", () => {
    const o = buildObjective({
      stage: "awareness",
      traffic: traffic({ sessions: 200, engaged_sessions: 120, moved_forward: 30 }),
      leads: null, paid: null, organic: null, target: undefined, rateBenchmark: null,
    });
    expect(o.funnel.map((s) => s.id)).toEqual(["visits", "engaged", "moved_forward"]);
    expect(o.funnel[1]!.loss_from_previous).toBeCloseTo(0.4);
    expect(o.funnel[0]!.loss_from_previous).toBeNull();
  });

  it("picks the biggest drop after the click-through step", () => {
    const step = (id: ObjectiveFunnelStep["id"], loss: number | null): ObjectiveFunnelStep => ({
      id, label: id, paid: null, organic: null, total: 1, loss_from_previous: loss, loss_cause: null,
    });
    expect(biggestFunnelDrop([step("impressions", null), step("clicks", 0.97), step("visits", 0.2), step("engaged", 0.45), step("lead", 0.35)])).toBe(3);
    expect(biggestFunnelDrop([step("impressions", null), step("clicks", 0.97), step("visits", 0.1)])).toBe(-1);
    expect(biggestFunnelDrop([step("visits", null), step("engaged", 0.25)])).toBe(-1);
  });
});

describe("moneyWithinTarget", () => {
  it("compares only currencies present in both", () => {
    expect(moneyWithinTarget({ USD: 30 }, { USD: 35 })).toBe(true);
    expect(moneyWithinTarget({ USD: 40, EUR: 10 }, { USD: 35 })).toBe(false);
    expect(moneyWithinTarget({ EUR: 10 }, { USD: 35 })).toBeNull();
  });
});

describe("campaign goal fit", () => {
  it("maps platform goals and flags mismatches against the page stage", () => {
    expect(campaignGoalFromMeta("OUTCOME_LEADS")).toBe("leads");
    expect(campaignGoalFromMeta(null, "LANDING_PAGE_VIEWS")).toBe("traffic");
    expect(campaignGoalFromGoogle("DISPLAY")).toBe("awareness");
    expect(campaignFit("awareness", "leads")).toBe("mismatch");
    expect(campaignFit("decision", "traffic")).toBe("mismatch");
    expect(campaignFit("decision", "search_intent")).toBe("fit");
    expect(campaignFit("consideration", "leads")).toBe("soft");
    expect(campaignFit("post-enrollment", "search_intent")).toBe("mismatch");
  });
});

describe("buildPageAdvice", () => {
  it("asks for a stage when none is set", () => {
    const a = buildPageAdvice({ stage: null, path: "/x", objective: null, traffic: null, leads: null, organic: null, paid: null, links: null });
    expect(a.findings[0]!.link).toEqual({ kind: "funnel_tab" });
    expect(a.verdict.tone).toBe("info");
  });

  it("ranks a decision page's wasted and over-target campaigns, capped at 3 findings", () => {
    const t = traffic({ sessions: 600, engaged_sessions: 300, form_or_cta: 60 });
    const p = paid({
      spend: { USD: 1000 },
      clicks: 400,
      clicks_to_visits: 0.4,
      unique_leads: 10,
      cost_per_lead: { USD: 100 },
      campaigns: [
        campaign({ campaign_id: "a", campaign_name: "Wasted", spend: { USD: 400 }, clicks: 200, paid_visits: 150 }),
        campaign({ campaign_id: "b", campaign_name: "Traffic one", goal: "traffic", fit: "mismatch", spend: { USD: 300 }, unique_leads: 2, cost_per_lead: { USD: 150 } }),
      ],
    });
    const objective = buildObjective({
      stage: "decision", traffic: t, leads: leads(12), paid: p, organic: null, target: { rate: 0.05, cost: { USD: 40 } }, rateBenchmark: null,
    });
    const a = buildPageAdvice({ stage: "decision", path: "/en/apply", objective, traffic: t, leads: leads(12), organic: null, paid: p, links: null });
    expect(a.verdict.tone).toBe("bad");
    expect(a.findings).toHaveLength(3);
    expect(a.findings.map((f) => f.id)).toEqual(["campaign_no_leads:a", "decision_test_variant", "campaign_over_cpl:b"]);
    expect(a.findings[2]!.evidence).toMatch(/would buy 7/);

    const onlyMismatch = buildPageAdvice({
      stage: "decision", path: "/en/apply", objective: null, traffic: t, leads: null, organic: null,
      paid: paid({ spend: { USD: 300 }, campaigns: [p.campaigns[1]!] }), links: null,
    });
    expect(onlyMismatch.findings.map((f) => f.id)).toContain("campaign_goal_mismatch");
  });

  it("flags ad spend on a post-enrollment page first", () => {
    const t = traffic({ sessions: 150 });
    const a = buildPageAdvice({
      stage: "post-enrollment", path: "/en/how-to/x", objective: null, traffic: t, leads: null, organic: null,
      paid: paid({ spend: { USD: 50 } }), links: null,
    });
    expect(a.findings[0]!.id).toBe("post_enrollment_spend");
  });

  it("suppresses rate findings below the session minimum", () => {
    const t = traffic({ sessions: 30, moved_back: 20 });
    const a = buildPageAdvice({ stage: "consideration", path: "/x", objective: null, traffic: t, leads: null, organic: null, paid: null, links: null });
    expect(a.findings.find((f) => f.id === "back_rate")).toBeUndefined();
    expect(a.verdict.text).toMatch(/Too little traffic/);
  });
});
