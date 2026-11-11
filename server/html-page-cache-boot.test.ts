import zlib from "zlib";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildHtmlCacheKey,
  getBootedHtmlBody,
  getCachedHtml,
  htmlPageCacheBytes,
  resetHtmlPageCacheForTests,
  setCachedHtml,
  setHtmlCacheBudgetForTests,
  type PageBootInjection,
} from "./html-page-cache";

const HTML = `<html><head><script>window.__4G_PAGE__ = {"af":0,"cm":null,"fp":0,"t":""};</script></head><body>${"x".repeat(2000)}</body></html>`;

function boot(cm: string, token = "t1"): PageBootInjection & { calls: number } {
  const b = {
    key: `1|${cm}|1|${token}`,
    token,
    calls: 0,
    inject(html: string) {
      b.calls += 1;
      return html.replace(/window\.__4G_PAGE__ = \{[^<]*?\};/, `window.__4G_PAGE__ = {"cm":"${cm}","t":"${token}"};`);
    },
  };
  return b;
}

describe("getBootedHtmlBody", () => {
  beforeEach(() => resetHtmlPageCacheForTests());

  it("injects and compresses once, then reuses the stored body", () => {
    const key = buildHtmlCacheKey("site", "/en/a");
    setCachedHtml(key, HTML, 200);
    const b = boot("notice");
    const first = getBootedHtmlBody(key, b, "br")!;
    const second = getBootedHtmlBody(key, b, "br")!;
    expect(b.calls).toBe(1);
    expect(second).toBe(first);
    expect(zlib.brotliDecompressSync(first).toString("utf8")).toContain(`{"cm":"notice","t":"t1"}`);
    const gzip = getBootedHtmlBody(key, b, "gzip")!;
    expect(zlib.gunzipSync(gzip).toString("utf8")).toContain(`{"cm":"notice","t":"t1"}`);
    expect(getBootedHtmlBody(key, b, "gzip")).toBe(gzip);
    expect(b.calls).toBe(2);
  });

  it("stores only the encoding that was asked for", () => {
    const key = buildHtmlCacheKey("site", "/en/a");
    setCachedHtml(key, HTML, 200);
    const base = htmlPageCacheBytes();
    const br = getBootedHtmlBody(key, boot("ask"), "br")!;
    expect(htmlPageCacheBytes() - base).toBe(br.length);
  });

  it("keeps a separate body per consent mode", () => {
    const key = buildHtmlCacheKey("site", "/en/a");
    setCachedHtml(key, HTML, 200);
    const ask = zlib.brotliDecompressSync(getBootedHtmlBody(key, boot("ask"), "br")!).toString("utf8");
    const notice = zlib.brotliDecompressSync(getBootedHtmlBody(key, boot("notice"), "br")!).toString("utf8");
    expect(ask).toContain(`"cm":"ask"`);
    expect(notice).toContain(`"cm":"notice"`);
  });

  it("counts boot bodies in the budget and frees them when the token changes", () => {
    const key = buildHtmlCacheKey("site", "/en/a");
    setCachedHtml(key, HTML, 200);
    const base = htmlPageCacheBytes();
    getBootedHtmlBody(key, boot("ask"), "br");
    getBootedHtmlBody(key, boot("notice"), "br");
    const withTwo = htmlPageCacheBytes();
    expect(withTwo).toBeGreaterThan(base);
    getBootedHtmlBody(key, boot("ask", "t2"), "br");
    const afterRollover = htmlPageCacheBytes();
    expect(afterRollover).toBeLessThan(withTwo);
    expect(afterRollover - base).toBeGreaterThan(0);
  });

  it("frees boot copies before deleting any page", () => {
    const older = buildHtmlCacheKey("site", "/en/older");
    const newer = buildHtmlCacheKey("site", "/en/newer");
    setCachedHtml(older, HTML, 200);
    setCachedHtml(newer, HTML, 200);
    getBootedHtmlBody(older, boot("ask"), "br");
    const pagesOnly = htmlPageCacheBytes() - getBootedHtmlBody(older, boot("ask"), "br")!.length;
    setHtmlCacheBudgetForTests(pagesOnly + 10);
    const body = getBootedHtmlBody(newer, boot("ask"), "br")!;
    expect(zlib.brotliDecompressSync(body).toString("utf8")).toContain(`"cm":"ask"`);
    expect(htmlPageCacheBytes()).toBeLessThanOrEqual(pagesOnly + 10);
    expect(getCachedHtml(older)).not.toBeNull();
    expect(getCachedHtml(newer)).not.toBeNull();
  });

  it("still deletes older pages when freeing boot copies is not enough", () => {
    const older = buildHtmlCacheKey("site", "/en/older");
    const newer = buildHtmlCacheKey("site", "/en/newer");
    setCachedHtml(older, HTML, 200);
    setCachedHtml(newer, HTML, 200);
    const budget = htmlPageCacheBytes() - 1;
    setHtmlCacheBudgetForTests(budget);
    const body = getBootedHtmlBody(newer, boot("ask"), "br")!;
    expect(zlib.brotliDecompressSync(body).toString("utf8")).toContain(`"cm":"ask"`);
    expect(htmlPageCacheBytes()).toBeLessThanOrEqual(budget);
    expect(getCachedHtml(older)).toBeNull();
    expect(getCachedHtml(newer)).not.toBeNull();
  });

  it("drops boot bodies when the page is rebuilt", () => {
    const key = buildHtmlCacheKey("site", "/en/a");
    const rebuilt = HTML.replace("x", "y");
    setCachedHtml(key, rebuilt, 200);
    const rebuiltBytes = htmlPageCacheBytes();
    setCachedHtml(key, HTML, 200);
    getBootedHtmlBody(key, boot("ask"), "br");
    setCachedHtml(key, rebuilt, 200);
    expect(htmlPageCacheBytes()).toBe(rebuiltBytes);
    const b = boot("ask");
    const body = zlib.brotliDecompressSync(getBootedHtmlBody(key, b, "br")!).toString("utf8");
    expect(b.calls).toBe(1);
    expect(body).toContain("<body>y");
  });

  it("returns null when the page is not in memory", () => {
    expect(getBootedHtmlBody(buildHtmlCacheKey("site", "/en/missing"), boot("ask"), "br")).toBeNull();
  });
});
