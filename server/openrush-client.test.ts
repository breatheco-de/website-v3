import { describe, expect, it } from "vitest";
import { parseInspectKeywordData } from "./openrush-client";

describe("parseInspectKeywordData", () => {
  it("maps monthly_volume and numeric competition_level", () => {
    const parsed = parseInspectKeywordData(
      {
        keyword: "ai engineer salary",
        monthly_volume: 2400,
        competition_level: 0.42,
      },
      "fallback",
    );
    expect(parsed.keyword).toBe("ai engineer salary");
    expect(parsed.monthly_volume).toBe(2400);
    expect(parsed.kw_difficulty).toBe(42);
  });

  it("maps string competition labels to difficulty buckets", () => {
    const parsed = parseInspectKeywordData(
      { monthly_volume: 100, competition_level: "high" },
      "seed kw",
    );
    expect(parsed.keyword).toBe("seed kw");
    expect(parsed.monthly_volume).toBe(100);
    expect(parsed.kw_difficulty).toBe(80);
  });

  it("returns null metrics when OpenRush omits volume and difficulty", () => {
    const parsed = parseInspectKeywordData({ keyword: "x" }, "x");
    expect(parsed.monthly_volume).toBeNull();
    expect(parsed.kw_difficulty).toBeNull();
  });
});
