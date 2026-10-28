import { describe, expect, it } from "vitest";
import {
  isTaskDestination,
  landingTagsFromSearch,
  navCodeFromEntryType,
  referrerInfo,
  shouldCount,
} from "./page-ready";

describe("landingTagsFromSearch", () => {
  it("keeps the six UTM values and only the click-ID parameter name", () => {
    const t = landingTagsFromSearch("?utm_source=google&utm_medium=cpc&utm_campaign=fall&utm_id=123&utm_term=456&utm_content=ad&gclid=SECRET");
    expect(t).toEqual({ q: { s: "google", m: "cpc", c: "fall", i: "123", t: "456", n: "ad" }, ck: "gclid" });
    expect(JSON.stringify(t)).not.toContain("SECRET");
  });

  it("returns nulls for a plain URL", () => {
    expect(landingTagsFromSearch("")).toEqual({ q: null, ck: null });
  });
});

describe("referrerInfo", () => {
  it("uses our own referrer path as the previous page (full page load)", () => {
    expect(referrerInfo("https://4geeks.com/en/blog/post?x=1", "4geeks.com")).toEqual({ pp: "/en/blog/post", rh: null });
  });

  it("keeps only the host of an external referrer", () => {
    expect(referrerInfo("https://www.google.com/search?q=bootcamp", "4geeks.com")).toEqual({ pp: null, rh: "www.google.com" });
  });

  it("handles a missing referrer", () => {
    expect(referrerInfo("", "4geeks.com")).toEqual({ pp: null, rh: null });
  });
});

describe("navCodeFromEntryType", () => {
  it("maps reload and back/forward; everything else is a navigation", () => {
    expect(navCodeFromEntryType("reload")).toBe("r");
    expect(navCodeFromEntryType("back_forward")).toBe("b");
    expect(navCodeFromEntryType("navigate")).toBe("n");
    expect(navCodeFromEntryType("prerender")).toBe("n");
    expect(navCodeFromEntryType(undefined)).toBe("n");
  });
});

describe("shouldCount", () => {
  const base = { fp: 1, token: "t", pathname: "/en/landing/a", search: "", staff: false };

  it("runs only when the server turned it on and gave a token", () => {
    expect(shouldCount(base)).toBe(true);
    expect(shouldCount({ ...base, fp: 0 })).toBe(false);
    expect(shouldCount({ ...base, token: "" })).toBe(false);
  });

  it("never runs for staff, private pages, preview frames or edit mode", () => {
    expect(shouldCount({ ...base, staff: true })).toBe(false);
    expect(shouldCount({ ...base, pathname: "/private/settings" })).toBe(false);
    expect(shouldCount({ ...base, pathname: "/preview-frame/x" })).toBe(false);
    expect(shouldCount({ ...base, search: "?edit=1" })).toBe(false);
  });
});

describe("isTaskDestination", () => {
  it("matches the GA4 task click rule (leaves the site)", () => {
    expect(isTaskDestination("learn.4geeks.com/login")).toBe(true);
    expect(isTaskDestination("mailto:")).toBe(true);
    expect(isTaskDestination("/en/apply")).toBe(false);
    expect(isTaskDestination("#faq")).toBe(false);
    expect(isTaskDestination(undefined)).toBe(false);
  });
});
