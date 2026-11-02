import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/openrush-client.js", () => ({
  isOpenRushConfigured: vi.fn(),
  inspectKeywordQuery: vi.fn(),
  inspectSerpQuery: vi.fn(),
  researchKeywordsQuery: vi.fn(),
  discoverCompetitorsQuery: vi.fn(),
  compareKeywordCoverageQuery: vi.fn(),
  OPENRUSH_INSPECT_KEYWORD_CREDITS: 5,
  OPENRUSH_INSPECT_SERP_CREDITS: 2,
  OPENRUSH_RESEARCH_KEYWORDS_CREDITS: 3,
  OPENRUSH_DISCOVER_COMPETITORS_CREDITS: 7,
  OPENRUSH_COMPARE_KEYWORD_COVERAGE_CREDITS: 12,
}));

vi.mock("../../server/settings.js", () => ({
  getOpenRushSettings: vi.fn(() => ({
    enabled: true,
    serp_top_n: 20,
    location: "United States",
    language: "English",
    session_credit_limit: 50,
    daily_credit_limit: 200,
    budget_warn_percent: 80,
  })),
}));

vi.mock("../../server/openrush-keyword-cache.js", () => ({
  getKeywordEntry: vi.fn(),
  keywordMetricsCompleteAndFresh: vi.fn(),
  keywordDifficultySourceOf: vi.fn((e?: { kw_difficulty_source?: string | null }) => e?.kw_difficulty_source ?? null),
  competitionLevelOf: vi.fn((e?: { competition_level?: string | number | null }) => e?.competition_level ?? null),
}));

vi.mock("../../server/seo-research-budget.js", () => ({
  wouldSpend: vi.fn(() => ({
    ok: true,
    snapshot: {
      session_used: 0,
      session_limit: 50,
      daily_used: 0,
      daily_limit: 200,
      warn_percent: 80,
      session_pct: 0,
      daily_pct: 0,
      apply_session_cap: true,
    },
  })),
  recordSpend: vi.fn(() => ({
    session_used: 5,
    session_limit: 50,
    daily_used: 5,
    daily_limit: 200,
    warn_percent: 80,
    session_pct: 10,
    daily_pct: 2.5,
    apply_session_cap: true,
  })),
  budgetSnapshot: vi.fn(() => ({
    session_used: 0,
    session_limit: 50,
    daily_used: 0,
    daily_limit: 200,
    warn_percent: 80,
    session_pct: 0,
    daily_pct: 0,
    apply_session_cap: true,
  })),
  STAFF_BUDGET_SESSION_KEY: "staff",
}));

vi.mock("./content.js", () => ({
  loadPage: vi.fn(),
  resolveContentType: vi.fn(() => ({ contentType: "blog" })),
}));

import { isOpenRushConfigured, inspectKeywordQuery } from "../../server/openrush-client.js";
import {
  getKeywordEntry,
  keywordMetricsCompleteAndFresh,
} from "../../server/openrush-keyword-cache.js";
import { wouldSpend } from "../../server/seo-research-budget.js";
import { runSeoResearch } from "./seo-research-mcp";

const mockedConfigured = vi.mocked(isOpenRushConfigured);
const mockedInspect = vi.mocked(inspectKeywordQuery);
const mockedGetEntry = vi.mocked(getKeywordEntry);
const mockedFresh = vi.mocked(keywordMetricsCompleteAndFresh);
const mockedWouldSpend = vi.mocked(wouldSpend);

