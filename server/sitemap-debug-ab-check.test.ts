import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { databaseManager } from "./database";
import { checkPageFiles } from "./ab-testing/setup";
import { getDebugSitemapUrls, resetDebugSitemapCacheForTests } from "./sitemap";

let tempDir: string;
let contentRoot: string;
let ci: ContentIndex;

function writeEntry(slug: string, files: Record<string, string>) {
  const dir = path.join(contentRoot, "landings", slug);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body, "utf-8");
}

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sitemap-ab-check-"));
  contentRoot = path.join(tempDir, "site_abcheck");
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    "landing:\n  directory: landings\n  url_pattern:\n    en: /en/landing/:slug\n",
    "utf-8",
  );
  writeEntry("ab-check", checkPageFiles());
  writeEntry("plain", { "_common.yml": "slug: plain\n", "en.yml": "title: Plain\nsections: []\n" });
  resetRegistry(contentRoot);
  ci = new ContentIndex(contentRoot);
  ci.scanFast();
  resetDebugSitemapCacheForTests();
});

afterAll(() => {
  resetDebugSitemapCacheForTests();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("debug sitemap and the A/B check page", () => {
  it("omits the hidden A/B check page but keeps other landings", () => {
    const urls = getDebugSitemapUrls({ contentIndex: ci, contentRootName: contentRoot, database: databaseManager });
    const slugs = urls.map((u) => u.slug);
    expect(slugs).toContain("plain");
    expect(slugs).not.toContain("ab-check");
  });
});
