import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveFaqItems,
  buildFaqPageSchema,
  dedupeFaqItems,
  clearSsrSchemaCache,
  generateSsrSchemaHtml,
  generateDatabaseSsrHtml,
  injectSsrSchemaHtml,
  type FaqSection,
} from "./ssr-schema";
import { applyIgnoredEntries } from "@shared/faq-listing";
import { contentIndex } from "./content-index";
import { validateFaqListingSections } from "@shared/validateFaqListing";
import { faqSectionSchema } from "../shared/component-registry/faq/v1.0/schema";

let tempDir: string;
let contentRoot: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssr-schema-test-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  clearSsrSchemaCache();
});

afterEach(() => {
  clearSsrSchemaCache();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("resolveFaqItems (slim — post-DE items / hardcoded)", () => {
  it("reads resolved items", () => {
    const section: FaqSection = {
      type: "faq",
      title: "FAQ",
      items: [
        { question: "How long does the AI Engineering program take?", answer: "About 16 weeks." },
        { question: "Do I need expensive hardware for AI development?", answer: "No." },
      ],
      dynamic_entries: {
        database: "frequently_asked_questions",
      },
    };
    const items = resolveFaqItems(section, "en", undefined, undefined, contentRoot);
    expect(items.map((i) => i.question)).toEqual([
      "How long does the AI Engineering program take?",
      "Do I need expensive hardware for AI development?",
    ]);
  });

  it("falls back to hardcoded_entries when items empty", () => {
    const section: FaqSection = {
      type: "faq",
      hardcoded_entries: [
        { question: "Hardcoded question?", answer: "Hardcoded answer." },
      ],
    };
    expect(resolveFaqItems(section, "en")).toEqual([
      { question: "Hardcoded question?", answer: "Hardcoded answer." },
    ]);
  });

  it("still prefers inline items over root hardcoded_entries", () => {
    const section: FaqSection = {
      type: "faq",
      items: [{ question: "Inline?", answer: "Inline answer." }],
      hardcoded_entries: [{ question: "Hardcoded?", answer: "Hardcoded answer." }],
    };
    expect(resolveFaqItems(section, "en")).toEqual([
      { question: "Inline?", answer: "Inline answer." },
    ]);
  });

  it("applies item_overrides.hideOnLocations for FAQPage parity", () => {
    const section: FaqSection = {
      type: "faq",
      items: [
        { question: "Visible everywhere?", answer: "Yes." },
        { question: "Hidden in Madrid?", answer: "Hidden." },
      ],
      item_overrides: {
        "hidden-in-madrid": { hideOnLocations: ["madrid-spain"] },
      },
    };
    const items = resolveFaqItems(section, "en", "madrid-spain");
    expect(items.map((i) => i.question)).toEqual(["Visible everywhere?"]);
  });
});

describe("applyIgnoredEntries dual-match", () => {
  it("matches slug/id when present, else question-key", () => {
    const items = [
      { slug: "financing", question: "Do you offer financing?", answer: "Yes." },
      { question: "How long does the AI Engineering program take?", answer: "16 weeks." },
    ];
    const bySlug = applyIgnoredEntries(items, ["financing"]);
    expect(bySlug).toHaveLength(1);
    expect(bySlug[0].question).toContain("How long");

    const byKey = applyIgnoredEntries(items, [
      "how-long-does-the-ai-engineering-program-take",
    ]);
    expect(byKey).toHaveLength(1);
    expect(byKey[0].slug).toBe("financing");
  });
});

describe("faq listing contract", () => {
  it("Zod accepts dynamic_entries FAQ shape", () => {
    const parsed = faqSectionSchema.safeParse({
      type: "faq",
      title: "FAQ",
      dynamic_entries: {
        database: "frequently_asked_questions",
        limit: 9,
        permanent_filters: [
          { item_property_slug: "related_features", value: ["online-platform"] },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects section-level related_features on save validation", () => {
    const err = validateFaqListingSections({
      sections: [
        {
          type: "faq",
          title: "FAQ",
          related_features: ["price"],
        },
      ],
    });
    expect(err).toMatch(/related_features/);
  });
});

describe("buildFaqPageSchema", () => {
  it("produces a FAQPage schema with Question mainEntity", () => {
    const schema = buildFaqPageSchema([
      { question: "Q1?", answer: "A1." },
      { question: "Q2?", answer: "A2." },
    ]);

    expect(schema["@type"]).toBe("FAQPage");
    expect(schema["@context"]).toBe("https://schema.org");
    const mainEntity = schema.mainEntity as Array<Record<string, unknown>>;
    expect(mainEntity).toHaveLength(2);
    expect(mainEntity[0]).toEqual({
      "@type": "Question",
      name: "Q1?",
      acceptedAnswer: { "@type": "Answer", text: "A1." },
    });
  });
});

describe("dedupeFaqItems", () => {
  it("removes duplicate questions case-insensitively, keeping first occurrence", () => {
    const result = dedupeFaqItems([
      { question: "What is AI?", answer: "First answer." },
      { question: "what is ai? ", answer: "Second answer." },
      { question: "Other question?", answer: "Other answer." },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].answer).toBe("First answer.");
  });
});

describe("resolveFaqItems with standalone hardcoded_entries", () => {
  it("filters malformed hardcoded entries", () => {
    const section = {
      type: "faq",
      hardcoded_entries: [
        { question: "Valid?", answer: "Yes." },
        { question: "Missing answer?" },
        { answer: "Missing question." },
      ],
    } as unknown as FaqSection;
    const items = resolveFaqItems(section, "en", undefined, undefined, contentRoot);

    expect(items).toEqual([{ question: "Valid?", answer: "Yes." }]);
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function makeFakeCi(
  mergedData: Record<string, unknown> | null,
  isSharedTemplate = false,
): typeof contentIndex {
  return {
    resolveUrl: () => ({
      contentType: "landing",
      slug: "test-page",
      fromDatabase: false,
      params: { locale: "en" },
    }),
    loadMergedContent: () => ({
      data: mergedData,
      filePath: "/tmp/fake.yml",
      isSharedTemplate,
    }),
    loadCommonData: () => null,
    getLocaleUrls: () => ({}),
    resolveBaseSlug: (slug: string) => slug,
  } as unknown as typeof contentIndex;
}

describe("generateSsrSchemaHtml section schema dispatch (static pages)", () => {
  it("emits one FAQPage for a page mixing a listing component and FAQ sections", async () => {
    const ci = makeFakeCi({
      sections: [
        { type: "listing", dynamic_entries: { content_type: "blog" } },
        { type: "faq", items: [{ question: "Q1?", answer: "A1." }] },
        { type: "faq", items: [{ question: "q1?", answer: "Duplicate." }, { question: "Q2?", answer: "A2." }] },
      ],
    });
    const html = await generateSsrSchemaHtml("/en/test-page", ci, contentRoot);

    expect(countOccurrences(html, '"@type":"FAQPage"')).toBe(1);
    expect(countOccurrences(html, '"@type":"Question"')).toBe(2);
    expect(html).toContain("Q1?");
    expect(html).toContain("Q2?");
    expect(html).not.toContain("Duplicate.");
  });

  it("emits no FAQPage when FAQ sections resolve no items", async () => {
    const ci = makeFakeCi({
      sections: [{ type: "faq", title: "Empty" }, { type: "hero", title: "Hero" }],
    });
    const html = await generateSsrSchemaHtml("/en/test-page", ci, contentRoot);

    expect(html).not.toContain('"@type":"FAQPage"');
  });

  it("resolves {{ single.* }} vars in shared-template pages before contributing schema", async () => {
    const ci = makeFakeCi(
      {
        title: "My Course",
        sections: [
          {
            type: "faq",
            hardcoded_entries: [
              { question: "About {{ single.title }}?", answer: "Answer for {{ single.title }}." },
            ],
          },
        ],
      },
      true,
    );
    const html = await generateSsrSchemaHtml("/en/test-page", ci, contentRoot);

    expect(countOccurrences(html, '"@type":"FAQPage"')).toBe(1);
    expect(html).toContain("About My Course?");
    expect(html).toContain("Answer for My Course.");
    expect(html).not.toContain("{{ single.title }}");
  });
});

describe("generateDatabaseSsrHtml section schema dispatch (database/blog pages)", () => {
  function writeBlogTemplateFixture() {
    fs.writeFileSync(
      path.join(contentRoot, "content-types.yml"),
      `blog:
  directory: blog
  single_template: true
  url_pattern:
    en: /en/blog/:category/:slug
    es: /es/blog/:category/:slug
`,
      "utf-8",
    );

    const blogDir = path.join(contentRoot, "blog");
    fs.mkdirSync(blogDir, { recursive: true });
    fs.writeFileSync(
      path.join(blogDir, "single.en.yml"),
      `sections:
  - type: hero
    section_id: hero-1
    title: "{{ single.title }}"
  - type: breadcrumb
    section_id: breadcrumb-1
    items:
      - label: Home
        url: /
      - label: "{{ single.title }}"
  - type: article
    section_id: article-1
    content: |
      # {{ single.title }}

      Body for {{ single.title }}.
  - type: faq
    section_id: faq-1
    title: Frequently Asked Questions
    hardcoded_entries:
      - question: Template question?
        answer: Template answer.
`,
      "utf-8",
    );

    const entryDir = path.join(blogDir, "my-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, "_common.yml"),
      `detached: true
`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(entryDir, "en.yml"),
      `title: My Post
sections:
  - section_id: faq-1
    hardcoded_entries:
      - question: "About {{ single.title }}?"
        answer: Entry answer.
`,
      "utf-8",
    );
  }

  const record = {
    slug: "my-post",
    title: "My Post",
    description: "Post description",
    category: "learn",
    lang: "en",
    published_at: "2026-01-01",
  };

  it("emits FAQPage from the merged single template with per-entry overrides applied", async () => {
    writeBlogTemplateFixture();
    const html = await generateDatabaseSsrHtml("blog", record, "en", contentIndex, contentRoot);

    expect(html).toContain('"@type":"BlogPosting"');
    expect(countOccurrences(html, '"@type":"FAQPage"')).toBe(1);
    expect(html).toContain("About My Post?");
    expect(html).toContain("Entry answer.");
    expect(html).not.toContain("Template question?");
  });

  it("emits section BreadcrumbList only (no synthetic blog trail)", async () => {
    writeBlogTemplateFixture();
    const html = await generateDatabaseSsrHtml("blog", record, "en", contentIndex, contentRoot);

    expect(countOccurrences(html, '"@type":"BreadcrumbList"')).toBe(1);
    expect(html).not.toContain('"name":"Blog"');
    expect(html).toContain('"name":"My Post"');
  });

  it("falls back to the shared template FAQ when the entry has no override", async () => {
    writeBlogTemplateFixture();
    const html = await generateDatabaseSsrHtml(
      "blog",
      { ...record, slug: "another-post", title: "Another Post" },
      "en",
      contentIndex,
      contentRoot,
    );

    expect(countOccurrences(html, '"@type":"FAQPage"')).toBe(1);
    expect(html).toContain("Template question?");
    expect(html).toContain("Template answer.");
  });

  it("hydrates omitted listing content so BlogPosting emits from {{ single.content }}", async () => {
    fs.writeFileSync(
      path.join(contentRoot, "content-types.yml"),
      `blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
    content: content
    authors: authors
  url_pattern:
    en: /en/blog/:category/:slug
`,
      "utf-8",
    );

    const blogDir = path.join(contentRoot, "blog");
    fs.mkdirSync(blogDir, { recursive: true });
    fs.writeFileSync(
      path.join(blogDir, "single.en.yml"),
      `sections:
  - type: article
    section_id: article-1
    content: "{{ single.content }}"
    authors: "{{ single.authors }}"
`,
      "utf-8",
    );

    const entryDir = path.join(blogDir, "ai-act-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, "_common.yml"),
      `slug: ai-act-post
title: AI Act for companies
authors:
  - 4geeks-academy
category:
  slug: regulations
published_at: "2026-08-10T00:00:00.000Z"
`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(entryDir, "en.yml"),
      `content: |-
  Full article body about the AI Act that must appear in BlogPosting.
description: What the AI Act requires.
`,
      "utf-8",
    );

    // Mimic queryEntries static listing projection: no content field.
    const listingRecord = {
      slug: "ai-act-post",
      title: "AI Act for companies",
      description: "What the AI Act requires.",
      category: { slug: "regulations" },
      authors: ["4geeks-academy"],
      lang: "en",
      published_at: "2026-08-10T00:00:00.000Z",
    };

    const html = await generateDatabaseSsrHtml(
      "blog",
      listingRecord,
      "en",
      contentIndex,
      contentRoot,
    );

    expect(html).toContain('"@type":"BlogPosting"');
    expect(html).toContain("Full article body about the AI Act");
    expect(html).toContain('"headline":"AI Act for companies"');
  });

  it("does not re-emit description / og:description / twitter:description (owned by injectSsrMetaTags)", async () => {
    writeBlogTemplateFixture();
    const html = await generateDatabaseSsrHtml("blog", record, "en", contentIndex, contentRoot);

    expect(html).not.toMatch(/name=["']description["']/);
    expect(html).not.toMatch(/property=["']og:description["']/);
    expect(html).not.toMatch(/name=["']twitter:description["']/);
    expect(html).not.toMatch(/<title>/);
    expect(html).toContain('property="og:type" content="article"');
    expect(html).toContain('rel="canonical"');
  });
});

describe("injectSsrSchemaHtml", () => {
  it("replaces shell description metas instead of duplicating them", () => {
    const shell = `<!DOCTYPE html><html><head>
    <meta
      name="description"
      content="Shell default description"
    />
    <meta property="og:description" content="Shell og desc" />
    <meta name="twitter:description" content="Shell tw desc" />
    <meta property="og:type" content="website" />
</head><body></body></html>`;

    const fragment = [
      `<meta name="description" content="Post description" />`,
      `<meta property="og:description" content="Post description" />`,
      `<meta name="twitter:description" content="Post description" />`,
      `<meta property="og:type" content="article" />`,
    ].join("\n");

    const html = injectSsrSchemaHtml(shell, fragment);

    expect(countOccurrences(html, 'name="description"')).toBe(1);
    expect(countOccurrences(html, 'property="og:description"')).toBe(1);
    expect(countOccurrences(html, 'name="twitter:description"')).toBe(1);
    expect(countOccurrences(html, 'property="og:type"')).toBe(1);
    expect(html).toContain('content="Post description"');
    expect(html).toContain('content="article"');
    expect(html).not.toContain("Shell default description");
  });
});
