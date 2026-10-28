/**
 * The stage objective block: primary metric value vs target (settings → same-stage benchmark →
 * previous period), the paid cost metric, the objective funnel (paid vs organic per step with the
 * loss between steps) and the channels / campaigns driving or dragging the objective. Pure.
 */

import {
  FUNNEL_LOSS_CAUSES,
  FUNNEL_STEP_LABELS,
  STAGE_OBJECTIVES,
  type FunnelStepId,
  type ObjectiveMetricId,
  type StageTargetValues,
} from "@shared/page-objectives";
import {
  PAGE_STATS_MIN_SESSIONS,
  type ChannelRow,
  type LeadsFacts,
  type Money,
  type ObjectiveBlock,
  type ObjectiveDriver,
  type ObjectiveFunnelStep,
  type OrganicFacts,
  type PaidFacts,
  type TargetSource,
  type TrafficFacts,
  type TrafficTotals,
} from "@shared/page-stats";
import type { FunnelStage } from "@shared/funnel";

export type ObjectiveInputs = {
  stage: FunnelStage;
  traffic: TrafficFacts | null;
  leads: LeadsFacts | null;
  paid: PaidFacts | null;
  organic: OrganicFacts | null;
  target: StageTargetValues | undefined;
  rateBenchmark: number | null;
  rateBenchmarkPages?: number;
  /** One version of a test: no cost block (spend can't be split) and no previous-period target. */
  testView?: boolean;
};

const CHANNEL_LABELS: Record<string, string> = {
  paid: "Paid ads",
  organic: "Organic search",
  direct: "Direct",
  email: "Email",
  social: "Social",
  referral: "Referral",
  other: "Other",
  internal: "From another page on the site",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/** Numerator of the primary metric for a set of totals (decision uses ledger leads). */
function primaryNumerator(metric: ObjectiveMetricId, t: TrafficTotals, convertedLeads: number): number {
  switch (metric) {
    case "moved_forward_rate":
      return t.moved_forward;
    case "reached_decision_rate":
      return t.reached_decision;
    case "task_click_rate":
      return t.task_clicks;
    case "conversion_rate":
      return convertedLeads;
  }
}

/** Per-channel numerator (decision: GA4 lead later in session, the only per-channel lead signal). */
function channelNumerator(metric: ObjectiveMetricId, c: ChannelRow): number {
  switch (metric) {
    case "moved_forward_rate":
      return c.moved_forward;
    case "reached_decision_rate":
      return c.reached_decision;
    case "task_click_rate":
      return 0;
    case "conversion_rate":
      return c.lead_later;
  }
}

export function divideMoney(m: Money, n: number): Money | null {
  if (n <= 0) return null;
  const out: Money = {};
  for (const [c, v] of Object.entries(m)) if (v > 0) out[c] = Math.round((v / n) * 100) / 100;
  return Object.keys(out).length > 0 ? out : null;
}

function hasSpend(m: Money | null | undefined): boolean {
  return !!m && Object.values(m).some((v) => v > 0);
}

/** Lower is better: on track when every currency present in both is at or under target. */
export function moneyWithinTarget(value: Money, target: Money): boolean | null {
  const shared = Object.keys(value).filter((c) => c in target);
  if (shared.length === 0) return null;
  return shared.every((c) => value[c]! <= target[c]!);
}

function costValues(stage: FunnelStage, traffic: TrafficFacts | null, paid: PaidFacts): { value: Money | null; prior: Money | null } {
  if (stage === "awareness") {
    return { value: divideMoney(paid.spend, paid.engaged_paid), prior: null };
  }
  if (stage === "consideration") {
    const cur = traffic?.channels.find((c) => c.channel === "paid")?.reached_decision ?? 0;
    const prior = traffic?.prior_channels.find((c) => c.channel === "paid")?.reached_decision ?? 0;
    return { value: divideMoney(paid.spend, cur), prior: divideMoney(paid.prior_spend, prior) };
  }
  return {
    value: hasSpend(paid.cost_per_lead) ? paid.cost_per_lead : null,
    prior: hasSpend(paid.prior_cost_per_lead) ? paid.prior_cost_per_lead : null,
  };
}

function stepValues(
  step: FunnelStepId,
  stage: FunnelStage,
  traffic: TrafficFacts | null,
  leads: LeadsFacts | null,
  paid: PaidFacts | null,
  organic: OrganicFacts | null,
): { paid: number | null; organic: number | null; total: number | null } {
  const ch = (name: string) => traffic?.channels.find((c) => c.channel === name);
  const both = (p: number | null | undefined, o: number | null | undefined, total?: number | null) => ({
    paid: p ?? null,
    organic: o ?? null,
    total: total !== undefined ? total : p == null && o == null ? null : (p ?? 0) + (o ?? 0),
  });
  const t = traffic?.current;
  switch (step) {
    case "impressions":
      return both(paid ? paid.impressions : null, organic ? organic.current.impressions : null);
    case "clicks":
      return both(paid ? paid.clicks : null, organic ? organic.current.clicks : null);
    case "visits":
      return both(ch("paid")?.sessions ?? (traffic ? 0 : null), ch("organic")?.sessions ?? (traffic ? 0 : null), t?.sessions ?? null);
    case "engaged":
      return both(ch("paid")?.engaged ?? (traffic ? 0 : null), ch("organic")?.engaged ?? (traffic ? 0 : null), t?.engaged_sessions ?? null);
    case "moved_forward":
      return both(ch("paid")?.moved_forward ?? (traffic ? 0 : null), ch("organic")?.moved_forward ?? (traffic ? 0 : null), t?.moved_forward ?? null);
    case "reached_decision":
      return both(ch("paid")?.reached_decision ?? (traffic ? 0 : null), ch("organic")?.reached_decision ?? (traffic ? 0 : null), t?.reached_decision ?? null);
    case "form_or_cta":
      return { paid: null, organic: null, total: t?.form_or_cta ?? null };
    case "task_click":
      return { paid: null, organic: null, total: t?.task_clicks ?? null };
    case "lead": {
      const block = stage === "decision" ? leads?.converted_here : leads?.started_here;
      if (!block) return { paid: null, organic: null, total: null };
      const organicLeads = block.by_channel.find((r) => r.key === "organic_search")?.count ?? 0;
      return { paid: block.paid_count, organic: organicLeads, total: block.count };
    }
  }
}

export function buildFunnel(inputs: ObjectiveInputs): ObjectiveFunnelStep[] {
  const steps = STAGE_OBJECTIVES[inputs.stage].funnel
    .map((id) => ({ id, ...stepValues(id, inputs.stage, inputs.traffic, inputs.leads, inputs.paid, inputs.organic) }))
    // Without ads or search data the funnel starts at visits.
    .filter((s) => !((s.id === "impressions" || s.id === "clicks") && !s.total));
  const out: ObjectiveFunnelStep[] = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    const loss =
      prev && prev.total !== null && prev.total > 0 && s.total !== null && s.total <= prev.total
        ? 1 - s.total / prev.total
        : null;
    out.push({
      ...s,
      label: FUNNEL_STEP_LABELS[s.id],
      loss_from_previous: loss,
      loss_cause: prev ? FUNNEL_LOSS_CAUSES[prev.id] ?? null : null,
    });
  }
  return out;
}

