import { describe, expect, it } from "vitest";
import { normalizeRedirectInput, previewRedirectBlock } from "./seoRedirectsPreview";

describe("normalizeRedirectInput", () => {
  it("lowercases, adds leading slash and drops trailing slash", () => {
    expect(normalizeRedirectInput(" En/Old-Page/ ")).toBe("/en/old-page");
    expect(normalizeRedirectInput("")).toBe("");
  });

  it("keeps the path of a full URL", () => {
    expect(normalizeRedirectInput("https://4geeks.com/en/Old")).toBe("/en/old");
  });
});

describe("previewRedirectBlock", () => {
  const page = "/en/how-to/install-js";

  it("passes a free path", () => {
    expect(previewRedirectBlock("/en/old", page, { match: false, pageExists: false })).toBeNull();
  });

  it("blocks this page's own address and homepages", () => {
    expect(previewRedirectBlock(page, page, null)).toContain("own address");
    expect(previewRedirectBlock("/es", page, null)).toContain("homepage");
  });

  it("blocks live pages", () => {
    expect(previewRedirectBlock("/en/other", page, { match: false, pageExists: true })).toContain("live page");
  });

  it("blocks existing exact and pattern redirects", () => {
    expect(
      previewRedirectBlock("/en/old", page, { match: true, matchType: "exact", resolvedTo: "/en/apply" }),
    ).toBe("/en/old already redirects to /en/apply.");
    expect(
      previewRedirectBlock("/en/old", page, { match: true, matchType: "exact", resolvedTo: page }),
    ).toBe("/en/old already redirects to this page.");
    expect(
      previewRedirectBlock("/us/x", page, { match: true, matchType: "regex", from: "/us/(.*)" }),
    ).toBe("/us/x is already handled by the pattern rule /us/(.*).");
  });
});
