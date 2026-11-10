import { describe, expect, it } from "vitest";
import { evaluateRenderGate, pathnameFromSitemapLoc, renderGateLogLines } from "./prebuild-html-cache";

describe("pathnameFromSitemapLoc", () => {
  it("keeps a public path from an absolute sitemap url", () => {
    expect(pathnameFromSitemapLoc("https://4geeks.com/en/blog/ai-tools/how-to")).toBe(
      "/en/blog/ai-tools/how-to",
    );
  });

  it("drops query strings and private previews", () => {
    expect(pathnameFromSitemapLoc("https://4geeks.com/en/pricing?plan=ai")).toBeNull();
    expect(pathnameFromSitemapLoc("https://4geeks.com/private/preview/page/home?locale=en")).toBeNull();
  });
});

describe("evaluateRenderGate", () => {
  it("passes when every type is at or under 10% empty", () => {
    expect(evaluateRenderGate({ landing: { total: 115, empty: 3 }, blog: { total: 10, empty: 1 } }).failed).toBe(false);
  });

  it("fails a type over 10% empty, like the landing bug (all empty)", () => {
    const result = evaluateRenderGate({ landing: { total: 115, empty: 115 }, blog: { total: 40, empty: 0 } });
    expect(result.failed).toBe(true);
    expect(result.failing).toEqual([{ type: "landing", total: 115, empty: 115, share: 1 }]);
  });

  it("never fails a type with fewer than 5 pages", () => {
    expect(evaluateRenderGate({ workshop: { total: 4, empty: 4 } }).failed).toBe(false);
  });

  it("only counts what it is given (404s and other non-200 pages are not passed in)", () => {
    expect(evaluateRenderGate({}).failed).toBe(false);
  });
});

describe("renderGateLogLines", () => {
  it("prints per-type counts, empty pages and the outcome", () => {
    const counts = { landing: { total: 10, empty: 5 } };
    const lines = renderGateLogLines(counts, evaluateRenderGate(counts), ["/landing/a"], false);
    expect(lines).toEqual([
      "RENDER_GATE type=landing total=10 empty=5",
      "RENDER_GATE_EMPTY path=/landing/a",
      'RENDER_GATE result=failed failing="landing 50% (5/10)"',
    ]);
  });

  it("marks an override", () => {
    const counts = { landing: { total: 10, empty: 5 } };
    expect(renderGateLogLines(counts, evaluateRenderGate(counts), [], true).at(-1)).toMatch(/result=skipped_by_override/);
  });
});
