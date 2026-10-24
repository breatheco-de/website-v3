/**
 * One objective per funnel stage for the page stats drawer: what the page is for, the one
 * number that says whether it works, guardrails, the paid cost metric, and the funnel steps
 * from first impression to the objective. Targets (numbers) live in settings.yml
 * `funnel.targets`; these definitions are code and not editable by staff.
 */

import { FUNNEL_STAGES, type FunnelStage } from "./funnel";

export type ObjectiveMetricId =
  | "moved_forward_rate"
  | "reached_decision_rate"
  | "conversion_rate"
  | "task_click_rate";

export type CostMetricId = "cost_per_engaged_visit" | "cost_per_decision_visit" | "cost_per_lead";

export type GuardrailId =
  | "engaged_rate"
  | "organic_ctr_vs_expected"
  | "median_engaged_seconds"
  | "back_rate"
  | "repeat_share"
  | "clicks_to_visits"
  | "lost_rate";

export type FunnelStepId =
  | "impressions"
  | "clicks"
  | "visits"
  | "engaged"
  | "moved_forward"
  | "reached_decision"
  | "form_or_cta"
  | "lead"
  | "task_click";

export type StageObjective = {
  stage: FunnelStage;
  /** Short goal statement shown on the objective card. */
  job: string;
  primary: { id: ObjectiveMetricId; label: string };
  guardrails: GuardrailId[];
  cost: { id: CostMetricId; label: string } | null;
  funnel: FunnelStepId[];
};

export const STAGE_OBJECTIVES: Record<FunnelStage, StageObjective> = {
  awareness: {
    stage: "awareness",
    job: "Reach the right new people and get them to take a next step.",
    primary: { id: "moved_forward_rate", label: "Moved forward" },
    guardrails: ["engaged_rate", "organic_ctr_vs_expected"],
    cost: { id: "cost_per_engaged_visit", label: "Cost per engaged visit" },
    funnel: ["impressions", "clicks", "visits", "engaged", "moved_forward"],
  },
  consideration: {
    stage: "consideration",
    job: "Turn interest into intent.",
    primary: { id: "reached_decision_rate", label: "Reached a decision page" },
    guardrails: ["median_engaged_seconds", "back_rate"],
    cost: { id: "cost_per_decision_visit", label: "Cost per decision-page visit" },
    funnel: ["impressions", "clicks", "visits", "engaged", "reached_decision", "lead"],
  },
  decision: {
    stage: "decision",
    job: "Get leads at or below the target cost.",
    primary: { id: "conversion_rate", label: "Conversion rate" },
    guardrails: ["repeat_share", "clicks_to_visits"],
    cost: { id: "cost_per_lead", label: "Cost per lead" },
    funnel: ["impressions", "clicks", "visits", "engaged", "form_or_cta", "lead"],
  },
  "post-enrollment": {
    stage: "post-enrollment",
    job: "Help enrolled students get things done.",
    primary: { id: "task_click_rate", label: "Task clicks" },
    guardrails: ["lost_rate"],
    cost: null,
    funnel: ["visits", "engaged", "task_click"],
  },
};

export const FUNNEL_STEP_LABELS: Record<FunnelStepId, string> = {
  impressions: "Impressions",
  clicks: "Clicks",
  visits: "Visits",
  engaged: "Engaged",
  moved_forward: "Moved forward",
  reached_decision: "Reached decision page",
  form_or_cta: "Form or CTA",
  lead: "Lead",
  task_click: "Task click",
};

/** Funnel step whose count is the primary metric's numerator. */
export const OBJECTIVE_FUNNEL_STEP: Record<ObjectiveMetricId, FunnelStepId> = {
  moved_forward_rate: "moved_forward",
  reached_decision_rate: "reached_decision",
  conversion_rate: "lead",
  task_click_rate: "task_click",
};

/** Usual cause of the loss between a step and the next one (shown under the funnel chart). */
export const FUNNEL_LOSS_CAUSES: Partial<Record<FunnelStepId, string>> = {
  impressions: "Ad or search result isn't compelling (CTR).",
  clicks: "Tracking gaps or a slow page: clicks that never load the page.",
  visits: "The page doesn't match what the ad or search result promised.",
  engaged: "The next step, offer, CTA or form isn't working.",
  form_or_cta: "Form friction: people start but don't submit.",
  reached_decision: "The decision page doesn't close.",
};

export const STAGE_RANK: Record<FunnelStage, number> = {
  awareness: 1,
  consideration: 2,
  decision: 3,
  "post-enrollment": 4,
};

export function stageRank(stage: string | null | undefined): number {
  return stage && stage in STAGE_RANK ? STAGE_RANK[stage as FunnelStage] : 0;
}

export function objectiveForStage(stage: string | null | undefined): StageObjective | null {
  return stage && stage in STAGE_OBJECTIVES ? STAGE_OBJECTIVES[stage as FunnelStage] : null;
}

// ── Campaign goal vs page job ──────────────────────────────────────────────────────────

export type CampaignGoal =
  | "awareness"
  | "traffic"
  | "engagement"
  | "video"
  | "search_intent"
  | "leads"
  | "sales"
  | "app"
  | "unknown";

export const CAMPAIGN_GOAL_LABELS: Record<CampaignGoal, string> = {
  awareness: "Awareness / reach",
  traffic: "Traffic",
  engagement: "Engagement",
  video: "Video views",
  search_intent: "Search",
  leads: "Leads",
  sales: "Sales",
  app: "App installs",
  unknown: "Unknown goal",
};

