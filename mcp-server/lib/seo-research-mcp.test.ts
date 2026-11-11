import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/openrush-client.js", () => ({
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

vi.mock("../../server/seo-research-providers.js", () => ({
  providerFor: vi.fn(),
  fetchKeywordMetrics: vi.fn(),
  estimateKeywordMetricsCost: vi.fn((provider: string, n: number) =>
    provider === "dataforseo" ? 0.0101 * n : 5 * n,
  ),
}));

vi.mock("../../server/dataforseo-client.js", () => ({
  dataForSeoMode: vi.fn(() => "live"),
}));

const markets = {
  usa: { id: "usa", label: "USA", country: "usa", location: "United States", language: "English" },
  spain: { id: "spain", label: "Spain", country: "esp", location: "Spain", language: "Spanish" },
  mexico: { id: "mexico", label: "Mexico", country: "mex", location: "Mexico", language: "Spanish" },
} as const;

vi.mock("../../server/seo-research-market.js", () => ({
  resolveSiteResearchMarket: vi.fn((opts: { marketId?: string; locale?: string }) => {
    if (opts.marketId === "latam") {
      return {
        ok: false,
        code: "market_not_researchable",
        message: 'Market "LatAm" cannot be used for keyword research.',
        country_markets: ["spain", "usa", "mexico"],
      };
    }
    if (opts.marketId) {
      const m = markets[opts.marketId as keyof typeof markets];
      return { ok: true, market: { ...m, source: "explicit" } };
    }
    const m = opts.locale === "es" ? markets.spain : markets.usa;
    return { ok: true, market: { ...m, source: "locale_default" } };
  }),
  marketSummary: vi.fn((m: Record<string, unknown>) => ({
    id: m.id,
    label: m.label,
    location: m.location,
    language: m.language,
    source: m.source,
  })),
}));

vi.mock("../../server/openrush-keyword-cache.js", () => ({
  getKeywordEntry: vi.fn(),
  keywordMetricsCompleteAndFresh: vi.fn(),
  keywordDifficultySourceOf: vi.fn((e?: { kw_difficulty_source?: string | null }) => e?.kw_difficulty_source ?? null),
  competitionLevelOf: vi.fn((e?: { competition_level?: string | number | null }) => e?.competition_level ?? null),
  volumeProviderOf: vi.fn((e?: { monthly_volume?: number | null; volume_provider?: string | null }) =>
    e?.monthly_volume == null ? null : (e.volume_provider ?? "openrush"),
  ),
  difficultyProviderOf: vi.fn((e?: { kw_difficulty?: number | null; difficulty_provider?: string | null }) =>
    e?.kw_difficulty == null ? null : (e.difficulty_provider ?? "openrush"),
  ),
}));

const snapshot = {
  provider: "openrush",
  unit: "credits",
  session_used: 0,
  session_limit: 50,
  daily_used: 0,
  daily_limit: 200,
  warn_percent: 80,
  session_pct: 0,
  daily_pct: 0,
  apply_session_cap: true,
};

vi.mock("../../server/seo-research-budget.js", () => ({
  wouldSpend: vi.fn(() => ({ ok: true, snapshot })),
  recordSpend: vi.fn(() => snapshot),
  budgetSnapshot: vi.fn(() => snapshot),
  STAFF_BUDGET_SESSION_KEY: "staff",
}));

vi.mock("./content.js", () => ({
  loadPage: vi.fn(),
  resolveContentType: vi.fn(() => ({ contentType: "blog" })),
}));

import { providerFor, fetchKeywordMetrics } from "../../server/seo-research-providers.js";
import { getKeywordEntry, keywordMetricsCompleteAndFresh } from "../../server/openrush-keyword-cache.js";
import { recordSpend, wouldSpend } from "../../server/seo-research-budget.js";
import { dataForSeoMode } from "../../server/dataforseo-client.js";
import { runSeoResearch } from "./seo-research-mcp";

const mockedProvider = vi.mocked(providerFor);
const mockedFetch = vi.mocked(fetchKeywordMetrics);
const mockedGetEntry = vi.mocked(getKeywordEntry);
const mockedFresh = vi.mocked(keywordMetricsCompleteAndFresh);
const mockedWouldSpend = vi.mocked(wouldSpend);
const mockedRecordSpend = vi.mocked(recordSpend);
const mockedMode = vi.mocked(dataForSeoMode);

const baseArgs = {
  action: "keyword_metrics" as const,
  contentPath: "/tmp",
  contentFolder: "site_x",
  contentType: "blog",
  slug: "a",
  locale: "en",
  keyword: "test kw",
  agent_session_id: "s1",
};

function entry(overrides: Record<string, unknown> = {}) {
  return {
    keyword: "test kw",
    location: "United States",
    language: "English",
    fetched_at: new Date().toISOString(),
    monthly_volume: 100,
    kw_difficulty: 20,
    notes: null,
    payload: null,
    ...overrides,
  };
}

