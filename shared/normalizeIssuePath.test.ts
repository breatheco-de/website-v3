import { describe, expect, it } from "vitest";
import { issuePathMatches, normalizeIssuePath } from "./normalizeIssuePath";

describe("normalizeIssuePath", () => {
  it("strips query and hash", () => {
    expect(normalizeIssuePath("/en/home?x=1#section")).toBe("/en/home");
  });

  it("extracts pathname from absolute URL", () => {
    expect(normalizeIssuePath("https://example.com/es/blog/")).toBe("/es/blog");
  });
});

describe("issuePathMatches", () => {
  it("matches exact and suffix paths", () => {
    expect(issuePathMatches("/en/home", "/en/home")).toBe(true);
    expect(issuePathMatches("/home", "/en/home")).toBe(true);
    expect(issuePathMatches("/en/home", "/home")).toBe(true);
  });

  it("rejects blank URLs when filter is set", () => {
    expect(issuePathMatches("/en/home", "")).toBe(false);
  });

  it("allows any URL when filter is blank", () => {
    expect(issuePathMatches("", "/en/home")).toBe(true);
  });
});