/** Meta campaign objective (ODAX or legacy), falling back to the ad set optimization goal. */
export function campaignGoalFromMeta(
  objective: string | null | undefined,
  optimizationGoal?: string | null,
): CampaignGoal {
  const o = (objective || "").toUpperCase();
  if (/AWARENESS|REACH|BRAND/.test(o)) return "awareness";
  if (/TRAFFIC|LINK_CLICKS/.test(o)) return "traffic";
  if (/VIDEO/.test(o)) return "video";
  if (/LEAD/.test(o)) return "leads";
  if (/SALES|CONVERSIONS|PRODUCT_CATALOG/.test(o)) return "sales";
  if (/APP/.test(o)) return "app";
  if (/ENGAGEMENT|MESSAGES|POST_ENGAGEMENT|PAGE_LIKES/.test(o)) return "engagement";
  const g = (optimizationGoal || "").toUpperCase();
  if (/LEAD|OFFSITE_CONVERSIONS|CONVERSATIONS/.test(g)) return "leads";
  if (/LANDING_PAGE_VIEWS|LINK_CLICKS/.test(g)) return "traffic";
  if (/REACH|IMPRESSIONS|AD_RECALL/.test(g)) return "awareness";
  if (/THRUPLAY|VIDEO/.test(g)) return "video";
  if (/APP_INSTALLS/.test(g)) return "app";
  if (/ENGAGEMENT/.test(g)) return "engagement";
  return "unknown";
}

/** Google Ads `advertising_channel_type`. */
export function campaignGoalFromGoogle(channelType: string | null | undefined): CampaignGoal {
  const c = (channelType || "").toUpperCase();
  if (c === "SEARCH") return "search_intent";
  if (c === "PERFORMANCE_MAX") return "leads";
  if (c === "SHOPPING") return "sales";
  if (c === "DISPLAY") return "awareness";
  if (c === "VIDEO") return "video";
  if (c === "DEMAND_GEN" || c === "DISCOVERY") return "engagement";
  if (c === "MULTI_CHANNEL" || c === "APP") return "app";
  return "unknown";
}

export type CampaignFit = "fit" | "soft" | "mismatch" | "unknown";

const FIT_MAP: Record<FunnelStage, { fit: CampaignGoal[]; soft: CampaignGoal[] }> = {
  awareness: { fit: ["awareness", "traffic", "engagement", "video"], soft: ["search_intent"] },
  consideration: {
    fit: ["traffic", "engagement", "video", "search_intent"],
    soft: ["leads", "sales", "awareness"],
  },
  decision: { fit: ["leads", "sales", "search_intent"], soft: [] },
  "post-enrollment": { fit: [], soft: [] },
};

export function campaignFit(stage: string | null | undefined, goal: CampaignGoal): CampaignFit {
  if (!stage || !(stage in FIT_MAP) || goal === "unknown") return "unknown";
  const m = FIT_MAP[stage as FunnelStage];
  if (m.fit.includes(goal)) return "fit";
  if (m.soft.includes(goal)) return "soft";
  return "mismatch";
}

// ── Targets (settings.yml funnel.targets) ──────────────────────────────────────────────

export type MoneyTarget = Record<string, number>;

export type StageTargetValues = {
  /** Main target: a 0–1 rate on all traffic, keyed by the stage's primary metric. */
  rate?: number;
  /** Paid-only cost target per currency. */
  cost?: MoneyTarget;
};

export type StageTargets = Partial<Record<FunnelStage, StageTargetValues>>;

const CURRENCY_RE = /^[A-Z]{3}$/;

function parseMoney(raw: unknown): MoneyTarget | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: MoneyTarget = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const cur = k.trim().toUpperCase();
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (CURRENCY_RE.test(cur) && Number.isFinite(n) && n > 0) out[cur] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseRate(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : undefined;
}

/**
 * YAML shape (keys are the stage's metric ids):
 *   decision: { conversion_rate: 0.04, cost_per_lead: { USD: 35 } }
 * Invalid or empty values are dropped (that field falls back to the benchmark).
 */
export function parseStageTargets(raw: unknown): StageTargets {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: StageTargets = {};
  for (const stage of FUNNEL_STAGES) {
    const block = (raw as Record<string, unknown>)[stage];
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const def = STAGE_OBJECTIVES[stage];
    const b = block as Record<string, unknown>;
    const rate = parseRate(b[def.primary.id]);
    const cost = def.cost ? parseMoney(b[def.cost.id]) : undefined;
    if (rate === undefined && cost === undefined) continue;
    out[stage] = { ...(rate !== undefined ? { rate } : {}), ...(cost ? { cost } : {}) };
  }
  return out;
}

/** Back to the YAML shape (metric-id keys). */
export function serializeStageTargets(targets: StageTargets): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const stage of FUNNEL_STAGES) {
    const t = targets[stage];
    if (!t) continue;
    const def = STAGE_OBJECTIVES[stage];
    const block: Record<string, unknown> = {};
    if (t.rate !== undefined) block[def.primary.id] = t.rate;
    if (def.cost && t.cost && Object.keys(t.cost).length > 0) block[def.cost.id] = { ...t.cost };
    if (Object.keys(block).length > 0) out[stage] = block;
  }
  return out;
}
