import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("openrush-keyword-cache", () => {
  let tmpDir: string;
  let contentFolder: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "or-kw-"));
    contentFolder = "site_test";
    fs.mkdirSync(path.join(tmpDir, contentFolder), { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function loadCacheModule() {
    vi.doMock("./db-cache", () => ({ CACHE_DIR: tmpDir }));
    vi.doMock("./site-config", () => ({
      getDefaultContentFolder: () => contentFolder,
    }));
    vi.doMock("./settings", async () => {
      const markets = await vi.importActual<typeof import("./gsc-organic-markets")>(
        "./gsc-organic-markets",
      );
      return {
        getOpenRushSettings: () => ({
          enabled: true,
          location: "United States",
          language: "English",
          serp_top_n: 20,
        }),
        getDataForSeoSettings: () => ({ enabled: false }),
        getSearchConsoleSettings: () => ({
          organic_markets: markets.DEFAULT_ORGANIC_MARKETS,
          research_market_defaults: { en: "usa", es: "spain" },
        }),
      };
    });
    return import("./openrush-keyword-cache");
  }

  it("keys by normalized keyword|location|language", async () => {
    const mod = await loadCacheModule();
    expect(mod.keywordCacheKey("  AI Tools  ", "United States", "English")).toBe(
      "ai tools|united states|english",
    );
  });

  it("partial merge keeps prior difficulty when incoming is null", async () => {
    const mod = await loadCacheModule();
    const first = mod.upsertKeywordEntry(
      {
        keyword: "ai engineer salary",
        location: "United States",
        language: "English",
        monthly_volume: 1000,
        kw_difficulty: 40,
        payload: { monthly_volume: 1000 },
      },
      contentFolder,
    );
    expect(first.monthly_volume).toBe(1000);
    expect(first.kw_difficulty).toBe(40);

    const second = mod.upsertKeywordEntry(
      {
        keyword: "ai engineer salary",
        location: "United States",
        language: "English",
        monthly_volume: 2400,
        kw_difficulty: null,
        payload: { monthly_volume: 2400 },
      },
      contentFolder,
    );
    expect(second.monthly_volume).toBe(2400);
    expect(second.kw_difficulty).toBe(40);
    expect(second.notes).toMatch(/Volume refreshed/i);
    expect(second.notes).toMatch(/difficulty kept/i);
  });

  it("keeps the difficulty source with the difficulty it describes on partial merge", async () => {
    const mod = await loadCacheModule();
    mod.upsertKeywordEntry(
      {
        keyword: "kw",
        location: "United States",
        language: "English",
        monthly_volume: 100,
        kw_difficulty: 37,
        kw_difficulty_source: "reported",
        payload: { keyword_difficulty: 37 },
      },
      contentFolder,
    );
    const second = mod.upsertKeywordEntry(
      {
        keyword: "kw",
        location: "United States",
        language: "English",
        monthly_volume: 200,
        kw_difficulty: null,
        kw_difficulty_source: null,
        competition_level: "LOW",
        payload: { search_volume: 200, competition: "LOW" },
      },
      contentFolder,
    );
    expect(second.kw_difficulty).toBe(37);
    expect(mod.keywordDifficultySourceOf(second)).toBe("reported");
    expect(mod.competitionLevelOf(second)).toBe("LOW");
  });

  it("reads the source of legacy entries from their payload only when the number matches", async () => {
    const mod = await loadCacheModule();
    const base = {
      keyword: "kw",
      location: "United States",
      language: "English",
      fetched_at: new Date().toISOString(),
      monthly_volume: 3600,
      notes: null,
    };
    expect(
      mod.keywordDifficultySourceOf({ ...base, kw_difficulty: 20, payload: { competition: "LOW" } }),
    ).toBe("derived_from_competition");
    expect(
      mod.keywordDifficultySourceOf({ ...base, kw_difficulty: 55, payload: { competition: "LOW" } }),
    ).toBeNull();
  });

  it("clears an ad-competition estimate when a provider checks and has no score", async () => {
    const mod = await loadCacheModule();
    mod.upsertKeywordEntry(
      {
        keyword: "niche kw",
        location: "Spain",
        language: "Spanish",
        monthly_volume: 90,
        kw_difficulty: 20,
        kw_difficulty_source: "derived_from_competition",
        competition_level: "LOW",
        provider: "openrush",
      },
      contentFolder,
    );
    const second = mod.upsertKeywordEntry(
      {
        keyword: "niche kw",
        location: "Spain",
        language: "Spanish",
        monthly_volume: 110,
        kw_difficulty: null,
        provider: "dataforseo",
        difficulty_checked: true,
      },
      contentFolder,
    );
    expect(second.kw_difficulty).toBeNull();
    expect(mod.keywordDifficultySourceOf(second)).toBeNull();
    expect(second.monthly_volume).toBe(110);
    expect(second.volume_provider).toBe("dataforseo");
    expect(second.notes).toMatch(/ad-competition estimate cleared/);
  });

  it("keeps a prior reported score when a provider checks and has no score", async () => {
    const mod = await loadCacheModule();
    mod.upsertKeywordEntry(
      {
        keyword: "kw2",
        location: "Spain",
        language: "Spanish",
        monthly_volume: 100,
        kw_difficulty: 28,
        kw_difficulty_source: "reported",
        provider: "dataforseo",
        difficulty_checked: true,
      },
      contentFolder,
    );
    const second = mod.upsertKeywordEntry(
      {
        keyword: "kw2",
        location: "Spain",
        language: "Spanish",
        monthly_volume: null,
        kw_difficulty: null,
        provider: "dataforseo",
        difficulty_checked: true,
      },
      contentFolder,
    );
    expect(second.kw_difficulty).toBe(28);
    expect(mod.keywordDifficultySourceOf(second)).toBe("reported");
    expect(mod.difficultyProviderOf(second)).toBe("dataforseo");
  });

  it("treats legacy entries without provider fields as OpenRush", async () => {
    const mod = await loadCacheModule();
    const entry = mod.upsertKeywordEntry(
      { keyword: "legacy", location: "United States", language: "English", monthly_volume: 5, kw_difficulty: 9 },
      contentFolder,
    );
    const legacy = { ...entry, volume_provider: undefined, difficulty_provider: undefined };
    expect(mod.volumeProviderOf(legacy)).toBe("openrush");
    expect(mod.difficultyProviderOf(legacy)).toBe("openrush");
  });

  it("resolveKeywordMetrics reads the page language's default market", async () => {
    vi.stubEnv("OPENRUSH_API_KEY", "test-key");
    const mod = await loadCacheModule();
    mod.upsertKeywordEntry(
      {
        keyword: "tipos de inteligencia artificial",
        location: "Spain",
        language: "Spanish",
        monthly_volume: 2900,
        kw_difficulty: 18,
        kw_difficulty_source: "reported",
        provider: "dataforseo",
      },
      contentFolder,
    );
    const es = mod.resolveKeywordMetrics({
      keyword: "tipos de inteligencia artificial",
      contentFolder,
      locale: "es",
    });
    expect(es.source).toBe("openrush_cache");
    expect(es.kw_difficulty).toBe(18);
    expect(es.difficulty_provider).toBe("dataforseo");
    expect(es.market?.id).toBe("spain");

    const en = mod.resolveKeywordMetrics({
      keyword: "tipos de inteligencia artificial",
      contentFolder,
      locale: "en",
    });
    expect(en.source).toBe("none");
  });

  it("resolveKeywordMetrics prefers cache when OpenRush configured", async () => {
    vi.stubEnv("OPENRUSH_API_KEY", "test-key");
    const mod = await loadCacheModule();
    mod.upsertKeywordEntry(
      {
        keyword: "crm software",
        location: "United States",
        language: "English",
        monthly_volume: 500,
        kw_difficulty: 33,
      },
      contentFolder,
    );
    const resolved = mod.resolveKeywordMetrics({
      keyword: "crm software",
      contentFolder,
      yamlVolume: 1,
      yamlDifficulty: 2,
    });
    expect(resolved.source).toBe("openrush_cache");
    expect(resolved.kw_monthly_volume).toBe(500);
    expect(resolved.kw_difficulty).toBe(33);
    expect(resolved.may_not_be_recent).toBe(false);
  });

  it("resolveKeywordMetrics falls back to YAML with may_not_be_recent when cache miss", async () => {
    vi.stubEnv("OPENRUSH_API_KEY", "test-key");
    const mod = await loadCacheModule();
    const resolved = mod.resolveKeywordMetrics({
      keyword: "missing phrase",
      contentFolder,
      yamlVolume: 900,
      yamlDifficulty: 12,
    });
    expect(resolved.source).toBe("yaml_fallback");
    expect(resolved.kw_monthly_volume).toBe(900);
    expect(resolved.may_not_be_recent).toBe(true);
  });

  it("keyword change does not reuse prior phrase cache", async () => {
    vi.stubEnv("OPENRUSH_API_KEY", "test-key");
    const mod = await loadCacheModule();
    mod.upsertKeywordEntry(
      {
        keyword: "old keyword",
        location: "United States",
        language: "English",
        monthly_volume: 100,
        kw_difficulty: 10,
      },
      contentFolder,
    );
    const resolved = mod.resolveKeywordMetrics({
      keyword: "new keyword",
      contentFolder,
      yamlVolume: null,
      yamlDifficulty: null,
    });
    expect(resolved.source).toBe("none");
    expect(resolved.kw_monthly_volume).toBeNull();
  });

  it("marks stale after TTL", async () => {
    vi.stubEnv("OPENRUSH_API_KEY", "test-key");
    const mod = await loadCacheModule();
    const entry = mod.upsertKeywordEntry(
      {
        keyword: "stale kw",
        location: "United States",
        language: "English",
        monthly_volume: 10,
        kw_difficulty: 5,
      },
      contentFolder,
    );
    const old = {
      ...entry,
      fetched_at: new Date(Date.now() - mod.KEYWORD_TTL_MS - 1000).toISOString(),
    };
    expect(mod.keywordEntryFresh(old)).toBe(false);
    const resolved = mod.resolveKeywordMetrics({
      keyword: "stale kw",
      contentFolder,
      now: Date.now(),
    });
    // live cache still has fresh entry from upsert
    expect(resolved.stale).toBe(false);
  });
});
