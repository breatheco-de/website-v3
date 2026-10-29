import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createContentEntry,
  SINGLE_LOCALE_CREATE_ERROR,
} from "./content-editor";
import { resetRegistry } from "./content-types";
import { isDraftEntry, rejectLiveWriteIfDraft } from "./draft-entry";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;
let rootName: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "single-locale-create-"));
  rootName = "site_test";
  contentRoot = path.join(tempDir, rootName);
  fs.mkdirSync(path.join(contentRoot, "blog"), { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
    _slug: slug
    _locale: locale
  url_pattern:
    en: /en/blog/:slug
    es: /es/blog/:slug
`,
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

describe("single-locale create (all types)", () => {
  it("rejects create when more than one locale is active", async () => {
    const result = await createContentEntry({
      type: "blog",
      title: "Test Post",
      slugEn: "test-post",
      slugEs: "test-post",
      skipLocales: [],
      contentRootName: rootName,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe(SINGLE_LOCALE_CREATE_ERROR);
    }
  });

  it("rejects when zero locales remain after skipLocales", async () => {
    const result = await createContentEntry({
      type: "blog",
      title: "Test Post",
      slugEn: "test-post",
      skipLocales: ["en", "es"],
      contentRootName: rootName,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(SINGLE_LOCALE_CREATE_ERROR);
    }
  });
});

describe("duplicate never carries a funnel", () => {
  it("drops funnel from the copied _common.yml and from copied language files", async () => {
    const src = path.join(contentRoot, "blog", "source-post");
    fs.mkdirSync(src, { recursive: true });
    const funnel = { stage: "consideration", products: [{ product: "ai-flex", persona: "the-explorer" }] };
    fs.writeFileSync(path.join(src, "_common.yml"), yaml.dump({ slug: "source-post", funnel }), "utf-8");
    fs.writeFileSync(
      path.join(src, "en.yml"),
      yaml.dump({ slug: "source-post", title: "Source", funnel, sections: [] }),
      "utf-8",
    );
    resetRegistry(contentRoot);

    const result = await createContentEntry({
      type: "blog",
      title: "Copy",
      slugEn: "copy-post",
      sourceSlug: "source-post",
      skipLocales: ["es"],
      contentRootName: rootName,
    });
    expect(result.success).toBe(true);
    const dir = path.join(contentRoot, "blog", "copy-post");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yml"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const doc = yaml.load(fs.readFileSync(path.join(dir, f), "utf-8")) as Record<string, unknown> | null;
      expect(doc?.funnel, f).toBeUndefined();
    }
  });
});

describe("shared-template create starts as a draft", () => {
  it("writes draft.{locale}.yml + versioning.yml, no live file and no published_at", async () => {
    const result = await createContentEntry({
      type: "blog",
      title: "Draft Post",
      slugEn: "draft-post",
      skipLocales: ["es"],
      contentRootName: rootName,
    });
    expect(result.success).toBe(true);
    const dir = path.join(contentRoot, "blog", "draft-post");
    expect(fs.existsSync(path.join(dir, "en.yml"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "draft.en.yml"))).toBe(true);
    const versioning = yaml.load(fs.readFileSync(path.join(dir, "versioning.yml"), "utf-8")) as Record<string, any>;
    expect(versioning.en.variants).toEqual([{ slug: "draft", allocation: 0 }]);
    const common = (yaml.load(fs.readFileSync(path.join(dir, "_common.yml"), "utf-8")) as Record<string, unknown>) ?? {};
    expect(common.published_at).toBeUndefined();
    const draft = yaml.load(fs.readFileSync(path.join(dir, "draft.en.yml"), "utf-8")) as Record<string, any>;
    expect(draft.title).toBe("Draft Post");
    expect(draft.sections ?? []).toEqual([]);
    expect(draft._draft.based_on.locale).toBeNull();
    expect(isDraftEntry("blog", "draft-post", contentRoot)).toBe(true);
  });

  it("rejects live writes on an attached draft-only entry without a variant", () => {
    const dir = path.join(contentRoot, "blog", "only-draft");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "draft.en.yml"), "slug: only-draft\ntitle: X\n");
    const gate = rejectLiveWriteIfDraft({ contentType: "blog", slug: "only-draft", locale: "en", contentRoot });
    expect(gate.ok).toBe(false);
    expect(rejectLiveWriteIfDraft({ contentType: "blog", slug: "only-draft", locale: "en", variant: "draft", contentRoot }).ok).toBe(true);
  });
});
