import { describe, expect, it } from "vitest";
import {
  restoreTemplatePlaceholders,
  restoreTemplateFieldValue,
  sanitizeClearedTemplatePaths,
} from "./content-editor";

const original = {
  type: "hero",
  title: "{{ single.title | blog title }}",
  subtitle: "{{ single.description }}",
  image: {
    src: "{{ single.image | https://example.com/fallback.webp }}",
  },
  badge: "static-badge",
};

describe("restoreTemplateFieldValue", () => {
  const expr = "{{ single.title }}";

  it("keeps strings that already contain template expressions", () => {
    expect(restoreTemplateFieldValue("{{ single.title }} test", expr)).toBe(
      "{{ single.title }} test",
    );
  });

  it("restores pure resolved values to the expression", () => {
    expect(restoreTemplateFieldValue("Coding Bootcamp", expr)).toBe(expr);
  });

  it("uses resolved prefix to preserve a suffix", () => {
    expect(
      restoreTemplateFieldValue("Coding Bootcamp test", expr, "Coding Bootcamp"),
    ).toBe("{{ single.title }} test");
  });
});

describe("restoreTemplatePlaceholders", () => {
  it("re-injects bindings by default when missing from incoming section", () => {
    const incoming = {
      type: "hero",
      badge: "static-badge",
      title: "resolved title",
    };
    const result = restoreTemplatePlaceholders(incoming, original);
    expect(result.title).toBe("{{ single.title | blog title }}");
    expect(result.subtitle).toBe("{{ single.description }}");
    expect((result.image as { src: string }).src).toBe(
      "{{ single.image | https://example.com/fallback.webp }}",
    );
    expect(result.badge).toBe("static-badge");
  });

  it("preserves literal text around authored expressions", () => {
    const incoming = {
      type: "hero",
      title: "{{ single.title | blog title }} test",
      subtitle: "{{ single.description }}",
      image: {
        src: "{{ single.image | https://example.com/fallback.webp }}",
      },
      badge: "static-badge",
    };
    const result = restoreTemplatePlaceholders(incoming, original);
    expect(result.title).toBe("{{ single.title | blog title }} test");
  });

  it("preserves suffix when resolvedByPath is provided", () => {
    const incoming = {
      type: "hero",
      title: "My Post test",
      subtitle: "Desc",
      image: { src: "https://cdn.example.com/photo.jpg" },
      badge: "static-badge",
    };
    const result = restoreTemplatePlaceholders(incoming, original, undefined, {
      title: "My Post",
      subtitle: "Desc",
      "image.src": "https://cdn.example.com/photo.jpg",
    });
    expect(result.title).toBe("{{ single.title | blog title }} test");
    expect(result.subtitle).toBe("{{ single.description }}");
    expect((result.image as { src: string }).src).toBe(
      "{{ single.image | https://example.com/fallback.webp }}",
    );
  });

  it("leaves allowlisted missing paths gone", () => {
    const incoming = {
      type: "hero",
      title: "{{ single.title | blog title }}",
      subtitle: "{{ single.description }}",
      badge: "static-badge",
    };
    const result = restoreTemplatePlaceholders(incoming, original, ["image.src"]);
    expect(result).not.toHaveProperty("image");
    expect(result.title).toBe("{{ single.title | blog title }}");
    expect(result.subtitle).toBe("{{ single.description }}");
  });

  it("still restores non-allowlisted missing paths", () => {
    const incoming = {
      type: "hero",
      badge: "x",
    };
    const result = restoreTemplatePlaceholders(incoming, original, ["image.src"]);
    expect(result).not.toHaveProperty("image");
    expect(result.title).toBe("{{ single.title | blog title }}");
    expect(result.subtitle).toBe("{{ single.description }}");
  });

  it("overwrites present literals with template expressions (unchanged)", () => {
    const incoming = {
      type: "hero",
      title: "literal title",
      subtitle: "literal subtitle",
      image: { src: "https://cdn.example.com/photo.jpg" },
    };
    const result = restoreTemplatePlaceholders(incoming, original);
    expect(result.title).toBe("{{ single.title | blog title }}");
    expect(result.subtitle).toBe("{{ single.description }}");
    expect((result.image as { src: string }).src).toBe(
      "{{ single.image | https://example.com/fallback.webp }}",
    );
  });
});

describe("sanitizeClearedTemplatePaths", () => {
  it("keeps only real bindings that are absent on incoming", () => {
    const incoming = {
      type: "hero",
      title: "{{ single.title | blog title }}",
      subtitle: "{{ single.description }}",
    };
    expect(
      sanitizeClearedTemplatePaths(
        ["image.src", "title", "not.a.binding", "subtitle"],
        incoming,
        original,
      ),
    ).toEqual(["image.src"]);
  });

  it("returns empty for undefined or empty requests", () => {
    expect(sanitizeClearedTemplatePaths(undefined, {}, original)).toEqual([]);
    expect(sanitizeClearedTemplatePaths([], {}, original)).toEqual([]);
  });
});
