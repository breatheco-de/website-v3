import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearPublishedAtFromCommon,
  ensurePublishedAtOnce,
  isPublishedAtEmpty,
  readPublishedAt,
  setPublishedAt,
} from "./published-at";
import { writeFieldOverrides } from "./field-overrides";
import { resetRegistry } from "./content-types";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "published-at-test-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(path.join(contentRoot, "blog", "post-a"), { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
    published_at: published_at
    _slug: slug
    _locale: locale
  url_pattern:
    en: /en/blog/:slug
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "blog", "post-a", "_common.yml"),
    "title: Post A\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "blog", "post-a", "en.yml"),
    "slug: post-a\nsections: []\n",
    "utf-8",
  );
  process.chdir(tempDir);
  resetRegistry(contentRoot);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("published-at helper", () => {
  it("treats missing and empty as empty", () => {
    expect(isPublishedAtEmpty(undefined)).toBe(true);
    expect(isPublishedAtEmpty("")).toBe(true);
    expect(isPublishedAtEmpty("  ")).toBe(true);
    expect(isPublishedAtEmpty("2026-07-08T00:00:00.000Z")).toBe(false);
  });

  it("ensurePublishedAtOnce stamps when missing and no-ops when set", () => {
    const first = ensurePublishedAtOnce("blog", "post-a", {
      contentRoot,
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(first.written).toBe(true);
    expect(readPublishedAt("blog", "post-a", contentRoot)).toBe("2026-01-01T00:00:00.000Z");

    const second = ensurePublishedAtOnce("blog", "post-a", {
      contentRoot,
      now: "2026-12-01T00:00:00.000Z",
    });
    expect(second.written).toBe(false);
    expect(readPublishedAt("blog", "post-a", contentRoot)).toBe("2026-01-01T00:00:00.000Z");
  });

  it("clearPublishedAtFromCommon removes the key", () => {
    setPublishedAt("blog", "post-a", "2026-02-02T00:00:00.000Z", undefined, contentRoot);
    clearPublishedAtFromCommon("blog", "post-a", undefined, contentRoot);
    expect(isPublishedAtEmpty(readPublishedAt("blog", "post-a", contentRoot))).toBe(true);
  });

  it("setPublishedAt rejects empty", () => {
    const r = setPublishedAt("blog", "post-a", "", undefined, contentRoot);
    expect(r.success).toBe(false);
  });

  it("setPublishedAt keeps unquoted {{ }} placeholders in _common.yml", () => {
    const commonPath = path.join(contentRoot, "blog", "post-a", "_common.yml");
    fs.writeFileSync(commonPath, "title: Post A\nimage: {{ entry.hero | /fallback.webp }}\n", "utf-8");
    expect(setPublishedAt("blog", "post-a", "2026-03-03T00:00:00.000Z", undefined, contentRoot).success).toBe(true);
    const written = fs.readFileSync(commonPath, "utf-8");
    expect(written).toContain("image: {{ entry.hero | /fallback.webp }}");
    expect(written).not.toContain("[object Object]");
  });

  it("setPublishedAt blocks the write when _common.yml already has a destroyed placeholder", () => {
    const commonPath = path.join(contentRoot, "blog", "post-a", "_common.yml");
    const before = "title: Post A\nimage:\n  '[object Object]': null\n";
    fs.writeFileSync(commonPath, before, "utf-8");
    const r = setPublishedAt("blog", "post-a", "2026-03-03T00:00:00.000Z", undefined, contentRoot);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Save blocked/);
    expect(fs.readFileSync(commonPath, "utf-8")).toBe(before);
  });
});

describe("writeFieldOverrides published_at for static", () => {
  it("writes _common.yml and clears locale override", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "en.yml"),
      "slug: post-a\nsections: []\nmeta:\n  page_title: Post A\n  description: Test description\nfield_overrides:\n  published_at: '2020-01-01T00:00:00.000Z'\n  title: Old\n",
      "utf-8",
    );

    const result = writeFieldOverrides(
      "blog",
      "post-a",
      "en",
      { published_at: "2026-06-01T12:00:00.000Z" },
      undefined,
      contentRoot,
    );
    expect(result.success).toBe(true);
    expect(readPublishedAt("blog", "post-a", contentRoot)).toBe("2026-06-01T12:00:00.000Z");

    const locale = fs.readFileSync(path.join(contentRoot, "blog", "post-a", "en.yml"), "utf-8");
    expect(locale).not.toMatch(/published_at/);
    expect(locale).toMatch(/title: Old/);
  });

  it("rejects clearing published_at", () => {
    const result = writeFieldOverrides(
      "blog",
      "post-a",
      "en",
      { published_at: "" },
      undefined,
      contentRoot,
    );
    expect(result.success).toBe(false);
  });
});
