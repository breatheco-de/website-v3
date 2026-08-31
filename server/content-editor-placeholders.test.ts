import { describe, expect, it } from "vitest";
import {
  restoreTemplatePlaceholders,
  restoreTemplateFieldValue,
  sanitizeClearedTemplatePaths,
  sanitizeUnboundTemplatePaths,
} from "./content-editor";

const original = {
  type: "hero",
  title: "{{ entry.title | blog title }}",
  subtitle: "{{ entry.description }}",
  image: {
    src: "{{ entry.image | https://example.com/fallback.webp }}",
  },
  badge: "static-badge",
};

describe("restoreTemplateFieldValue", () => {
  const expr = "{{ entry.title }}";

  it("keeps strings that already contain template expressions", () => {
    expect(restoreTemplateFieldValue("{{ entry.title }} test", expr)).toBe(
      "{{ entry.title }} test",
    );
  });

  it("restores pure resolved values to the expression", () => {
    expect(restoreTemplateFieldValue("Coding Bootcamp", expr)).toBe(expr);
  });

  it("uses resolved prefix to preserve a suffix", () => {
    expect(
      restoreTemplateFieldValue("Coding Bootcamp test", expr, "Coding Bootcamp"),
    ).toBe("{{ entry.title }} test");
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
    expect(result.title).toBe("{{ entry.title | blog title }}");
    expect(result.subtitle).toBe("{{ entry.description }}");
    expect((result.image as { src: string }).src).toBe(
      "{{ entry.image | https://example.com/fallback.webp }}",
    );
    expect(result.badge).toBe("static-badge");
  });

  it("preserves literal text around authored expressions", () => {
    const incoming = {
      type: "hero",
      title: "{{ entry.title | blog title }} test",
      subtitle: "{{ entry.description }}",
      image: {
        src: "{{ entry.image | https://example.com/fallback.webp }}",
      },
      badge: "static-badge",
    };
    const result = restoreTemplatePlaceholders(incoming, original);
    expect(result.title).toBe("{{ entry.title | blog title }} test");
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
    expect(result.title).toBe("{{ entry.title | blog title }} test");
    expect(result.subtitle).toBe("{{ entry.description }}");
    expect((result.image as { src: string }).src).toBe(
      "{{ entry.image | https://example.com/fallback.webp }}",
    );
  });

  it("leaves allowlisted missing paths gone", () => {
    const incoming = {
      type: "hero",
      title: "{{ entry.title | blog title }}",
      subtitle: "{{ entry.description }}",
      badge: "static-badge",
    };
    const result = restoreTemplatePlaceholders(incoming, original, ["image.src"]);
    expect(result).not.toHaveProperty("image");
    expect(result.title).toBe("{{ entry.title | blog title }}");
    expect(result.subtitle).toBe("{{ entry.description }}");
  });

  it("still restores non-allowlisted missing paths", () => {
    const incoming = {
      type: "hero",
      badge: "x",
    };
    const result = restoreTemplatePlaceholders(incoming, original, ["image.src"]);
    expect(result).not.toHaveProperty("image");
    expect(result.title).toBe("{{ entry.title | blog title }}");
    expect(result.subtitle).toBe("{{ entry.description }}");
  });

  it("overwrites present literals with template expressions (unchanged)", () => {
    const incoming = {
      type: "hero",
      title: "literal title",
      subtitle: "literal subtitle",
      image: { src: "https://cdn.example.com/photo.jpg" },
    };
    const result = restoreTemplatePlaceholders(incoming, original);
    expect(result.title).toBe("{{ entry.title | blog title }}");
    expect(result.subtitle).toBe("{{ entry.description }}");
    expect((result.image as { src: string }).src).toBe(
      "{{ entry.image | https://example.com/fallback.webp }}",
    );
  });

  it("keeps static literals for unbound paths", () => {
    const incoming = {
      type: "hero",
      title: "category",
      subtitle: "{{ entry.description }}",
      image: { src: "https://cdn.example.com/fallback.webp" },
      badge: "static-badge",
    };
    const result = restoreTemplatePlaceholders(incoming, original, undefined, undefined, [
      "title",
      "image.src",
    ]);
    expect(result.title).toBe("category");
    expect((result.image as { src: string }).src).toBe("https://cdn.example.com/fallback.webp");
    expect(result.subtitle).toBe("{{ entry.description }}");
  });

  it("unbound wins when literal equals pipe fallback and resolved value", () => {
    const incoming = {
      type: "hero",
      title: "blog title",
      subtitle: "{{ entry.description }}",
      badge: "static-badge",
    };
    const result = restoreTemplatePlaceholders(incoming, original, undefined, undefined, ["title"]);
    expect(result.title).toBe("blog title");
  });
});

describe("sanitizeClearedTemplatePaths", () => {
  it("keeps only real bindings that are absent on incoming", () => {
    const incoming = {
      type: "hero",
      title: "{{ entry.title | blog title }}",
      subtitle: "{{ entry.description }}",
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

describe("sanitizeUnboundTemplatePaths", () => {
  it("keeps only real bindings that are static strings on incoming", () => {
    const incoming = {
      type: "hero",
      title: "Guides",
      subtitle: "{{ entry.description }}",
    };
    expect(
      sanitizeUnboundTemplatePaths(
        ["title", "subtitle", "image.src", "not.a.binding"],
        incoming,
        original,
      ),
    ).toEqual(["title"]);
  });

  it("rejects paths still containing template syntax", () => {
    const incoming = {
      type: "hero",
      title: "{{ entry.title | blog title }}",
    };
    expect(
      sanitizeUnboundTemplatePaths(["title"], incoming, original),
    ).toEqual([]);
  });
});
