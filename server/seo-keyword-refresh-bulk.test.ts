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

  async function loadMod(opts?: {
    inspectImpl?: (args: { keyword: string }) => Promise<{
      ok: boolean;
      metrics?: { keyword: string; monthly_volume: number | null; kw_difficulty: number | null };
      entry?: { monthly_volume: number | null; kw_difficulty: number | null; fetched_at: string };
      error?: string;
      fatal?: boolean;
    }>;
    openrushConfigured?: boolean;
  }) {
    vi.stubEnv("OPENRUSH_API_KEY", "test-key");
    vi.doMock("./db-cache", () => ({ CACHE_DIR: tmpDir }));
    vi.doMock("./site-config", () => ({
      getDefaultContentFolder: () => contentFolder,
    }));
    vi.doMock("./settings", () => ({
      getOpenRushSettings: () => ({
        enabled: true,
        location: "United States",
        language: "English",
        serp_top_n: 20,
      }),
    }));
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
      vi.doMock("./settings", () => ({
        getOpenRushSettings: () => ({
          enabled: true,
          location: "United States",
          language: "English",
          serp_top_n: 20,
        }),
      }));
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

  it("dedupes OpenRush calls for the same keyword across rows", async () => {
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
      ],
      resolveKeyword: (item) => (item.slug === "c" ? "other" : "shared"),
    });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(result.keywords_fetched).toBe(2);
    expect(result.credits_spent).toBe(10);
    expect(result.results.filter((r) => r.ok && !r.skipped)).toHaveLength(3);
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
