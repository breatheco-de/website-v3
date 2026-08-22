import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./redirects", () => ({
  clearRedirectCache: vi.fn(),
  toPublicUrlPath: (u: string) => (u.startsWith("/") ? u : `/${u}`),
}));
vi.mock("./sitemap", () => ({
  refreshSitemapEntry: vi.fn(),
  refreshSitemapEntriesForContentKey: vi.fn(),
}));
vi.mock("./routes/_helpers", () => ({
  invalidateContentCaches: vi.fn(),
  invalidateContentCachesWithoutHtml: vi.fn(),
}));
vi.mock("./settings", () => ({
  getSupportedLocales: () => ["en", "es"],
  normalizeLocale: (l: string) => l,
}));
vi.mock("./html-page-cache", () => ({
  invalidateHtmlPageCacheForPath: vi.fn(),
  invalidateHtmlPageCache: vi.fn(),
}));

import { clearRedirectCache } from "./redirects";
import {
  refreshSitemapEntry,
  refreshSitemapEntriesForContentKey,
} from "./sitemap";
import { invalidateContentCachesWithoutHtml } from "./routes/_helpers";
import { invalidateHtmlPageCacheForPath, invalidateHtmlPageCache } from "./html-page-cache";
import {
  flushAfterContentWrites,
  yamlMentionsRedirects,
  collectEntryHtmlPaths,
} from "./content-write-flush";
import {
  validateBulkMetaUpdates,
  BULK_META_MAX_SLUGS,
} from "./bulk-update-meta";

describe("flushAfterContentWrites", () => {
  const ci = {
    refresh: vi.fn(),
    getAlternateUrls: vi.fn(() => ({ en: "/en/home", es: "/es/inicio" })),
    buildUrl: vi.fn(() => "/en/home"),
    contentRootName: "site_test",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears redirects, refreshes CI async by default, invalidates without full HTML clear, refreshes locale sitemap", async () => {
    flushAfterContentWrites({
      ci: ci as any,
      contentTypes: ["page", "page", "blog"],
      sitemapEntries: [
        { contentType: "page", slug: "home", locale: "en" },
        { contentType: "blog", slug: "post", locale: "en" },
      ],
      commonMetaTouched: false,
      siteId: "site_test",
      htmlPaths: ["/en/home", "/en/blog/post"],
    });

    expect(clearRedirectCache).toHaveBeenCalledTimes(1);
    expect(ci.refresh).toHaveBeenCalledWith({ syncSlow: false });
    expect(invalidateContentCachesWithoutHtml).toHaveBeenCalledTimes(2);
    expect(refreshSitemapEntry).toHaveBeenCalledTimes(2);
    expect(refreshSitemapEntriesForContentKey).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(invalidateHtmlPageCacheForPath).toHaveBeenCalled();
    });
    expect(invalidateHtmlPageCacheForPath).toHaveBeenCalledWith("site_test", "/en/home");
    expect(invalidateHtmlPageCache).not.toHaveBeenCalled();
  });

  it("passes syncSlow true when requested", () => {
    flushAfterContentWrites({
      ci: ci as any,
      contentTypes: ["page"],
      sitemapEntries: [{ contentType: "page", slug: "home", locale: "en" }],
      syncSlow: true,
    });
    expect(ci.refresh).toHaveBeenCalledWith({ syncSlow: true });
  });

  it("uses content-key sitemap refresh when commonMetaTouched", () => {
    flushAfterContentWrites({
      ci: ci as any,
      contentTypes: ["page"],
      sitemapEntries: [
        { contentType: "page", slug: "home", locale: "en" },
        { contentType: "page", slug: "home", locale: "es" },
      ],
      commonMetaTouched: true,
    });

    expect(refreshSitemapEntriesForContentKey).toHaveBeenCalledTimes(1);
    expect(refreshSitemapEntriesForContentKey).toHaveBeenCalledWith(
      "page",
      "home",
      ["en", "es"],
    );
    expect(refreshSitemapEntry).not.toHaveBeenCalled();
  });
});

describe("yamlMentionsRedirects", () => {
  it("detects redirects keys", () => {
    expect(yamlMentionsRedirects("meta:\n  redirects:\n    - /old\n")).toBe(true);
    expect(yamlMentionsRedirects("title: Hi\n")).toBe(false);
  });
});

describe("collectEntryHtmlPaths", () => {
  it("returns alternate paths", () => {
    const paths = collectEntryHtmlPaths(
      {
        getAlternateUrls: () => ({ en: "/en/home", es: "/es/inicio" }),
        buildUrl: () => "/en/home",
      } as any,
      "page",
      "home",
      "en",
    );
    expect(paths).toContain("/en/home");
    expect(paths).toContain("/es/inicio");
  });
});

describe("validateBulkMetaUpdates", () => {
  it("rejects empty updates", () => {
    expect(validateBulkMetaUpdates([])).toMatch(/non-empty/i);
  });

  it("rejects non-meta paths", () => {
    expect(
      validateBulkMetaUpdates([{ field_path: "sections.0.title", value: "x" }]),
    ).toMatch(/Non-meta/i);
    expect(
      validateBulkMetaUpdates([{ field_path: "title", value: "x" }]),
    ).toMatch(/Non-meta/i);
  });

  it("rejects duplicate field_path", () => {
    expect(
      validateBulkMetaUpdates([
        { field_path: "meta.robots", value: "a" },
        { field_path: "meta.robots", value: "b" },
      ]),
    ).toMatch(/Duplicate/i);
  });

  it("requires meta_target for unknown meta keys", () => {
    expect(
      validateBulkMetaUpdates([{ field_path: "meta.twitter_card", value: "summary" }]),
    ).toMatch(/meta_target/);
  });

  it("accepts known meta paths", () => {
    expect(
      validateBulkMetaUpdates([
        { field_path: "meta.robots", value: "index" },
        { field_path: "meta.page_title", value: "Hi" },
      ]),
    ).toBeNull();
  });

  it("exposes max slug constant", () => {
    expect(BULK_META_MAX_SLUGS).toBe(50);
  });
});
