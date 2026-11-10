import { describe, expect, it } from "vitest";
import {
  applyEntryModulePreload,
  __testShouldKeepModulePreload,
} from "./html-transforms";

describe("applyEntryModulePreload", () => {
  it("keeps the entry static graph modulepreloads (incl. hydrate deps) without fetchpriority=low", () => {
    const html = `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="/assets/index-abc.css">
<link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-aaa.js">
<link rel="modulepreload" crossorigin href="/assets/framer-bbb.js">
<link rel="modulepreload" crossorigin href="/assets/carousel-ddd.js">
<link rel="modulepreload" crossorigin href="/assets/tanstack-eee.js">
<link rel="modulepreload" crossorigin href="/assets/lucide-ggg.js">
<link rel="modulepreload" crossorigin href="/assets/index-fff.js">
<script type="module" crossorigin src="/assets/index-fff.js"></script>
</head><body></body></html>`;

    const out = applyEntryModulePreload(html);

    expect(out).toContain('href="/assets/rolldown-runtime-aaa.js"');
    expect(out).toContain('href="/assets/index-fff.js"');
    expect(out).toContain('href="/assets/framer-bbb.js"');
    expect(out).toContain('href="/assets/carousel-ddd.js"');
    expect(out).toContain('href="/assets/tanstack-eee.js"');
    expect(out).toContain('href="/assets/lucide-ggg.js"');
    expect(out).not.toContain('fetchpriority="low"');

    const preloadCount = (out.match(/rel="modulepreload"/g) ?? []).length;
    expect(preloadCount).toBe(6);
  });

  it("adds a modulepreload for the entry script when missing", () => {
    const html =
      `<script type="module" crossorigin src="/assets/index-xyz.js"></script>`;
    const out = applyEntryModulePreload(html);
    expect(out).toMatch(
      /<link rel="modulepreload" crossorigin href="\/assets\/index-xyz\.js">/,
    );
    expect(out).not.toContain('fetchpriority="low"');
  });

  it("dedupes repeated modulepreload hrefs", () => {
    const html = `
<link rel="modulepreload" crossorigin href="/assets/index-fff.js">
<link rel="modulepreload" crossorigin href="/assets/index-fff.js" fetchpriority="low">
<script type="module" crossorigin src="/assets/index-fff.js"></script>`;
    const out = applyEntryModulePreload(html);
    expect((out.match(/href="\/assets\/index-fff\.js"/g) ?? []).length).toBe(1);
  });
});

describe("__testShouldKeepModulePreload", () => {
  it("keeps asset JS modulepreloads used by the entry graph", () => {
    expect(__testShouldKeepModulePreload("/assets/index-abc.js")).toBe(true);
    expect(__testShouldKeepModulePreload("/assets/rolldown-runtime-x.js")).toBe(true);
    expect(__testShouldKeepModulePreload("/assets/framer-x.js")).toBe(true);
    expect(__testShouldKeepModulePreload("/assets/lucide-x.js")).toBe(true);
    expect(__testShouldKeepModulePreload("/not-assets/foo.js")).toBe(false);
  });
});
