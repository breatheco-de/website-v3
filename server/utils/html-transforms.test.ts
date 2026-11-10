import { describe, expect, it } from "vitest";
import {
  applyEntryModulePreload,
  prioritizeRenderBlockingCss,
  __testShouldKeepModulePreload,
} from "./html-transforms";
import { THEME_OVERRIDES_STYLE_ID } from "@shared/theme-palette";

describe("applyEntryModulePreload", () => {
  it("keeps the entry static graph without fetchpriority=low", () => {
    const html = `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="/assets/index-abc.css">
<link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-aaa.js">
<link rel="modulepreload" crossorigin href="/assets/framer-bbb.js">
<link rel="modulepreload" crossorigin href="/assets/charts-ccc.js">
<link rel="modulepreload" crossorigin href="/assets/carousel-ddd.js">
<link rel="modulepreload" crossorigin href="/assets/tanstack-eee.js">
<link rel="modulepreload" crossorigin href="/assets/index-fff.js">
<script type="module" crossorigin src="/assets/index-fff.js"></script>
</head><body></body></html>`;

    const out = applyEntryModulePreload(html);

    expect(out).toContain('href="/assets/rolldown-runtime-aaa.js"');
    expect(out).toContain('href="/assets/index-fff.js"');
    expect(out).toContain("framer-bbb");
    expect(out).toContain("charts-ccc");
    expect(out).toContain("carousel-ddd");
    expect(out).toContain("tanstack-eee");
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
});

describe("prioritizeRenderBlockingCss", () => {
  it("moves stylesheet and theme style ahead of modulepreloads", () => {
    const html = `<!DOCTYPE html><html><head>
<meta charset="UTF-8" />
<script type="module" crossorigin src="/assets/index-fff.js"></script>
<link rel="modulepreload" crossorigin href="/assets/framer-bbb.js">
<link rel="stylesheet" href="/assets/index-abc.css">
<style id="${THEME_OVERRIDES_STYLE_ID}">:root{--background:0 0% 100%}</style>
</head><body></body></html>`;

    const out = prioritizeRenderBlockingCss(html);
    const headInner = out.slice(
      out.indexOf("<head>") + "<head>".length,
      out.indexOf("</head>"),
    );

    const criticalIdx = headInner.indexOf('id="critical-paint"');
    const themeIdx = headInner.indexOf(THEME_OVERRIDES_STYLE_ID);
    const cssIdx = headInner.indexOf("/assets/index-abc.css");
    const scriptIdx = headInner.indexOf('type="module"');
    const preloadIdx = headInner.indexOf("modulepreload");

    expect(criticalIdx).toBeGreaterThanOrEqual(0);
    expect(themeIdx).toBeGreaterThan(criticalIdx);
    expect(cssIdx).toBeGreaterThan(criticalIdx);
    expect(cssIdx).toBeLessThan(scriptIdx);
    expect(themeIdx).toBeLessThan(scriptIdx);
    expect(preloadIdx).toBeGreaterThan(cssIdx);
  });
});

describe("__testShouldKeepModulePreload", () => {
  it("keeps entry/runtime and other asset JS (full hydrate graph)", () => {
    expect(__testShouldKeepModulePreload("/assets/index-abc.js")).toBe(true);
    expect(__testShouldKeepModulePreload("/assets/rolldown-runtime-x.js")).toBe(true);
    expect(__testShouldKeepModulePreload("/assets/framer-x.js")).toBe(true);
    expect(__testShouldKeepModulePreload("/assets/lucide-x.js")).toBe(true);
    expect(__testShouldKeepModulePreload("/assets/index-abc.css")).toBe(false);
  });
});
