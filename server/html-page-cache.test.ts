import { describe, expect, it } from "vitest";
import { buildHtmlCacheKey, shouldBypassHtmlCache } from "./html-page-cache";

describe("shouldBypassHtmlCache", () => {
  const emptyHeaders = { cookie: undefined as string | undefined };

  it("bypasses for ?cache=false (anonymous preferred)", () => {
    expect(
      shouldBypassHtmlCache({
        method: "GET",
        headers: emptyHeaders,
        originalUrl: "/en/blog/post?cache=false",
      }),
    ).toBe(true);
    expect(
      shouldBypassHtmlCache({
        method: "GET",
        headers: emptyHeaders,
        originalUrl: "/es/page?foo=1&cache=false#section",
      }),
    ).toBe(true);
  });

  it("does not treat unrelated cache= values as bypass", () => {
    expect(
      shouldBypassHtmlCache({
        method: "GET",
        headers: emptyHeaders,
        originalUrl: "/en/blog/post?cache=true",
      }),
    ).toBe(false);
    expect(
      shouldBypassHtmlCache({
        method: "GET",
        headers: emptyHeaders,
        originalUrl: "/en/blog/post?cache=falsehood",
      }),
    ).toBe(false);
  });

  it("still bypasses edit=1 / edit_mode / __site", () => {
    expect(
      shouldBypassHtmlCache({
        method: "GET",
        headers: emptyHeaders,
        originalUrl: "/en/x?edit=1",
      }),
    ).toBe(true);
    expect(
      shouldBypassHtmlCache({
        method: "GET",
        headers: emptyHeaders,
        originalUrl: "/en/x?edit_mode=true",
      }),
    ).toBe(true);
    expect(
      shouldBypassHtmlCache({
        method: "GET",
        headers: emptyHeaders,
        originalUrl: "/en/x?__site=example.com",
      }),
    ).toBe(true);
  });

  it("does not bypass plain anonymous GET", () => {
    expect(
      shouldBypassHtmlCache({
        method: "GET",
        headers: emptyHeaders,
        originalUrl: "/en/blog/post",
      }),
    ).toBe(false);
  });
});

describe("buildHtmlCacheKey", () => {
  it("strips query from pathname", () => {
    expect(buildHtmlCacheKey("site", "/blog/post?cache=false")).toBe(
      "site::/blog/post::live",
    );
  });
});
