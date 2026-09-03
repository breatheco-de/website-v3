import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { resolvePreviewBaseSlug } from "./shared-layout-entry";
import { VersioningManager } from "./versioning/VersioningManager";
import { registerContentRoutes } from "./routes/content";
import { registerVersioningRoutes } from "./routes/versioning";

const URL_SLUG = "what-is-cloudflare-os-open-source-agent-workspace";
const FOLDER_SLUG = "cloudflareos";
const ARTICLE_TITLE = "What Is Cloudflare OS";
const TEMPLATE_LEAK = "TEMPLATE_SHELL_MUST_NOT_LEAK";

let tempDir: string;
let contentRoot: string;
let ci: ContentIndex;
let server: http.Server | null = null;
let baseUrl = "";

function writeFixture() {
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
    description: description
    content: content
    _slug: slug
    _locale: locale
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
    [
      "meta:",
      `  page_title: ${TEMPLATE_LEAK}`,
      "sections:",
      "  - type: hero",
      "    title: \"{{ single.title }}\"",
      "",
    ].join("\n"),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(blogDir, "single.es.yml"),
    [
      "meta:",
      `  page_title: ${TEMPLATE_LEAK}`,
      "sections:",
      "  - type: hero",
      "    title: \"{{ single.title }}\"",
      "",
    ].join("\n"),
    "utf-8",
  );

  const entryDir = path.join(blogDir, FOLDER_SLUG);
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(
    path.join(entryDir, "_common.yml"),
    [
      `title: ${ARTICLE_TITLE}`,
      "description: Cloudflare OS overview",
      "category: ai-powered-learning",
      "detached: true",
      "",
    ].join("\n"),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(entryDir, "en.yml"),
    [
      `slug: ${URL_SLUG}`,
      `title: ${ARTICLE_TITLE}`,
      "content: |",
      "  Article body about Cloudflare OS",
      "sections:",
      "  - type: article",
      "    content: Article body about Cloudflare OS",
      "",
    ].join("\n"),
    "utf-8",
  );
}

async function startServer() {
  const app = express();
  const versioningManager = new VersioningManager(contentRoot);
  app.use((_req, res, next) => {
    res.locals.site = {
      contentIndex: ci,
      contentRoot,
      versioningManager,
      entryPreviewManager: {
        resolveEffectiveImage: async () => ({ url: null }),
      },
    } as any;
    next();
  });
  registerContentRoutes(app);
  registerVersioningRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function getJson(pathname: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${pathname}`);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "content-pages-locale-slug-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  writeFixture();
  resetRegistry(contentRoot);
  ci = new ContentIndex(contentRoot);
  ci.scanFast();
  await startServer();
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
    server = null;
  }
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("GET /api/content-pages locale slugs", () => {
  it("resolves the public article slug to the YAML folder", async () => {
    expect(resolvePreviewBaseSlug(URL_SLUG, "blog", ci)).toBe(FOLDER_SLUG);
    expect(resolvePreviewBaseSlug(FOLDER_SLUG, "blog", ci)).toBe(FOLDER_SLUG);

    const { status, body } = await getJson(
      `/api/content-pages/blog/${URL_SLUG}?locale=en`,
    );
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(JSON.stringify(body)).toContain(ARTICLE_TITLE);
    expect(JSON.stringify(body)).toContain("Article body about Cloudflare OS");
    expect(JSON.stringify(body)).not.toContain(TEMPLATE_LEAK);
  });

  it("still 404s unknown slugs without returning the empty single template", async () => {
    const { status, body } = await getJson(
      `/api/content-pages/blog/not-a-post?locale=en`,
    );
    expect(status).toBe(404);
    expect(body.error).not.toBe("locale_unavailable");
    expect(JSON.stringify(body)).not.toContain(TEMPLATE_LEAK);
    expect(JSON.stringify(body)).not.toContain("{{ single.title }}");
  });

  it("returns locale-unavailable for an EN-only post in es", async () => {
    const { status, body } = await getJson(
      `/api/content-pages/blog/${URL_SLUG}?locale=es`,
    );
    expect(status).toBe(404);
    expect(body.error).toBe("locale_unavailable");
    expect(body.code).toBe("EMPTY_LOCALE");
    expect(body.locale).toBe("es");
    expect(JSON.stringify(body)).not.toContain(TEMPLATE_LEAK);
  });
});

describe("folder-wins resolveBaseSlug", () => {
  it("does not remap a locale slug when a real folder uses that name", () => {
    const collisionDir = path.join(contentRoot, "blog", URL_SLUG);
    fs.mkdirSync(collisionDir, { recursive: true });
    fs.writeFileSync(
      path.join(collisionDir, "_common.yml"),
      "title: Collision folder\ndetached: true\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(collisionDir, "en.yml"),
      "title: Collision folder\ncontent: from folder\n",
      "utf-8",
    );
    ci.scanFast();
    expect(ci.resolveBaseSlug(URL_SLUG, "blog")).toBe(URL_SLUG);
    expect(resolvePreviewBaseSlug(URL_SLUG, "blog", ci)).toBe(URL_SLUG);
  });
});

describe("GET /api/versioning and /api/variants locale slugs", () => {
  it("reads versioning from the folder, not a missing URL-slug path", async () => {
    const versioning = await getJson(`/api/versioning/blog/${URL_SLUG}`);
    expect(versioning.status).toBe(200);
    expect(versioning.body.versioningSlug).toBe(FOLDER_SLUG);
    expect(versioning.body.detached).toBe(true);
    expect(String(versioning.body.filePath)).toContain(FOLDER_SLUG);
    expect(versioning.body.versioningSlug).not.toBe("single");

    const variants = await getJson(`/api/variants/blog/${URL_SLUG}`);
    expect(variants.status).toBe(200);
    expect(variants.body.slug).toBe(FOLDER_SLUG);
    expect(String(variants.body.folderPath)).toContain(FOLDER_SLUG);
  });
});

describe("GET /api/content-pages attached entry draft preview", () => {
  it("merges template sections with draft.{locale}.yml fields", async () => {
    const blogDir = path.join(contentRoot, "blog");
    fs.writeFileSync(
      path.join(blogDir, "template.en.yml"),
      [
        "meta:",
        '  page_title: "{{ entry.title }}"',
        "sections:",
        "  - type: hero",
        "    section_id: hero-1",
        '    title: "{{ entry.title }}"',
        "  - type: article",
        "    section_id: article-1",
        '    content: "{{ entry.content }}"',
        "",
      ].join("\n"),
      "utf-8",
    );
    const entryDir = path.join(blogDir, "attached-draft-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, "_common.yml"),
      "category: ai-powered-learning\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(entryDir, "draft.en.yml"),
      [
        "slug: attached-draft-post",
        "title: Attached Draft Title",
        "content: |",
        "  Draft article body",
        "sections: []",
        "",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(entryDir, "versioning.yml"),
      "en:\n  variants:\n    - slug: draft\n      allocation: 0\n",
      "utf-8",
    );
    ci.scanFast();

    const { status, body } = await getJson(
      "/api/content-pages/blog/attached-draft-post?locale=en&force_variant=draft",
    );
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.detached).toBe(false);
    expect(JSON.stringify(body)).toContain("Attached Draft Title");
    expect(JSON.stringify(body)).toContain("Draft article body");
    const sections = body.sections as Array<{ type?: string }>;
    expect(Array.isArray(sections)).toBe(true);
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.map((s) => s.type)).toEqual(expect.arrayContaining(["hero", "article"]));
  });
});
