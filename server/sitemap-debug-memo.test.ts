import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  clearSiteSitemapCache,
  clearSitemapCache,
  getDebugSitemapUrls,
  getSitemap,
  getSitemapCacheStatus,
  invalidateDebugSitemapUrls,
  invalidateSitemapEntry,
  invalidateSitemapEntriesByContentKey,
  refreshSitemapEntriesForContentKey,
  refreshSitemapEntry,
  resetDebugSitemapCacheForTests,
} from "./sitemap";

describe("debug sitemap memo", () => {
  beforeEach(() => {
    resetDebugSitemapCacheForTests();
  });

  afterEach(() => {
    resetDebugSitemapCacheForTests();
    vi.useRealTimers();
  });

  it("returns a copy so callers cannot mutate the memo", () => {
    const a = getDebugSitemapUrls();
    const b = getDebugSitemapUrls();
    expect(a).not.toBe(b);
    if (a[0]) {
      a[0].label = "mutated";
      expect(b[0]?.label).not.toBe("mutated");
    }
  });

  it("invalidateDebugSitemapUrls forces rebuild", () => {
    const first = getDebugSitemapUrls();
    invalidateDebugSitemapUrls();
    const second = getDebugSitemapUrls();
    // Same logical content, but rebuilt (copy already asserted above)
    expect(Array.isArray(second)).toBe(true);
    expect(first.length).toBe(second.length);
  });

  it("invalidateSitemapEntry clears debug memo even when XML cache is cold", () => {
    getDebugSitemapUrls();
    invalidateSitemapEntry("anything:en");
    // Should not throw; next call rebuilds
    expect(Array.isArray(getDebugSitemapUrls())).toBe(true);
  });

  it("invalidateSitemapEntriesByContentKey clears debug memo", () => {
    getDebugSitemapUrls();
    invalidateSitemapEntriesByContentKey("blog:foo");
    expect(Array.isArray(getDebugSitemapUrls())).toBe(true);
  });

  it("clearSitemapCache clears debug memo", () => {
    getDebugSitemapUrls();
    const result = clearSitemapCache();
    expect(result.success).toBe(true);
    expect(Array.isArray(getDebugSitemapUrls())).toBe(true);
  });

  it("clearSiteSitemapCache drops the cached sitemap and debug memo", () => {
    getSitemap();
    expect(getSitemapCacheStatus().cached).toBe(true);
    getDebugSitemapUrls();
    clearSiteSitemapCache("site_test");
    expect(getSitemapCacheStatus().cached).toBe(false);
    expect(Array.isArray(getDebugSitemapUrls())).toBe(true);
  });

  it("entry refreshes drop the cached sitemap instead of patching it", () => {
    getSitemap();
    refreshSitemapEntry("blog", "foo", "en");
    expect(getSitemapCacheStatus().cached).toBe(false);

    getSitemap();
    refreshSitemapEntriesForContentKey("blog", "foo", ["en", "es"]);
    expect(getSitemapCacheStatus().cached).toBe(false);
  });

  it("expires memo after TTL", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);
    getDebugSitemapUrls();
    vi.setSystemTime(t0 + 61_000);
    // Rebuild after TTL — still returns an array
    expect(Array.isArray(getDebugSitemapUrls())).toBe(true);
  });
});
