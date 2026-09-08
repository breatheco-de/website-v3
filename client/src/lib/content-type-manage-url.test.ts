import { describe, expect, it } from "vitest";
import {
  MANAGE_LIST_VIEW_DEFAULTS,
  parseManageListSearch,
  serializeManageListSearch,
} from "./content-type-manage-url";

describe("parseManageListSearch", () => {
  it("returns defaults for an empty query", () => {
    expect(parseManageListSearch("")).toEqual(MANAGE_LIST_VIEW_DEFAULTS);
    expect(parseManageListSearch("?")).toEqual(MANAGE_LIST_VIEW_DEFAULTS);
  });

  it("parses perspective, view, q, page", () => {
    const view = parseManageListSearch(
      "perspective=organic&view=db&q=python&page=3",
    );
    expect(view.perspective).toBe("organic");
    expect(view.view).toBe("db");
    expect(view.q).toBe("python");
    expect(view.page).toBe(3);
  });

  it("rejects invalid perspective, view, and page", () => {
    expect(parseManageListSearch("perspective=nope").perspective).toBe("default");
    expect(parseManageListSearch("view=csv").view).toBeNull();
    expect(parseManageListSearch("page=0").page).toBe(1);
    expect(parseManageListSearch("page=abc").page).toBe(1);
  });

  it("parses updated sort, organic filters, and tag filters", () => {
    const view = parseManageListSearch(
      "updated=asc&locale=es&market=us&sort=position&dir=asc&t=topic:ai&t=topic:ml&t=level:beginner",
    );
    expect(view.updatedSortDir).toBe("asc");
    expect(view.organicLocale).toBe("es");
    expect(view.organicMarket).toBe("us");
    expect(view.organicSort).toBe("position");
    expect(view.organicSortDir).toBe("asc");
    expect(view.tagFilters).toEqual({
      topic: ["ai", "ml"],
      level: ["beginner"],
    });
  });
});

describe("serializeManageListSearch", () => {
  it("omits defaults so the URL stays empty", () => {
    expect(serializeManageListSearch(MANAGE_LIST_VIEW_DEFAULTS)).toBe("");
  });

  it("writes only non-default keys", () => {
    const qs = serializeManageListSearch({
      ...MANAGE_LIST_VIEW_DEFAULTS,
      perspective: "organic",
      view: "db",
      q: "react",
      page: 2,
      updatedSortDir: "desc",
      tagFilters: { topic: ["ai"] },
      organicLocale: "es",
      organicMarket: "us",
      organicSort: "ctr",
      organicSortDir: "asc",
    });
    const params = new URLSearchParams(qs);
    expect(params.get("perspective")).toBe("organic");
    expect(params.get("view")).toBe("db");
    expect(params.get("q")).toBe("react");
    expect(params.get("page")).toBe("2");
    expect(params.get("updated")).toBe("desc");
    expect(params.getAll("t")).toEqual(["topic:ai"]);
    expect(params.get("locale")).toBe("es");
    expect(params.get("market")).toBe("us");
    expect(params.get("sort")).toBe("ctr");
    expect(params.get("dir")).toBe("asc");
  });

  it("omits view when it matches defaultViewMode", () => {
    const qs = serializeManageListSearch(
      { ...MANAGE_LIST_VIEW_DEFAULTS, view: "db" },
      "",
      { defaultViewMode: "db" },
    );
    expect(qs).toBe("");
  });

  it("keeps unknown params and round-trips", () => {
    const qs = serializeManageListSearch(
      {
        ...MANAGE_LIST_VIEW_DEFAULTS,
        perspective: "seo",
        q: "a",
      },
      "debug=1",
    );
    expect(new URLSearchParams(qs).get("debug")).toBe("1");
    expect(parseManageListSearch(qs).perspective).toBe("seo");
    expect(parseManageListSearch(qs).q).toBe("a");
  });
});
