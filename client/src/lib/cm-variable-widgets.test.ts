import { describe, expect, it } from "vitest";
import {
  findReplaceableTextRange,
  findTemplateSpans,
  formatVariablePillLabel,
} from "./cm-variable-widgets";

const BLOG_BREADCRUMB_YAML = `type: breadcrumb
variant: blogWithTags
version: v1.0
items:
  - label: Blog
    url: /en/blog
  - label: {{ entry.category | category }}
    url: /en/blog?taxonomy=category
  - label: {{ entry.slug | slug }}
tags: {{ entry.tags }}
`;

describe("findReplaceableTextRange", () => {
  it("prefers explicit selection offsets when they still match", () => {
    const needle = "category";
    const urlOccurrence = BLOG_BREADCRUMB_YAML.lastIndexOf(
      "taxonomy=category",
    );
    const from = urlOccurrence + "taxonomy=".length;
    const range = findReplaceableTextRange(
      BLOG_BREADCRUMB_YAML,
      needle,
      from,
      from + needle.length,
    );
    expect(range).toEqual({ from, to: from + needle.length });
    expect(BLOG_BREADCRUMB_YAML.slice(range!.from - 9, range!.to)).toBe(
      "taxonomy=category",
    );
  });

  it("skips occurrences inside existing {{ }} when falling back to search", () => {
    const range = findReplaceableTextRange(BLOG_BREADCRUMB_YAML, "category");
    expect(range).not.toBeNull();
    expect(BLOG_BREADCRUMB_YAML.slice(range!.from - 9, range!.to)).toBe(
      "taxonomy=category",
    );
  });

  it("returns null when every occurrence is inside a template span", () => {
    const doc = `label: {{ entry.category | category }}\n`;
    expect(findReplaceableTextRange(doc, "category")).toBeNull();
  });

  it("finds whole-field text outside templates", () => {
    const range = findReplaceableTextRange(BLOG_BREADCRUMB_YAML, "Blog");
    expect(range).not.toBeNull();
    expect(BLOG_BREADCRUMB_YAML.slice(range!.from, range!.to)).toBe("Blog");
  });
});

describe("findTemplateSpans", () => {
  it("detects mid-string templates in URLs", () => {
    const doc = `url: /en/blog?taxonomy={{ entry.category | category }}\n`;
    const spans = findTemplateSpans(doc);
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("entry.category");
    expect(spans[0].defaultValue).toBe("category");
    expect(doc.slice(spans[0].from, spans[0].to)).toBe(
      "{{ entry.category | category }}",
    );
  });

  it("omits defaultValue when there is no pipe", () => {
    const spans = findTemplateSpans("url: {{ entry.learnpack_url }}\n");
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("entry.learnpack_url");
    expect(spans[0].defaultValue).toBeUndefined();
  });
});

describe("formatVariablePillLabel", () => {
  it("appends | default when present", () => {
    expect(
      formatVariablePillLabel({
        name: "entry.learnpack_url",
        defaultValue: "https://example.com",
      }),
    ).toBe("entry.learnpack_url | https://example.com");
  });

  it("shows only the binding name without a default", () => {
    expect(formatVariablePillLabel({ name: "entry.slug" })).toBe("entry.slug");
  });
});
