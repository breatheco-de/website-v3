import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  schemaCompletenessValidator,
  resolvePageSections,
  cachedSsrHtmlHasFaqPage,
  ssrCachePathCandidates,
  htmlContainsFaqPage,
  isSchemaPlaceholderValue,
  __resetResolvePageSchemaDocumentsForTests,
} from "./schema-completeness";
import type { ContentFile, ValidationContext } from "../shared/types";
import {
  buildHtmlCacheKey,
  invalidateHtmlPageCache,
  setCachedHtml,
} from "../../../server/html-page-cache";

function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "schema-completeness-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function context(file: ContentFile, contentRoot?: string): ValidationContext {
  return {
    contentFiles: [file],
    redirectMap: new Map(),
    availableSchemas: new Set(),
    sitemapEntries: [],
    contentRoot,
  };
}

function baseFile(overrides: Partial<ContentFile> & Pick<ContentFile, "filePath">): ContentFile {
  return {
    slug: "home",
    title: "Home",
    type: "page",
    locale: "en",
    url: "/en/home",
    ...overrides,
  };
}

describe("isSchemaPlaceholderValue", () => {
  it("does not flag Spanish copy containing todo as substring", () => {
    expect(isSchemaPlaceholderValue("Todos los estudiantes reciben mentoría")).toBe(false);
    expect(isSchemaPlaceholderValue("metodología profesional de pentesting")).toBe(false);
    expect(isSchemaPlaceholderValue("Cada plan incluye acceso al catálogo completo")).toBe(false);
  });

  it("flags intentional TODO placeholders", () => {
    expect(isSchemaPlaceholderValue("TODO: replace before publish")).toBe(true);
    expect(isSchemaPlaceholderValue("[TODO]")).toBe(true);
    expect(isSchemaPlaceholderValue("lorem ipsum dolor sit amet")).toBe(true);
  });
});

describe("resolvePageSections", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it("prefers merged entryFields.sections over disk", () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(filePath, "sections:\n  - type: hero\n");

    const sections = resolvePageSections(
      baseFile({
        filePath,
        entryFields: {
          sections: [{ type: "schema_org", schema_type: "WebSite" }],
        },
      }),
    );
    expect(sections.map((s) => s.type)).toEqual(["schema_org"]);
  });

  it("parses unquoted {{ template vars }} on disk instead of returning []", () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(
      filePath,
      [
        "sections:",
        "  - type: schema_org",
        "    schema_type: WebSite",
        "  - type: graduates_stats",
        "    stats:",
        "      - value: {{ global.global_job_placement_rate | 84% }}%",
        "        label: Average hiring rate",
        "",
      ].join("\n"),
    );

    const sections = resolvePageSections(baseFile({ filePath }));
    expect(sections.map((s) => s.type)).toEqual(["schema_org", "graduates_stats"]);
  });
});

