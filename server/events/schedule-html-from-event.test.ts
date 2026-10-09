import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ContentEvent } from "./types";

vi.mock("../html-rebuild", () => ({
  scheduleSavedHtmlPaths: vi.fn(),
  scheduleStoredHtmlPaths: vi.fn(),
  scheduleHotHtmlRebuild: vi.fn(),
  scheduleContentTypeHtmlRebuild: vi.fn(),
  scheduleContentTypeListingRebuild: vi.fn(),
  scheduleDatabaseReaderRebuild: vi.fn(),
  scheduleCachedSlugHtmlRebuild: vi.fn(),
}));

vi.mock("../theme-config", () => ({
  sitesInheritingThemeFrom: vi.fn(() => []),
}));

vi.mock("../html-page-cache", async () => {
  const actual = await vi.importActual<typeof import("../html-page-cache")>("../html-page-cache");
  return {
    ...actual,
    listStoredHtmlCacheKeys: vi.fn(() => []),
    parseHtmlCacheKey: (key: string) => {
      const parts = String(key).split("::");
      if (parts.length < 4) return null;
      return {
        siteId: parts[1],
        pathname: parts.slice(2, -1).join("::"),
        variantKey: parts[parts.length - 1],
      };
    },
  };
});

import {
  scheduleCachedSlugHtmlRebuild,
  scheduleContentTypeHtmlRebuild,
  scheduleContentTypeListingRebuild,
  scheduleDatabaseReaderRebuild,
  scheduleHotHtmlRebuild,
  scheduleSavedHtmlPaths,
  scheduleStoredHtmlPaths,
} from "../html-rebuild";
import { sitesInheritingThemeFrom } from "../theme-config";
import { listStoredHtmlCacheKeys } from "../html-page-cache";
import { scheduleHtmlFromEvent } from "./schedule-html-from-event";

function event(type: ContentEvent["type"], overrides: Partial<ContentEvent> = {}): ContentEvent {
  return {
    id: 1,
    type,
    site: "site_test",
    resource: { contentType: "blog", slug: "post", locale: "en", layer: "live" },
    attribution: [],
    payload: {},
    published: false,
    created_at: 0,
    ...overrides,
  };
}

const ci = {
  contentRoot: "/tmp/site_test",
  normalizeType: (t: string) => t,
  getContentTypeConfig: () => ({ directory: "blog" }),
  getAlternateUrls: () => ({ en: "/en/blog/news/post" }),
  buildUrl: () => "/en/blog/news/post",
  getVariableUsage: (name: string) =>
    name === "brand.title" ? ["site_test/blog/post/en.yml"] : [],
  getContentTypes: () => [] as string[],
  refresh: vi.fn(),
  listAttachedEntries: () => [],
};

const site = {
  contentRootName: "site_test",
  contentRoot: "/tmp/site_test",
  contentIndex: ci as any,
};

