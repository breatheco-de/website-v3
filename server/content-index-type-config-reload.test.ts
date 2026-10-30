import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";

const tmpDirs: string[] = [];

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

const PAGE_TYPE = ["page:", "  directory: pages", "  url_pattern:", "    en: /en/:slug", ""].join("\n");
const NEWS_TYPE = [
  "news:",
  "  directory: news",
  "  url_pattern:",
  "    en: /en/news/:slug",
  "    es: /es/noticias/:slug",
  "",
].join("\n");

function writeNewsEntry(root: string) {
  write(root, "news/sample-news/_common.yml", "slug: sample-news\ntitle: News\n");
  write(root, "news/sample-news/en.yml", "slug: sample-news\ntitle: News\nsections: []\n");
  write(root, "news/sample-news/es.yml", "slug: sample-news\ntitle: News\nsections: []\n");
}

function bootSite(): { root: string; ci: ContentIndex } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-type-reload-"));
  tmpDirs.push(root);
  write(root, "content-types.yml", PAGE_TYPE);
  write(root, "pages/home/en.yml", "slug: home\ntitle: Home\n");
  const ci = new ContentIndex(root);
  resetRegistry();
  ci.scanFast();
  return { root, ci };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  resetRegistry();
});

describe("ContentIndex content type config reload", () => {
  it("new type added after boot: first entry gets the type's URL pattern after refresh", () => {
    const { root, ci } = bootSite();
    write(root, "content-types.yml", PAGE_TYPE + NEWS_TYPE);
    ci.refresh();
    writeNewsEntry(root);
    ci.upsertEntry(path.join(root, "news/sample-news/en.yml"));

    expect(ci.getLocaleUrls("sample-news", "news", { includeEmptyLocales: true })).toEqual({
      en: "/en/news/sample-news",
      es: "/es/noticias/sample-news",
    });
  });

  it("applying a worker snapshot picks up an edited URL pattern", () => {
    const { root, ci } = bootSite();
    write(root, "content-types.yml", PAGE_TYPE + NEWS_TYPE);
    writeNewsEntry(root);

    const worker = new ContentIndex(root);
    worker.scanFast();
    expect(ci.applySnapshot(worker.exportSnapshot(1), 0)).toBe(true);

    expect(ci.getContentTypeConfig("news")?.url_pattern).toEqual({
      en: "/en/news/:slug",
      es: "/es/noticias/:slug",
    });
    expect(ci.buildUrl("news", "es", "otra")).toBe("/es/noticias/otra");
  });
});
