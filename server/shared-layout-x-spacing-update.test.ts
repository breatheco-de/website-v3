import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editContent } from "./content-editor";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;
let rootName: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "x-spacing-update-"));
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
    content: content
    _slug: slug
    _locale: locale
  url_pattern:
    en: /en/blog/:slug
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "blog", "single.en.yml"),
    `meta:
  page_title: "{{ single.title }}"
sections:
  - type: hero
    section_id: hero-1
    title: "{{ single.title }}"
  - type: article
    section_id: article-1
    content: "{{ single.content }}"
    maxWidth:
      desktop: 2xl
`,
    "utf-8",
  );
  const entryDir = path.join(contentRoot, "blog", "demo-post");
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(
    path.join(entryDir, "_common.yml"),
    `title: Demo
slug: demo-post
`,
    "utf-8",
  );
  // Simulate the buggy stubs previously written by update_field into the entry file
  fs.writeFileSync(
    path.join(entryDir, "en.yml"),
    `title: Demo
content: Hello world
sections:
  - maxWidth:
      desktop: md
  - maxWidth:
      desktop: sm
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

describe("attached shared-layout X spacing update_field", () => {
  it("writes maxWidth to single.en.yml and scrubs entry section stubs", async () => {
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

    const singleRaw = fs.readFileSync(path.join(contentRoot, "blog", "single.en.yml"), "utf-8");
    expect(singleRaw).toMatch(/maxWidth:[\s\S]*desktop:\s*sm/);
    expect(singleRaw).not.toMatch(/desktop:\s*2xl/);

    const entryRaw = fs.readFileSync(path.join(contentRoot, "blog", "demo-post", "en.yml"), "utf-8");
    expect(entryRaw).not.toMatch(/maxWidth:/);
    expect(entryRaw).toMatch(/content:\s*Hello world/);
  });

  it("does not rewrite a clean attached entry when forwarding template ops", async () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "demo-post", "en.yml"),
      `title: Demo
content: Hello world
sections: []
`,
      "utf-8",
    );
    const entryPath = path.join(contentRoot, "blog", "demo-post", "en.yml");
    const before = fs.readFileSync(entryPath, "utf-8");
    const beforeMtime = fs.statSync(entryPath).mtimeMs;

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
    expect(fs.readFileSync(entryPath, "utf-8")).toBe(before);
    expect(fs.statSync(entryPath).mtimeMs).toBe(beforeMtime);
  });
});
