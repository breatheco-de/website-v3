/**
 * Local SEO research spend ledger (success-only), one ledger per provider: OpenRush in credits,
 * DataForSEO in USD. Each has a shared daily pot plus agent session caps.
 * Path: .cache/{contentFolder}/seo-research-budget.json
 */

import fs from "fs";
import path from "path";
import { CACHE_DIR } from "./db-cache";
import { getDefaultContentFolder } from "./site-config";
import {
  getDataForSeoSettings,
  getOpenRushSettings,
  type DataForSeoSettings,
  type OpenRushSettings,
} from "./settings";

export const STAFF_BUDGET_SESSION_KEY = "staff";

export type SeoResearchBudgetProvider = "openrush" | "dataforseo";
export type SeoResearchBudgetUnit = "credits" | "usd";

export type SeoResearchLedger = {
  /** UTC YYYY-MM-DD → spend that day (all actors). */
  daily: Record<string, number>;
  /** agent_session_id or staff → spend in that session. */
  sessions: Record<string, number>;
};

export type SeoResearchBudgetFile = {
  updated_at: string;
  providers: Record<SeoResearchBudgetProvider, SeoResearchLedger>;
};

export type SeoResearchBudgetSnapshot = {
  provider: SeoResearchBudgetProvider;
  unit: SeoResearchBudgetUnit;
  session_used: number;
  session_limit: number;
  daily_used: number;
  daily_limit: number;
  warn_percent: number;
  session_pct: number;
  daily_pct: number;
  apply_session_cap: boolean;
};

export type SeoResearchBudgetGate =
  | { ok: true; snapshot: SeoResearchBudgetSnapshot }
  | {
      ok: false;
      code: "confirm_seo_research_budget" | "seo_research_budget_exhausted";
      snapshot: SeoResearchBudgetSnapshot;
      message: string;
    };

export type BudgetLimits = {
  unit: SeoResearchBudgetUnit;
  session_limit: number;
  daily_limit: number;
  warn_percent: number;
};

export function unitFor(provider: SeoResearchBudgetProvider): SeoResearchBudgetUnit {
  return provider === "dataforseo" ? "usd" : "credits";
}

export function openRushBudgetLimits(settings: OpenRushSettings): BudgetLimits {
  return {
    unit: "credits",
    session_limit: settings.session_credit_limit,
    daily_limit: settings.daily_credit_limit,
    warn_percent: settings.budget_warn_percent,
  };
}

export function dataForSeoBudgetLimits(settings: DataForSeoSettings): BudgetLimits {
  return {
    unit: "usd",
    session_limit: settings.session_usd_limit,
    daily_limit: settings.daily_usd_limit,
    warn_percent: settings.budget_warn_percent,
  };
}

export function budgetLimitsFor(
  provider: SeoResearchBudgetProvider,
  contentRoot?: string,
): BudgetLimits {
  return provider === "dataforseo"
    ? dataForSeoBudgetLimits(getDataForSeoSettings(contentRoot))
    : openRushBudgetLimits(getOpenRushSettings(contentRoot));
}

/** Credits are whole numbers; USD keeps 4 decimals. */
function normalizeCost(cost: number, unit: SeoResearchBudgetUnit): number {
  const n = Math.max(0, Number.isFinite(cost) ? cost : 0);
  return unit === "usd" ? Math.round(n * 10_000) / 10_000 : Math.round(n);
}

function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function seoResearchBudgetPath(contentFolder?: string): string {
  const folder = contentFolder || getDefaultContentFolder();
  return path.join(CACHE_DIR, folder, "seo-research-budget.json");
}

function emptyLedger(): SeoResearchLedger {
  return { daily: {}, sessions: {} };
}

function parseLedger(raw: unknown): SeoResearchLedger {
  if (!raw || typeof raw !== "object") return emptyLedger();
  const o = raw as Record<string, unknown>;
  return {
    daily: o.daily && typeof o.daily === "object" ? (o.daily as Record<string, number>) : {},
    sessions: o.sessions && typeof o.sessions === "object" ? (o.sessions as Record<string, number>) : {},
  };
}

function emptyBudgetFile(): SeoResearchBudgetFile {
  return { updated_at: "", providers: { openrush: emptyLedger(), dataforseo: emptyLedger() } };
}

/** Legacy flat files ({ daily, sessions }) are OpenRush credit ledgers. */
export function loadSeoResearchBudget(contentFolder?: string): SeoResearchBudgetFile {
  const p = seoResearchBudgetPath(contentFolder);
  if (!fs.existsSync(p)) return emptyBudgetFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return emptyBudgetFile();
    const updated_at = typeof parsed.updated_at === "string" ? parsed.updated_at : "";
    const providers = parsed.providers as Record<string, unknown> | undefined;
    if (providers && typeof providers === "object") {
      return {
        updated_at,
        providers: {
          openrush: parseLedger(providers.openrush),
          dataforseo: parseLedger(providers.dataforseo),
        },
      };
    }
    return {
      updated_at,
      providers: { openrush: parseLedger(parsed), dataforseo: emptyLedger() },
    };
  } catch {
    return emptyBudgetFile();
  }
}

export function saveSeoResearchBudget(file: SeoResearchBudgetFile, contentFolder?: string): void {
  const p = seoResearchBudgetPath(contentFolder);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(file), "utf-8");
}

type LimitsInput = {
  provider?: SeoResearchBudgetProvider;
  contentRoot?: string;
  /** OpenRush settings override (legacy callers / tests). */
  settings?: OpenRushSettings;
  limits?: BudgetLimits;
};

