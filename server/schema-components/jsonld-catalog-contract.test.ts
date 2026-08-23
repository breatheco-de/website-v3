import { describe, expect, it } from "vitest";
import { collectMissingJsonLdFields } from "@shared/schema-org-jsonld-rules";
import { collectSectionSchemas, type SchemaComponentContext } from "./index";

const baseContext: SchemaComponentContext = {
  locale: "en",
  contentRoot: "/nonexistent-content-root",
  baseUrl: "https://example.com",
};

describe("jsonld catalog contract (emitters)", () => {
  it("Course schema_org satisfies catalog when name and description are set", () => {
    const schemas = collectSectionSchemas(
      [
        {
          type: "schema_org",
          schema_type: "Course",
          properties: { name: "AI Engineering", description: "Learn AI engineering." },
        },
      ],
      baseContext,
    );
    expect(schemas).toHaveLength(1);
    expect(collectMissingJsonLdFields(schemas[0] as Record<string, unknown>)).toEqual([]);
  });

  it("Article satisfies catalog when headline and description are present", () => {
    const schemas = collectSectionSchemas(
      [{ type: "article", content: "# Hello\n\nBody text." }],
      {
        ...baseContext,
        contentType: "page",
        title: "Hello",
        description: "Page summary",
        pageUrl: "https://example.com/p",
      },
    );
    expect(collectMissingJsonLdFields(schemas[0] as Record<string, unknown>)).toEqual([]);
  });

  it("BlogPosting satisfies catalog when all required fields are emitted", () => {
    const schemas = collectSectionSchemas(
      [{ type: "article", content: "Post body with enough text." }],
      {
        ...baseContext,
        contentType: "blog",
        title: "My Post",
        description: "Post summary",
        authorName: "Ada",
        publishedAt: "2024-01-01",
        pageUrl: "https://example.com/en/blog/cat/my-post",
      },
    );
    expect(collectMissingJsonLdFields(schemas[0] as Record<string, unknown>)).toEqual([]);
  });

  it("Person schema_org satisfies catalog when url/@id are filled from pageUrl", () => {
    const pageUrl = "https://example.com/en/authors/ada-lovelace";
    const schemas = collectSectionSchemas(
      [
        {
          type: "schema_org",
          schema_type: "Person",
          properties: { name: "Ada Lovelace", description: "Mathematician." },
        },
      ],
      {
        ...baseContext,
        contentType: "authors",
        pageUrl,
        title: "Ada Lovelace",
      },
    );
    expect(collectMissingJsonLdFields(schemas[0] as Record<string, unknown>)).toEqual([]);
  });
});
