import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasStaticSharedLayoutEntryLocale,
  loadMergedSinglePage,
  mergeSingleTemplate,
  resolveDetachedEntryLocalePath,
} from "./database-single-loader";
import { resetRegistry, resolveEntryUpdatedAt } from "./content-types";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

function writeTypes(extraUrlParams = false) {
  const urlPattern = extraUrlParams
    ? `  url_pattern:
    en: /en/blog/:category/:slug
    es: /es/blog/:category/:slug`
    : `  url_pattern:
    en: /en/blog/:slug
    es: /es/blog/:slug`;
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
    description: description
    content: content
    category:
      source: category
      default: general
    _slug: slug
    _locale: locale
${urlPattern}
`,
    "utf-8",
  );
}

function writeSingleTemplates() {
  const blogDir = path.join(contentRoot, "blog");
  fs.mkdirSync(blogDir, { recursive: true });
  for (const loc of ["en", "es"]) {
    fs.writeFileSync(
      path.join(blogDir, `single.${loc}.yml`),
      [
        "meta:",
        '  page_title: "{{ single.title }}"',
        "sections:",
        "  - type: article",
        "    section_id: article-1",
        "    show_toc: true",
        '    content: "{{ single.content }}"',
        "",
      ].join("\n"),
      "utf-8",
    );
  }
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-single-loader-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  writeTypes(true);
  writeSingleTemplates();
  process.chdir(tempDir);
  resetRegistry(contentRoot);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("hasStaticSharedLayoutEntryLocale", () => {
  it("is false when the entry locale file is missing", () => {
    expect(
      hasStaticSharedLayoutEntryLocale("blog", "missing-slug", "es", contentRoot),
    ).toBe(false);
  });

  it("is true when {slug}/{locale}.yml exists", () => {
    const entryDir = path.join(contentRoot, "blog", "real-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "es.yml"), "title: Real\ncontent: Body\n", "utf-8");
    expect(
      hasStaticSharedLayoutEntryLocale("blog", "real-post", "es", contentRoot),
    ).toBe(true);
    expect(
      hasStaticSharedLayoutEntryLocale("blog", "real-post", "en", contentRoot),
    ).toBe(false);
  });
});

describe("resolveDetachedEntryLocalePath", () => {
  it("prefers {variant}.{locale}.yml when previewing a draft-only entry", () => {
    const entryDir = path.join(contentRoot, "blog", "deletemenow");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "draft.en.yml"), "title: Draft\n", "utf-8");

    expect(resolveDetachedEntryLocalePath(entryDir, "en")).toBeNull();
    expect(resolveDetachedEntryLocalePath(entryDir, "en", "draft")).toBe(
      path.join(entryDir, "draft.en.yml"),
    );
  });

  it("falls back to live {locale}.yml when the variant file is missing", () => {
    const entryDir = path.join(contentRoot, "blog", "live-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "en.yml"), "title: Live\n", "utf-8");

    expect(resolveDetachedEntryLocalePath(entryDir, "en", "draft")).toBe(
      path.join(entryDir, "en.yml"),
    );
  });
});

describe("loadMergedSinglePage static shared-layout", () => {
  it("returns null for a missing slug (no empty single.*.yml shell)", async () => {
    const page = await loadMergedSinglePage(
      "blog",
      "mejores-agentes-de-codigo8",
      "es",
      contentRoot,
    );
    expect(page).toBeNull();
  });

  it("returns the merged template when the entry locale exists", async () => {
    const entryDir = path.join(contentRoot, "blog", "real-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, "_common.yml"),
      "category:\n  slug: herramientas-ia\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(entryDir, "es.yml"),
      "title: Real Post\ncontent: \"# Hello\"\n",
      "utf-8",
    );

    const page = await loadMergedSinglePage("blog", "real-post", "es", contentRoot);
    expect(page).not.toBeNull();
    expect(page?.sections?.some((s) => (s as { type?: string }).type === "article")).toBe(
      true,
    );
  });
});

describe("mergeSingleTemplate shell editorial dates", () => {
  it("does not leak template updated_at onto an entry that only has published_at", () => {
    const blogDir = path.join(contentRoot, "blog");
    fs.writeFileSync(
      path.join(blogDir, "template.es.yml"),
      [
        "sections:",
        "  - type: hero",
        "    variant: blogHero",
        '    title: "{{ entry.title }}"',
        '    updated_at: "{{ entry.updated_at }}"',
        'updated_at: "2022-11-30T12:02:10.252Z"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const entryDir = path.join(blogDir, "como-configurar-grok-bot");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, "es.yml"),
      [
        'title: "Cómo configurar Grok Bot"',
        "sections: []",
        'published_at: "2026-08-18T00:00:00.000Z"',
        "",
      ].join("\n"),
      "utf-8",
    );

    const merged = mergeSingleTemplate(
      "blog",
      "es",
      "como-configurar-grok-bot",
      undefined,
      contentRoot,
    );
    expect(merged).not.toBeNull();
    expect(merged?.updated_at).toBeUndefined();
    expect(merged?.published_at).toBe("2026-08-18T00:00:00.000Z");

    const iso = resolveEntryUpdatedAt({
      contentType: "blog",
      slug: "como-configurar-grok-bot",
      locale: "es",
      record: merged ?? undefined,
      contentRoot,
      isDb: false,
    });
    expect(iso).toBe("2026-08-18T00:00:00.000Z");
  });

  it("keeps template updated_at when loading the shell without an entry slug", () => {
    const blogDir = path.join(contentRoot, "blog");
    fs.writeFileSync(
      path.join(blogDir, "template.es.yml"),
      [
        "sections:",
        "  - type: hero",
        "    variant: blogHero",
        'updated_at: "2022-11-30T12:02:10.252Z"',
        "",
      ].join("\n"),
      "utf-8",
    );

    const shell = mergeSingleTemplate("blog", "es", undefined, undefined, contentRoot);
    expect(shell?.updated_at).toBe("2022-11-30T12:02:10.252Z");
  });

  it("preserves an entry's own updated_at over the stripped shell", () => {
    const blogDir = path.join(contentRoot, "blog");
    fs.writeFileSync(
      path.join(blogDir, "template.es.yml"),
      [
        "sections:",
        "  - type: article",
        'updated_at: "2022-11-30T12:02:10.252Z"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const entryDir = path.join(blogDir, "fresh-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, "es.yml"),
      [
        "title: Fresh",
        "sections: []",
        'updated_at: "2026-08-20T10:00:00.000Z"',
        'published_at: "2026-08-18T00:00:00.000Z"',
        "",
      ].join("\n"),
      "utf-8",
    );

    const merged = mergeSingleTemplate("blog", "es", "fresh-post", undefined, contentRoot);
    expect(merged?.updated_at).toBe("2026-08-20T10:00:00.000Z");
  });
});

describe("mergeSingleTemplate entryVariant (attached draft preview)", () => {
  it("overlays draft.{locale}.yml onto the template while keeping shell sections", () => {
    const blogDir = path.join(contentRoot, "blog");
    fs.writeFileSync(
      path.join(blogDir, "template.en.yml"),
      [
        "sections:",
        "  - type: article",
        "    section_id: article-1",
        '    content: "{{ entry.content }}"',
        "  - type: hero",
        "    section_id: hero-1",
        '    title: "{{ entry.title }}"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const entryDir = path.join(blogDir, "draft-only-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "_common.yml"), "category: general\n", "utf-8");
    fs.writeFileSync(
      path.join(entryDir, "draft.en.yml"),
      [
        "title: Draft Title",
        "content: Draft body markdown",
        "sections: []",
        "",
      ].join("\n"),
      "utf-8",
    );

    const merged = mergeSingleTemplate(
      "blog",
      "en",
      "draft-only-post",
      undefined,
      contentRoot,
      undefined,
      "draft",
    );
    expect(merged).not.toBeNull();
    expect(merged?.title).toBe("Draft Title");
    expect(merged?.content).toBe("Draft body markdown");
    const sections = merged?.sections as Array<{ type?: string; section_id?: string }>;
    expect(sections?.map((s) => s.type)).toEqual(["article", "hero"]);
    expect(sections?.some((s) => s.section_id === "article-1")).toBe(true);
  });

  it("prefers draft fields over a live locale when entryVariant is set", () => {
    const blogDir = path.join(contentRoot, "blog");
    fs.writeFileSync(
      path.join(blogDir, "template.en.yml"),
      [
        "sections:",
        "  - type: article",
        "    section_id: article-1",
        '    content: "{{ entry.content }}"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const entryDir = path.join(blogDir, "live-and-draft");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, "en.yml"),
      "title: Live Title\ncontent: Live body\nsections: []\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(entryDir, "draft.en.yml"),
      "title: Draft Title\ncontent: Draft body\nsections: []\n",
      "utf-8",
    );

    const merged = mergeSingleTemplate(
      "blog",
      "en",
      "live-and-draft",
      undefined,
      contentRoot,
      undefined,
      "draft",
    );
    expect(merged?.title).toBe("Draft Title");
    expect(merged?.content).toBe("Draft body");
    expect((merged?.sections as unknown[])?.length).toBe(1);
  });

  it("returns null when the requested entry variant file is missing", () => {
    const blogDir = path.join(contentRoot, "blog");
    fs.writeFileSync(
      path.join(blogDir, "template.en.yml"),
      "sections:\n  - type: article\n    section_id: article-1\n",
      "utf-8",
    );
    const entryDir = path.join(blogDir, "no-draft");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "en.yml"), "title: Live\nsections: []\n", "utf-8");

    expect(
      mergeSingleTemplate("blog", "en", "no-draft", undefined, contentRoot, undefined, "draft"),
    ).toBeNull();
  });
});
