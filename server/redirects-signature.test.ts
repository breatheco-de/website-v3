import { describe, expect, it } from "vitest";
import { computeRedirectsSignature, didRedirectsChange } from "./redirects";

describe("computeRedirectsSignature", () => {
  it("returns empty when no redirects key", () => {
    expect(
      computeRedirectsSignature(`title: Hello\nmeta:\n  page_title: Hi\n`),
    ).toBe("");
  });

  it("hashes meta.redirects stably", () => {
    const a = computeRedirectsSignature(`meta:\n  redirects:\n    - /old\n    - /us/old\n`);
    const b = computeRedirectsSignature(`meta:\n  redirects:\n    - /old\n    - /us/old\n`);
    const c = computeRedirectsSignature(`meta:\n  redirects:\n    - /old\n`);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.length).toBeGreaterThan(0);
  });

  it("survives template expressions in other fields", () => {
    const sig = computeRedirectsSignature(
      `meta:\n  page_title: {{ single.title }}\n  redirects:\n    - /legacy\n`,
    );
    expect(sig).toContain("/legacy");
  });
});

describe("didRedirectsChange", () => {
  const withRedirects = `meta:\n  redirects:\n    - /a\n`;
  const withOtherRedirects = `meta:\n  redirects:\n    - /b\n`;
  const noRedirects = `title: x\n`;

  it("seeds without emitting on first observation", () => {
    expect(didRedirectsChange(undefined, withRedirects)).toBe(false);
  });

  it("detects real redirect list changes", () => {
    expect(didRedirectsChange(withRedirects, withOtherRedirects)).toBe(true);
  });

  it("ignores non-redirect content changes", () => {
    const before = `title: A\nmeta:\n  redirects:\n    - /a\n`;
    const after = `title: B\nmeta:\n  redirects:\n    - /a\n`;
    expect(didRedirectsChange(before, after)).toBe(false);
  });

  it("treats custom-redirects.yml as whole-file change", () => {
    expect(
      didRedirectsChange("a: 1\n", "a: 2\n", { isCustomRedirectsFile: true }),
    ).toBe(true);
    expect(
      didRedirectsChange("a: 1\n", "a: 1\n", { isCustomRedirectsFile: true }),
    ).toBe(false);
  });

  it("detects adding redirects where none existed", () => {
    expect(didRedirectsChange(noRedirects, withRedirects)).toBe(true);
  });
});