describe("runSeoResearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedProvider.mockReturnValue("openrush");
    mockedMode.mockReturnValue("live");
    mockedWouldSpend.mockReturnValue({ ok: true, snapshot } as never);
  });

  it("returns seo_research_inactive when no provider is configured", async () => {
    mockedProvider.mockReturnValue(null);
    const r = await runSeoResearch(baseArgs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("seo_research_inactive");
  });

  it("returns cache_hit without calling provider when fresh", async () => {
    mockedFresh.mockReturnValue(true);
    mockedGetEntry.mockReturnValue(entry() as never);
    const r = await runSeoResearch(baseArgs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.outcome).toBe("cache_hit");
      expect(r.credits_spent).toBe(0);
      expect(r.data.providers).toEqual({ volume: "openrush", difficulty: "openrush" });
      expect((r.data.market as { id: string }).id).toBe("usa");
    }
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("fetches from DataForSEO in the Spanish page's market and reports USD", async () => {
    mockedProvider.mockReturnValue("dataforseo");
    mockedFresh.mockReturnValue(false);
    mockedGetEntry.mockReturnValue(undefined);
    mockedFetch.mockResolvedValue({
      provider: "dataforseo",
      mode: "live",
      cost: 0.0101,
      rows: [
        {
          keyword: "tipos de inteligencia artificial",
          ok: true,
          found: true,
          entry: entry({
            keyword: "tipos de inteligencia artificial",
            location: "Spain",
            language: "Spanish",
            monthly_volume: 2900,
            kw_difficulty: 18,
            kw_difficulty_source: "reported",
            volume_provider: "dataforseo",
            difficulty_provider: "dataforseo",
          }),
        },
      ],
    } as never);
    const r = await runSeoResearch({
      ...baseArgs,
      locale: "es",
      keyword: "tipos de inteligencia artificial",
    });
    expect(mockedFetch.mock.calls[0]![0].market).toMatchObject({ location: "Spain", language: "Spanish" });
    expect(mockedWouldSpend.mock.calls[0]![0]).toMatchObject({ provider: "dataforseo", cost: 0.0101 });
    expect(mockedRecordSpend.mock.calls[0]![0]).toMatchObject({ provider: "dataforseo", cost: 0.0101 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cost_usd).toBe(0.0101);
      expect(r.credits_spent).toBe(0);
      expect(r.data.kw_difficulty).toBe(18);
      expect(r.data.kw_difficulty_source).toBe("reported");
      expect(r.data.providers).toEqual({ volume: "dataforseo", difficulty: "dataforseo" });
      expect((r.data.market as { id: string }).id).toBe("spain");
      expect(r.warnings.map((w) => w.code)).not.toContain("seo_research_difficulty_derived");
    }
  });

  it("warns when the provider has no difficulty score", async () => {
    mockedProvider.mockReturnValue("dataforseo");
    mockedFresh.mockReturnValue(false);
    mockedGetEntry.mockReturnValue(undefined);
    mockedFetch.mockResolvedValue({
      provider: "dataforseo",
      mode: "live",
      cost: 0.01,
      rows: [{ keyword: "test kw", ok: true, found: false, entry: entry({ monthly_volume: 40, kw_difficulty: null }) }],
    } as never);
    const r = await runSeoResearch(baseArgs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.kw_difficulty).toBeNull();
      expect(r.warnings.map((w) => w.code)).toContain("seo_research_difficulty_unavailable");
    }
  });

  it("flags sandbox results as sample data", async () => {
    mockedProvider.mockReturnValue("dataforseo");
    mockedMode.mockReturnValue("sandbox");
    mockedFresh.mockReturnValue(false);
    mockedGetEntry.mockReturnValue(undefined);
    mockedFetch.mockResolvedValue({
      provider: "dataforseo",
      mode: "sandbox",
      cost: 0,
      rows: [{ keyword: "test kw", ok: true, found: true, entry: entry({ kw_difficulty_source: "reported" }) }],
    } as never);
    const r = await runSeoResearch(baseArgs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.mode).toBe("sandbox");
      expect(r.warnings.map((w) => w.code)).toContain("seo_research_sandbox");
    }
  });

  it("stops with provider_unavailable on a fatal provider error, without charging", async () => {
    mockedProvider.mockReturnValue("dataforseo");
    mockedFresh.mockReturnValue(false);
    mockedGetEntry.mockReturnValue(undefined);
    mockedFetch.mockResolvedValue({
      provider: "dataforseo",
      mode: "live",
      cost: 0,
      rows: [
        {
          keyword: "test kw",
          ok: false,
          fatal: true,
          error_kind: "funds",
          error: "DataForSEO is out of funds or hit its account cost limit. Top up the DataForSEO account.",
        },
      ],
      fatal: { error: "out of funds", error_kind: "funds" },
    } as never);
    const r = await runSeoResearch(baseArgs);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("seo_research_provider_unavailable");
      expect(r.details?.error_kind).toBe("funds");
      expect(r.next_actions).toEqual([]);
    }
    expect(mockedRecordSpend).not.toHaveBeenCalled();
  });

  it("refuses rollup markets with country markets to use instead", async () => {
    const r = await runSeoResearch({ ...baseArgs, market: "latam" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("market_not_researchable");
      expect(r.details?.country_markets).toContain("spain");
      expect(r.next_actions?.[0]?.args_hint).toMatchObject({ market: "spain" });
    }
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("flags difficulty mapped from a competition label on cache hit", async () => {
    mockedFresh.mockReturnValue(true);
    mockedGetEntry.mockReturnValue(
      entry({
        keyword: "tipos de inteligencia artificial",
        location: "Spain",
        language: "Spanish",
        monthly_volume: 3600,
        kw_difficulty: 20,
        kw_difficulty_source: "derived_from_competition",
        competition_level: "LOW",
      }) as never,
    );
    const r = await runSeoResearch({
      ...baseArgs,
      locale: "es",
      keyword: "tipos de inteligencia artificial",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.kw_difficulty_source).toBe("derived_from_competition");
      expect(r.data.competition_level).toBe("LOW");
      const derived = r.warnings.find((w) => w.code === "seo_research_difficulty_derived");
      expect(derived?.message).toContain('competition "LOW"');
      expect(derived?.message).toContain("force: true");
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
      snapshot: { ...snapshot, session_used: 42, session_pct: 84 },
      message: "confirm needed",
    } as never);
    const r = await runSeoResearch(baseArgs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("confirm_seo_research_budget");
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