function buildDrivers(inputs: ObjectiveInputs, metric: ObjectiveMetricId): { drivers: ObjectiveDriver[]; dragging: ObjectiveDriver | null } {
  const traffic = inputs.traffic;
  if (!traffic) return { drivers: [], dragging: null };
  const total = traffic.current.sessions;
  const overall = ratio(
    traffic.channels.reduce((s, c) => s + channelNumerator(metric, c), 0),
    total,
  );
  const paidCost = inputs.paid ? costValues(inputs.stage, traffic, inputs.paid).value : null;
  const channelDrivers = traffic.channels
    .map((c) => ({
      label: channelLabel(c.channel),
      kind: "channel" as const,
      contribution: channelNumerator(metric, c),
      rate: ratio(channelNumerator(metric, c), c.sessions),
      cost: c.channel === "paid" ? paidCost : null,
      sessions: c.sessions,
    }))
    .filter((d) => d.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution);

  const campaignDrivers: ObjectiveDriver[] =
    inputs.stage === "decision" && inputs.paid
      ? inputs.paid.campaigns
          .filter((c) => !c.untagged && c.unique_leads > 0)
          .map((c) => ({
            label: c.campaign_name,
            kind: "campaign" as const,
            contribution: c.unique_leads,
            rate: ratio(c.unique_leads, c.paid_visits),
            cost: hasSpend(c.cost_per_lead) ? c.cost_per_lead : null,
          }))
          .sort((a, b) => b.contribution - a.contribution)
      : [];

  const drivers: ObjectiveDriver[] = [
    ...channelDrivers.slice(0, 3).map(({ sessions: _s, ...d }) => d),
    ...campaignDrivers.slice(0, 1),
  ];

  let dragging: ObjectiveDriver | null = null;
  if (overall !== null && total >= PAGE_STATS_MIN_SESSIONS && metric !== "task_click_rate") {
    const worst = traffic.channels
      .filter((c) => c.sessions >= total * 0.1)
      .map((c) => ({ c, rate: ratio(channelNumerator(metric, c), c.sessions) ?? 0 }))
      .filter((x) => x.rate < overall * 0.5)
      .sort((a, b) => b.c.sessions - a.c.sessions)[0];
    if (worst) {
      dragging = {
        label: channelLabel(worst.c.channel),
        kind: "channel",
        contribution: channelNumerator(metric, worst.c),
        rate: worst.rate,
        cost: worst.c.channel === "paid" ? paidCost : null,
      };
    }
  }
  if (!dragging && inputs.stage === "decision" && inputs.paid) {
    const spendTotal = Object.values(inputs.paid.spend).reduce((s, v) => s + v, 0);
    const waste = inputs.paid.campaigns
      .filter((c) => !c.untagged && c.unique_leads === 0)
      .map((c) => ({ c, spend: Object.values(c.spend).reduce((s, v) => s + v, 0) }))
      .filter((x) => spendTotal > 0 && x.spend >= spendTotal * 0.2)
      .sort((a, b) => b.spend - a.spend)[0];
    if (waste) {
      dragging = { label: waste.c.campaign_name, kind: "campaign", contribution: 0, rate: 0, cost: waste.c.spend };
    }
  }
  return { drivers, dragging };
}