function resolveLimits(opts: LimitsInput): { provider: SeoResearchBudgetProvider; limits: BudgetLimits } {
  const provider = opts.provider ?? "openrush";
  if (opts.limits) return { provider, limits: opts.limits };
  if (provider === "openrush" && opts.settings) {
    return { provider, limits: openRushBudgetLimits(opts.settings) };
  }
  return { provider, limits: budgetLimitsFor(provider, opts.contentRoot) };
}

export function budgetSnapshot(
  opts: LimitsInput & {
    contentFolder?: string;
    sessionKey: string;
    applySessionCap: boolean;
    now?: number;
  },
): SeoResearchBudgetSnapshot {
  const { provider, limits } = resolveLimits(opts);
  const ledger = loadSeoResearchBudget(opts.contentFolder).providers[provider];
  const day = utcDay(opts.now);
  const daily_used = normalizeCost(Number(ledger.daily[day]) || 0, limits.unit);
  const session_used = normalizeCost(Number(ledger.sessions[opts.sessionKey]) || 0, limits.unit);
  return {
    provider,
    unit: limits.unit,
    session_used,
    session_limit: limits.session_limit,
    daily_used,
    daily_limit: limits.daily_limit,
    warn_percent: limits.warn_percent,
    session_pct: limits.session_limit > 0 ? (session_used / limits.session_limit) * 100 : 0,
    daily_pct: limits.daily_limit > 0 ? (daily_used / limits.daily_limit) * 100 : 0,
    apply_session_cap: opts.applySessionCap,
  };
}

/** Remaining spend before the daily (and, for agents, session) cap. */
export function remainingBudget(snap: SeoResearchBudgetSnapshot): number {
  const daily = Math.max(0, snap.daily_limit - snap.daily_used);
  if (!snap.apply_session_cap) return normalizeCost(daily, snap.unit);
  return normalizeCost(Math.min(daily, Math.max(0, snap.session_limit - snap.session_used)), snap.unit);
}

function afterSpendPct(used: number, cost: number, limit: number): number {
  if (limit <= 0) return 100;
  return ((used + cost) / limit) * 100;
}

function unitLabel(unit: SeoResearchBudgetUnit, cost: number): string {
  return unit === "usd" ? `$${cost.toFixed(4)}` : `${cost} research credits`;
}

/**
 * Gate a paid research call. Cache hits should not call this.
 * Agents: session + daily. Staff: daily only (applySessionCap false).
 */
export function wouldSpend(
  opts: LimitsInput & {
    contentFolder?: string;
    sessionKey: string;
    applySessionCap: boolean;
    cost: number;
    confirm?: boolean;
    now?: number;
  },
): SeoResearchBudgetGate {
  const snap = budgetSnapshot(opts);
  const cost = normalizeCost(opts.cost, snap.unit);

  if (cost <= 0) return { ok: true, snapshot: snap };

  const dailyAfter = afterSpendPct(snap.daily_used, cost, snap.daily_limit);
  const sessionAfter = opts.applySessionCap
    ? afterSpendPct(snap.session_used, cost, snap.session_limit)
    : 0;

  if (dailyAfter > 100 || (opts.applySessionCap && sessionAfter > 100)) {
    return {
      ok: false,
      code: "seo_research_budget_exhausted",
      snapshot: snap,
      message:
        "SEO research budget exhausted for this site day" +
        (opts.applySessionCap ? " or agent session" : "") +
        ". Wait for the next day/session or raise limits in SEO research settings.",
    };
  }

  const warn = snap.warn_percent;
  const inWarn =
    dailyAfter >= warn || (opts.applySessionCap && sessionAfter >= warn);
  if (inWarn && !opts.confirm) {
    return {
      ok: false,
      code: "confirm_seo_research_budget",
      snapshot: snap,
      message:
        `This call would use about ${unitLabel(snap.unit, cost)} and enter/stay in the warn band ` +
        `(≥${warn}% of session and/or daily limit). Re-call with confirm_seo_research_budget: true.`,
    };
  }

  return { ok: true, snapshot: snap };
}

/** Success-only: increment daily + session after a paid fetch that returned usable data. */
export function recordSpend(opts: {
  contentFolder?: string;
  contentRoot?: string;
  provider?: SeoResearchBudgetProvider;
  sessionKey: string;
  cost: number;
  now?: number;
}): SeoResearchBudgetSnapshot {
  const provider = opts.provider ?? "openrush";
  const unit = unitFor(provider);
  const cost = normalizeCost(opts.cost, unit);
  const file = loadSeoResearchBudget(opts.contentFolder);
  const day = utcDay(opts.now);
  if (cost > 0) {
    const ledger = file.providers[provider];
    ledger.daily[day] = normalizeCost((Number(ledger.daily[day]) || 0) + cost, unit);
    ledger.sessions[opts.sessionKey] = normalizeCost(
      (Number(ledger.sessions[opts.sessionKey]) || 0) + cost,
      unit,
    );
    file.updated_at = new Date(opts.now ?? Date.now()).toISOString();
    saveSeoResearchBudget(file, opts.contentFolder);
  }
  return budgetSnapshot({
    provider,
    contentFolder: opts.contentFolder,
    contentRoot: opts.contentRoot,
    sessionKey: opts.sessionKey,
    applySessionCap: opts.sessionKey !== STAFF_BUDGET_SESSION_KEY,
    now: opts.now,
  });
}
