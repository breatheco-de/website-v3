import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ContentEvent } from "./types";

vi.mock("../html-rebuild", () => ({
  scheduleSavedHtmlPaths: vi.fn(),
  scheduleHotHtmlRebuild: vi.fn(),
  scheduleContentTypeListingRebuild: vi.fn(),
  scheduleDatabaseReaderRebuild: vi.fn(),
  scheduleCachedSlugHtmlRebuild: vi.fn(),
  invalidateHotHtmlAndRebuild: vi.fn(),
}));

import {
  invalidateHotHtmlAndRebuild,
  scheduleCachedSlugHtmlRebuild,
  scheduleContentTypeListingRebuild,
  scheduleDatabaseReaderRebuild,
  scheduleHotHtmlRebuild,
  scheduleSavedHtmlPaths,
} from "../html-rebuild";
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

  it("rebuilds every hot page when a theme is inherited", () => {
    scheduleHtmlFromEvent(event("theme_changed", { payload: { affectsInheritingSites: true } }), site);
    expect(scheduleHotHtmlRebuild).toHaveBeenCalledWith("theme");
  });

  it("rebuilds one site when the theme is not inherited", () => {
    scheduleHtmlFromEvent(event("theme_changed", { payload: { affectsInheritingSites: false } }), site);
    expect(scheduleHotHtmlRebuild).toHaveBeenCalledWith("theme", "/tmp/site_test");
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

  it("rebuilds hot pages when variable names are unknown", () => {
    scheduleHtmlFromEvent(event("variables_changed"), site);
    expect(scheduleHotHtmlRebuild).toHaveBeenCalledWith("variables", "/tmp/site_test");
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

  it("drops and rebuilds hot pages for Tag Manager", () => {
    scheduleHtmlFromEvent(event("tag_manager_changed"), site);
    expect(invalidateHotHtmlAndRebuild).toHaveBeenCalledWith("tag-manager");
  });
});
