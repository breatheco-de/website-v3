import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createContentEntry,
  SINGLE_LOCALE_CREATE_ERROR,
} from "./content-editor";
import { resetRegistry } from "./content-types";

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
