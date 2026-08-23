import { describe, expect, it } from "vitest";
import {
  collectMissingJsonLdFields,
  getJsonLdFieldRule,
  hasNonEmptyJsonLdValue,
  JSON_LD_FIELD_RULES,
  missingRequiredJsonLdFields,
  suggestionForMissingField,
  warningCodeForJsonLdField,
} from "./schema-org-jsonld-rules";

describe("schema-org-jsonld-rules", () => {
  it("returns null rule for undeclared types", () => {
    expect(getJsonLdFieldRule({ "@type": "FAQPage" })).toBeNull();
    expect(getJsonLdFieldRule({ "@type": "BreadcrumbList" })).toBeNull();
    expect(collectMissingJsonLdFields({ "@type": "WebSite", name: "Site" })).toEqual([]);
  });

  it("BlogPosting passes when all required fields are present", () => {
    const doc = {
      "@type": "BlogPosting",
      headline: "My Post",
      description: "Summary",
      datePublished: "2024-01-01",
      author: { "@type": "Person", name: "Ada" },
    };
    expect(collectMissingJsonLdFields(doc)).toEqual([]);
  });

  it("BlogPosting reports missing headline and author", () => {
    const rule = JSON_LD_FIELD_RULES.BlogPosting;
    const missing = missingRequiredJsonLdFields(
      {
        "@type": "BlogPosting",
        description: "Summary",
        datePublished: "2024-01-01",
      },
      rule,
    );
    expect(missing).toContain("headline");
    expect(missing).toContain("author");
  });

  it("Article requires headline and description only", () => {
    const missing = collectMissingJsonLdFields({
      "@type": "Article",
      headline: "Terms",
    });
    expect(missing).toEqual(["description"]);
  });

  it("Person requires name and url or @id", () => {
    expect(
      collectMissingJsonLdFields({
        "@type": "Person",
        name: "Ada",
        url: "https://example.com/authors/ada",
      }),
    ).toEqual([]);

    expect(
      collectMissingJsonLdFields({
        "@type": "Person",
        name: "Ada",
        "@id": "https://example.com/authors/ada",
      }),
    ).toEqual([]);

    expect(
      collectMissingJsonLdFields({
        "@type": "Person",
        name: "Ada",
      }),
    ).toEqual(["url"]);
  });

  it("hasNonEmptyJsonLdValue treats author object as present", () => {
    expect(hasNonEmptyJsonLdValue({ author: { "@type": "Organization", name: "4Geeks" } }, "author")).toBe(
      true,
    );
  });

  it("maps fields to warning codes", () => {
    expect(warningCodeForJsonLdField("headline")).toBe("SCHEMA_MISSING_HEADLINE");
    expect(warningCodeForJsonLdField("datePublished")).toBe("SCHEMA_MISSING_DATE_PUBLISHED");
  });

  it("provides source-aware suggestions", () => {
    expect(
      suggestionForMissingField({
        type: "BlogPosting",
        field: "headline",
        source: "article",
      }),
    ).toContain("meta.page_title");

    expect(
      suggestionForMissingField({
        type: "Course",
        field: "description",
        source: "schema_org",
      }),
    ).toContain("properties");
  });
});
