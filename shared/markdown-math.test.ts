import { describe, expect, it } from "vitest";
import { normalizeMathDelimiters } from "./markdown-math";

describe("normalizeMathDelimiters", () => {
  it("converts inline paren math to $$", () => {
    expect(normalizeMathDelimiters("See \\(E = mc^2\\) here.")).toBe(
      "See $$E = mc^2$$ here.",
    );
  });

  it("converts display paren math to $$ blocks", () => {
    const input = "Before\n\\[\nR(t) = I\n\\]\nAfter";
    const out = normalizeMathDelimiters(input);
    expect(out).toContain("$$\nR(t) = I\n$$");
    expect(out.startsWith("Before")).toBe(true);
    expect(out.endsWith("After")).toBe(true);
  });

  it("leaves currency dollars alone", () => {
    const s = "Pricing from $99/mo and $50–$150 per link.";
    expect(normalizeMathDelimiters(s)).toBe(s);
  });

  it("skips fenced code blocks", () => {
    const input = "Prose \\(a\\)\n```\nconst x = '\\(y\\)';\n```\nMore \\(b\\)";
    const out = normalizeMathDelimiters(input);
    expect(out).toContain("$$a$$");
    expect(out).toContain("$$b$$");
    expect(out).toContain("const x = '\\(y\\)';");
  });

  it("skips inline code", () => {
    expect(normalizeMathDelimiters("Use `\\(x\\)` literally and \\(y\\) math.")).toBe(
      "Use `\\(x\\)` literally and $$y$$ math.",
    );
  });

  it("returns unchanged when no paren delimiters", () => {
    expect(normalizeMathDelimiters("plain text")).toBe("plain text");
  });
});
