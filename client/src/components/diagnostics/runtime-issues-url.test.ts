import { describe, expect, it } from "vitest";
import { FILTER_ALL } from "./runtime-issues-filters";
import {
  RUNTIME_ISSUE_VIEW_DEFAULTS,
  parseRuntimeIssueSearch,
  serializeRuntimeIssueSearch,
} from "./runtime-issues-url";

describe("parseRuntimeIssueSearch", () => {
  it("returns defaults for an empty query", () => {
    expect(parseRuntimeIssueSearch("")).toEqual(RUNTIME_ISSUE_VIEW_DEFAULTS);
    expect(parseRuntimeIssueSearch("?")).toEqual(RUNTIME_ISSUE_VIEW_DEFAULTS);
  });

  it("parses pagesOnly=0 and ignores leftover hideBots", () => {
    const view = parseRuntimeIssueSearch("hideBots=0&pagesOnly=0");
    expect(view.filters.pagesOnly).toBe(false);
    expect("hideBots" in view).toBe(false);
  });

  it("parses queryParams=1", () => {
    expect(parseRuntimeIssueSearch("queryParams=1").filters.queryParamsOnly).toBe(true);
    expect(parseRuntimeIssueSearch("").filters.queryParamsOnly).toBe(false);
  });

  it("parses path, referrer, locale, device, sort, dir", () => {
    const view = parseRuntimeIssueSearch(
      "path=%2Fen&referrer=google&locale=es&device=mobile&sort=lastSeen&dir=asc",
    );
    expect(view.filters.pathQuery).toBe("/en");
    expect(view.filters.referrerQuery).toBe("google");
    expect(view.filters.locale).toBe("es");
    expect(view.filters.device).toBe("mobile");
    expect(view.sortKey).toBe("lastSeen");
    expect(view.sortDir).toBe("asc");
    expect(view.page).toBe(1);
  });

  it("parses page and treats invalid values as page 1", () => {
    expect(parseRuntimeIssueSearch("page=3").page).toBe(3);
    expect(parseRuntimeIssueSearch("page=0").page).toBe(1);
    expect(parseRuntimeIssueSearch("page=-2").page).toBe(1);
    expect(parseRuntimeIssueSearch("page=abc").page).toBe(1);
  });

  it("treats FILTER_ALL locale as all locales", () => {
    expect(parseRuntimeIssueSearch("locale=__all__").filters.locale).toBe(FILTER_ALL);
  });
});

describe("serializeRuntimeIssueSearch", () => {
  it("omits defaults so the URL stays empty", () => {
    expect(serializeRuntimeIssueSearch(RUNTIME_ISSUE_VIEW_DEFAULTS)).toBe("");
  });

  it("writes only non-default keys", () => {
    const qs = serializeRuntimeIssueSearch({
      ...RUNTIME_ISSUE_VIEW_DEFAULTS,
      filters: {
        ...RUNTIME_ISSUE_VIEW_DEFAULTS.filters,
        pathQuery: "/es/blog",
        locale: "es",
        pagesOnly: false,
        windowDays: 7,
      },
      sortKey: "lastSeen",
    });
    const params = new URLSearchParams(qs);
    expect(params.get("pagesOnly")).toBe("0");
    expect(params.get("window")).toBe("7");
    expect(params.get("path")).toBe("/es/blog");
    expect(params.get("locale")).toBe("es");
    expect(params.get("sort")).toBe("lastSeen");
    expect(params.has("dir")).toBe(false);
    expect(params.has("device")).toBe(false);
    expect(params.has("page")).toBe(false);
  });

  it("writes queryParams when enabled", () => {
    const qs = serializeRuntimeIssueSearch({
      ...RUNTIME_ISSUE_VIEW_DEFAULTS,
      filters: {
        ...RUNTIME_ISSUE_VIEW_DEFAULTS.filters,
        queryParamsOnly: true,
      },
    });
    expect(new URLSearchParams(qs).get("queryParams")).toBe("1");
  });

  it("writes page when it is not 1", () => {
    const qs = serializeRuntimeIssueSearch({ ...RUNTIME_ISSUE_VIEW_DEFAULTS, page: 2 });
    expect(new URLSearchParams(qs).get("page")).toBe("2");
  });

  it("preserves unrelated query params", () => {
    const qs = serializeRuntimeIssueSearch(RUNTIME_ISSUE_VIEW_DEFAULTS, "token=abc&path=/old");
    const params = new URLSearchParams(qs);
    expect(params.get("token")).toBe("abc");
    expect(params.has("path")).toBe(false);
  });

  it("strips leftover hideBots from the URL", () => {
    const qs = serializeRuntimeIssueSearch(RUNTIME_ISSUE_VIEW_DEFAULTS, "hideBots=0&token=abc");
    const params = new URLSearchParams(qs);
    expect(params.get("token")).toBe("abc");
    expect(params.has("hideBots")).toBe(false);
  });

  it("round-trips a fully customized view", () => {
    const view = parseRuntimeIssueSearch(
      "pagesOnly=0&path=/en&referrer=press&locale=en&device=desktop&window=7&tz=America/Bogota&source=search_crawler&sort=lastSeen&dir=asc&page=2",
    );
    expect(parseRuntimeIssueSearch(serializeRuntimeIssueSearch(view))).toEqual(view);
  });
});