describe("scheduleHtmlFromEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing without a content index", () => {
    scheduleHtmlFromEvent(event("entry_locale_saved"), {
      contentRootName: "site_test",
      contentRoot: "/tmp/site_test",
    });
    expect(scheduleSavedHtmlPaths).not.toHaveBeenCalled();
  });

  it("skips a variant-layer save", () => {
    scheduleHtmlFromEvent(
      event("entry_locale_saved", { resource: { contentType: "blog", slug: "post", locale: "en", layer: "variant" } }),
      site,
    );
    expect(scheduleSavedHtmlPaths).not.toHaveBeenCalled();
    expect(scheduleContentTypeListingRebuild).not.toHaveBeenCalled();
  });

  it("rebuilds the saved page and its listing", () => {
    scheduleHtmlFromEvent(event("entry_locale_saved"), site);
    expect(scheduleSavedHtmlPaths).toHaveBeenCalledWith(
      "site_test",
      ["/en/blog/news/post"],
      "/tmp/site_test",
    );
    expect(scheduleContentTypeListingRebuild).toHaveBeenCalled();
  });

  it("rebuilds only the stored home url, not locale aliases", () => {
    ci.getAlternateUrls = () => ({ en: "/en/home" });
    ci.buildUrl = () => "/en/home";
    ci.resolveUrl = () => null;
    scheduleHtmlFromEvent(
      event("entry_locale_saved", {
        resource: { contentType: "page", slug: "home", locale: "en", layer: "live" },
      }),
      site,
    );
    expect(scheduleSavedHtmlPaths).toHaveBeenCalledWith("site_test", ["/en/home"], "/tmp/site_test");
    ci.getAlternateUrls = () => ({ en: "/en/blog/news/post" });
    ci.buildUrl = () => "/en/blog/news/post";
    delete (ci as { resolveUrl?: unknown }).resolveUrl;
  });

  it("rebuilds the owning site and inheritors on the bulk queue when a theme is inherited", () => {
    vi.mocked(sitesInheritingThemeFrom).mockReturnValue(["/tmp/site_child"]);
    scheduleHtmlFromEvent(event("theme_changed", { payload: { affectsInheritingSites: true } }), site);
    expect(scheduleHotHtmlRebuild).toHaveBeenCalledWith("theme", {
      siteIds: ["site_test", "site_child"],
      queue: "html_rebuild_bulk",
    });
  });

  it("rebuilds one site on the bulk queue when the theme is not inherited", () => {
    scheduleHtmlFromEvent(event("theme_changed", { payload: { affectsInheritingSites: false } }), site);
    expect(scheduleHotHtmlRebuild).toHaveBeenCalledWith("theme", {
      siteIds: ["site_test"],
      queue: "html_rebuild_bulk",
    });
    expect(sitesInheritingThemeFrom).not.toHaveBeenCalled();
  });

  it("rebuilds stored Spanish pages that use the saved menu, not every hot page", () => {
    vi.mocked(listStoredHtmlCacheKeys).mockReturnValue([
      "dev::site_test::/es/blog/post::live",
      "dev::site_test::/en/blog/other::live",
    ]);
    scheduleHtmlFromEvent(event("menu_changed", { payload: { menuName: "main-navbar", locale: "es" } }), site);
    expect(scheduleHotHtmlRebuild).not.toHaveBeenCalled();
    expect(scheduleStoredHtmlPaths).toHaveBeenCalledWith("site_test", ["/es/blog/post"], "/tmp/site_test");
  });

  it("rebuilds pages that use a named variable", () => {
    scheduleHtmlFromEvent(event("variables_changed", { payload: { names: ["brand.title"] } }), site);
    expect(scheduleSavedHtmlPaths).toHaveBeenCalledWith(
      "site_test",
      ["/en/blog/news/post"],
      "/tmp/site_test",
    );
    expect(scheduleHotHtmlRebuild).not.toHaveBeenCalled();
  });

  it("rebuilds stored pages of this site when variable names are unknown", () => {
    scheduleHtmlFromEvent(event("variables_changed"), site);
    expect(scheduleHotHtmlRebuild).toHaveBeenCalledWith("variables", { siteIds: ["site_test"] });
  });

  it("rebuilds database readers and the row slug", () => {
    scheduleHtmlFromEvent(
      event("database_row_changed", { payload: { dbName: "testimonials", slug: "ada" }, resource: { slug: "ada" } }),
      site,
    );
    expect(scheduleDatabaseReaderRebuild).toHaveBeenCalledWith({
      siteId: "site_test",
      contentRoot: "/tmp/site_test",
      dbName: "testimonials",
    });
    expect(scheduleCachedSlugHtmlRebuild).toHaveBeenCalledWith("site_test", "ada", "/tmp/site_test");
  });

  it("rebuilds readers once and each refreshed row without dropping the copy", () => {
    ci.getContentTypes = () => ["lesson"];
    ci.getContentTypeConfig = (type: string) =>
      type === "lesson"
        ? {
            directory: "lesson",
            url_pattern: { en: "/en/lesson/:slug" },
            database: { slug: "lesson_tuples" },
          }
        : { directory: "blog" };
    ci.buildUrl = (_type: string, locale: string, slug: string) => `/${locale}/lesson/${slug}`;
    scheduleHtmlFromEvent(
      event("database_refreshed", {
        payload: {
          dbName: "lesson_tuples",
          rows: [{ slug: "html-input", locale: "en", params: {} }],
        },
      }),
      site,
    );
    expect(scheduleDatabaseReaderRebuild).toHaveBeenCalledTimes(1);
    expect(scheduleSavedHtmlPaths).toHaveBeenCalledWith(
      "site_test",
      ["/en/lesson/html-input"],
      "/tmp/site_test",
      { deleteIfSlow: false },
    );
    expect(scheduleCachedSlugHtmlRebuild).not.toHaveBeenCalled();
    ci.getContentTypes = () => [];
    ci.getContentTypeConfig = () => ({ directory: "blog" });
    ci.buildUrl = () => "/en/blog/news/post";
  });

  it("rebuilds the public url when a row path is a folder spelling", () => {
    ci.resolveUrl = (url: string) =>
      url === "/es/ubicacion/berlin-germany" || url === "/es/ubicacion/berlin-alemania"
        ? { contentType: "location", slug: "berlin-germany", patternLocale: "es" }
        : null;
    ci.getAlternateUrls = () => ({ es: "/es/ubicacion/berlin-alemania" });
    ci.getContentTypes = () => ["location"];
    ci.getContentTypeConfig = () => ({
      directory: "location",
      url_pattern: { es: "/es/ubicacion/:slug" },
      database: { slug: "locations" },
    });
    ci.buildUrl = () => "/es/ubicacion/berlin-germany";
    scheduleHtmlFromEvent(
      event("database_refreshed", {
        payload: { dbName: "locations", rows: [{ slug: "berlin-germany", locale: "es", params: {} }] },
      }),
      site,
    );
    expect(scheduleSavedHtmlPaths).toHaveBeenCalledWith(
      "site_test",
      ["/es/ubicacion/berlin-alemania"],
      "/tmp/site_test",
      { deleteIfSlow: false },
    );
    ci.getContentTypes = () => [];
    ci.getContentTypeConfig = () => ({ directory: "blog" });
    ci.getAlternateUrls = () => ({ en: "/en/blog/news/post" });
    ci.buildUrl = () => "/en/blog/news/post";
    delete (ci as { resolveUrl?: unknown }).resolveUrl;
  });

  it("lets a pull reload a local database instead of rebuilding readers immediately", () => {
    (ci as { getDatabase: () => { get: (name: string) => { source: { type: string } } } }).getDatabase = () => ({
      get: () => ({ source: { type: "local" } }),
    });
    scheduleHtmlFromEvent(
      event("site_bulk_synced", { payload: { files: ["site_test/db/testimonials/rows.yml"] } }),
      site,
    );
    expect(scheduleDatabaseReaderRebuild).not.toHaveBeenCalled();
    delete (ci as { getDatabase?: unknown }).getDatabase;
  });

  it("enqueues a content type rebuild and keeps the previous URL pattern", () => {
    scheduleHtmlFromEvent(
      event("content_type_changed", {
        resource: { contentType: "blog" },
        payload: { contentType: "blog", urlPatternChanged: true, previousUrlPattern: { en: "/blog/:slug" } },
      }),
      site,
    );
    expect(scheduleContentTypeHtmlRebuild).toHaveBeenCalledWith({
      siteId: "site_test",
      contentRoot: "/tmp/site_test",
      contentType: "blog",
      urlPatternChanged: true,
      previousUrlPattern: { en: "/blog/:slug" },
    });
    expect(scheduleHotHtmlRebuild).not.toHaveBeenCalled();
  });

  it("enqueues a content type rebuild without a URL change for a mapping save", () => {
    scheduleHtmlFromEvent(
      event("content_type_changed", {
        resource: { contentType: "blog" },
        payload: { contentType: "blog", urlPatternChanged: false },
      }),
      site,
    );
    expect(scheduleContentTypeHtmlRebuild).toHaveBeenCalledWith({
      siteId: "site_test",
      contentRoot: "/tmp/site_test",
      contentType: "blog",
      urlPatternChanged: false,
      previousUrlPattern: null,
    });
  });

  it("rebuilds this site's stored pages on the bulk queue for Tag Manager", () => {
    scheduleHtmlFromEvent(event("tag_manager_changed"), site);
    expect(scheduleHotHtmlRebuild).toHaveBeenCalledWith("tag-manager", {
      siteIds: ["site_test"],
      queue: "html_rebuild_bulk",
    });
  });
});
