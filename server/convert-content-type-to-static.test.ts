import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  convertContentTypeToStatic,
  ConvertToStaticError,
} from "./convert-content-type-to-static";
import { resetRegistry } from "./content-types";
import type { DatabaseManager } from "./database";

vi.mock("./markdown", () => ({
  fetchMarkdownContent: vi.fn(async (url: string) => {
    if (String(url).includes("fail")) return "";
    return `# Body from ${url}`;
  }),
}));

vi.mock("./sync-state", () => ({
  markFileAsModified: vi.fn(),
}));

vi.mock("./sitemap", () => ({
  clearSitemapCache: vi.fn(),
  refreshSitemapEntriesForContentKey: vi.fn(),
}));

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

function writeFixture(opts?: { withOverlay?: boolean; detached?: boolean; orphan?: boolean }) {
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `howto:
  directory: howto
  single_template: true
  url_pattern:
    en: /en/howto/:slug
    es: /es/howto/:slug
  field_mapping:
    title: title
    description: description
    content: content
    slug: slug
    locale: lang
  database:
    slug: howto_db
`,
    "utf-8",
  );

  const typeDir = path.join(contentRoot, "howto");
  fs.mkdirSync(typeDir, { recursive: true });
  for (const loc of ["en", "es"]) {
    fs.writeFileSync(
      path.join(typeDir, `template.${loc}.yml`),
      [
        "meta:",
        '  page_title: "{{ entry.title }}"',
        "sections:",
        "  - type: article",
        "    section_id: article-1",
        '    content: "{{ entry.content }}"',
        "",
      ].join("\n"),
      "utf-8",
    );
  }
  fs.writeFileSync(
    path.join(typeDir, "_common.template.yml"),
    "section_defaults:\n  maxWidth:\n    desktop: xl\n",
    "utf-8",
  );

  if (opts?.withOverlay) {
    const entryDir = path.join(typeDir, "hello-world");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, "_common.yml"),
      opts?.detached ? "detached: true\n" : "{}\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(entryDir, "en.yml"),
      yaml.dump({
        meta: {
          page_title: "Custom SEO Title",
          description: "Custom SEO description",
        },
      }),
      "utf-8",
    );
  }

  if (opts?.orphan) {
    const orphanDir = path.join(typeDir, "orphan-old");
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(path.join(orphanDir, "en.yml"), "title: Orphan\n", "utf-8");
  }

  fs.mkdirSync(path.join(contentRoot, "db", "howto_db"), { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "db", "howto_db", "config.yml"),
    "type: api\n",
    "utf-8",
  );
}

