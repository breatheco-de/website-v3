import { describe, expect, it } from "vitest";
import { normalizeTags } from "./normalize-tags";

describe("normalizeTags", () => {
  it("returns empty for nullish and template placeholders", () => {
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags("{{ single.tags }}")).toEqual([]);
  });

  it("normalizes string arrays", () => {
    expect(normalizeTags([" ai ", "learning"])).toEqual(["ai", "learning"]);
  });

  it("splits comma and pipe separated strings", () => {
    expect(normalizeTags("ai, learning-science")).toEqual(["ai", "learning-science"]);
    expect(normalizeTags("ai | bootcamp")).toEqual(["ai", "bootcamp"]);
  });

  it("parses JSON array strings", () => {
    expect(normalizeTags('["ai","ml"]')).toEqual(["ai", "ml"]);
  });
});
