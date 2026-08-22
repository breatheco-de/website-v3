import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  flattenFieldOverridesInFile,
  normalizeStringSelectForRoot,
  resetStaticMappedField,
  resolveMappedFieldsLayerPath,
  writeMappedFields,
} from "./field-overrides";
import { resetRegistry } from "./content-types";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

function writeCtYml(extra = "") {
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
    description: description
    category: category
    faq_entries:
      source: faq_entries
      default: null
    published_at: published_at
  editor:
    title:
      required: true
    description:
      required: true
    category:
      type: select
      populate_options: true
      allow_custom_values: true
  url_pattern:
    en: /en/blog/:slug
course:
  directory: courses
  database:
    slug: courses
  field_mapping:
    title: title
  url_pattern:
    en: /en/courses/:slug
${extra}
`,
    "utf-8",
  );
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "field-overrides-test-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(path.join(contentRoot, "blog", "post-a"), { recursive: true });
  fs.mkdirSync(path.join(contentRoot, "courses", "c1"), { recursive: true });
  writeCtYml();
  fs.writeFileSync(
    path.join(contentRoot, "blog", "post-a", "_common.yml"),
    "title: From common\ndescription: Common desc\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "blog", "post-a", "en.yml"),
    `slug: post-a
meta:
  page_title: Post A
  description: SEO desc
sections: []
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "courses", "c1", "en.yml"),
    `slug: c1
meta:
  page_title: Course
  description: Course SEO
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

describe("normalizeStringSelectForRoot", () => {
  it("stores string scalars (unwraps { slug })", () => {
    expect(normalizeStringSelectForRoot("trends")).toBe("trends");
    expect(normalizeStringSelectForRoot({ slug: "x", title: "Y" })).toBe("x");
    expect(normalizeStringSelectForRoot("  ")).toBe("  ");
  });
});

describe("writeMappedFields static", () => {
  it("coerces select { slug } objects to string scalars on write", () => {
    const enPath = path.join(contentRoot, "blog", "post-a", "en.yml");
    const result = writeMappedFields(
      "blog",
      "post-a",
      "en",
      { category: { slug: "ai-tools", title: "AI" } },
      { contentRoot, author: "test" },
    );
    expect(result.success).toBe(true);
    const raw = fs.readFileSync(enPath, "utf-8");
    expect(raw).toMatch(/^category: ai-tools$/m);
    expect(raw).not.toMatch(/slug: ai-tools/);
  });

  it("writes root keys and clears leftover FO bag keys", () => {
    const enPath = path.join(contentRoot, "blog", "post-a", "en.yml");
    fs.writeFileSync(
      enPath,
      `slug: post-a
meta:
  page_title: Post A
  description: SEO desc
field_overrides:
  faq_entries:
    - question: Old
      answer: Bag
sections: []
`,
      "utf-8",
    );

    const result = writeMappedFields(
      "blog",
      "post-a",
      "en",
      {
        faq_entries: [{ question: "Q", answer: "A" }],
      },
      { contentRoot, author: "test" },
    );
    expect(result.success).toBe(true);
    expect(result.storage).toBe("root_key");
    expect(result.relativePath).toMatch(/en\.yml$/);

    const raw = fs.readFileSync(enPath, "utf-8");
    expect(raw).toContain("faq_entries:");
    expect(raw).toContain("question: Q");
    expect(raw).not.toContain("field_overrides:");
  });

  it("deletes root key on empty/null clear", () => {
    const enPath = path.join(contentRoot, "blog", "post-a", "en.yml");
    fs.writeFileSync(
      enPath,
      `slug: post-a
meta:
  page_title: Post A
  description: SEO desc
faq_entries:
  - question: Q
    answer: A
sections: []
`,
      "utf-8",
    );
    const result = writeMappedFields("blog", "post-a", "en", { faq_entries: null }, { contentRoot });
    expect(result.success).toBe(true);
    const raw = fs.readFileSync(enPath, "utf-8");
    expect(raw).not.toMatch(/^faq_entries:/m);
  });

  it("writes variant layer only when file exists", () => {
    const draftPath = path.join(contentRoot, "blog", "post-a", "draft.en.yml");
    fs.writeFileSync(
      draftPath,
      `slug: post-a
