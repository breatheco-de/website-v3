/**
 * Server-render smoke test for ads-optimized pages. Renders every fixture page of
 * `landing` and of each ads-optimized content type in the CI content fixture with the
 * real entry-server, and fails on an empty body (the client-only fallback).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContentIndex } from "./content-index";
import { getAdsOptimizedTypes, resetRegistry } from "./content-types";
import { databaseManager } from "./database";
import { resolveInitialData } from "./initial-data-middleware";
import { assembleSsrDocument, isMeaningfulSsrAppHtml } from "./utils/ssr-html";

const FIXTURE_SOURCE = path.resolve(import.meta.dirname, "..", "fixtures", "ci", "content-4geeks-com");
const SHELL = '<!DOCTYPE html><html lang="en"><head><title>Default</title></head><body><div id="root"></div></body></html>';

// The scan writes shared-template stubs into content folders; keep the committed fixture clean.
let FIXTURE_ROOT: string;
let ci: ContentIndex;

beforeAll(() => {
  FIXTURE_ROOT = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ssr-smoke-")), "content-4geeks-com");
  fs.cpSync(FIXTURE_SOURCE, FIXTURE_ROOT, { recursive: true });
  resetRegistry();
  ci = new ContentIndex(FIXTURE_ROOT);
  ci.scanFast();
  ci.scanSlow();
});

afterAll(() => {
  resetRegistry();
  fs.rmSync(path.dirname(FIXTURE_ROOT), { recursive: true, force: true });
});

function smokeTypes(): string[] {
  return [...new Set(["landing", ...getAdsOptimizedTypes(FIXTURE_ROOT)])];
}

function publicUrls(type: string): Array<{ url: string; locale: string; title: string }> {
  const out: Array<{ url: string; locale: string; title: string }> = [];
  for (const entry of ci.findByType(type)) {
    const urls = ci.getLocaleUrls(entry.slug, entry.contentType) ?? {};
    for (const [locale, url] of Object.entries(urls)) {
      if (typeof url !== "string" || !url.startsWith("/")) continue;
      const merged = ci.loadMergedContent(entry.contentType, entry.slug, locale).data as
        | { meta?: { page_title?: string } }
        | null;
      out.push({ url, locale, title: merged?.meta?.page_title ?? "" });
    }
  }
  return out;
}

describe("SSR smoke: ads-optimized pages render on the server", () => {
  it("has at least one fixture page for landing and every ads-optimized type", () => {
    for (const type of smokeTypes()) {
      expect(publicUrls(type), `add a fixture entry for ads-optimized type ${type} under fixtures/ci`).not.toHaveLength(0);
    }
  });

  it("renders a non-empty body with the page's language and title", async () => {
    const { render } = await import("../client/src/entry-server");
    let checked = 0;
    for (const type of smokeTypes()) {
      for (const page of publicUrls(type)) {
        const payload = await resolveInitialData(page.url, ci, databaseManager);
        expect(payload, `${page.url}: no page data`).not.toBeNull();
        const appHtml = await render(page.url, payload);
        expect(isMeaningfulSsrAppHtml(appHtml), `${page.url} rendered an empty body`).toBe(true);
        const html = assembleSsrDocument({ template: SHELL, appHtml, payload, url: page.url, contentRoot: FIXTURE_ROOT });
        expect(html).toMatch(new RegExp(`<html[^>]*lang="${page.locale}"`));
        if (page.title) expect(html).toContain(`<title>${page.title}</title>`);
        expect(html).not.toContain('<div id="root"></div>');
        checked += 1;
      }
    }
    expect(checked, "the smoke test checked no pages").toBeGreaterThan(0);
  }, 60_000);
});
