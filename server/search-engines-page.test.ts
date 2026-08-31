import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { DebugSitemapUrl } from "./sitemap";
import {
  resetGscInspectionMemory,
  setGscCacheRootForTests,
  STALE_MS,
  upsertRecord,
} from "./gsc-url-inspection";
import { resetSettings } from "./settings";
import {
  buildBingEngineStatus,
  buildGoogleEngineStatus,
  buildSearchEnginesPagePayload,
  toAbsolutePublicUrl,
} from "./search-engines-page";

function url(partial: Partial<DebugSitemapUrl> & { loc: string }): DebugSitemapUrl {
  return {
    inSitemap: true,
    label: partial.loc,
    ...partial,
  };
}

describe("search-engines-page", () => {
  let tmp: string;
  let contentRoot: string;
  const rootName = "site_demo";
  const prevCreds = process.env.GSC_CREDENTIALS_JSON;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "search-engines-"));
    setGscCacheRootForTests(tmp);
    resetGscInspectionMemory();
    contentRoot = path.join(tmp, "content");
    fs.mkdirSync(contentRoot, { recursive: true });
    fs.writeFileSync(
      path.join(contentRoot, "settings.yml"),
      "search_console:\n  site_url: https://example.com/\n",
      "utf-8",
    );
    resetSettings(contentRoot);
    process.env.GSC_CREDENTIALS_JSON = JSON.stringify({
      client_email: "sa@example.com",
      private_key: "x",
    });
  });

  afterEach(() => {
    setGscCacheRootForTests(null);
    if (prevCreds === undefined) delete process.env.GSC_CREDENTIALS_JSON;
    else process.env.GSC_CREDENTIALS_JSON = prevCreds;
    resetSettings(contentRoot);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("toAbsolutePublicUrl builds https host + path", () => {
    expect(toAbsolutePublicUrl("/en/blog/foo", "example.com")).toBe("https://example.com/en/blog/foo");
    expect(toAbsolutePublicUrl("https://example.com/en/x", "example.com")).toBe("https://example.com/en/x");
    expect(toAbsolutePublicUrl("/x", "localhost")).toBeNull();
  });

  it("buildBingEngineStatus is always not_configured", () => {
    const bing = buildBingEngineStatus();
    expect(bing).toEqual({
      configured: false,
      status: "not_configured",
      detail: "Bing Webmaster is not configured on this site yet.",
      record: null,
    });
  });

  it("maps PASS record to indexed", () => {
    const loc = "https://example.com/en/blog/foo";
    upsertRecord(rootName, loc, {
      inspectedAt: new Date().toISOString(),
      verdict: "PASS",
      googleCanonical: loc,
      userCanonical: loc,
    });
    const google = buildGoogleEngineStatus({
      contentRoot,
      contentRootName: rootName,
      domain: "example.com",
      requestedUrl: loc,
      debugUrls: [url({ loc, content_type: "blog", slug: "foo", locale: "en" })],
    });
    expect(google.status).toBe("indexed");
    expect(google.configured).toBe(true);
    expect(google.canonical_mismatch).toBe(false);
    expect(google.stale).toBe(false);
    expect(google.record?.verdict).toBe("PASS");
  });

  it("maps FAIL to not_indexed and never_checked when missing", () => {
    const loc = "https://example.com/en/blog/bar";
    upsertRecord(rootName, loc, { inspectedAt: new Date().toISOString(), verdict: "FAIL" });
    expect(
      buildGoogleEngineStatus({
        contentRoot,
        contentRootName: rootName,
        domain: "example.com",
        requestedUrl: loc,
        debugUrls: [url({ loc })],
      }).status,
    ).toBe("not_indexed");

    expect(
      buildGoogleEngineStatus({
        contentRoot,
        contentRootName: rootName,
        domain: "example.com",
        requestedUrl: "https://example.com/en/missing",
        debugUrls: [url({ loc: "https://example.com/en/missing" })],
      }).status,
    ).toBe("never_checked");
  });

  it("falls back to absolute URL cache key when sitemap resolve misses", () => {
    const loc = "https://example.com/en/orphan";
    upsertRecord(rootName, loc, {
      inspectedAt: new Date().toISOString(),
      verdict: "PASS",
    });
    const google = buildGoogleEngineStatus({
      contentRoot,
      contentRootName: rootName,
      domain: "example.com",
      requestedUrl: "/en/orphan",
      debugUrls: [],
    });
    expect(google.status).toBe("indexed");
    expect(google.resolved.loc).toBe(loc);
  });

  it("marks stale when inspectedAt older than STALE_MS", () => {
    const loc = "https://example.com/en/old";
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    upsertRecord(rootName, loc, {
      inspectedAt: new Date(now - STALE_MS - 1000).toISOString(),
      verdict: "PASS",
    });
    const google = buildGoogleEngineStatus({
      contentRoot,
      contentRootName: rootName,
      domain: "example.com",
      requestedUrl: loc,
      debugUrls: [url({ loc })],
      now,
    });
    expect(google.stale).toBe(true);
    expect(google.status).toBe("indexed");
  });

  it("sets canonical_mismatch when canonicals differ", () => {
    const loc = "https://example.com/en/canon";
    upsertRecord(rootName, loc, {
      inspectedAt: new Date().toISOString(),
      verdict: "PASS",
      googleCanonical: "https://example.com/en/other",
      userCanonical: loc,
    });
    const google = buildGoogleEngineStatus({
      contentRoot,
      contentRootName: rootName,
      domain: "example.com",
      requestedUrl: loc,
      debugUrls: [url({ loc })],
    });
    expect(google.canonical_mismatch).toBe(true);
  });

  it("buildSearchEnginesPagePayload includes google + bing and bing warning", () => {
    const folder = "site_demo_payload";
    const siteRoot = path.join(tmp, folder);
    fs.mkdirSync(siteRoot, { recursive: true });
    fs.writeFileSync(
      path.join(siteRoot, "settings.yml"),
      "search_console:\n  site_url: https://example.com/\n",
      "utf-8",
    );
    fs.writeFileSync(path.join(siteRoot, "content-types.yml"), "page:\n  directory: pages\n", "utf-8");
    resetSettings(siteRoot);

    const payload = buildSearchEnginesPagePayload({
      contentRoot: siteRoot,
      contentFolder: folder,
      domain: "example.com",
      requestedUrl: "https://example.com/en/home",
    });

    expect(payload.search_engines.google).toBeDefined();
    expect(payload.search_engines.bing.status).toBe("not_configured");
    expect(payload.warnings.some((w) => w.code === "bing_not_configured")).toBe(true);
  });
});
