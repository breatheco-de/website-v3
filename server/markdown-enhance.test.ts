import { describe, expect, it } from "vitest";
import {
  ARTICLE_HTML_MARKER,
  enhanceMarkdownToHtml,
  clearMarkdownEnhanceCache,
} from "./markdown-enhance";

describe("enhanceMarkdownToHtml math", () => {
  it("renders inline paren math as katex HTML", async () => {
    clearMarkdownEnhanceCache();
    const html = await enhanceMarkdownToHtml("Rate \\(R(t) = I \\times e^{-t/S}\\) decays.");
    expect(html.startsWith(ARTICLE_HTML_MARKER)).toBe(true);
    expect(html).toContain("katex");
    expect(html).not.toContain("\\(R(t)");
    // No MathML / TeX-annotation leak into visible copy
    expect(html).not.toContain("katex-mathml");
    expect(html).not.toContain("application/x-tex");
  });

  it("renders display paren math", async () => {
    clearMarkdownEnhanceCache();
    const html = await enhanceMarkdownToHtml("Intro\n\n\\[\nE = mc^2\n\\]\n\nOutro");
    expect(html).toContain("katex");
    expect(html).toMatch(/katex-display|display/);
  });

  it("does not treat currency dollars as math", async () => {
    clearMarkdownEnhanceCache();
    const html = await enhanceMarkdownToHtml("Plans from $99/mo up to $500.");
    expect(html).toContain("$99");
    expect(html).not.toContain("katex");
  });

  it("leaves fenced code math delimiters alone", async () => {
    clearMarkdownEnhanceCache();
    const md = "Before\n\n```js\nconst s = '\\\\(x\\\\)';\n```\n\nAfter \\(y\\)";
    const html = await enhanceMarkdownToHtml(md);
    expect(html).toContain("katex"); // from \(y\)
    // Code fence is highlighted; ensure we did not strip the fence into a second katex for x
    expect(html).toContain("data-language=\"js\"");
    expect((html.match(/class="katex"/g) ?? []).length).toBe(1);
  });

  it("does not throw on invalid TeX", async () => {
    clearMarkdownEnhanceCache();
    const html = await enhanceMarkdownToHtml("Bad \\(\\frac{a\\) here.");
    expect(html.startsWith(ARTICLE_HTML_MARKER)).toBe(true);
  });
});
