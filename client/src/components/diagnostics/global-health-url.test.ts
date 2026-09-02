import { describe, expect, it } from "vitest";
import {
  GLOBAL_HEALTH_VIEW_DEFAULTS,
  buildCacheIssuesQuery,
  parseGlobalHealthSearch,
  serializeGlobalHealthSearch,
} from "./global-health-url";

describe("parseGlobalHealthSearch", () => {
  it("returns defaults for empty search", () => {
    expect(parseGlobalHealthSearch("")).toEqual(GLOBAL_HEALTH_VIEW_DEFAULTS);
    expect(parseGlobalHealthSearch("?")).toEqual(GLOBAL_HEALTH_VIEW_DEFAULTS);
  });

  it("parses kpi, path, scope, validators, and tried", () => {
    const view = parseGlobalHealthSearch(
      "kpi=errors&path=/en/home&scope=seo,components&validators=meta,seo-depth&tried=1",
    );
    expect(view).toEqual({
      kpi: "errors",
      path: "/en/home",
      scope: ["seo", "components"],
      validators: ["meta", "seo-depth"],
      priorAttempts: true,
    });
  });

  it("parses completed kpi", () => {
    expect(parseGlobalHealthSearch("kpi=completed").kpi).toBe("completed");
  });

  it("ignores unknown kpi and scope keys", () => {
    const view = parseGlobalHealthSearch("kpi=bogus&scope=seo,nope,forms");
    expect(view.kpi).toBeNull();
    expect(view.scope).toEqual(["seo", "forms"]);
  });

  it("dedupes csv values", () => {
    expect(parseGlobalHealthSearch("validators=meta,meta,seo-depth").validators).toEqual([
      "meta",
      "seo-depth",
    ]);
  });
});

describe("serializeGlobalHealthSearch", () => {
  it("omits defaults", () => {
    expect(serializeGlobalHealthSearch(GLOBAL_HEALTH_VIEW_DEFAULTS)).toBe("");
  });

  it("writes non-default filters", () => {
    const qs = serializeGlobalHealthSearch({
      kpi: "warnings",
      path: "/es/blog",
      scope: ["seo"],
      validators: ["seo-depth"],
      priorAttempts: true,
    });
    const params = new URLSearchParams(qs);
    expect(params.get("kpi")).toBe("warnings");
    expect(params.get("path")).toBe("/es/blog");
    expect(params.get("scope")).toBe("seo");
    expect(params.get("validators")).toBe("seo-depth");
    expect(params.get("tried")).toBe("1");
  });

  it("preserves unknown existing params", () => {
    const qs = serializeGlobalHealthSearch(GLOBAL_HEALTH_VIEW_DEFAULTS, "token=abc&kpi=errors");
    const params = new URLSearchParams(qs);
    expect(params.get("token")).toBe("abc");
    expect(params.has("kpi")).toBe(false);
  });

  it("round-trips", () => {
    const view = parseGlobalHealthSearch(
      "kpi=coverage&path=/x&scope=forms,bindings&validators=section-variants&tried=1",
    );
    expect(parseGlobalHealthSearch(serializeGlobalHealthSearch(view))).toEqual(view);
  });
});

describe("buildCacheIssuesQuery", () => {
  it("maps view state to cache-issues query params", () => {
    const params = buildCacheIssuesQuery(
      {
        kpi: "errors",
        path: "/es/blog",
        scope: ["seo", "content"],
        validators: ["schema-completeness", "meta"],
        priorAttempts: true,
      },
      "empty field",
    );
    expect(params.get("severity")).toBe("error");
    expect(params.get("urlPath")).toBe("/es/blog");
    expect(params.get("categories")).toBe("seo,content");
    expect(params.get("validators")).toBe("schema-completeness,meta");
    expect(params.get("priorAttempts")).toBe("1");
    expect(params.get("search")).toBe("empty field");
  });

  it("omits defaults", () => {
    const params = buildCacheIssuesQuery(GLOBAL_HEALTH_VIEW_DEFAULTS);
    expect(params.toString()).toBe("");
  });
});