meta:
  page_title: Draft
  description: Draft SEO
sections: []
`,
      "utf-8",
    );
    const result = writeMappedFields(
      "blog",
      "post-a",
      "en",
      { title: "Draft title" },
      { contentRoot, variant: "draft" },
    );
    expect(result.success).toBe(true);
    expect(result.isVariantLayer).toBe(true);
    expect(fs.readFileSync(draftPath, "utf-8")).toContain("title: Draft title");
    expect(fs.readFileSync(path.join(contentRoot, "blog", "post-a", "en.yml"), "utf-8")).not.toContain(
      "Draft title",
    );
  });

  it("fails clearly when variant file is missing", () => {
    const result = writeMappedFields(
      "blog",
      "post-a",
      "en",
      { title: "Nope" },
      { contentRoot, variant: "lumi-version" },
    );
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(result.error).toMatch(/not found/i);
  });

  it("auto-resolves all-draft when no live locale file", () => {
    fs.unlinkSync(path.join(contentRoot, "blog", "post-a", "en.yml"));
    const draftPath = path.join(contentRoot, "blog", "post-a", "draft.en.yml");
    fs.writeFileSync(
      draftPath,
      `slug: post-a
meta:
  page_title: Draft only
  description: Draft SEO
sections: []
`,
      "utf-8",
    );
    const resolved = resolveMappedFieldsLayerPath({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      contentRoot,
      requireExists: true,
    });
    expect(resolved.fileName).toBe("draft.en.yml");
    expect(resolved.isVariantLayer).toBe(true);

    const result = writeMappedFields("blog", "post-a", "en", { title: "All draft" }, { contentRoot });
    expect(result.success).toBe(true);
    expect(result.isVariantLayer).toBe(true);
    expect(fs.readFileSync(draftPath, "utf-8")).toContain("title: All draft");
  });
});

describe("writeMappedFields DB", () => {
  it("writes field_overrides bag for database-backed types", () => {
    const result = writeMappedFields(
      "course",
      "c1",
      "en",
      { title: "Overridden" },
      { contentRoot },
    );
    expect(result.success).toBe(true);
    expect(result.storage).toBe("field_overrides");
    const raw = fs.readFileSync(path.join(contentRoot, "courses", "c1", "en.yml"), "utf-8");
    expect(raw).toContain("field_overrides:");
    expect(raw).toContain("title: Overridden");
  });
});

describe("resetStaticMappedField", () => {
  it("no-ops when key only exists on _common", () => {
    const result = resetStaticMappedField({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      field: "title",
      contentRoot,
    });
    expect(result.success).toBe(true);
    expect(result.noop).toBe(true);
    expect(fs.readFileSync(path.join(contentRoot, "blog", "post-a", "_common.yml"), "utf-8")).toContain(
      "title: From common",
    );
  });

  it("deletes key when present on layer file", () => {
    const enPath = path.join(contentRoot, "blog", "post-a", "en.yml");
    fs.writeFileSync(
      enPath,
      `slug: post-a
title: On layer
meta:
  page_title: Post A
  description: SEO desc
sections: []
`,
      "utf-8",
    );
    // _common still has title so clearing the layer key passes the live required gate
    const result = resetStaticMappedField({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      field: "title",
      contentRoot,
    });
    expect(result.success).toBe(true);
    expect(result.noop).toBeFalsy();
    expect(fs.readFileSync(enPath, "utf-8")).not.toMatch(/^title:/m);
  });
});

describe("flattenFieldOverridesInFile", () => {
  it("promotes FO to root and stores category as a string scalar", () => {
    const enPath = path.join(contentRoot, "blog", "post-a", "en.yml");
    fs.writeFileSync(
      enPath,
      `slug: post-a
field_overrides:
  category: trends
  faq_entries:
    - question: Q
      answer: A
`,
      "utf-8",
    );
    const r = flattenFieldOverridesInFile(enPath, "test", contentRoot, "blog");
    expect(r.success).toBe(true);
    expect(r.changed).toBe(true);
    const raw = fs.readFileSync(enPath, "utf-8");
    expect(raw).not.toContain("field_overrides:");
    expect(raw).toMatch(/^category: trends$/m);
    expect(raw).toContain("faq_entries:");
  });
});
