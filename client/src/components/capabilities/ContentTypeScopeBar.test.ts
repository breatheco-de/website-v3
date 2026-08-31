import { describe, expect, it } from "vitest";
import {
  deriveContentTypeScopeMode,
  formatContentTypeScopeLabel,
  formatSameAsAboveLabel,
  parseContentTypeScope,
  serializeContentTypeScope,
} from "./ContentTypeScopeBar";

describe("parseContentTypeScope / serializeContentTypeScope", () => {
  it("parses comma-separated names", () => {
    expect(parseContentTypeScope("blog, landings")).toEqual(["blog", "landings"]);
    expect(parseContentTypeScope("")).toEqual([]);
    expect(parseContentTypeScope("  ")).toEqual([]);
  });

  it("round-trips lists", () => {
    expect(serializeContentTypeScope(["blog", "page"])).toBe("blog, page");
    expect(parseContentTypeScope(serializeContentTypeScope(["a"]))).toEqual(["a"]);
  });
});

describe("deriveContentTypeScopeMode", () => {
  it("treats empty as all", () => {
    expect(deriveContentTypeScopeMode("", null)).toBe("all");
    expect(deriveContentTypeScopeMode("  ", "blog")).toBe("all");
  });

  it("treats matching parent as same", () => {
    expect(deriveContentTypeScopeMode("blog", "blog")).toBe("same");
    expect(deriveContentTypeScopeMode("blog, page", "blog, page")).toBe("same");
  });

  it("treats non-matching non-empty as specific", () => {
    expect(deriveContentTypeScopeMode("blog", "page")).toBe("specific");
    expect(deriveContentTypeScopeMode("blog", null)).toBe("specific");
    expect(deriveContentTypeScopeMode("blog", undefined)).toBe("specific");
  });

  it("does not treat empty+empty as same (ambiguous with all)", () => {
    expect(deriveContentTypeScopeMode("", "")).toBe("all");
  });
});

describe("formatContentTypeScopeLabel", () => {
  const types = [
    { name: "blog", label: "Blog" },
    { name: "page", label: "Landing pages" },
    { name: "programs", label: "Programs" },
    { name: "lessons", label: "Lessons" },
    { name: "workshops", label: "Workshops" },
    { name: "faq", label: "FAQ" },
  ];

  it("uses Specific when nothing selected", () => {
    expect(formatContentTypeScopeLabel([], types)).toBe("Specific");
  });

  it("uses type label for a single selection", () => {
    expect(formatContentTypeScopeLabel(["blog"], types)).toBe("Only 1: Blog");
    expect(formatContentTypeScopeLabel(["unknown"], types)).toBe("Only 1: unknown");
  });

  it("lists up to four type labels", () => {
    expect(formatContentTypeScopeLabel(["blog", "page"], types)).toBe(
      "Only 2: Blog, Landing pages",
    );
    expect(
      formatContentTypeScopeLabel(["blog", "page", "programs", "lessons"], types),
    ).toBe("Only 4: Blog, Landing pages, Programs, Lessons");
  });

  it("lists first four then and more", () => {
    expect(
      formatContentTypeScopeLabel(
        ["blog", "page", "programs", "lessons", "workshops", "faq"],
        types,
      ),
    ).toBe("Only 6: Blog, Landing pages, Programs, Lessons and 2 more");
  });
});

describe("formatSameAsAboveLabel", () => {
  it("omits count when parent is all", () => {
    expect(formatSameAsAboveLabel("")).toBe("Same as above");
    expect(formatSameAsAboveLabel("  ")).toBe("Same as above");
  });

  it("includes parent type count", () => {
    expect(formatSameAsAboveLabel("blog")).toBe("Same 1 as above");
    expect(formatSameAsAboveLabel("a, b, c, d, e, f")).toBe("Same 6 as above");
  });
});
