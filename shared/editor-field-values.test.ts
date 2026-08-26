import { describe, expect, it } from "vitest";
import {
  coerceEditorSelectScalar,
  collectEditorFieldTokens,
  expandEditorFieldTokens,
  itemHasEditorFieldToken,
} from "./editor-field-values";

describe("coerceEditorSelectScalar", () => {
  it("returns trimmed strings", () => {
    expect(coerceEditorSelectScalar("  ai  ")).toBe("ai");
  });

  it("extracts slug from leftover { slug } objects", () => {
    expect(coerceEditorSelectScalar({ slug: "trends-and-tech" })).toBe("trends-and-tech");
  });

  it("returns empty for unsupported shapes", () => {
    expect(coerceEditorSelectScalar(null)).toBe("");
    expect(coerceEditorSelectScalar({ name: "x" })).toBe("");
    expect(coerceEditorSelectScalar([])).toBe("");
  });
});

describe("expandEditorFieldTokens", () => {
  it("expands string and slug objects", () => {
    expect(expandEditorFieldTokens("a")).toEqual(["a"]);
    expect(expandEditorFieldTokens({ slug: "b" })).toEqual(["b"]);
  });

  it("expands arrays of strings and slug objects", () => {
    expect(expandEditorFieldTokens(["a", { slug: "b" }, ""])).toEqual(["a", "b"]);
  });

  it("splits comma strings when requested", () => {
    expect(expandEditorFieldTokens("a, b", { splitComma: true })).toEqual(["a", "b"]);
  });
});

describe("collectEditorFieldTokens", () => {
  it("collects distinct category strings from peer items", () => {
    const items = [
      { category: "trends-and-tech" },
      { category: "aprender-a-programar" },
      { category: "trends-and-tech" },
      { category: null },
    ];
    expect(collectEditorFieldTokens(items, "category")).toEqual([
      "aprender-a-programar",
      "trends-and-tech",
    ]);
  });
});

describe("itemHasEditorFieldToken", () => {
  it("matches arrays case-insensitively", () => {
    const item = { tags: ["Javascript", "Python"] };
    expect(itemHasEditorFieldToken(item, "tags", "javascript")).toBe(true);
    expect(itemHasEditorFieldToken(item, "tags", "RUBY")).toBe(false);
  });

  it("splits CSV only when splitComma is true", () => {
    const item = { tags: "js, python" };
    expect(itemHasEditorFieldToken(item, "tags", "js")).toBe(false);
    expect(itemHasEditorFieldToken(item, "tags", "js", { splitComma: true })).toBe(true);
    expect(
      itemHasEditorFieldToken(item, "tags", "PYTHON", { splitComma: true }),
    ).toBe(true);
  });

  it("treats empty selection as match-all", () => {
    expect(itemHasEditorFieldToken({ tags: ["a"] }, "tags", "")).toBe(true);
    expect(itemHasEditorFieldToken({ tags: ["a"] }, "tags", "  ")).toBe(true);
  });
});
