import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRegistry } from "../../../server/content-types";
import { invalidateSeoIndexCache } from "../../../server/seo-index";
import { MEMBER_MISSING_HUB_LINK } from "../../../server/seo-cluster-link-check";
import type { ContentFile, ValidationContext } from "../shared/types";
import { seoClusterLinksValidator } from "./seo-cluster-links";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

function contentRootAbs(): string {
  return path.join(tempDir, contentRoot);
}

vi.mock("../../../server/content-index", () => ({
  contentIndex: {
    getRedirects: () => [],
    refreshCustomRedirects: () => [],
    isKnownUrl: () => true,
    findBySlug: () => [],
  },
}));

function writeFixture(contentTypesYaml: string, seoIndex: Record<string, unknown>) {
  const abs = contentRootAbs();
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(path.join(abs, "content-types.yml"), contentTypesYaml, "utf-8");
  fs.writeFileSync(path.join(abs, "seo-index.json"), JSON.stringify(seoIndex), "utf-8");
}

function baseFile(overrides: Partial<ContentFile> & Pick<ContentFile, "filePath">): ContentFile {
  return {
    slug: "spoke",
    title: "Spoke",
    type: "blog",
    locale: "en",
    url: "/en/blog/spoke",
    ...overrides,
  };
}

function context(files: ContentFile | ContentFile[]): ValidationContext {
  return {
    contentFiles: Array.isArray(files) ? files : [files],
    redirectMap: new Map(),
    validUrls: new Set(),
    availableSchemas: new Set(),
    sitemapEntries: [],
    contentRoot,
  };
}

const monitoredTypes = `blog:
  directory: blog
  url_pattern:
    en: /en/blog/:slug
  seo_monitoring:
    enabled: true
    require_cluster: true
`;

const seoIndexWithHub = {
  version: 1,
  entries: {
    "blog/spoke/en": {
      content_type: "blog",
      slug: "spoke",
      locale: "en",
      path: "/en/blog/spoke",
      pillar_path: "/en/blog/hub",
      file: "blog/spoke/en.yml",
    },
  },
  by_path: { "/en/blog/hub": "blog/hub/en" },
  clusters: {},
  orphans: [],
  warnings: [],
};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-cluster-links-test-"));
  contentRoot = "site_test";
  resetRegistry();
  invalidateSeoIndexCache();
  process.chdir(tempDir);
});

afterEach(() => {
  resetRegistry();
  invalidateSeoIndexCache();
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("seoClusterLinksValidator", () => {
  it("warns (does not fail) when member lacks hub back-link", async () => {
    writeFixture(monitoredTypes, seoIndexWithHub);
    resetRegistry(contentRoot);

    const result = await seoClusterLinksValidator.run(
      context(
        baseFile({
          filePath: path.join(contentRootAbs(), "blog/spoke/en.yml"),
          seo: { pillar_path: "/en/blog/hub", is_pillar: false },
          entryFields: { content: "No links here" },
        }),
      ),
    );

    expect(result.status).toBe("warning");
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === MEMBER_MISSING_HUB_LINK)).toBe(true);
  });

  it("passes when member links back to hub via HTML in content", async () => {
    writeFixture(monitoredTypes, seoIndexWithHub);
    resetRegistry(contentRoot);

    const result = await seoClusterLinksValidator.run(
      context(
        baseFile({
          filePath: path.join(contentRootAbs(), "blog/spoke/en.yml"),
          seo: { pillar_path: "/en/blog/hub", is_pillar: false },
          entryFields: {
            content: '<p>See <a href="/en/blog/hub">hub</a></p>',
          },
        }),
      ),
    );

    expect(result.status).toBe("passed");
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
