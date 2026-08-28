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

describe("mermaid blocks become geekchart figures", () => {
  it("replaces a ```mermaid block with an inline animated SVG and no blank lines", async () => {
    const md = "Intro\n\n```mermaid\nflowchart LR\n  A[Prompt] --> B[Model] --> C[Answer]\n```\n\nOutro";
    const html = await enhanceMarkdownToHtml(md);
    expect(html.startsWith(ARTICLE_HTML_MARKER)).toBe(true);
    expect(html).toContain('<figure class="geekchart">');
    expect(html).toContain("<svg");
    expect(html).not.toContain("language-mermaid");
    const figure = html.slice(html.indexOf("<figure"), html.indexOf("</figure>"));
    expect(figure).not.toMatch(/\n\s*\n/);
  });

  it("leaves an unparseable chart as a code block", async () => {
    const md = "```mermaid\nthis is not a diagram\n```";
    const html = await enhanceMarkdownToHtml(md);
    expect(html).not.toContain('<figure class="geekchart">');
    expect(html).toContain("<pre");
  });
});

describe("mermaid fence options", () => {
  it("passes speed=N from the fence line through to the chart", async () => {
    const md = "```mermaid speed=0.5\nflowchart LR\n  A[Prompt] --> B[Answer]\n```";
    const html = await enhanceMarkdownToHtml(md);
    expect(html).toContain('data-gc-speed="0.5"');
  });
});
