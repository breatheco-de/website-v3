import { describe, expect, it } from "vitest";
import {
  pathMatchesIgnoreRule,
  previewIgnoreRule,
  splitLocalePrefix,
  validateIgnoreRuleInput,
} from "./runtime-issues-ignore";

describe("splitLocalePrefix", () => {
  it("requires a slug after the locale", () => {
    expect(splitLocalePrefix("/us/old-page")).toEqual({ locale: "us", rest: "/old-page" });
    expect(splitLocalePrefix("/us")).toBeNull();
    expect(splitLocalePrefix("/old-page")).toBeNull();
  });
});

describe("pathMatchesIgnoreRule", () => {
  it("matches exact paths only", () => {
    const rule = validateIgnoreRuleInput({ kind: "exact", path: "/us/old-page" });
    expect(rule).toBeTruthy();
    expect(pathMatchesIgnoreRule("/us/old-page/", rule!)).toBe(true);
    expect(pathMatchesIgnoreRule("/us/old-page/extra", rule!)).toBe(false);
  });

  it("matches locale twins but not extra segments", () => {
    const rule = validateIgnoreRuleInput({
      kind: "locales",
      locales: ["us", "es"],
      rest: "/old-page",
    });
    expect(rule).toBeTruthy();
    expect(pathMatchesIgnoreRule("/us/old-page", rule!)).toBe(true);
    expect(pathMatchesIgnoreRule("/es/old-page", rule!)).toBe(true);
    expect(pathMatchesIgnoreRule("/us/old-page/extra", rule!)).toBe(false);
    expect(pathMatchesIgnoreRule("/en/old-page", rule!)).toBe(false);
  });

  it("matches only listed slugs under a parent", () => {
    const rule = validateIgnoreRuleInput({
      kind: "slug_list",
      locales: ["us"],
      parent: "/old-blog",
      slugs: ["post-1", "post-2"],
    });
    expect(rule).toBeTruthy();
    expect(pathMatchesIgnoreRule("/us/old-blog/post-1", rule!)).toBe(true);
    expect(pathMatchesIgnoreRule("/us/old-blog/post-3", rule!)).toBe(false);
    expect(pathMatchesIgnoreRule("/es/old-blog/post-1", rule!)).toBe(false);
  });

  it("matches prefix paths with segment boundary", () => {
    const wp = validateIgnoreRuleInput({ kind: "prefix", prefix: "/wp" })!;
    const wpJson = validateIgnoreRuleInput({ kind: "prefix", prefix: "/wp-json" })!;
    const wordpress = validateIgnoreRuleInput({ kind: "prefix", prefix: "/wordpress/" })!;

    expect(pathMatchesIgnoreRule("/wp", wp)).toBe(true);
    expect(pathMatchesIgnoreRule("/wp/login", wp)).toBe(true);
    expect(pathMatchesIgnoreRule("/wp-json", wp)).toBe(false);
    expect(pathMatchesIgnoreRule("/wp-admin", wp)).toBe(false);

    expect(pathMatchesIgnoreRule("/wp-json", wpJson)).toBe(true);
    expect(pathMatchesIgnoreRule("/wp-json/wp/v2/posts", wpJson)).toBe(true);

    expect(pathMatchesIgnoreRule("/wordpress", wordpress)).toBe(true);
    expect(pathMatchesIgnoreRule("/wordpress/2020/01/post", wordpress)).toBe(true);
  });
});

describe("previewIgnoreRule", () => {
  it("counts current matching paths", () => {
    const rule = validateIgnoreRuleInput({
      kind: "locales",
      locales: ["us", "es"],
      rest: "/gone",
    })!;
    const preview = previewIgnoreRule(rule, ["/us/gone", "/es/gone", "/us/keep"]);
    expect(preview.matchCount).toBe(2);
  });
});
