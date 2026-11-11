import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("seo-keyword-refresh-bulk", () => {
  let tmpDir: string;
  const contentFolder = "site_test";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "or-bulk-"));
    fs.mkdirSync(path.join(tmpDir, contentFolder), { recursive: true });
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function mockSettings(dailyUsd = 2) {
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
          session_credit_limit: 50,
          daily_credit_limit: 200,
          budget_warn_percent: 80,
        }),
        getDataForSeoSettings: () => ({
          enabled: true,
          daily_usd_limit: dailyUsd,
          session_usd_limit: 0.5,
          budget_warn_percent: 80,
        }),
        getSearchConsoleSettings: () => ({
          organic_markets: markets.DEFAULT_ORGANIC_MARKETS,
          research_market_defaults: { en: "usa", es: "spain" },
        }),
      };
    });
  }

  async function loadMod(opts?: {
    inspectImpl?: (args: { keyword: string }) => Promise<{
      ok: boolean;
      metrics?: { keyword: string; monthly_volume: number | null; kw_difficulty: number | null };
      entry?: { monthly_volume: number | null; kw_difficulty: number | null; fetched_at: string };
      error?: string;
      fatal?: boolean;
    }>;
    openrushConfigured?: boolean;
    dataforseo?: {
      dailyUsd?: number;
      overviewImpl: (args: { keywords: string[]; market: { location: string; language: string } }) => Promise<unknown>;
    };
  }) {
    vi.stubEnv("OPENRUSH_API_KEY", "test-key");
    vi.doMock("./db-cache", () => ({ CACHE_DIR: tmpDir }));
    vi.doMock("./site-config", () => ({
      getDefaultContentFolder: () => contentFolder,
    }));
    mockSettings(opts?.dataforseo?.dailyUsd);
    if (opts?.dataforseo) {
      const real = await vi.importActual<typeof import("./dataforseo-client")>("./dataforseo-client");
      vi.doMock("./dataforseo-client", () => ({
        ...real,
        isDataForSeoConfigured: () => true,
        dataForSeoMode: () => "sandbox",
        keywordOverviewQuery: opts.dataforseo!.overviewImpl,
      }));
    } else {
      const real = await vi.importActual<typeof import("./dataforseo-client")>("./dataforseo-client");
      vi.doMock("./dataforseo-client", () => ({
        ...real,
        isDataForSeoConfigured: () => false,
      }));
    }
    const inspectKeywordQuery =
      opts?.inspectImpl ??
      (async ({ keyword }: { keyword: string }) => ({
        ok: true,
        metrics: { keyword, monthly_volume: 100, kw_difficulty: 20 },
        entry: {
          monthly_volume: 100,
          kw_difficulty: 20,
          fetched_at: new Date().toISOString(),
        },
      }));
    vi.doMock("./openrush-client", () => ({
      isOpenRushConfigured: () => opts?.openrushConfigured !== false,
      inspectKeywordQuery,
      OPENRUSH_INSPECT_KEYWORD_CREDITS: 5,
    }));
    return import("./seo-keyword-refresh-bulk");
  }

  it("skips rows with no keyword and estimates credits for the rest", async () => {
    const mod = await loadMod();
    const result = await mod.runKeywordRefreshBulk({
      contentType: "blog",
      contentRoot: "/tmp",
      contentFolder,
      preview: true,
      items: [
        { slug: "a", locale: "en" },
        { slug: "b", locale: "en" },
        { slug: "c", locale: "es" },
      ],
      resolveKeyword: (item) => (item.slug === "b" ? "" : `kw-${item.slug}`),
    });
    expect(result.preview).toBe(true);
    expect(result.skipped_no_keyword).toBe(1);
    expect(result.keywords_to_fetch).toBe(2);
    expect(result.credits_estimated).toBe(10);
    expect(result.keywords_fetched).toBe(0);
  });

  it("skips already-fresh keywords (7-day TTL) and does not charge", async () => {
    const cacheMod = await (async () => {
      vi.doMock("./db-cache", () => ({ CACHE_DIR: tmpDir }));
      vi.doMock("./site-config", () => ({
        getDefaultContentFolder: () => contentFolder,
      }));
      mockSettings();
      return import("./openrush-keyword-cache");
    })();
    cacheMod.upsertKeywordEntry(
      {
        keyword: "fresh kw",
        location: "United States",
        language: "English",
        monthly_volume: 50,
        kw_difficulty: 10,
      },
      contentFolder,
    );

    vi.resetModules();
    const mod = await loadMod();
    const result = await mod.runKeywordRefreshBulk({
      contentType: "blog",
      contentRoot: "/tmp",
      contentFolder,
      preview: true,
      items: [
        { slug: "a", locale: "en" },
        { slug: "b", locale: "en" },
      ],
      resolveKeyword: (item) => (item.slug === "a" ? "fresh kw" : "stale kw"),
    });
    expect(result.skipped_already_fresh).toBe(1);
    expect(result.keywords_to_fetch).toBe(1);
    expect(result.credits_estimated).toBe(5);
  });

  it("dedupes calls for the same keyword in the same market, not across markets", async () => {
    const inspect = vi.fn(async ({ keyword }: { keyword: string }) => ({
      ok: true as const,
      metrics: { keyword, monthly_volume: 12, kw_difficulty: 3 },
      entry: {
        monthly_volume: 12,
        kw_difficulty: 3,
        fetched_at: new Date().toISOString(),
      },
    }));
    const mod = await loadMod({ inspectImpl: inspect });
    const result = await mod.runKeywordRefreshBulk({
      contentType: "blog",
      contentRoot: "/tmp",
      contentFolder,
      preview: false,
      items: [
        { slug: "a", locale: "en" },
        { slug: "b", locale: "es" },
        { slug: "c", locale: "en" },
        { slug: "d", locale: "en" },
      ],
      resolveKeyword: (item) => (item.slug === "c" ? "other" : "shared"),
    });
    // shared (USA) + shared (Spain) + other (USA)
    expect(inspect).toHaveBeenCalledTimes(3);
    expect(result.provider).toBe("openrush");
    expect(result.keywords_fetched).toBe(3);
    expect(result.credits_spent).toBe(15);
    expect(result.results.filter((r) => r.ok && !r.skipped)).toHaveLength(4);
    expect(result.results.find((r) => r.slug === "b")?.market).toBe("Spain");
  });

  it("uses DataForSEO in one call per market and reports USD", async () => {
    const overview = vi.fn(async ({ keywords }: { keywords: string[] }) => ({
      ok: true as const,
      cost_usd: 0.0102,
      mode: "sandbox" as const,
      metrics: new Map(
        keywords.map((k) => [
          k.toLowerCase(),
          {
            keyword: k,
            monthly_volume: 2900,
            kw_difficulty: 18,
            kw_difficulty_source: "reported" as const,
            competition_level: "LOW",
            intent: null,
            payload: {},
          },
        ]),
      ),
    }));
    const mod = await loadMod({ dataforseo: { overviewImpl: overview } });
    const preview = await mod.runKeywordRefreshBulk({
      contentType: "blog",
      contentRoot: "/tmp",
      contentFolder,
      preview: true,
      items: [
        { slug: "a", locale: "en" },
        { slug: "b", locale: "en" },
      ],
      resolveKeyword: (item) => `kw-${item.slug}`,
    });
    expect(preview.provider).toBe("dataforseo");
    expect(preview.cost_unit).toBe("usd");
    expect(preview.usd_estimated).toBe(0.0102);
    expect(preview.budget_remaining).toBe(2);
    expect(preview.mode).toBe("sandbox");

    const result = await mod.runKeywordRefreshBulk({
      contentType: "blog",
      contentRoot: "/tmp",
      contentFolder,
      preview: false,
      items: [
        { slug: "a", locale: "en" },
        { slug: "b", locale: "en" },
      ],
      resolveKeyword: (item) => `kw-${item.slug}`,
    });
    expect(overview).toHaveBeenCalledTimes(1);
    expect(result.keywords_fetched).toBe(2);
    expect(result.usd_spent).toBe(0.0102);
    expect(result.results.every((r) => r.kw_difficulty === 18)).toBe(true);
  });

  it("stops cleanly at the daily USD cap and lists what was left", async () => {
    const overview = vi.fn(async ({ keywords }: { keywords: string[] }) => ({
      ok: true as const,
      cost_usd: 0.01 + keywords.length * 0.0001,
      mode: "sandbox" as const,
      metrics: new Map(),
    }));
    // $0.0102 allows one task with two keywords.
    const mod = await loadMod({ dataforseo: { dailyUsd: 0.0102, overviewImpl: overview } });
    const result = await mod.runKeywordRefreshBulk({
      contentType: "blog",
      contentRoot: "/tmp",
      contentFolder,
      preview: false,
      items: [
        { slug: "a", locale: "en" },
        { slug: "b", locale: "en" },
        { slug: "c", locale: "en" },
        { slug: "d", locale: "es" },
      ],
      resolveKeyword: (item) => `kw-${item.slug}`,
    });
    expect(overview).toHaveBeenCalledTimes(1);
    expect(overview.mock.calls[0]![0].keywords).toEqual(["kw-a", "kw-b"]);
    expect(result.stopped_at_cap).toBe(true);
    expect(result.keywords_not_refreshed).toEqual(["kw-c", "kw-d"]);
    expect(result.results.filter((r) => r.reason === "stopped_at_cap")).toHaveLength(2);
  });

  it("stops the run after a fatal DataForSEO error without OpenRush fallback", async () => {
    const inspect = vi.fn();
    const overview = vi.fn(async () => ({
      ok: false as const,
      error: "DataForSEO is out of funds or hit its account cost limit. Top up the DataForSEO account.",
      error_kind: "funds" as const,
      fatal: true,
      status_code: 40210,
    }));
    const mod = await loadMod({ inspectImpl: inspect, dataforseo: { overviewImpl: overview } });
    const result = await mod.runKeywordRefreshBulk({
      contentType: "blog",
      contentRoot: "/tmp",
      contentFolder,
      preview: false,
      items: [
        { slug: "a", locale: "en" },
        { slug: "b", locale: "es" },
      ],
      resolveKeyword: (item) => `kw-${item.slug}`,
    });
    expect(overview).toHaveBeenCalledTimes(1);
    expect(inspect).not.toHaveBeenCalled();
    expect(result.aborted_remaining).toBe(true);
    expect(result.results.find((r) => r.slug === "a")?.error).toMatch(/Top up/);
    expect(result.results.find((r) => r.slug === "b")?.reason).toBe("aborted");
  });

  it("aborts remaining fetches after a fatal OpenRush error", async () => {
    const inspect = vi.fn(async ({ keyword }: { keyword: string }) => {
      if (keyword === "first") {
        return { ok: false as const, error: "Unauthorized", fatal: true };
      }
      return {
        ok: true as const,
        metrics: { keyword, monthly_volume: 1, kw_difficulty: 1 },
        entry: {
          monthly_volume: 1,
          kw_difficulty: 1,
          fetched_at: new Date().toISOString(),
        },
      };
    });
    const mod = await loadMod({ inspectImpl: inspect });
    const result = await mod.runKeywordRefreshBulk({
      contentType: "blog",
      contentRoot: "/tmp",
      contentFolder,
      preview: false,
      items: [
        { slug: "a", locale: "en" },
        { slug: "b", locale: "en" },
      ],
      resolveKeyword: (item) => (item.slug === "a" ? "first" : "second"),
    });
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(result.aborted_remaining).toBe(true);
    expect(result.results.some((r) => r.reason === "fetch_failed")).toBe(true);
    expect(result.results.some((r) => r.reason === "aborted")).toBe(true);
  });

  it("marks openrush_inactive when not configured", async () => {
    const mod = await loadMod({ openrushConfigured: false });
    const result = await mod.runKeywordRefreshBulk({
      contentType: "blog",
      contentRoot: "/tmp",
      contentFolder,
      preview: false,
      items: [{ slug: "a", locale: "en" }],
      resolveKeyword: () => "kw",
    });
    expect(result.results[0]?.reason).toBe("openrush_inactive");
    expect(result.keywords_fetched).toBe(0);
  });
});
