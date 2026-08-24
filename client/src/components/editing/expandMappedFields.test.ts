import { describe, expect, it } from "vitest";
import {
  buildPickerMappedFields,
  expandMappedFields,
  formatPickerSampleValue,
  getPickerSample,
} from "./expandMappedFields";

describe("buildPickerMappedFields", () => {
  it("exposes system aliases like slug before regular fields", () => {
    const result = buildPickerMappedFields({
      title: "title",
      _slug: "slug",
      _image: "image",
      _hreflangs: "",
      category: "category",
    });

    expect(result.map((f) => f.key)).toEqual([
      "slug",
      "image",
      "title",
      "category",
    ]);
    expect(result.find((f) => f.key === "slug")).toMatchObject({
      source: "slug",
      isSystemAlias: true,
    });
  });

  it("skips system specials with empty sources", () => {
    const result = buildPickerMappedFields({
      _slug: "slug",
      _hreflangs: "",
      title: "title",
    });
    expect(result.map((f) => f.key)).toEqual(["slug", "title"]);
  });
});

describe("expandMappedFields", () => {
  it("keeps scalar mapped fields as a single option", () => {
    const result = expandMappedFields(
      [{ key: "title", source: "title" }],
      { common: ["title", "slug"], partial: [] },
    );
    expect(result).toEqual([{ key: "title", source: "title", isObject: false }]);
  });

  it("keeps string category as a single option (no nested .slug)", () => {
    const result = expandMappedFields(
      [
        { key: "category", source: "category" },
        { key: "title", source: "title" },
      ],
      {
        common: ["category", "title"],
        partial: [],
      },
      { category: "ai-powered-learning", title: "Hello" },
    );

    expect(result).toEqual([
      { key: "category", source: "category", isObject: false },
      { key: "title", source: "title", isObject: false },
    ]);
  });

  it("expands object fields into parent + nested leaf paths", () => {
    const result = expandMappedFields(
      [
        { key: "author", source: "author" },
        { key: "title", source: "title" },
      ],
      {
        common: ["author", "author.name", "author.id", "title"],
        partial: [],
      },
    );

    expect(result).toEqual([
      { key: "author", source: "author", isObject: true },
      { key: "author.id", source: "author.id", isNested: true },
      { key: "author.name", source: "author.name", isNested: true },
      { key: "title", source: "title", isObject: false },
    ]);
  });

  it("maps nested options onto the field_mapping key when source differs", () => {
    const result = expandMappedFields(
      [{ key: "meta_block", source: "meta.block" }],
      {
        common: ["meta.block", "meta.block.slug"],
        partial: [],
      },
    );

    expect(result).toEqual([
      { key: "meta_block", source: "meta.block", isObject: true },
      { key: "meta_block.slug", source: "meta.block.slug", isNested: true },
    ]);
  });

  it("includes nested paths that only appear on some entries", () => {
    const result = expandMappedFields(
      [{ key: "author", source: "author" }],
      {
        common: ["author", "author.name"],
        partial: [{ key: "author.label", count: 3, total: 10 }],
      },
    );

    expect(result.map((f) => f.key)).toEqual([
      "author",
      "author.label",
      "author.name",
    ]);
  });

  it("skips expansion for function: sources", () => {
    const result = expandMappedFields(
      [{ key: "computed", source: "function:foo" }],
      { common: ["computed.bar"], partial: [] },
    );
    expect(result).toEqual([{ key: "computed", source: "function:foo" }]);
  });

  it("expands from the current singleEntry even without available-properties", () => {
    const result = expandMappedFields(
      [{ key: "author", source: "author" }],
      undefined,
      { author: { name: "Ada" }, title: "Hello" },
    );

    expect(result).toEqual([
      { key: "author", source: "author", isObject: true },
      { key: "author.name", source: "author.name", isNested: true },
    ]);
  });

  it("preserves isSystemAlias on slug rows", () => {
    const result = expandMappedFields(
      [{ key: "slug", source: "slug", isSystemAlias: true }],
      { common: ["slug"], partial: [] },
    );
    expect(result[0]).toMatchObject({ key: "slug", isSystemAlias: true, isObject: false });
  });
});

describe("getPickerSample", () => {
  const entry = {
    title: "Why 4Geeks is Built for the AI Era",
    slug: "4geeks-in-the-ai-era",
    category: "ai-powered-learning",
    tags: ["ai", "bootcamp"],
  };

  it("returns nested and scalar samples from the current single", () => {
    expect(getPickerSample(entry, "title")).toBe("Why 4Geeks is Built for the AI Era");
    expect(getPickerSample(entry, "slug")).toBe("4geeks-in-the-ai-era");
    expect(getPickerSample(entry, "category")).toBe("ai-powered-learning");
    expect(getPickerSample(entry, "tags")).toBe("ai, bootcamp");
  });

  it("returns empty string when missing", () => {
    expect(getPickerSample(undefined, "title")).toBe("");
    expect(getPickerSample(entry, "missing")).toBe("");
  });
});

describe("formatPickerSampleValue", () => {
  it("stringifies primitives and objects compactly", () => {
    expect(formatPickerSampleValue(null)).toBe("");
    expect(formatPickerSampleValue(42)).toBe("42");
    expect(formatPickerSampleValue(true)).toBe("true");
    expect(formatPickerSampleValue([])).toBe("[]");
  });
});
