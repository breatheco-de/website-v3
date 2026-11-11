import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  wouldSpend,
  recordSpend,
  budgetSnapshot,
  STAFF_BUDGET_SESSION_KEY,
  seoResearchBudgetPath,
  loadSeoResearchBudget,
  remainingBudget,
} from "./seo-research-budget";
import type { OpenRushSettings } from "./settings";
import { DEFAULT_OPENRUSH_SETTINGS } from "./settings";

const settings: OpenRushSettings = {
  ...DEFAULT_OPENRUSH_SETTINGS,
  session_credit_limit: 50,
  daily_credit_limit: 200,
  budget_warn_percent: 80,
};

describe("seo-research-budget", () => {
  const folder = `seo-budget-test-${process.pid}`;
  const budgetFile = seoResearchBudgetPath(folder);

  beforeEach(() => {
    fs.mkdirSync(path.dirname(budgetFile), { recursive: true });
    if (fs.existsSync(budgetFile)) fs.unlinkSync(budgetFile);
  });

  afterEach(() => {
    if (fs.existsSync(budgetFile)) fs.unlinkSync(budgetFile);
  });

  it("requires confirm in warn band; exhausts session; staff uses daily only", () => {
    recordSpend({ contentFolder: folder, sessionKey: "agent-1", cost: 40 });
    const snap = budgetSnapshot({
      contentFolder: folder,
      sessionKey: "agent-1",
      applySessionCap: true,
      settings,
    });
    expect(snap.session_used).toBe(40);
    expect(snap.daily_used).toBe(40);

    const needConfirm = wouldSpend({
      contentFolder: folder,
      sessionKey: "agent-1",
      applySessionCap: true,
      cost: 5,
      settings,
    });
    expect(needConfirm.ok).toBe(false);
    if (!needConfirm.ok) expect(needConfirm.code).toBe("confirm_seo_research_budget");

    const confirmed = wouldSpend({
      contentFolder: folder,
      sessionKey: "agent-1",
      applySessionCap: true,
      cost: 5,
      confirm: true,
      settings,
    });
    expect(confirmed.ok).toBe(true);

    recordSpend({ contentFolder: folder, sessionKey: "agent-1", cost: 12 });
    const exhaust = wouldSpend({
      contentFolder: folder,
      sessionKey: "agent-1",
      applySessionCap: true,
      cost: 5,
      confirm: true,
      settings,
    });
    expect(exhaust.ok).toBe(false);
    if (!exhaust.ok) expect(exhaust.code).toBe("seo_research_budget_exhausted");

    const staff = wouldSpend({
      contentFolder: folder,
      sessionKey: STAFF_BUDGET_SESSION_KEY,
      applySessionCap: false,
      cost: 5,
      confirm: true,
      settings,
    });
    expect(staff.ok).toBe(true);
  });

  it("keeps DataForSEO USD spend in its own ledger", () => {
    const usdLimits = { unit: "usd" as const, session_limit: 0.5, daily_limit: 2, warn_percent: 80 };
    recordSpend({ contentFolder: folder, provider: "openrush", sessionKey: "agent-1", cost: 40 });
    recordSpend({ contentFolder: folder, provider: "dataforseo", sessionKey: "agent-1", cost: 0.01015 });
    const usd = budgetSnapshot({
      contentFolder: folder,
      provider: "dataforseo",
      limits: usdLimits,
      sessionKey: "agent-1",
      applySessionCap: true,
    });
    expect(usd.unit).toBe("usd");
    expect(usd.daily_used).toBe(0.0102);
    const credits = budgetSnapshot({ contentFolder: folder, sessionKey: "agent-1", applySessionCap: true, settings });
    expect(credits.daily_used).toBe(40);
    expect(remainingBudget(usd)).toBe(0.4898);

    const over = wouldSpend({
      contentFolder: folder,
      provider: "dataforseo",
      limits: usdLimits,
      sessionKey: "agent-1",
      applySessionCap: true,
      cost: 0.6,
      confirm: true,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe("seo_research_budget_exhausted");
  });

  it("reads a legacy flat budget file as the OpenRush ledger", () => {
    const day = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(
      budgetFile,
      JSON.stringify({ updated_at: "", daily: { [day]: 17 }, sessions: { "agent-1": 17 } }),
      "utf-8",
    );
    const file = loadSeoResearchBudget(folder);
    expect(file.providers.openrush.daily[day]).toBe(17);
    expect(file.providers.dataforseo.daily).toEqual({});
    recordSpend({ contentFolder: folder, sessionKey: "agent-1", cost: 3 });
    expect(loadSeoResearchBudget(folder).providers.openrush.daily[day]).toBe(20);
  });

  it("does not increment on zero cost", () => {
    recordSpend({ contentFolder: folder, sessionKey: "agent-1", cost: 0 });
    const snap = budgetSnapshot({
      contentFolder: folder,
      sessionKey: "agent-1",
      applySessionCap: true,
      settings,
    });
    expect(snap.session_used).toBe(0);
  });
});
