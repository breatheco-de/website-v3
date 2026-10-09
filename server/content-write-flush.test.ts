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
vi.mock("./html-page-cache", async () => {
  const actual = await vi.importActual<typeof import("./html-page-cache")>("./html-page-cache");
  return {
    ...actual,
    invalidateHtmlPageCacheForPath: vi.fn(),
    invalidateHtmlPageCache: vi.fn(),
  };
});
vi.mock("./html-rebuild", () => ({
  scheduleSavedHtmlPaths: vi.fn(),
  scheduleHotHtmlRebuild: vi.fn(),
  scheduleContentTypeListingRebuild: vi.fn(),
  scheduleDatabaseReaderRebuild: vi.fn(),
  scheduleCachedSlugHtmlRebuild: vi.fn(),
}));

import { clearRedirectCache } from "./redirects";
import {
  refreshSitemapEntry,
  refreshSitemapEntriesForContentKey,
} from "./sitemap";
import { invalidateContentCachesWithoutHtml } from "./routes/_helpers";
import { invalidateHtmlPageCacheForPath, invalidateHtmlPageCache } from "./html-page-cache";
import { scheduleSavedHtmlPaths, scheduleHotHtmlRebuild, scheduleContentTypeListingRebuild } from "./html-rebuild";
import {
  flushAfterContentWrites,
  yamlMentionsRedirects,
  collectEntryHtmlPaths,
  classifyTouchedContentFiles,
} from "./content-write-flush";
import {
  validateBulkMetaUpdates,
  BULK_META_MAX_SLUGS,
} from "./bulk-update-meta";

describe("flushAfterContentWrites", () => {
  const ci = {
    refresh: vi.fn(),
    upsertEntry: vi.fn(),
    getAlternateUrls: vi.fn(() => ({ en: "/en/home", es: "/es/inicio" })),
    buildUrl: vi.fn(() => "/en/home"),
    contentRootName: "site_test",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears redirects, upserts saved entries by default (no full CI refresh), invalidates without full HTML clear, refreshes locale sitemap", () => {
    flushAfterContentWrites({
      ci: ci as any,
      contentTypes: ["page", "page", "blog"],
      sitemapEntries: [
        { contentType: "page", slug: "home", locale: "en" },
        { contentType: "blog", slug: "post", locale: "en" },
      ],
      commonMetaTouched: false,
      siteId: "site_test",
      savedFilePaths: ["site_test/pages/home/en.yml"],
    });

    expect(clearRedirectCache).toHaveBeenCalledTimes(1);
    expect(ci.refresh).not.toHaveBeenCalled();
    expect(ci.upsertEntry).toHaveBeenCalledWith("site_test/pages/home/en.yml");
    expect(invalidateContentCachesWithoutHtml).toHaveBeenCalledTimes(2);
    expect(refreshSitemapEntry).toHaveBeenCalledTimes(2);
    expect(refreshSitemapEntriesForContentKey).not.toHaveBeenCalled();
    expect(scheduleSavedHtmlPaths).not.toHaveBeenCalled();
    expect(scheduleContentTypeListingRebuild).not.toHaveBeenCalled();
    expect(invalidateHtmlPageCacheForPath).not.toHaveBeenCalled();
    expect(invalidateHtmlPageCache).not.toHaveBeenCalled();
    expect(scheduleHotHtmlRebuild).not.toHaveBeenCalled();
  });

  it("passes syncSlow true when requested", () => {
    flushAfterContentWrites({
      ci: ci as any,
      contentTypes: ["page"],
      sitemapEntries: [{ contentType: "page", slug: "home", locale: "en" }],
      syncSlow: true,
    });
    expect(ci.refresh).toHaveBeenCalledWith({ syncSlow: true });
    expect(scheduleHotHtmlRebuild).not.toHaveBeenCalled();
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

describe("classifyTouchedContentFiles", () => {
  it("splits a blog entry and a database file", () => {
    const ci = {
      contentRoot: "/tmp/site_test",
      getContentTypeConfig: (folder: string) => (folder === "blog" ? { directory: "blog" } : undefined),
      normalizeType: (folder: string) => (folder === "blog" ? "blog" : folder),
      getAlternateUrls: (slug: string) => ({
        en: `/en/blog/news/${slug}`,
        es: `/es/blog/noticias/${slug}`,
      }),
      buildUrl: (_type: string, locale: string, slug: string) =>
        locale === "es" ? `/es/blog/noticias/${slug}` : `/en/blog/news/${slug}`,
    };
    expect(
      classifyTouchedContentFiles(ci as any, [
        "site_test/blog/post/en.yml",
        "site_test/db/testimonials/testimonials.yml",
        "site_test/blog/_common.template.yml",
        "site_test/blog/template.en.yml",
      ]),
    ).toEqual({
      contentTypes: ["blog"],
      htmlPaths: ["/en/blog/news/post"],
      databaseNames: ["testimonials"],
    });
  });
});

describe("yamlMentionsRedirects", () => {
  it("detects redirects keys", () => {
    expect(yamlMentionsRedirects("meta:\n  redirects:\n    - /old\n")).toBe(true);
    expect(yamlMentionsRedirects("title: Hi\n")).toBe(false);
  });
});

describe("collectEntryHtmlPaths", () => {
  it("returns only the locale that was written", () => {
    const paths = collectEntryHtmlPaths(
      {
        getAlternateUrls: () => ({ en: "/en/outcomes", es: "/es/resultados" }),
        buildUrl: () => "/en/outcomes",
      } as any,
      "page",
      "outcomes",
      "en",
    );
    expect(paths).toEqual(["/en/outcomes"]);
  });

  it("returns every locale when the file is not one locale", () => {
    const paths = collectEntryHtmlPaths(
      {
        getAlternateUrls: () => ({ en: "/en/outcomes", es: "/es/resultados" }),
        buildUrl: () => "/en/outcomes",
      } as any,
      "page",
      "outcomes",
    );
    expect(paths).toContain("/en/outcomes");
    expect(paths).toContain("/es/resultados");
  });

  it("keeps the stored home copy and skips locale aliases", () => {
    const paths = collectEntryHtmlPaths(
      {
        resolveUrl: () => null,
        getAlternateUrls: () => ({ en: "/en/home", es: "/es/inicio" }),
        buildUrl: () => "/en/home",
      } as any,
      "page",
      "home",
      "en",
    );
    expect(paths).toEqual(["/en/home"]);
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

  it("accepts unknown meta keys without meta_target (routed by field scope)", () => {
    expect(
      validateBulkMetaUpdates([{ field_path: "meta.twitter_card", value: "summary" }]),
    ).toBeNull();
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