describe("ssr HTML cache FAQ helpers", () => {
  afterEach(() => {
    invalidateHtmlPageCache();
  });

  it("ssrCachePathCandidates includes home aliases and redirects", () => {
    const paths = ssrCachePathCandidates(
      baseFile({
        filePath: "x",
        meta: { redirects: ["/en", "/home"] },
      }),
      "/en/home",
    );
    expect(paths).toEqual(expect.arrayContaining(["/en/home", "/en", "/", "/home"]));
  });

  it("htmlContainsFaqPage detects FAQPage JSON-LD", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@type": "FAQPage",
      mainEntity: [],
    })}</script></head></html>`;
    expect(htmlContainsFaqPage(html)).toBe(true);
    expect(htmlContainsFaqPage("<html></html>")).toBe(false);
  });

  it("cachedSsrHtmlHasFaqPage finds FAQPage under /en alias for home", () => {
    const siteId = "site_4geeks-com";
    setCachedHtml(
      buildHtmlCacheKey(siteId, "/en", "live"),
      `<script type="application/ld+json">${JSON.stringify({
        "@type": "FAQPage",
        mainEntity: [{ "@type": "Question", name: "Q?" }],
      })}</script>`,
      200,
    );
    expect(
      cachedSsrHtmlHasFaqPage(
        baseFile({ filePath: "x", meta: { redirects: ["/en"] } }),
        "/en/home",
        `/tmp/${siteId}`,
      ),
    ).toBe(true);
  });
});

describe("schemaCompletenessValidator PAGE_NO_SCHEMA", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
    invalidateHtmlPageCache();
    __resetResolvePageSchemaDocumentsForTests();
    vi.restoreAllMocks();
  });

  it("does not flag pages whose YAML has schema_org plus unquoted template vars", async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(
      filePath,
      [
        "sections:",
        "  - type: schema_org",
        "    schema_type: Course",
        "  - type: hero",
        "    features:",
        "      - text: {{ global.ai_engineering_program_tracks | 22 Weeks }}",
        "",
      ].join("\n"),
    );

    const collector = await import("../../../server/page-schema-collect");
    vi.spyOn(collector, "resolvePageSchemaDocuments").mockResolvedValue({
      documents: [{ "@type": "Course", name: "AI", description: "Desc" }],
      preview: [
        {
          schema: { "@type": "Course", name: "AI Engineering", description: "Desc" },
          source: "schema_org",
        },
      ],
    });
    __resetResolvePageSchemaDocumentsForTests();

    const result = await schemaCompletenessValidator.run(
      context(baseFile({ slug: "ai-engineering", type: "program", filePath, url: "/en/career-programs/ai-engineering" })),
    );
    expect(result.warnings.filter((w) => w.code === "PAGE_NO_SCHEMA")).toEqual([]);
    expect(result.artifacts?.pagesWithSchema).toBe(1);
  });

  it("does not flag when merged entryFields has schema_org even if the file is unreadable YAML", async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(filePath, "sections: [this is: : not: valid\n");

    const collector = await import("../../../server/page-schema-collect");
    vi.spyOn(collector, "resolvePageSchemaDocuments").mockResolvedValue({
      documents: [{ "@type": "WebSite", name: "4Geeks" }],
      preview: [{ schema: { "@type": "WebSite", name: "4Geeks" }, source: "schema_org" }],
    });
    __resetResolvePageSchemaDocumentsForTests();

    const result = await schemaCompletenessValidator.run(
      context(
        baseFile({
          filePath,
          entryFields: {
            sections: [{ type: "schema_org", schema_type: "WebSite" }],
          },
        }),
      ),
    );
    expect(result.warnings.filter((w) => w.code === "PAGE_NO_SCHEMA")).toEqual([]);
  });

  it("still flags pages with no schema contributors", async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(filePath, "sections:\n  - type: hero\n");

    const result = await schemaCompletenessValidator.run(
      context(
        baseFile({
          filePath,
          entryFields: { sections: [{ type: "hero" }] },
        }),
      ),
    );
    expect(result.warnings.some((w) => w.code === "PAGE_NO_SCHEMA")).toBe(true);
    expect(result.artifacts?.pagesWithoutSchema).toBe(1);
  });

  it("does not emit FAQ_SECTION_NO_SCHEMA when preview has FAQ source even if cache is cold", async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(filePath, "sections:\n  - type: schema_org\n  - type: faq\n");

    const collector = await import("../../../server/page-schema-collect");
    vi.spyOn(collector, "resolvePageSchemaDocuments").mockResolvedValue({
      documents: [
        { "@type": "WebSite", name: "4Geeks", description: "desc" },
        { "@type": "FAQPage", mainEntity: [] },
      ],
      preview: [
        { schema: { "@type": "WebSite", name: "4Geeks", description: "desc" }, source: "schema_org" },
        { schema: { "@type": "FAQPage", mainEntity: [] }, source: "faq" },
      ],
    });
    __resetResolvePageSchemaDocumentsForTests();

    const result = await schemaCompletenessValidator.run(
      context(
        baseFile({
          filePath,
          url: "/en/home",
          entryFields: {
            sections: [
              { type: "schema_org", schema_type: "WebSite" },
              { type: "faq" },
            ],
          },
        }),
      ),
    );

    expect(result.warnings.filter((w) => w.code === "FAQ_SECTION_NO_SCHEMA")).toEqual([]);
  });

  it("does not require fields on undeclared FAQPage or BreadcrumbList JSON-LD", async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(filePath, "sections:\n  - type: schema_org\n  - type: faq\n");

    const collector = await import("../../../server/page-schema-collect");
    vi.spyOn(collector, "resolvePageSchemaDocuments").mockResolvedValue({
      documents: [
        { "@type": "Course", name: "AI Fluency", description: "A short program" },
        { "@type": "FAQPage", mainEntity: [] },
        { "@type": "BreadcrumbList", itemListElement: [] },
      ],
      preview: [
        {
          schema: { "@type": "Course", name: "AI Fluency", description: "A short program" },
          source: "schema_org",
        },
        { schema: { "@type": "FAQPage", mainEntity: [] }, source: "faq" },
        { schema: { "@type": "BreadcrumbList", itemListElement: [] }, source: "breadcrumb" },
      ],
    });
    __resetResolvePageSchemaDocumentsForTests();

    const result = await schemaCompletenessValidator.run(
      context(
        baseFile({
          filePath,
          url: "/en/career-programs/ai-fluency",
          entryFields: {
            sections: [
              { type: "schema_org", schema_type: "Course" },
              { type: "faq" },
            ],
          },
        }),
      ),
    );

    expect(result.warnings.filter((w) => w.code.startsWith("SCHEMA_MISSING_"))).toEqual([]);
    expect(result.warnings.filter((w) => w.code === "FAQ_SECTION_NO_SCHEMA")).toEqual([]);
  });

  it("warns when Course JSON-LD lacks name or description", async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(filePath, "sections:\n  - type: schema_org\n");

    const collector = await import("../../../server/page-schema-collect");
    vi.spyOn(collector, "resolvePageSchemaDocuments").mockResolvedValue({
      documents: [{ "@type": "Course" }],
      preview: [{ schema: { "@type": "Course" }, source: "schema_org" }],
    });
    __resetResolvePageSchemaDocumentsForTests();

    const result = await schemaCompletenessValidator.run(
      context(
        baseFile({
          filePath,
          url: "/en/career-programs/ai-fluency",
          entryFields: {
            sections: [{ type: "schema_org", schema_type: "Course" }],
          },
        }),
      ),
    );

    expect(result.warnings.some((w) => w.code === "SCHEMA_MISSING_NAME")).toBe(true);
    expect(result.warnings.some((w) => w.code === "SCHEMA_MISSING_DESCRIPTION")).toBe(true);
  });

  it("warns when BlogPosting JSON-LD lacks author", async () => {
    const { dir, cleanup } = tempDir();
    cleanups.push(cleanup);
    const filePath = join(dir, "en.yml");
    writeFileSync(filePath, "sections:\n  - type: article\n");

    const collector = await import("../../../server/page-schema-collect");
    vi.spyOn(collector, "resolvePageSchemaDocuments").mockResolvedValue({
      documents: [
        {
          "@type": "BlogPosting",
          headline: "My Post",
          description: "Summary",
          datePublished: "2024-01-01",
        },
      ],
      preview: [
        {
          schema: {
            "@type": "BlogPosting",
            headline: "My Post",
            description: "Summary",
            datePublished: "2024-01-01",
          },
          source: "article",
        },
      ],
    });
    __resetResolvePageSchemaDocumentsForTests();

    const result = await schemaCompletenessValidator.run(
      context(
        baseFile({
          filePath,
          type: "blog",
          slug: "my-post",
          url: "/en/blog/learn/my-post",
          entryFields: { sections: [{ type: "article" }] },
        }),
      ),
    );

    expect(result.warnings.some((w) => w.code === "SCHEMA_MISSING_AUTHOR")).toBe(true);
    expect(result.warnings.some((w) => w.code === "SCHEMA_MISSING_HEADLINE")).toBe(false);
  });
});
