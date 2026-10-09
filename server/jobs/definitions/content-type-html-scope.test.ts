import { describe, expect, it } from "vitest";
import type { ContentIndex } from "../../content-index";
import { diffPublicContentTypes, planContentTypeHtmlUpdate, publicUrlsForType } from "./content-type-html-scope";

describe("diffPublicContentTypes", () => {
  it("ignores staff-only fields and notices a public URL change", () => {
    const before = {
      blog: {
        directory: "blog",
        url_pattern: { en: "/blog/:slug" },
        strategy: { purpose: "old" },
      },
      page: { directory: "page", url_pattern: { en: "/:slug" }, layout: { menu: { top: "main-navbar" } } },
    };
    const after = {
      blog: {
        directory: "blog",
        url_pattern: { en: "/articulos/:slug" },
        strategy: { purpose: "new" },
      },
      page: { directory: "page", url_pattern: { en: "/:slug" }, layout: { menu: { top: "main-navbar" } }, editor: {} },
    };
    expect(diffPublicContentTypes(before, after)).toEqual([
      { type: "blog", urlPatternChanged: true, previousUrlPattern: { en: "/blog/:slug" } },
    ]);
  });
});

describe("planContentTypeHtmlUpdate", () => {
  it("drops the old address and rebuilds the new one when the URL pattern changes", () => {
    expect(
      planContentTypeHtmlUpdate({
        urlPatternChanged: true,
        previousUrls: ["/blog/post"],
        nextUrls: ["/articulos/post"],
        storedPaths: ["/blog/post"],
      }),
    ).toEqual({ drop: ["/blog/post"], rebuild: ["/articulos/post"] });
  });

  it("rebuilds only stored pages when the URL stays the same", () => {
    expect(
      planContentTypeHtmlUpdate({
        urlPatternChanged: false,
        previousUrls: ["/blog/post", "/blog/draft"],
        nextUrls: ["/blog/post", "/blog/draft"],
        storedPaths: ["/blog/post"],
      }),
    ).toEqual({ drop: [], rebuild: ["/blog/post"] });
  });
});

describe("publicUrlsForType", () => {
  it("uses the previous pattern for the old address", () => {
    const ci = {
      contentRoot: "/tmp/site_test",
      getContentTypeConfig: () => ({ url_pattern: { en: "/articulos/:slug" }, directory: "blog" }),
      findByType: () => [{ slug: "post", locales: ["en"], files: ["en.yml"] }],
      buildUrl: () => "/articulos/post",
    } as unknown as ContentIndex;
    expect(publicUrlsForType(ci, "blog", { en: "/blog/:slug" })).toEqual(["/blog/post"]);
    expect(publicUrlsForType(ci, "blog")).toEqual(["/articulos/post"]);
  });
});
