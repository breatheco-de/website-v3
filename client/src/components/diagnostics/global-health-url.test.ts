import { describe, expect, it } from "vitest";
import {
  GLOBAL_HEALTH_VIEW_DEFAULTS,
  parseGlobalHealthSearch,
  serializeGlobalHealthSearch,
} from "./global-health-url";

describe("parseGlobalHealthSearch", () => {
  it("returns defaults for empty search", () => {
    expect(parseGlobalHealthSearch("")).toEqual(GLOBAL_HEALTH_VIEW_DEFAULTS);
    expect(parseGlobalHealthSearch("?")).toEqual(GLOBAL_HEALTH_VIEW_DEFAULTS);
  });

  it("parses kpi, path, scope, and validators", () => {
    const view = parseGlobalHealthSearch(
      "kpi=errors&path=/en/home&scope=seo,components&validators=meta,seo-depth",
    );
    expect(view).toEqual({
      kpi: "errors",
      path: "/en/home",
      scope: ["seo", "components"],
      validators: ["meta", "seo-depth"],
    });
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
    });
    const params = new URLSearchParams(qs);
    expect(params.get("kpi")).toBe("warnings");
    expect(params.get("path")).toBe("/es/blog");
    expect(params.get("scope")).toBe("seo");
    expect(params.get("validators")).toBe("seo-depth");
  });

  it("preserves unknown existing params", () => {
    const qs = serializeGlobalHealthSearch(GLOBAL_HEALTH_VIEW_DEFAULTS, "token=abc&kpi=errors");
    const params = new URLSearchParams(qs);
    expect(params.get("token")).toBe("abc");
    expect(params.has("kpi")).toBe(false);
  });

  it("round-trips", () => {
    const view = parseGlobalHealthSearch(
      "kpi=coverage&path=/x&scope=forms,bindings&validators=section-variants",
    );
    expect(parseGlobalHealthSearch(serializeGlobalHealthSearch(view))).toEqual(view);
  });
});
