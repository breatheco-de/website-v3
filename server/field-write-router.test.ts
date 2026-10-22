import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRegistry } from "./content-types";
import {
  applyFieldUpdates,
  classifyFieldPath,
  readFieldValueAtPath,
} from "./field-write-router";
import { readFunnelBlockFromFile, stripFunnelFromAllLocaleYamls } from "./funnel-fields";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "field-write-router-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(path.join(contentRoot, "blog", "post-a"), { recursive: true });
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
  fs.writeFileSync(
    path.join(contentRoot, "blog", "post-a", "_common.yml"),
    `title: Post A
funnel:
  stage: consideration
  products:
    - ai-engineering
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "blog", "post-a", "en.yml"),
    `slug: post-a
title: Post A EN
funnel:
  stage: consideration
  products:
    - persona: the-career-changer
      product: ai-engineering
sections: []
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "blog", "post-a", "es.yml"),
    `slug: post-a
title: Post A ES
funnel:
  stage: awareness
  products: all
sections: []
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

describe("classifyFieldPath", () => {
  it("routes funnel, seo, page-level fields, and locale", () => {
    expect(classifyFieldPath("funnel.products")).toBe("funnel");
    expect(classifyFieldPath("funnel.stage")).toBe("funnel");
    expect(classifyFieldPath("seo.main_keyword")).toBe("seo");
    expect(classifyFieldPath("meta.robots")).toBe("locale");
    expect(classifyFieldPath("meta.priority")).toBe("locale");
    expect(classifyFieldPath("authors")).toBe("common");
    expect(classifyFieldPath("published_at")).toBe("common");
    expect(classifyFieldPath("meta.page_title")).toBe("locale");
    expect(classifyFieldPath("meta.custom")).toBe("locale");
    expect(classifyFieldPath("title")).toBe("locale");
  });

  it("keeps URL params locale-scoped", () => {
    expect(classifyFieldPath("authors", { urlParams: ["authors"] })).toBe("locale");
  });
});

describe("applyFieldUpdates draft_only", () => {
  beforeEach(() => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "draft.en.yml"),
      `slug: post-a
title: Draft title
meta:
  robots: index
sections: []
_draft:
  based_on:
    locale: abc
    common: def
    at: "2026-01-01T00:00:00.000Z"
