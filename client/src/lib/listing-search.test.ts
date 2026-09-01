import { describe, expect, it } from "vitest";
import {
  buildListingSearchUrl,
  computeListingSearchPool,
  filterListingItemsByQuery,
  syncListingQueryParam,
} from "./listing-search";

describe("buildListingSearchUrl", () => {
  it("includes q when at least 3 chars", () => {
    const url = buildListingSearchUrl({
      database: "interactive-exercises",
      locale: "en",
      q: "loops",
      searchConfig: {
        permanent_filters: [{ item_property_slug: "locale", value: "en" }],
        fields: ["title", "description"],
      },
    });
    expect(url).toContain("database=interactive-exercises");
    expect(url).toContain("q=loops");
    expect(url).toContain("filters=");
    expect(url).toContain("search_fields=");
  });

  it("returns null without database or content type", () => {
    expect(buildListingSearchUrl({ q: "test" })).toBeNull();
  });
});

describe("filterListingItemsByQuery", () => {
  const items = [
    { title: "Python Loops", description: "Learn for loops" },
    { title: "HTML Basics", description: "Tags and elements" },
  ];

  it("filters by title substring", () => {
    expect(filterListingItemsByQuery(items, "python")).toHaveLength(1);
  });

  it("returns all when query empty", () => {
    expect(filterListingItemsByQuery(items, "")).toHaveLength(2);
  });
});

describe("syncListingQueryParam", () => {
  it("sets q and clears page", () => {
    const p = new URLSearchParams("page=3&taxonomy=python");
    syncListingQueryParam(p, "loops");
    expect(p.get("q")).toBe("loops");
    expect(p.has("page")).toBe(false);
    expect(p.get("taxonomy")).toBe("python");
  });

  it("removes q when empty", () => {
    const p = new URLSearchParams("q=old&page=2");
    syncListingQueryParam(p, "  ");
    expect(p.has("q")).toBe(false);
    expect(p.has("page")).toBe(false);
  });
});

describe("computeListingSearchPool", () => {
  const hardcoded = [{ title: "Pinned card", _pinned: true }];
  const dbItems = [
    { title: "Python Loops", taxonomy: "python" },
    { title: "JavaScript Arrays", taxonomy: "javascript" },
  ];
  const tagFilter = [
    {
      item_property_slug: "taxonomy",
      component_renderer: "tags" as const,
    },
  ];

  it("pins hardcoded entries and applies tag filter after substring search", () => {
    const result = computeListingSearchPool({
      hasActiveSearch: true,
      userFiltered: [...hardcoded, ...dbItems],
      useSemanticSearch: false,
      hardcodedItems: hardcoded,
      ssrDbItems: dbItems,
      activeSearchQuery: "python",
      userFilters: tagFilter,
      userFilterValues: { taxonomy: "python" },
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ title: "Pinned card" });
    expect(result[1]).toMatchObject({ title: "Python Loops" });
  });

  it("uses API results when semantic search is active", () => {
    const apiItems = [{ title: "From API", taxonomy: "python" }];
    const result = computeListingSearchPool({
      hasActiveSearch: true,
      userFiltered: [],
      useSemanticSearch: true,
      apiItems,
      hardcodedItems: hardcoded,
      ssrDbItems: dbItems,
      activeSearchQuery: "loops",
      userFilters: tagFilter,
      userFilterValues: { taxonomy: "python" },
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ title: "Pinned card" });
    expect(result[1]).toMatchObject({ title: "From API" });
  });

  it("returns userFiltered when search inactive", () => {
    const userFiltered = [{ title: "All items" }];
    expect(
      computeListingSearchPool({
        hasActiveSearch: false,
        userFiltered,
        useSemanticSearch: false,
        hardcodedItems: [],
        ssrDbItems: [],
        activeSearchQuery: "",
        userFilters: [],
        userFilterValues: {},
      }),
    ).toEqual(userFiltered);
  });
});
