import { describe, expect, it } from "vitest";
import {
  coerceEditorSelectScalar,
  collectEditorFieldTokens,
  expandEditorFieldTokens,
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