`,
      "utf-8",
    );
  });

  it("keeps page-level fields and removals inside the draft", async () => {
    const commonBefore = fs.readFileSync(path.join(contentRoot, "blog", "post-a", "_common.yml"), "utf-8");
    const result = await applyFieldUpdates({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      variant: "draft",
      mode: "draft_only",
      updates: [
        { field_path: "funnel.stage", value: "decision" },
        { field_path: "published_at", op: "remove" },
        { field_path: "meta.robots", op: "remove" },
        { field_path: "authors", value: ["ana"] },
      ],
      author: "tester",
      contentRoot,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((w) => w.code)).toContain("common_fields_all_languages");
    expect(result.warnings.map((w) => w.code)).toContain("common_field_removal_staged");

    expect(fs.readFileSync(path.join(contentRoot, "blog", "post-a", "_common.yml"), "utf-8")).toBe(commonBefore);
    const draftRaw = fs.readFileSync(path.join(contentRoot, "blog", "post-a", "draft.en.yml"), "utf-8");
    const draft = yaml.load(draftRaw) as Record<string, any>;
    expect(draft.funnel.stage).toBe("decision");
    expect(draft.published_at).toBeNull();
    expect(draft.meta?.robots).toBeUndefined();
    expect(draft.authors).toEqual(["ana"]);
    expect(draft._draft.based_on.locale).toBe("abc");
  });

  it("stages this language's slug on the draft and leaves live untouched", async () => {
    const liveBefore = fs.readFileSync(path.join(contentRoot, "blog", "post-a", "en.yml"), "utf-8");
    const result = await applyFieldUpdates({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      variant: "draft",
      mode: "draft_only",
      updates: [{ field_path: "slug", value: "post-a-renamed" }],
      author: "tester",
      contentRoot,
    });
    expect(result.ok).toBe(true);
    const draft = yaml.load(
      fs.readFileSync(path.join(contentRoot, "blog", "post-a", "draft.en.yml"), "utf-8"),
    ) as Record<string, any>;
    expect(draft.slug).toBe("post-a-renamed");
    expect(draft._draft.based_on.locale).toBe("abc");
    expect(fs.readFileSync(path.join(contentRoot, "blog", "post-a", "en.yml"), "utf-8")).toBe(liveBefore);

    const bad = await applyFieldUpdates({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      variant: "draft",
      mode: "draft_only",
      updates: [{ field_path: "slug", value: "Not A Slug" }],
      author: "tester",
      contentRoot,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("invalid_locale_slug");
  });

  it("rejects variants with traffic", async () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "versioning.yml"),
      "en:\n  variants:\n    - slug: draft\n      allocation: 50\n",
      "utf-8",
    );
    const result = await applyFieldUpdates({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      variant: "draft",
      mode: "draft_only",
      updates: [{ field_path: "authors", value: ["ana"] }],
      author: "tester",
      contentRoot,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("variant_has_traffic");
  });
});

describe("stripFunnelFromAllLocaleYamls", () => {
  it("removes funnel from all locale files, leaves _common", () => {
    const { strippedRelativePaths } = stripFunnelFromAllLocaleYamls(
      "blog",
      "post-a",
      contentRoot,
      "tester",
    );
    expect(strippedRelativePaths.length).toBe(2);
    expect(fs.readFileSync(path.join(contentRoot, "blog", "post-a", "en.yml"), "utf-8")).not.toMatch(
      /^funnel:/m,
    );
    expect(fs.readFileSync(path.join(contentRoot, "blog", "post-a", "es.yml"), "utf-8")).not.toMatch(
      /^funnel:/m,
    );
    expect(readFunnelBlockFromFile(path.join(contentRoot, "blog", "post-a", "_common.yml")).products).toEqual(
      [{ product: "ai-engineering" }],
    );
  });
});

describe("readFieldValueAtPath", () => {
  it("reads funnel from _common only, ignoring locale overlay", () => {
    const { value } = readFieldValueAtPath({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      field_path: "funnel.products",
      contentRoot,
    });
    expect(value).toEqual([{ product: "ai-engineering" }]);
  });
});

describe("applyFieldUpdates funnel", () => {
  it("writes bindings to _common and strips all locale funnel blocks", async () => {
    const bindings = [
      { persona: "the-career-changer", product: "ai-engineering" },
      { persona: "the-developer", product: "ai-flex" },
    ];
    const result = await applyFieldUpdates({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: [{ field_path: "funnel.products", value: bindings }],
      author: "tester",
      contentRoot,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.code === "funnel_locale_agnostic")).toBe(true);
    expect(result.warnings.some((w) => w.code === "funnel_stripped_from_locale_yamls")).toBe(true);

    const common = readFunnelBlockFromFile(path.join(contentRoot, "blog", "post-a", "_common.yml"));
    expect(common.products).toEqual([
      { product: "ai-engineering", persona: "the-career-changer" },
      { product: "ai-flex", persona: "the-developer" },
    ]);
    expect(fs.readFileSync(path.join(contentRoot, "blog", "post-a", "en.yml"), "utf-8")).not.toMatch(
      /^funnel:/m,
    );
    expect(fs.readFileSync(path.join(contentRoot, "blog", "post-a", "es.yml"), "utf-8")).not.toMatch(
      /^funnel:/m,
    );
  });

  it("warns funnel_live_despite_variant when variant is set", async () => {
    const result = await applyFieldUpdates({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      variant: "draft",
      updates: [{ field_path: "funnel.stage", value: "decision" }],
      author: "tester",
      contentRoot,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.code === "funnel_live_despite_variant")).toBe(true);
    const common = readFunnelBlockFromFile(path.join(contentRoot, "blog", "post-a", "_common.yml"));
    expect(common.stage).toBe("decision");
  });
});
