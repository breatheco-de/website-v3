import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  buildHtmlCacheKey,
  canonicalHtmlCachePath,
  collectParamPlaceholderNames,
  dropHtmlCacheMemoryForTests,
  getCachedHtml,
  htmlLooksPersonalized,
  invalidateHtmlPageCache,
  setHtmlCacheClockForTests,
  requestBakesQueryParamTemplate,
  resetHtmlPageCacheForTests,
  setCachedHtml,
  setHtmlBuildIdForTests,
  isEditDocumentRequest,
  htmlRenderSkipReason,
  shouldBypassHtmlCache,
  singleflight,
} from "./html-page-cache";

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

  it("does not bypass edit urls, cookies, or the debug token", () => {
    expect(isEditDocumentRequest("/en/x?edit=1")).toBe(true);
    expect(isEditDocumentRequest("/en/x?edit_mode=true")).toBe(true);
    expect(isEditDocumentRequest("/en/x?edit_mode=false")).toBe(false);
    expect(isEditDocumentRequest("/en/x")).toBe(false);
    expect(
      shouldBypassHtmlCache({
        method: "GET",
        headers: emptyHeaders,
        originalUrl: "/en/x?edit=1",
      }),
    ).toBe(false);
    expect(
      shouldBypassHtmlCache({
        method: "GET",
        headers: { cookie: "4g_ctx=abc; session=1" },
        originalUrl: "/en/x",
      }),
    ).toBe(false);
    expect(
      shouldBypassHtmlCache({
        method: "GET",
        headers: { get: (name: string) => (name === "x-debug-token" ? "tok" : undefined) },
        originalUrl: "/en/x",
      }),
    ).toBe(false);
  });

  it("still bypasses __site and Authorization", () => {
    expect(
      shouldBypassHtmlCache({
        method: "GET",
        headers: emptyHeaders,
        originalUrl: "/en/x?__site=example.com",
      }),
    ).toBe(true);
    expect(
      shouldBypassHtmlCache({
        method: "GET",
        headers: { authorization: "Bearer secret" },
        originalUrl: "/en/x",
      }),
    ).toBe(true);
  });

  it("names why a fresh document is built", () => {
    expect(htmlRenderSkipReason({
      method: "GET",
      headers: emptyHeaders,
      originalUrl: "/en/blog/post?cache=false",
    })).toBe("cache_false");
    expect(htmlRenderSkipReason({
      method: "GET",
      headers: emptyHeaders,
      originalUrl: "/en/x?__site=example.com",
    })).toBe("other_site");
    expect(htmlRenderSkipReason({
      method: "GET",
      headers: { authorization: "Bearer secret" },
      originalUrl: "/en/x",
    })).toBe("authorization");
    expect(htmlRenderSkipReason({
      method: "POST",
      headers: emptyHeaders,
      originalUrl: "/en/x",
    })).toBe("not_read");
    expect(htmlRenderSkipReason({
      method: "GET",
      headers: emptyHeaders,
      originalUrl: "/en/x?edit=1",
    })).toBeNull();
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

describe("canonicalHtmlCachePath", () => {
  const ci = {
    resolveUrl(url: string) {
      if (url === "/es/ubicacion/berlin-germany" || url === "/es/ubicacion/berlin-alemania") {
        return { contentType: "location", slug: "berlin-germany", patternLocale: "es" };
      }
      if (url === "/es/blog/herramientas-ia/mcp-model-context-protocol") {
        return { contentType: "blog", slug: "mcp-model-context-protocol", patternLocale: "es" };
      }
      if (url === "/en/programs/ai-fluency") return null;
      return null;
    },
    getAlternateUrls(slug: string, contentType: string) {
      if (contentType === "location" && slug === "berlin-germany") {
        return { es: "/es/ubicacion/berlin-alemania", en: "/en/location/berlin-germany" };
      }
      if (contentType === "blog") {
        return { es: "/es/blog/herramientas-ia/que-es-y-como-funciona-el-model-context-protocol" };
      }
      return {};
    },
  };

  it("uses the locale slug url for the same entry", () => {
    expect(canonicalHtmlCachePath("/es/ubicacion/berlin-germany", ci)).toBe(
      "/es/ubicacion/berlin-alemania",
    );
    expect(canonicalHtmlCachePath("/es/ubicacion/berlin-alemania", ci)).toBe(
      "/es/ubicacion/berlin-alemania",
    );
    expect(canonicalHtmlCachePath("/es/blog/herramientas-ia/mcp-model-context-protocol", ci)).toBe(
      "/es/blog/herramientas-ia/que-es-y-como-funciona-el-model-context-protocol",
    );
  });

  it("leaves a path that does not resolve", () => {
    expect(canonicalHtmlCachePath("/en/programs/ai-fluency", ci)).toBe("/en/programs/ai-fluency");
    expect(canonicalHtmlCachePath("/en/home", undefined)).toBe("/en/home");
  });
});

describe("buildHtmlCacheKey", () => {
  beforeEach(() => {
    setHtmlBuildIdForTests("testbuild");
  });

  it("strips query from pathname and includes the build id", () => {
    expect(buildHtmlCacheKey("site", "/blog/post?cache=false")).toBe(
      "testbuild::site::/blog/post::live",
    );
  });
});

describe("query param cache", () => {
  it("misses only when the url fills a param the page uses", () => {
    const source = { title: "Cursos en {{ param.ciudad }}", plan: "ignored" };
    expect(collectParamPlaceholderNames(source)).toEqual(["ciudad"]);
    expect(requestBakesQueryParamTemplate("/en/cursos?ciudad=miami", source)).toBe(true);
    expect(requestBakesQueryParamTemplate("/en/cursos?utm_source=google", source)).toBe(false);
    expect(requestBakesQueryParamTemplate("/en/cursos?plan=pro", source)).toBe(false);
    expect(requestBakesQueryParamTemplate("/en/cursos?edit=1", source)).toBe(false);
  });
});

describe("html page store", () => {
  beforeEach(() => {
    setHtmlBuildIdForTests("testbuild");
    resetHtmlPageCacheForTests();
  });

  it("stores a page and refuses markup that looks per-visitor", () => {
    const key = buildHtmlCacheKey("site", "/en/home");
    setCachedHtml(key, "<html><body>Hello</body></html>", 200);
    expect(getCachedHtml(key)?.html).toContain("Hello");
    expect(htmlLooksPersonalized(`<html><meta name="csrf-token" content="abc">`)).toBe(true);
    setCachedHtml(key, `<html><body>4g_user_id=abc</body></html>`, 200);
    expect(getCachedHtml(key)?.html).toContain("Hello");
  });

  it("keeps a disk copy after the old 6 hour mark", () => {
    setHtmlBuildIdForTests("ttlbuild");
    let now = 1_700_000_000_000;
    setHtmlCacheClockForTests(() => now);
    const key = buildHtmlCacheKey("site", "/en/home");
    setCachedHtml(key, "<html><body>Still here</body></html>", 200);
    const dir = path.join(os.tmpdir(), `website-v3-html-cache-${process.pid}`, "ttlbuild");
    const file = path.join(dir, fs.readdirSync(dir)[0]!);
    const stored = JSON.parse(fs.readFileSync(file, "utf8")) as { expiresAt: number };
    stored.expiresAt = now - 1;
    fs.writeFileSync(file, JSON.stringify(stored));
    dropHtmlCacheMemoryForTests();
    now += 7 * 60 * 60 * 1000;
    expect(getCachedHtml(key)?.html).toContain("Still here");
    invalidateHtmlPageCache();
  });

  it("reads html from a disk copy that has no decoded string", () => {
    setHtmlBuildIdForTests("testbuild");
    const key = buildHtmlCacheKey("site", "/en/blog");
    setCachedHtml(key, "<html><body>From disk</body></html>", 200);
    resetHtmlPageCacheForTests();
    setHtmlBuildIdForTests("testbuild");
    expect(getCachedHtml(key)?.html).toContain("From disk");
    expect(getCachedHtml(key)?.html).toContain("From disk");
  });

  it("singleflight shares one in-flight render", async () => {
    let runs = 0;
    const key = "k";
    const [a, b] = await Promise.all([
      singleflight(key, async () => {
        runs += 1;
        await new Promise((r) => setTimeout(r, 20));
        return "page";
      }),
      singleflight(key, async () => {
        runs += 1;
        return "other";
      }),
    ]);
    expect(runs).toBe(1);
    expect(a).toBe("page");
    expect(b).toBe("page");
  });
});
