import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editContent } from "./content-editor";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { invalidSectionIndexMessage } from "@shared/sectionLeftovers";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

function writePageSite() {
  fs.mkdirSync(path.join(contentRoot, "pages", "home"), { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `page:
  directory: pages
  field_mapping:
    title: title
    _slug: slug
    _locale: locale
  url_pattern:
    en: /en/:slug
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "pages", "home", "_common.yml"),
    `title: Home
slug: home
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "pages", "home", "en.yml"),
    `meta:
  page_title: Home
  description: Home page for tests.
sections:
  - type: hero
    section_id: hero-1
    title: Hello
`,
    "utf-8",
  );
}

function writeBlogSite() {
  fs.mkdirSync(path.join(contentRoot, "blog", "demo-post"), { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
    content: content
    _slug: slug
    _locale: locale
  url_pattern:
    en: /en/blog/:slug
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "blog", "template.en.yml"),
    `meta:
  page_title: "{{ entry.title }}"
sections:
  - type: hero
    section_id: hero-1
    title: "{{ entry.title }}"
  - type: article
    section_id: article-1
    content: "{{ entry.content }}"
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "blog", "demo-post", "_common.yml"),
    `title: Demo
slug: demo-post
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "blog", "demo-post", "en.yml"),
    `title: Demo
content: Hello world
`,
    "utf-8",
  );
}

describe("update_field missing section index", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "section-leftover-"));
    contentRoot = path.join(tempDir, "site_test");
    fs.mkdirSync(contentRoot, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    resetRegistry(contentRoot);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("fails on a standalone page and does not append a stub", async () => {
    writePageSite();
    resetRegistry(contentRoot);
    const ci = new ContentIndex(contentRoot);
    const result = await editContent({
      contentType: "page",
      slug: "home",
      locale: "en",
      operations: [
        { action: "update_field", path: "sections.5.highlight", value: { heading: "nope" } },
      ],
      contentRoot,
      ci,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(invalidSectionIndexMessage(5));

    const raw = fs.readFileSync(path.join(contentRoot, "pages", "home", "en.yml"), "utf-8");
    expect(raw).not.toMatch(/highlight:/);
    expect(raw).toMatch(/section_id: hero-1/);
  });

  it("fails when the merged index is missing on an attached overlay (does not grow overlay sections)", async () => {
    writeBlogSite();
    resetRegistry(contentRoot);
    const ci = new ContentIndex(contentRoot);
    const result = await editContent({
      contentType: "blog",
      slug: "demo-post",
      locale: "en",
      operations: [
        { action: "update_field", path: "sections.9.title", value: "nope" },
      ],
      contentRoot,
      ci,
      skipSharedLayoutFanOut: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(invalidSectionIndexMessage(9));

    const entryRaw = fs.readFileSync(path.join(contentRoot, "blog", "demo-post", "en.yml"), "utf-8");
    expect(entryRaw).not.toMatch(/sections:/);
    const templateRaw = fs.readFileSync(path.join(contentRoot, "blog", "template.en.yml"), "utf-8");
    expect(templateRaw).not.toMatch(/title: nope/);
  });

  it("still writes a template-owned field to template.en.yml when the section exists", async () => {
    writeBlogSite();
    resetRegistry(contentRoot);
    const ci = new ContentIndex(contentRoot);
    const result = await editContent({
      contentType: "blog",
      slug: "demo-post",
      locale: "en",
      operations: [
        {
          action: "update_field",
          path: "sections.1.maxWidth",
          value: { desktop: "sm" },
        },
      ],
      contentRoot,
      ci,
      skipSharedLayoutFanOut: true,
    });

    expect(result.success, result.error).toBe(true);
    const templateRaw = fs.readFileSync(path.join(contentRoot, "blog", "template.en.yml"), "utf-8");
    expect(templateRaw).toMatch(/maxWidth:[\s\S]*desktop:\s*sm/);
    const entryRaw = fs.readFileSync(path.join(contentRoot, "blog", "demo-post", "en.yml"), "utf-8");
    expect(entryRaw).not.toMatch(/maxWidth:/);
  });
});
