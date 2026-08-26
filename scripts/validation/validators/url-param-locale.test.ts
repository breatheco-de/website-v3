import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import yaml from "js-yaml";
import { urlParamLocaleValidator } from "./url-param-locale";
import type { ContentFile, ValidationContext } from "../shared/types";

function makeContext(contentRoot: string, files: ContentFile[]): ValidationContext {
  return {
    contentRoot,
    contentFiles: files,
    redirectMap: new Map(),
    validUrls: new Set(),
    availableSchemas: new Set(),
    sitemapEntries: [],
  };
}

describe("urlParamLocaleValidator", () => {
  let tmp = "";

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "url-param-val-"));
    fs.writeFileSync(
      path.join(tmp, "content-types.yml"),
      yaml.dump({
        blog: {
          directory: "blog",
          url_pattern: {
            en: "/en/blog/:category/:slug",
            es: "/es/blog/:category/:slug",
          },
          field_mapping: { title: "title", category: "category", slug: "slug" },
        },
      }),
    );
    fs.mkdirSync(path.join(tmp, "blog", "post-a"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "blog", "post-b"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "blog", "post-a", "en.yml"),
      yaml.dump({ slug: "post-a", category: "ai-tools" }),
    );
    fs.writeFileSync(
      path.join(tmp, "blog", "post-b", "es.yml"),
      yaml.dump({ slug: "post-b", category: "herramientas-ia" }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("errors when URL param is on _common.yml", async () => {
    const commonPath = path.join(tmp, "blog", "post-a", "_common.yml");
    fs.writeFileSync(commonPath, yaml.dump({ slug: "post-a", category: "ai-tools" }));
    const result = await urlParamLocaleValidator.run(
      makeContext(tmp, [
        {
          type: "blog",
          slug: "post-a",
          locale: "_common",
          filePath: commonPath,
          title: "Post",
          entryFields: { slug: "post-a", category: "ai-tools" },
        },
      ]),
    );
    expect(result.status).toBe("failed");
    expect(result.errors.some((e) => e.code === "URL_PARAM_ON_COMMON")).toBe(true);
  });

  it("errors on peer mismatch when slug is not used by any es peer", async () => {
    const esPath = path.join(tmp, "blog", "post-a", "es.yml");
    fs.writeFileSync(esPath, yaml.dump({ slug: "post-a", category: "herramientas-ia" }));
    const result = await urlParamLocaleValidator.run(
      makeContext(tmp, [
        {
          type: "blog",
          slug: "post-a",
          locale: "es",
          filePath: esPath,
          title: "Post",
          entryFields: { slug: "post-a", category: "wrong-slug" },
        },
      ]),
    );
    expect(result.status).toBe("failed");
    expect(result.errors.some((e) => e.code === "URL_PARAM_LOCALE_PEER_MISMATCH")).toBe(true);
  });

  it("passes for valid locale-scoped category", async () => {
    const enPath = path.join(tmp, "blog", "post-a", "en.yml");
    const result = await urlParamLocaleValidator.run(
      makeContext(tmp, [
        {
          type: "blog",
          slug: "post-a",
          locale: "en",
          filePath: enPath,
          title: "Post",
          entryFields: { slug: "post-a", category: "ai-tools" },
        },
      ]),
    );
    expect(result.status).toBe("passed");
  });
});
