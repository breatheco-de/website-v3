import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasEntryLevelVersioningDir, versioningApiSlug } from "./shared-layout.js";

describe("versioningApiSlug / entry-level drafts", () => {
  let tempDir: string;
  let contentPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-ver-"));
    contentPath = path.join(tempDir, "site_test");
    fs.mkdirSync(path.join(contentPath, "blog"), { recursive: true });
    fs.writeFileSync(
      path.join(contentPath, "content-types.yml"),
      `blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
`,
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("remaps attached entries to template when no entry drafts", () => {
    const entryDir = path.join(contentPath, "blog", "my-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "_common.yml"), "slug: my-post\n");
    expect(versioningApiSlug("blog", "my-post", contentPath)).toBe("template");
  });

  it("keeps entry slug when translate drafts exist", () => {
    const entryDir = path.join(contentPath, "blog", "my-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "_common.yml"), "slug: my-post\n");
    fs.writeFileSync(path.join(entryDir, "draft.es.yml"), "title: Hola\n");
    expect(hasEntryLevelVersioningDir(entryDir)).toBe(true);
    expect(versioningApiSlug("blog", "my-post", contentPath)).toBe("my-post");
  });

  it("keeps entry slug when detached", () => {
    const entryDir = path.join(contentPath, "blog", "my-post");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(path.join(entryDir, "_common.yml"), "slug: my-post\ndetached: true\n");
    expect(versioningApiSlug("blog", "my-post", contentPath)).toBe("my-post");
  });
});
