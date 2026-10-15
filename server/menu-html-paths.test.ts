import { describe, expect, it } from "vitest";
import { pathsUsingMenu, type MenuPathIndex } from "./events/menu-html-paths";

function index(overrides: Partial<MenuPathIndex> = {}): MenuPathIndex {
  return {
    contentRoot: "/tmp/site_test",
    resolveUrl: (url: string) => {
      if (url === "/es/blog/post") return { contentType: "blog", slug: "post", patternLocale: "es" };
      if (url === "/en/landing/promo") return { contentType: "landing", slug: "promo", patternLocale: "en" };
      if (url === "/en/blog/other") return { contentType: "blog", slug: "other", patternLocale: "en" };
      return null;
    },
    getContentTypeConfig: () => ({ directory: "blog" }),
    normalizeType: (type: string) => type,
    getAllMenuUsage: () =>
      new Map([
        ["promo-nav", [{ contentType: "landing", slug: "promo", position: "top" as const }]],
      ]),
    ...overrides,
  };
}

const stored = ["/es/blog/post", "/en/blog/other", "/en/landing/promo", "/es/about"];

describe("pathsUsingMenu", () => {
  it("keeps pages on the default navbar and skips a page that picked another menu", () => {
    expect(pathsUsingMenu(index(), stored, "main-navbar")).toEqual([
      "/es/blog/post",
      "/en/blog/other",
      "/es/about",
    ]);
  });

  it("limits a translation save to that language", () => {
    expect(pathsUsingMenu(index(), stored, "main-navbar", "es")).toEqual(["/es/blog/post", "/es/about"]);
  });

  it("includes only the entry that picked a custom menu", () => {
    expect(pathsUsingMenu(index(), stored, "promo-nav")).toEqual(["/en/landing/promo"]);
  });
});
