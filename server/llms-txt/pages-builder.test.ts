import { beforeEach, describe, expect, it, vi } from "vitest";

const findByType = vi.fn();
const loadMergedContent = vi.fn();
const getAlternateUrls = vi.fn();

vi.mock("../content-index", () => ({
  contentIndex: {
    findByType: (...args: unknown[]) => findByType(...args),
    loadMergedContent: (...args: unknown[]) => loadMergedContent(...args),
    getAlternateUrls: (...args: unknown[]) => getAlternateUrls(...args),
  },
}));

vi.mock("../schema-org", () => ({
  loadResolvedSchemaConfig: () => ({}),
}));

vi.mock("../variable-manager", () => ({
  getVariableManager: () => ({ getDefinitions: () => ({}), resolveString: () => ({ text: "" }) }),
}));

vi.mock("../product/product-io", () => ({
  listProductRows: () => [],
  readEntryProduct: () => null,
}));

import { buildPagesInput } from "./regenerate-prompt";

describe("buildPagesInput", () => {
  beforeEach(() => {
    findByType.mockReset();
    loadMergedContent.mockReset();
    getAlternateUrls.mockReset();
  });

  it("includes page with priority 0.8 and excludes denylist / low priority / programs", () => {
    findByType.mockReturnValue([
      { slug: "about-us", locales: ["en"], title: "About", files: ["en.yml"] },
      { slug: "cookies", locales: ["en"], title: "Cookies", files: ["en.yml"] },
      { slug: "low-prio", locales: ["en"], title: "Low", files: ["en.yml"] },
    ]);

    loadMergedContent.mockImplementation((_ct: string, slug: string) => {
      if (slug === "about-us") {
        return {
          data: {
            title: "About us",
            meta: { priority: 0.8, description: "Who we are", robots: "index,follow" },
          },
        };
      }
      if (slug === "cookies") {
        return {
          data: { title: "Cookies", meta: { priority: 1, description: "Legal" } },
        };
      }
      if (slug === "low-prio") {
        return {
          data: { title: "Low", meta: { priority: 0.5, description: "Skip" } },
        };
      }
      return { data: null, error: "missing" };
    });

    getAlternateUrls.mockImplementation((slug: string) => {
      if (slug === "about-us") return { en: "/us/about-us" };
      return { en: `/us/${slug}` };
    });

    const { rows } = buildPagesInput("/tmp/site_test");
    expect(rows.map((r) => r.slug)).toEqual(["about-us"]);
    expect(rows[0].meta_description).toBe("Who we are");
    expect(rows[0].url).toContain("/us/about-us");
    expect(findByType).toHaveBeenCalledWith("page");
  });

  it("excludes noindex", () => {
    findByType.mockReturnValue([
      { slug: "hidden", locales: ["en"], title: "Hidden", files: ["en.yml"] },
    ]);
    loadMergedContent.mockReturnValue({
      data: {
        title: "Hidden",
        meta: { priority: 1, robots: "noindex, nofollow", description: "x" },
      },
    });
    getAlternateUrls.mockReturnValue({ en: "/us/hidden" });
    expect(buildPagesInput("/tmp/site_test").rows).toHaveLength(0);
  });
});
