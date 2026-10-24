import { describe, expect, it } from "vitest";
import {
  findShortKeyConflicts,
  isValidShortKey,
  listMissingShortKeys,
  parseRetiredShortKeys,
  suggestShortKey,
  takenShortKeys,
  type TrackingKeyProduct,
} from "./tracking-keys";

const product = (over: Partial<TrackingKeyProduct> = {}): TrackingKeyProduct => ({
  slug: "ai-engineering",
  content_type: "program",
  product_id: "program-ai-engineering",
  name: "AI Engineering",
  active: true,
  personas: [],
  retired: [],
  ...over,
});

describe("isValidShortKey", () => {
  it("accepts 2-6 lowercase letters/digits and rejects reserved words", () => {
    expect(isValidShortKey("aie")).toBe(true);
    expect(isValidShortKey("a1")).toBe(true);
    expect(isValidShortKey("a")).toBe(false);
    expect(isValidShortKey("abcdefg")).toBe(false);
    expect(isValidShortKey("AIE")).toBe(false);
    expect(isValidShortKey("a-b")).toBe(false);
    expect(isValidShortKey("all")).toBe(false);
    expect(isValidShortKey("none")).toBe(false);
  });
});

describe("suggestShortKey", () => {
  it("keeps acronyms and takes initials", () => {
    expect(suggestShortKey("AI Engineering", new Set())).toBe("aie");
    expect(suggestShortKey("The Career Changer", new Set())).toBe("cc");
  });

  it("extends with the last word when taken", () => {
    expect(suggestShortKey("AI Fluency", new Set(["aif"]))).toBe("aifl");
  });

  it("falls back to numbers and never returns a reserved or taken key", () => {
    const taken = new Set(["al", "al2"]);
    const k = suggestShortKey("A L", taken);
    expect(isValidShortKey(k)).toBe(true);
    expect(taken.has(k)).toBe(false);
  });

  it("uses the id when the name is empty", () => {
    expect(suggestShortKey("", new Set(), "the-migrant")).toBe("mig");
  });

  it("caps long names at 6 characters", () => {
    const k = suggestShortKey("The Professional Adding AI to Their Career Path Today", new Set());
    expect(k.length).toBeLessThanOrEqual(6);
    expect(isValidShortKey(k)).toBe(true);
  });
});

describe("conflicts and missing keys", () => {
  it("flags duplicate persona keys across products and reuse of retired keys", () => {
    const products = [
      product({ key: "aie", personas: [{ id: "dev", name: "Dev", key: "dev" }] }),
      product({
        slug: "ai-flex",
        product_id: "program-ai-flex",
        name: "AI Flex",
        key: "afx",
        personas: [{ id: "dev", name: "Dev", key: "dev" }],
        retired: [{ key: "aie", type: "product", id: "old", retired_at: "" }],
      }),
    ];
    const conflicts = findShortKeyConflicts(products);
    expect(conflicts.map((c) => `${c.type}:${c.key}`).sort()).toEqual(["persona:dev", "product:aie"]);
  });

  it("allows the same key for a product and a persona", () => {
    const products = [product({ key: "cc", personas: [{ id: "cc", name: "CC", key: "cc" }] })];
    expect(findShortKeyConflicts(products)).toEqual([]);
  });

  it("lists missing keys for active products only", () => {
    const products = [
      product({ personas: [{ id: "a", name: "A", key: "aa" }, { id: "b", name: "B" }] }),
      product({ slug: "old", active: false, personas: [{ id: "c", name: "C" }] }),
    ];
    expect(listMissingShortKeys(products)).toEqual([
      { type: "product", product: "ai-engineering", name: "AI Engineering" },
      { type: "persona", product: "ai-engineering", persona: "b", name: "B" },
    ]);
  });

  it("counts retired keys as taken", () => {
    const products = [product({ retired: [{ key: "xx", type: "persona", id: "p", retired_at: "" }] })];
    expect(takenShortKeys(products, "persona").has("xx")).toBe(true);
    expect(takenShortKeys(products, "product").has("xx")).toBe(false);
  });

  it("parses retired keys and drops malformed rows", () => {
    expect(
      parseRetiredShortKeys([{ key: "AB", type: "persona", id: "p" }, { key: "x" }, "bad"]),
    ).toEqual([{ key: "ab", type: "persona", id: "p", retired_at: "" }]);
  });
});