export function buildObjective(inputs: ObjectiveInputs): ObjectiveBlock {
  const def = STAGE_OBJECTIVES[inputs.stage];
  const metric = def.primary.id;
  const t = inputs.traffic;
  const convertedNow = inputs.leads?.converted_here.count ?? 0;
  const convertedPrior = inputs.leads?.converted_here.prior_count ?? 0;
  const numerator = t ? primaryNumerator(metric, t.current, convertedNow) : convertedNow;
  const denominator = t?.current.sessions ?? 0;
  const value = t ? ratio(numerator, denominator) : null;
  const priorValue = t ? ratio(primaryNumerator(metric, t.prior, convertedPrior), t.prior.sessions) : null;

  let target: number | null = null;
  let targetSource: TargetSource = "none";
  if (inputs.target?.rate !== undefined) {
    target = inputs.target.rate;
    targetSource = "settings";
  } else if (inputs.rateBenchmark !== null) {
    target = inputs.rateBenchmark;
    targetSource = "benchmark";
  } else if (!inputs.testView && priorValue !== null && (t?.prior.sessions ?? 0) >= PAGE_STATS_MIN_SESSIONS) {
    target = priorValue;
    targetSource = "previous_period";
  }
  const status: ObjectiveBlock["primary"]["status"] =
    denominator < PAGE_STATS_MIN_SESSIONS || value === null
      ? "too_little_data"
      : target === null
        ? "no_target"
        : value >= target
          ? "on_track"
          : "behind";

  let cost: ObjectiveBlock["cost"] = null;
  if (inputs.testView) {
    cost = null;
  } else if (def.cost && inputs.paid) {
    const { value: cv, prior: cp } = costValues(inputs.stage, t, inputs.paid);
    const benchmark = inputs.paid.stage_cost_benchmark?.cost ?? null;
    let ct: Money | null = null;
    let cs: TargetSource = "none";
    if (inputs.target?.cost) {
      ct = inputs.target.cost;
      cs = "settings";
    } else if (benchmark) {
      ct = benchmark;
      cs = "benchmark";
    } else if (cp) {
      ct = cp;
      cs = "previous_period";
    }
    const within = cv && ct ? moneyWithinTarget(cv, ct) : null;
    cost = {
      id: def.cost.id,
      label: def.cost.label,
      value: cv,
      prior_value: cp,
      target: ct,
      target_source: cs,
      benchmark,
      benchmark_pages: inputs.paid.stage_cost_benchmark?.pages ?? 0,
      status: !hasSpend(inputs.paid.spend)
        ? "no_spend"
        : inputs.paid.low_sample || !cv
          ? "too_little_data"
          : within === null
            ? "no_target"
            : within
              ? "on_track"
              : "behind",
    };
  } else if (def.cost) {
    cost = {
      id: def.cost.id,
      label: def.cost.label,
      value: null,
      prior_value: null,
      target: inputs.target?.cost ?? null,
      target_source: inputs.target?.cost ? "settings" : "none",
      benchmark: null,
      benchmark_pages: 0,
      status: "no_spend",
    };
  }

  const { drivers, dragging } = buildDrivers(inputs, metric);
  return {
    stage: inputs.stage,
    job: def.job,
    primary: {
      id: metric,
      label: def.primary.label,
      value,
      numerator,
      denominator,
      prior_value: inputs.testView ? null : priorValue,
      target,
      target_source: targetSource,
      benchmark: inputs.rateBenchmark,
      benchmark_pages: inputs.rateBenchmarkPages ?? 0,
      status,
    },
    cost,
    funnel: buildFunnel(inputs),
    drivers,
    dragging,
  };
}
