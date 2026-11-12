import { afterEach, describe, expect, it, vi } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../logger", () => ({
  child: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { collectSectionSchemas, type SchemaComponentContext } from "./index";

afterEach(() => {
  vi.clearAllMocks();
});

const context: SchemaComponentContext = {
  locale: "en",
  // No fixture files needed: these tests only use inline `items` /
  // `hardcoded_entries`, which never touch the filesystem.
  contentRoot: "/nonexistent-content-root",
  baseUrl: "https://example.com",
};

function faqSection(
  items: Array<{ question: string; answer: string }>,
): Record<string, unknown> {
  return { type: "faq", title: "FAQ", items };
}

describe("collectSectionSchemas", () => {
  it("ignores sections without a registered contributor", () => {
    const schemas = collectSectionSchemas(
      [
        { type: "hero", title: "Hero" },
        { type: "listing", dynamic_entries: { content_type: "blog" } },
      ],
      context,
    );

    expect(schemas).toEqual([]);
  });

  it("emits FAQPage from a page mixing a listing component and a FAQ section", () => {
    const schemas = collectSectionSchemas(
      [
        { type: "listing", dynamic_entries: { content_type: "blog" } },
        faqSection([{ question: "Q1?", answer: "A1." }]),
      ],
      context,
    );

    expect(schemas).toHaveLength(1);
    expect(schemas[0]["@type"]).toBe("FAQPage");
    const mainEntity = schemas[0].mainEntity as Array<Record<string, unknown>>;
    expect(mainEntity).toHaveLength(1);
    expect(mainEntity[0].name).toBe("Q1?");
  });

  it("merges multiple FAQ sections into one deduped FAQPage", () => {
    const schemas = collectSectionSchemas(
      [
        faqSection([
          { question: "What is AI?", answer: "First answer." },
          { question: "How long?", answer: "16 weeks." },
        ]),
        faqSection([
          { question: "what is ai? ", answer: "Duplicate answer." },
          { question: "Financing?", answer: "Yes." },
        ]),
      ],
      context,
    );

    expect(schemas).toHaveLength(1);
    const mainEntity = schemas[0].mainEntity as Array<Record<string, unknown>>;
    expect(mainEntity.map((q) => q.name)).toEqual([
      "What is AI?",
      "How long?",
      "Financing?",
    ]);
    expect((mainEntity[0].acceptedAnswer as Record<string, unknown>).text).toBe("First answer.");
  });

  it("omits FAQPage when no FAQ section resolves any items", () => {
    const schemas = collectSectionSchemas(
      [{ type: "faq", title: "Empty FAQ" }, faqSection([])],
      context,
    );

    expect(schemas).toEqual([]);
  });

  it("resolves standalone root hardcoded_entries", () => {
    const schemas = collectSectionSchemas(
      [
        {
          type: "faq",
          title: "FAQ",
          hardcoded_entries: [
            { question: "Hardcoded question?", answer: "Hardcoded answer." },
          ],
        },
      ],
      context,
    );

    expect(schemas).toHaveLength(1);
    const mainEntity = schemas[0].mainEntity as Array<Record<string, unknown>>;
    expect(mainEntity[0].name).toBe("Hardcoded question?");
  });

  it("emits BreadcrumbList documents before the merged FAQPage", () => {
    const schemas = collectSectionSchemas(
      [
        faqSection([{ question: "Q1?", answer: "A1." }]),
        {
          type: "breadcrumb",
          items: [
            { label: "Home", url: "/" },
            { label: "Current page" },
          ],
        },
      ],
      context,
    );

    expect(schemas.map((s) => s["@type"])).toEqual(["BreadcrumbList", "FAQPage"]);
    const elements = schemas[0].itemListElement as Array<Record<string, unknown>>;
    expect(elements[0].item).toBe("https://example.com/");
    expect(elements[1]).not.toHaveProperty("item");
  });

  it("skips breadcrumb sections without labeled items and dedupes identical documents", () => {
    const breadcrumb = {
      type: "breadcrumb",
      items: [{ label: "Home", url: "/" }, { label: "Page" }],
    };
    const schemas = collectSectionSchemas(
      [{ type: "breadcrumb", items: [] }, breadcrumb, { ...breadcrumb }],
      context,
    );

    expect(schemas).toHaveLength(1);
    expect(schemas[0]["@type"]).toBe("BreadcrumbList");
  });

  it("emits Course from schema_org without dual Organization when no @organization ref", () => {
    const schemas = collectSectionSchemas(
      [
        {
          type: "schema_org",
          schema_type: "Course",
          properties: { name: "Test Course", description: "Desc" },
        },
      ],
      context,
    );
    expect(schemas).toHaveLength(1);
    expect(schemas[0]["@type"]).toBe("Course");
    expect(schemas[0].name).toBe("Test Course");
  });

  it("emits Article from article bodies (non-blog)", () => {
    const schemas = collectSectionSchemas(
      [
        { type: "article", content: "# Hello\n\nBody text." },
        { type: "article", content: "More markdown." },
      ],
      { ...context, contentType: "page", title: "Hello", pageUrl: "https://example.com/p" },
    );
    expect(schemas).toHaveLength(1);
    expect(schemas[0]["@type"]).toBe("Article");
    expect(schemas[0].headline).toBe("Hello");
  });

  it("emits BlogPosting from article bodies when contentType is blog", () => {
    const schemas = collectSectionSchemas(
      [{ type: "article", content: "Post body with enough text." }],
      {
        ...context,
        contentType: "blog",
        title: "My Post",
        authorName: "Ada",
        publishedAt: "2024-01-01",
      },
    );
    expect(schemas).toHaveLength(1);
    expect(schemas[0]["@type"]).toBe("BlogPosting");
    expect(schemas[0].author).toEqual({ "@type": "Person", name: "Ada" });
  });

  it("emits Person[] with @id/url from hydrated authors (primary first)", () => {
    const schemas = collectSectionSchemas(
      [
        {
          type: "article",
          content: "Post body with enough text.",
          authors: "{{ single.authors }}",
        },
      ],
      {
        ...context,
        contentType: "blog",
        title: "My Post",
        publishedAt: "2024-01-01",
        authors: [
          {
            name: "Ada Lovelace",
            slug: "ada-lovelace",
            url: "https://example.com/en/authors/ada-lovelace",
            "@id": "https://example.com/en/authors/ada-lovelace",
          },
          {
            name: "Bob",
            slug: "bob",
            url: "https://example.com/en/authors/bob",
            "@id": "https://example.com/en/authors/bob",
          },
        ],
      },
    );
    expect(schemas).toHaveLength(1);
    const author = schemas[0].author as Array<Record<string, unknown>>;
    expect(Array.isArray(author)).toBe(true);
    expect(author[0]).toMatchObject({
      "@type": "Person",
      name: "Ada Lovelace",
      url: "https://example.com/en/authors/ada-lovelace",
      "@id": "https://example.com/en/authors/ada-lovelace",
    });
    expect(author[1]).toMatchObject({ "@type": "Person", name: "Bob" });
  });

  it("falls back to Organization when blog has no authors", () => {
    const schemas = collectSectionSchemas(
      [{ type: "article", content: "Post body with enough text." }],
      {
        ...context,
        contentType: "blog",
        title: "My Post",
        baseUrl: "https://example.com",
      },
    );
    expect(schemas[0].author).toMatchObject({
      "@type": "Organization",
      name: "4Geeks Academy",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when the entry has authors but article sections omit them", () => {
    const schemas = collectSectionSchemas(
      [
        { type: "article", content: "First chunk.", authors: "{{ entry.authors }}" },
        { type: "article", content: "Second chunk without authors." },
      ],
      {
        ...context,
        contentType: "blog",
        title: "My Post",
        authors: [{ name: "4Geeks Academy", slug: "4geeks-academy" }],
      },
    );
    expect(schemas[0].author).toMatchObject({ "@type": "Person", name: "4Geeks Academy" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("fills WebPage url/@id from pageUrl when blank and keeps a typed url", () => {
    const pageUrl = "https://example.com/landing/foo";
    const [filled, typed] = collectSectionSchemas(
      [
        { type: "schema_org", section_id: "a", schema_type: "WebPage", properties: { name: "Foo" } },
        {
          type: "schema_org",
          section_id: "b",
          schema_type: "WebPage",
          properties: { name: "Bar", url: "https://example.com/typed" },
        },
      ],
      { ...context, contentType: "landing", pageUrl },
    );
    expect(filled.url).toBe(pageUrl);
    expect(filled["@id"]).toBe(pageUrl);
    expect(typed.url).toBe("https://example.com/typed");
    expect(typed["@id"]).toBe("https://example.com/typed");
  });

  it("does not fill url on Organization sections", () => {
    const [org] = collectSectionSchemas(
      [{ type: "schema_org", section_id: "o", schema_type: "Organization", properties: { name: "Acme" } }],
      { ...context, pageUrl: "https://example.com/landing/foo" },
    );
    expect(org.url).toBeUndefined();
  });

  it("emits Person from schema_org on authors hub; text_block bio does not emit Article", () => {
    const pageUrl = "https://example.com/en/authors/ada-lovelace";
    const schemas = collectSectionSchemas(
      [
        {
          type: "schema_org",
          section_id: "schema-org-author-person",
          schema_type: "Person",
          properties: {
            name: "Ada Lovelace",
            description: "Mathematician and writer.",
            job_title: "Analyst",
            same_as: ["https://en.wikipedia.org/wiki/Ada_Lovelace"],
            knows_about: ["mathematics", "computing"],
            works_for: { type: "Organization", name: "Analytical Engine" },
          },
        },
        {
          type: "text_block",
          section_id: "authors-bio",
          body: "Mathematician and writer.",
          alignment: "left",
          max_width: "default",
        },
      ],
      {
        ...context,
        contentType: "authors",
        pageUrl,
        title: "Ada Lovelace | Authors | 4Geeks",
      },
    );
    expect(schemas).toHaveLength(1);
    expect(schemas[0]["@type"]).toBe("Person");
    expect(schemas[0].name).toBe("Ada Lovelace");
    expect(schemas[0].jobTitle).toBe("Analyst");
    expect(schemas[0].sameAs).toEqual(["https://en.wikipedia.org/wiki/Ada_Lovelace"]);
    expect(schemas[0].knowsAbout).toEqual(["mathematics", "computing"]);
    expect(schemas[0].worksFor).toMatchObject({
      "@type": "Organization",
      name: "Analytical Engine",
    });
    expect(schemas[0].url).toBe(pageUrl);
    expect(schemas[0]["@id"]).toBe(pageUrl);
    expect(schemas.some((s) => s["@type"] === "Article")).toBe(false);
  });
});
