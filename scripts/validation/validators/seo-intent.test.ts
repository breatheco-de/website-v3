import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRegistry } from "../../../server/content-types";
import type { ContentFile, ValidationContext } from "../shared/types";
import { seoIntentValidator } from "./seo-intent";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

function contentRootAbs(): string {
  return path.join(tempDir, contentRoot);
}

function writeSeoConfig() {
  const abs = contentRootAbs();
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(
    path.join(abs, "seo-config.yml"),
    `intents:
  awareness:
    label: Learn
    description: Learn
intent_defaults: {}
focus_features:
  mentorship:
    label: Mentorship
    description: Mentorship
`,
    "utf-8",
  );
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-intent-slim-"));
  contentRoot = "site_test";
  resetRegistry();
  process.chdir(tempDir);
  writeSeoConfig();
});

afterEach(() => {
  resetRegistry();
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("seoIntentValidator funnel only", () => {
  it("flags INVALID_INTENT", async () => {
    const file: ContentFile = {
      slug: "spoke",
      title: "Spoke",
      type: "blog",
      locale: "en",
      url: "/en/blog/spoke",
      filePath: path.join(contentRootAbs(), "blog/spoke/en.yml"),
      seo: { intent: "not-a-real-intent" },
    };
    const ctx: ValidationContext = {
      contentFiles: [file],
      redirectMap: new Map(),
      availableSchemas: new Set(),
      sitemapEntries: [],
      contentRoot,
    };
    const result = await seoIntentValidator.run(ctx);
    expect(result.errors.some((e) => e.code === "INVALID_INTENT")).toBe(true);
  });

  it("skips variants", async () => {
    const file: ContentFile = {
      slug: "spoke",
      title: "Spoke",
      type: "blog",
      locale: "en",
      url: "/en/blog/spoke",
      filePath: path.join(contentRootAbs(), "blog/spoke/draft.en.yml"),
      variant: "draft",
      seo: { intent: "not-a-real-intent" },
    };
    const ctx: ValidationContext = {
      contentFiles: [file],
      redirectMap: new Map(),
      availableSchemas: new Set(),
      sitemapEntries: [],
      contentRoot,
    };
    const result = await seoIntentValidator.run(ctx);
    expect(result.errors.some((e) => e.code === "INVALID_INTENT")).toBe(false);
  });
});