describe("runSeoResearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedConfigured.mockReturnValue(true);
    mockedWouldSpend.mockReturnValue({
      ok: true,
      snapshot: {
        session_used: 0,
        session_limit: 50,
        daily_used: 0,
        daily_limit: 200,
        warn_percent: 80,
        session_pct: 0,
        daily_pct: 0,
        apply_session_cap: true,
      },
    });
  });

  it("returns seo_research_inactive when not configured", async () => {
    mockedConfigured.mockReturnValue(false);
    const r = await runSeoResearch({
      action: "keyword_metrics",
      contentPath: "/tmp",
      contentFolder: "site_x",
      contentType: "blog",
      slug: "a",
      locale: "en",
      keyword: "test kw",
      agent_session_id: "s1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("seo_research_inactive");
  });

  it("returns cache_hit without calling provider when fresh", async () => {
    mockedFresh.mockReturnValue(true);
    mockedGetEntry.mockReturnValue({
      keyword: "test kw",
      location: "United States",
      language: "English",
      fetched_at: new Date().toISOString(),
      monthly_volume: 100,
      kw_difficulty: 20,
      notes: null,
      payload: null,
    });
    const r = await runSeoResearch({
      action: "keyword_metrics",
      contentPath: "/tmp",
      contentFolder: "site_x",
      contentType: "blog",
      slug: "a",
      locale: "en",
      keyword: "test kw",
      agent_session_id: "s1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.outcome).toBe("cache_hit");
      expect(r.credits_spent).toBe(0);
    }
    expect(mockedInspect).not.toHaveBeenCalled();
  });

  it("fetches when force even if fresh", async () => {
    mockedFresh.mockReturnValue(true);
    mockedGetEntry.mockReturnValue({
      keyword: "test kw",
      location: "United States",
      language: "English",
      fetched_at: new Date().toISOString(),
      monthly_volume: 100,
      kw_difficulty: 20,
      notes: null,
      payload: null,
    });
    mockedInspect.mockResolvedValue({
      ok: true,
      metrics: {
        keyword: "test kw",
        monthly_volume: 200,
        kw_difficulty: 30,
        kw_difficulty_source: "reported",
        competition_level: null,
        intent: null,
      },
      entry: {
        keyword: "test kw",
        location: "United States",
        language: "English",
        fetched_at: new Date().toISOString(),
        monthly_volume: 200,
        kw_difficulty: 30,
        notes: "ok",
        payload: null,
      },
      credits_note: "inspect_keyword uses 5 research credits",
    });
    const r = await runSeoResearch({
      action: "keyword_metrics",
      contentPath: "/tmp",
      contentFolder: "site_x",
      contentType: "blog",
      slug: "a",
      locale: "en",
      keyword: "test kw",
      agent_session_id: "s1",
      force: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.outcome).toBe("fetched");
      expect(r.credits_spent).toBe(5);
      expect(r.data.kw_difficulty_source).toBe("reported");
      expect(r.warnings.map((w) => w.code)).not.toContain("seo_research_difficulty_derived");
    }
    expect(mockedInspect).toHaveBeenCalled();
  });

  it("flags difficulty mapped from a competition label on cache hit", async () => {
    mockedFresh.mockReturnValue(true);
    mockedGetEntry.mockReturnValue({
      keyword: "tipos de inteligencia artificial",
      location: "Mexico",
      language: "Spanish",
      fetched_at: new Date().toISOString(),
      monthly_volume: 3600,
      kw_difficulty: 20,
      kw_difficulty_source: "derived_from_competition",
      competition_level: "LOW",
      notes: null,
      payload: { competition: "LOW", search_volume: 3600 },
    });
    const r = await runSeoResearch({
      action: "keyword_metrics",
      contentPath: "/tmp",
      contentFolder: "site_x",
      contentType: "blog",
      slug: "a",
      locale: "es",
      keyword: "tipos de inteligencia artificial",
      agent_session_id: "s1",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.kw_difficulty).toBe(20);
      expect(r.data.kw_difficulty_source).toBe("derived_from_competition");
      expect(r.data.competition_level).toBe("LOW");
      expect(r.data.market).toEqual({ location: "United States", language: "English" });
      const derived = r.warnings.find((w) => w.code === "seo_research_difficulty_derived");
      expect(derived?.message).toContain('competition "LOW"');
    }
  });

  it("hard-fails keyword_gaps without competitors", async () => {
    const r = await runSeoResearch({
      action: "keyword_gaps",
      contentPath: "/tmp",
      contentFolder: "site_x",
      agent_session_id: "s1",
      competitors: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("competitors_required");
      expect(r.next_actions?.some((a) => a.tool === "get_or_refresh_seo_research")).toBe(true);
    }
  });

  it("returns confirm_seo_research_budget from gate", async () => {
    mockedFresh.mockReturnValue(false);
    mockedGetEntry.mockReturnValue(undefined);
    mockedWouldSpend.mockReturnValue({
      ok: false,
      code: "confirm_seo_research_budget",
      snapshot: {
        session_used: 42,
        session_limit: 50,
        daily_used: 42,
        daily_limit: 200,
        warn_percent: 80,
        session_pct: 84,
        daily_pct: 21,
        apply_session_cap: true,
      },
      message: "confirm needed",
    });
    const r = await runSeoResearch({
      action: "keyword_metrics",
      contentPath: "/tmp",
      contentFolder: "site_x",
      contentType: "blog",
      slug: "a",
      locale: "en",
      keyword: "test kw",
      agent_session_id: "s1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("confirm_seo_research_budget");
    expect(mockedInspect).not.toHaveBeenCalled();
  });
});
