import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import yaml from "js-yaml";
import { ContentIndex } from "../../../server/content-index";
import { localeSlugUniquenessValidator } from "./locale-slug-uniqueness";
import type { ContentFile, ValidationContext } from "../shared/types";

function makeContext(
  contentRoot: string,
  files: ContentFile[],
  contentIndex?: ContentIndex,
): ValidationContext {
  return {
    contentRoot,
    contentIndex,
    contentFiles: files,
    redirectMap: new Map(),
    validUrls: new Set(),
    availableSchemas: new Set(),
    sitemapEntries: [],
  };
}

function writeContentTypes(tmp: string, types: Record<string, unknown>): void {
  fs.writeFileSync(path.join(tmp, "content-types.yml"), yaml.dump(types));
}

describe("localeSlugUniquenessValidator", () => {
  let tmp = "";

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "locale-slug-val-"));
    writeContentTypes(tmp, {
      blog: {
        directory: "blog",
        url_pattern: {
          en: "/en/blog/:category/:slug",
          es: "/es/blog/:category/:slug",
        },
        field_mapping: { title: "title", category: "category", slug: "slug" },
      },
      program: {
        directory: "programs",
        url_pattern: {
          en: "/en/career-programs/:slug",
          es: "/es/programas-de-carrera/:slug",
        },
        field_mapping: { title: "title", slug: "slug" },
      },
      landing: {
        directory: "landings",
        url_pattern: { default: "/landing/:slug" },
        field_mapping: { title: "title", slug: "slug" },
      },
      "how-to": {
        directory: "how-to",
        database: { slug: "how_to" },
        url_pattern: {
          en: "/en/how-to/:slug",
          es: "/es/how-to/:slug",
        },
        field_mapping: { title: "title", slug: "slug" },
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("warns when blog en and es share the same explicit slug", async () => {
    const entryDir = path.join(tmp, "blog", "shared-slug-post");
    fs.mkdirSync(entryDir, { recursive: true });
    const enPath = path.join(entryDir, "en.yml");
    const esPath = path.join(entryDir, "es.yml");
    fs.writeFileSync(enPath, yaml.dump({ slug: "same-slug", category: "ai-tools", title: "EN" }));
    fs.writeFileSync(esPath, yaml.dump({ slug: "same-slug", category: "herramientas-ia", title: "ES" }));

    const ci = new ContentIndex(tmp);
    ci.scanFast();

    const result = await localeSlugUniquenessValidator.run(
      makeContext(
        tmp,
        [
          {
            type: "blog",
            slug: "shared-slug-post",
            locale: "en",
            filePath: enPath,
            title: "EN",
            entryFields: { slug: "same-slug", category: "ai-tools" },
          },
        ],
        ci,
      ),
    );

    expect(result.status).toBe("warning");
    expect(result.warnings.some((w) => w.code === "SLUG_SHARED_ACROSS_LOCALES")).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("passes when blog en and es use different slugs", async () => {
    const entryDir = path.join(tmp, "blog", "localized-post");
    fs.mkdirSync(entryDir, { recursive: true });
    const enPath = path.join(entryDir, "en.yml");
    const esPath = path.join(entryDir, "es.yml");
    fs.writeFileSync(enPath, yaml.dump({ slug: "ai-agent-governance", category: "ai-tools", title: "EN" }));
    fs.writeFileSync(
      esPath,
      yaml.dump({ slug: "gobernanza-agentes-ia", category: "herramientas-ia", title: "ES" }),
    );

    const ci = new ContentIndex(tmp);
    ci.scanFast();

    const result = await localeSlugUniquenessValidator.run(
      makeContext(
        tmp,
        [
          {
            type: "blog",
            slug: "localized-post",
            locale: "en",
            filePath: enPath,
            title: "EN",
            entryFields: { slug: "ai-agent-governance", category: "ai-tools" },
          },
        ],
        ci,
      ),
    );

    expect(result.status).toBe("passed");
    expect(result.warnings).toHaveLength(0);
  });

  it("warns when program locales rely on the same implicit folder slug", async () => {
    const entryDir = path.join(tmp, "programs", "ai-flex");
    fs.mkdirSync(entryDir, { recursive: true });
    const enPath = path.join(entryDir, "en.yml");
    const esPath = path.join(entryDir, "es.yml");
    fs.writeFileSync(enPath, yaml.dump({ title: "AI Flex EN" }));
    fs.writeFileSync(esPath, yaml.dump({ title: "AI Flex ES" }));

    const ci = new ContentIndex(tmp);
    ci.scanFast();

    const result = await localeSlugUniquenessValidator.run(
      makeContext(
        tmp,
        [
          {
            type: "program",
            slug: "ai-flex",
            locale: "en",
            filePath: enPath,
            title: "AI Flex EN",
            entryFields: { title: "AI Flex EN" },
          },
        ],
        ci,
      ),
    );

    expect(result.status).toBe("warning");
    expect(result.warnings.some((w) => w.code === "SLUG_SHARED_ACROSS_LOCALES")).toBe(true);
  });

  it("passes for a single-locale entry", async () => {
    const entryDir = path.join(tmp, "blog", "en-only");
    fs.mkdirSync(entryDir, { recursive: true });
    const enPath = path.join(entryDir, "en.yml");
    fs.writeFileSync(enPath, yaml.dump({ slug: "en-only", category: "ai-tools", title: "EN" }));

    const ci = new ContentIndex(tmp);
    ci.scanFast();

    const result = await localeSlugUniquenessValidator.run(
      makeContext(
        tmp,
        [
          {
            type: "blog",
            slug: "en-only",
            locale: "en",
            filePath: enPath,
            title: "EN",
            entryFields: { slug: "en-only", category: "ai-tools" },
          },
        ],
        ci,
      ),
    );

    expect(result.status).toBe("passed");
    expect(result.warnings).toHaveLength(0);
  });

  it("skips landing with default-only url_pattern", async () => {
    const entryDir = path.join(tmp, "landings", "promo");
    fs.mkdirSync(entryDir, { recursive: true });
    const enPath = path.join(entryDir, "en.yml");
    const esPath = path.join(entryDir, "es.yml");
    fs.writeFileSync(enPath, yaml.dump({ slug: "promo", title: "EN" }));
    fs.writeFileSync(esPath, yaml.dump({ slug: "promo", title: "ES" }));

    const ci = new ContentIndex(tmp);
    ci.scanFast();

    const result = await localeSlugUniquenessValidator.run(
      makeContext(
        tmp,
        [
          {
            type: "landing",
            slug: "promo",
            locale: "en",
            filePath: enPath,
            title: "EN",
            entryFields: { slug: "promo" },
          },
        ],
        ci,
      ),
    );

    expect(result.status).toBe("passed");
    expect(result.warnings).toHaveLength(0);
  });

  it("skips database-backed content types", async () => {
    const result = await localeSlugUniquenessValidator.run(
      makeContext(tmp, [
        {
          type: "how-to",
          slug: "some-how-to",
          locale: "en",
          filePath: path.join(tmp, "how-to", "some-how-to", "en.yml"),
          title: "How to",
          entryFields: { slug: "some-how-to" },
        },
        {
          type: "how-to",
          slug: "some-how-to",
          locale: "es",
          filePath: path.join(tmp, "how-to", "some-how-to", "es.yml"),
          title: "Cómo",
          entryFields: { slug: "some-how-to" },
        },
      ]),
    );

    expect(result.status).toBe("passed");
    expect(result.warnings).toHaveLength(0);
  });

  it("detects sibling locales on on-save context via contentIndex", async () => {
    const entryDir = path.join(tmp, "blog", "on-save-post");
    fs.mkdirSync(entryDir, { recursive: true });
    const enPath = path.join(entryDir, "en.yml");
    const esPath = path.join(entryDir, "es.yml");
    fs.writeFileSync(enPath, yaml.dump({ slug: "shared-on-save", category: "ai-tools", title: "EN" }));
    fs.writeFileSync(esPath, yaml.dump({ slug: "shared-on-save", category: "herramientas-ia", title: "ES" }));

    const ci = new ContentIndex(tmp);
    ci.scanFast();

    const result = await localeSlugUniquenessValidator.run(
      makeContext(
        tmp,
        [
          {
            type: "blog",
            slug: "on-save-post",
            locale: "en",
            filePath: enPath,
            title: "EN",
            entryFields: { slug: "shared-on-save", category: "ai-tools" },
          },
        ],
        ci,
      ),
    );

    expect(result.status).toBe("warning");
    expect(result.warnings.some((w) => w.code === "SLUG_SHARED_ACROSS_LOCALES")).toBe(true);
    expect(result.warnings.some((w) => w.file === esPath)).toBe(true);
  });
});