function mockDb(items: Record<string, unknown>[]): DatabaseManager {
  return {
    exists: () => true,
    getCacheInfo: () => ({ fetched_at: new Date().toISOString(), item_count: items.length }),
    fetchMappedItems: async () => items,
  } as unknown as DatabaseManager;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "convert-static-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  process.chdir(tempDir);
  resetRegistry(contentRoot);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("convertContentTypeToStatic", () => {
  it("dry-run preserves templates and lists orphans", async () => {
    writeFixture({ orphan: true });
    resetRegistry(contentRoot);
    const result = await convertContentTypeToStatic({
      contentType: "howto",
      contentRoot,
      dryRun: true,
      db: mockDb([
        {
          slug: "hello-world",
          title: "Hello",
          description: "Desc",
          content: "Inline body",
          lang: "en",
        },
      ]),
    });
    expect(result.dry_run).toBe(true);
    if (result.dry_run) {
      expect(result.templates_preserved.some((p) => p.includes("template.en.yml"))).toBe(true);
      expect(result.orphan_slug_folders).toContain("orphan-old");
      expect(result.message).toMatch(/preserve/i);
      expect(result.message).not.toMatch(/delete .*template/i);
    }
  });

  it("attached: keeps templates, writes data overlay, override wins on meta", async () => {
    writeFixture({ withOverlay: true });
    resetRegistry(contentRoot);
    const result = await convertContentTypeToStatic({
      contentType: "howto",
      contentRoot,
      dryRun: false,
      author: "test",
      db: mockDb([
        {
          slug: "hello-world",
          title: "DB Title",
          description: "DB description",
          content: "DB body content",
          lang: "en",
        },
      ]),
      refreshIndex: () => {},
      invalidateCommonFields: () => {},
    });
    expect(result.dry_run).toBe(false);
    if (!result.dry_run) {
      expect(result.templates_preserved.length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(contentRoot, "howto", "template.en.yml"))).toBe(true);
      expect(fs.existsSync(path.join(contentRoot, "howto", "template.es.yml"))).toBe(true);
    }

    const en = yaml.load(
      fs.readFileSync(path.join(contentRoot, "howto", "hello-world", "en.yml"), "utf-8"),
    ) as Record<string, unknown>;
    expect(en.content).toBe("DB body content");
    expect(en.sections).toBeUndefined();
    const meta = en.meta as Record<string, unknown>;
    expect(meta.page_title).toBe("Custom SEO Title");

    const types = yaml.load(
      fs.readFileSync(path.join(contentRoot, "content-types.yml"), "utf-8"),
    ) as Record<string, { database?: unknown; single_template?: boolean }>;
    expect(types.howto.database).toBeUndefined();
    expect(types.howto.single_template).toBe(true);
  });

  it("detached: bakes sections and keeps templates", async () => {
    writeFixture({ withOverlay: true, detached: true });
    resetRegistry(contentRoot);
    await convertContentTypeToStatic({
      contentType: "howto",
      contentRoot,
      dryRun: false,
      author: "test",
      db: mockDb([
        {
          slug: "hello-world",
          title: "Detached Title",
          content: "Detached body",
          lang: "en",
        },
      ]),
      refreshIndex: () => {},
      invalidateCommonFields: () => {},
    });

    expect(fs.existsSync(path.join(contentRoot, "howto", "template.en.yml"))).toBe(true);
    const en = yaml.load(
      fs.readFileSync(path.join(contentRoot, "howto", "hello-world", "en.yml"), "utf-8"),
    ) as Record<string, unknown>;
    expect(Array.isArray(en.sections)).toBe(true);
    expect((en.sections as unknown[]).length).toBeGreaterThan(0);
    const common = yaml.load(
      fs.readFileSync(path.join(contentRoot, "howto", "hello-world", "_common.yml"), "utf-8"),
    ) as Record<string, unknown>;
    expect(common.detached).toBe(true);
  });

  it("skips content_fetch_failed when remote body is empty", async () => {
    writeFixture();
    resetRegistry(contentRoot);
    const result = await convertContentTypeToStatic({
      contentType: "howto",
      contentRoot,
      dryRun: false,
      author: "test",
      db: mockDb([
        {
          slug: "broken-fetch",
          title: "Broken",
          content: "",
          content_url: "https://example.com/fail.md",
          lang: "en",
        },
      ]),
      refreshIndex: () => {},
      invalidateCommonFields: () => {},
    });
    expect(result.dry_run).toBe(false);
    if (!result.dry_run) {
      expect(result.skipped.some((s) => s.reason === "content_fetch_failed")).toBe(true);
      expect(fs.existsSync(path.join(contentRoot, "howto", "broken-fetch"))).toBe(false);
    }
  });

  it("leaves draft files and orphan folders untouched", async () => {
    writeFixture({ withOverlay: true, orphan: true });
    const entryDir = path.join(contentRoot, "howto", "hello-world");
    fs.writeFileSync(path.join(entryDir, "draft.en.yml"), "title: Draft\n", "utf-8");
    resetRegistry(contentRoot);

    const result = await convertContentTypeToStatic({
      contentType: "howto",
      contentRoot,
      dryRun: false,
      author: "test",
      db: mockDb([
        {
          slug: "hello-world",
          title: "Hello",
          content: "Body",
          lang: "en",
        },
      ]),
      refreshIndex: () => {},
      invalidateCommonFields: () => {},
    });

    expect(fs.existsSync(path.join(entryDir, "draft.en.yml"))).toBe(true);
    expect(fs.existsSync(path.join(contentRoot, "howto", "orphan-old", "en.yml"))).toBe(true);
    if (!result.dry_run) {
      expect(result.orphan_slug_folders).toContain("orphan-old");
    }
  });

  it("throws when no database configured", async () => {
    writeFixture();
    fs.writeFileSync(
      path.join(contentRoot, "content-types.yml"),
      `howto:
  directory: howto
  single_template: true
  url_pattern:
    en: /en/howto/:slug
  field_mapping:
    title: title
`,
      "utf-8",
    );
    resetRegistry(contentRoot);
    await expect(
      convertContentTypeToStatic({
        contentType: "howto",
        contentRoot,
        dryRun: true,
        db: mockDb([]),
      }),
    ).rejects.toBeInstanceOf(ConvertToStaticError);
  });
});
