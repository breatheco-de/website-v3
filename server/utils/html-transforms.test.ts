import { describe, expect, it } from "vitest";
import {
  applyEntryModulePreload,
  __testShouldKeepModulePreload,
} from "./html-transforms";

describe("applyEntryModulePreload", () => {
  it("keeps entry + runtime modulepreloads and drops framer/admin/heavy deps", () => {
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
    expect(out).toContain('fetchpriority="low"');

    expect(out).not.toContain("framer-bbb");
    expect(out).not.toContain("charts-ccc");
    expect(out).not.toContain("carousel-ddd");
    expect(out).not.toContain("tanstack-eee");

    const preloadCount = (out.match(/rel="modulepreload"/g) ?? []).length;
    expect(preloadCount).toBeLessThanOrEqual(3);
  });

  it("adds a low-priority modulepreload for the entry script when missing", () => {
    const html =
      `<script type="module" crossorigin src="/assets/index-xyz.js"></script>`;
    const out = applyEntryModulePreload(html);
    expect(out).toMatch(
      /<link rel="modulepreload" crossorigin href="\/assets\/index-xyz\.js" fetchpriority="low">/,
    );
  });
});

describe("__testShouldKeepModulePreload", () => {
  it("allowlists entry/runtime and denylists framer", () => {
    expect(__testShouldKeepModulePreload("/assets/index-abc.js")).toBe(true);
    expect(__testShouldKeepModulePreload("/assets/rolldown-runtime-x.js")).toBe(true);
    expect(__testShouldKeepModulePreload("/assets/framer-x.js")).toBe(false);
    expect(__testShouldKeepModulePreload("/assets/lucide-x.js")).toBe(false);
  });
});
