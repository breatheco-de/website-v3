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
    vi.doMock("./settings", () => ({
      getOpenRushSettings: () => ({
        enabled: true,
        location: "United States",
        language: "English",
        serp_top_n: 20,
      }),
    }));
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
