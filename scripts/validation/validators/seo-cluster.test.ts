import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRegistry } from "../../../server/content-types";
import { invalidateSeoIndexCache } from "../../../server/seo-index";
import type { ContentFile, ValidationContext } from "../shared/types";
import { seoClusterValidator } from "./seo-cluster";
import { seoIntentValidator } from "./seo-intent";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
/** Relative to tempDir — matches ValidationContext.contentRoot style in production. */
let contentRoot: string;

function contentRootAbs(): string {
  return path.join(tempDir, contentRoot);
}

vi.mock("../../../server/content-index", () => ({
  contentIndex: {},
}));

vi.mock("../../../server/redirects", () => ({
  createPublicUrlResolver: () => ({
    isLive: (url: string) => url === "/en/hub-live" || url === "/en/hub-a" || url === "/en/hub-b",
  }),
}));

function writeFixture(contentTypesYaml: string, seoIndex: Record<string, unknown>) {
  const abs = contentRootAbs();
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(
    path.join(abs, "seo-config.yml"),
    `intents:
  awareness:
    label: Learn
    description: Learn
intent_defaults:
  blog: awareness
focus_features:
  mentorship:
    label: Mentorship
    description: Mentorship
`,
    "utf-8",
  );
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
faq:
  directory: faq
  url_pattern:
    en: /en/faq/:slug
`;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-cluster-test-"));
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

describe("seoClusterValidator", () => {
  it("skips cluster warnings when monitoring is off", async () => {
    writeFixture(monitoredTypes, { version: 1, entries: {}, by_path: {}, clusters: {}, orphans: [], warnings: [] });
    resetRegistry(contentRoot);

    const result = await seoClusterValidator.run(
      context(
        baseFile({
          type: "faq",
          filePath: path.join(contentRootAbs(), "faq/spoke/en.yml"),
          seo: {},
        }),
      ),
    );
    expect(result.warnings.some((w) => w.code === "ORPHAN_PAGE")).toBe(false);
  });

  it("allows explicit pillar_path null opt-out", async () => {
    writeFixture(monitoredTypes, { version: 1, entries: {}, by_path: {}, clusters: {}, orphans: [], warnings: [] });
    resetRegistry(contentRoot);

    const result = await seoClusterValidator.run(
      context(
        baseFile({
          filePath: path.join(contentRootAbs(), "blog/spoke/en.yml"),
          seo: { pillar_path: null },
        }),
      ),
    );
    expect(result.warnings.some((w) => w.code === "ORPHAN_PAGE")).toBe(false);
    expect(result.warnings.some((w) => w.code === "PARTIALLY_SET_CLUSTER")).toBe(false);
  });

  it("warns ORPHAN_PAGE when monitored, require_cluster, and no cluster", async () => {
    writeFixture(monitoredTypes, { version: 1, entries: {}, by_path: {}, clusters: {}, orphans: [], warnings: [] });
    resetRegistry(contentRoot);

    const result = await seoClusterValidator.run(
      context(
        baseFile({
          filePath: path.join(contentRootAbs(), "blog/spoke/en.yml"),
          seo: {},
        }),
      ),
    );
    expect(result.warnings.some((w) => w.code === "ORPHAN_PAGE")).toBe(true);
  });

  it("warns PARTIALLY_SET_CLUSTER when main_keyword is set without pillar_path", async () => {
    writeFixture(monitoredTypes, { version: 1, entries: {}, by_path: {}, clusters: {}, orphans: [], warnings: [] });
    resetRegistry(contentRoot);

    const result = await seoClusterValidator.run(
      context(
        baseFile({
          filePath: path.join(contentRootAbs(), "blog/spoke/en.yml"),
          seo: { main_keyword: "learn python" },
        }),
      ),
    );
    expect(result.warnings.some((w) => w.code === "PARTIALLY_SET_CLUSTER")).toBe(true);
    expect(result.warnings.some((w) => w.code === "SEO_KEYWORD_RESEARCH_INCOMPLETE")).toBe(true);
  });

  it("warns SEO_KEYWORD_RESEARCH_INCOMPLETE when keyword set without both metrics", async () => {
    writeFixture(monitoredTypes, { version: 1, entries: {}, by_path: {}, clusters: {}, orphans: [], warnings: [] });
    resetRegistry(contentRoot);

    const incomplete = await seoClusterValidator.run(
      context(
        baseFile({
          filePath: path.join(contentRootAbs(), "blog/spoke/en.yml"),
          seo: {
            main_keyword: "learn python",
            kw_monthly_volume: 800,
            pillar_path: null,
          },
        }),
      ),
    );
    expect(incomplete.warnings.some((w) => w.code === "SEO_KEYWORD_RESEARCH_INCOMPLETE")).toBe(true);

    const complete = await seoClusterValidator.run(
      context(
        baseFile({
          filePath: path.join(contentRootAbs(), "blog/spoke/en.yml"),
          seo: {
            main_keyword: "learn python",
            kw_monthly_volume: 800,
            kw_difficulty: 40,
            pillar_path: null,
          },
        }),
      ),
    );
    expect(complete.warnings.some((w) => w.code === "SEO_KEYWORD_RESEARCH_INCOMPLETE")).toBe(false);
  });

  it("reports INVALID_PILLAR when hub URL is not live", async () => {
    writeFixture(monitoredTypes, { version: 1, entries: {}, by_path: {}, clusters: {}, orphans: [], warnings: [] });
    resetRegistry(contentRoot);

    const result = await seoClusterValidator.run(
      context(
        baseFile({
          filePath: path.join(contentRootAbs(), "blog/spoke/en.yml"),
          seo: { pillar_path: "/en/missing-hub" },
        }),
      ),
    );
    const issue = result.errors.find((e) => e.code === "INVALID_PILLAR");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("does not resolve to a known pillar hub");
  });

  it("reports INVALID_PILLAR hub_not_pillar when live page is not a pillar", async () => {
    writeFixture(monitoredTypes, {
      version: 1,
      entries: {
        "page/hub-not-pillar/en": {
          content_type: "page",
          slug: "hub-not-pillar",
          locale: "en",
          file: "page/hub-not-pillar/en.yml",
          path: "/en/hub-not-pillar",
          main_keyword: "hub",
          is_pillar: false,
          pillar_path: null,
          pillar_live: true,
        },
      },
      by_path: {},
      clusters: {},
      orphans: [],
      warnings: [],
    });
    resetRegistry(contentRoot);

    const result = await seoClusterValidator.run(
      context(
        baseFile({
          filePath: path.join(contentRootAbs(), "blog/spoke/en.yml"),
          seo: { pillar_path: "/en/hub-not-pillar" },
        }),
      ),
    );
    const issue = result.errors.find((e) => e.code === "INVALID_PILLAR");
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("not marked as a pillar hub");
  });

  it("reports DUPLICATE_PILLAR for both hubs", async () => {
    writeFixture(monitoredTypes, {
      version: 1,
      entries: {
        "blog/hub-a/en": {
          content_type: "blog",
          slug: "hub-a",
          locale: "en",
          file: "blog/hub-a/en.yml",
          path: "/en/shared-hub",
          is_pillar: true,
          pillar_path: "/en/shared-hub",
          pillar_live: true,
        },
        "blog/hub-b/en": {
          content_type: "blog",
          slug: "hub-b",
          locale: "en",
          file: "blog/hub-b/en.yml",
          path: "/en/shared-hub",
          is_pillar: true,
          pillar_path: "/en/shared-hub",
          pillar_live: true,
        },
      },
      by_path: {},
      clusters: {},
      orphans: [],
      warnings: [],
    });
    resetRegistry(contentRoot);

    const files = [
      baseFile({
        slug: "hub-a",
        filePath: path.join(contentRootAbs(), "blog/hub-a/en.yml"),
        seo: { is_pillar: true, pillar_path: "/en/shared-hub" },
      }),
      baseFile({
        slug: "hub-b",
        filePath: path.join(contentRootAbs(), "blog/hub-b/en.yml"),
        seo: { is_pillar: true, pillar_path: "/en/shared-hub" },
      }),
    ];
    const result = await seoClusterValidator.run(context(files));
    const dups = result.errors.filter((e) => e.code === "DUPLICATE_PILLAR");
    expect(dups.length).toBe(2);
  });

  it("reports SEO_BLOCK_ON_COMMON_YML when _common.yml has seo:", async () => {
    writeFixture(monitoredTypes, { version: 1, entries: {}, by_path: {}, clusters: {}, orphans: [], warnings: [] });
    resetRegistry(contentRoot);
    const dir = path.join(contentRootAbs(), "blog/spoke");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "_common.yml"), "seo:\n  main_keyword: x\n", "utf-8");
    fs.writeFileSync(path.join(dir, "en.yml"), "title: Spoke\n", "utf-8");

    const result = await seoClusterValidator.run(
      context(
        baseFile({
          filePath: path.join(dir, "en.yml"),
          seo: { pillar_path: null },
        }),
      ),
    );
    expect(result.errors.some((e) => e.code === "SEO_BLOCK_ON_COMMON_YML")).toBe(true);
  });

  it("skips variant ContentFiles", async () => {
    writeFixture(monitoredTypes, { version: 1, entries: {}, by_path: {}, clusters: {}, orphans: [], warnings: [] });
    resetRegistry(contentRoot);

    const result = await seoClusterValidator.run(
      context(
        baseFile({
          filePath: path.join(contentRootAbs(), "blog/spoke/draft.en.yml"),
          variant: "draft",
          seo: {},
        }),
      ),
    );
    expect(result.warnings.some((w) => w.code === "ORPHAN_PAGE")).toBe(false);
    expect(result.errors.length).toBe(0);
  });
});

describe("seoIntentValidator (no cluster codes)", () => {
  it("does not emit ORPHAN_PAGE or INVALID_PILLAR", async () => {
    writeFixture(monitoredTypes, { version: 1, entries: {}, by_path: {}, clusters: {}, orphans: [], warnings: [] });
    resetRegistry(contentRoot);

    const result = await seoIntentValidator.run(
      context(
        baseFile({
          filePath: path.join(contentRootAbs(), "blog/spoke/en.yml"),
          seo: { pillar_path: "/en/missing-hub", intent: "awareness" },
        }),
      ),
    );
    expect(result.errors.some((e) => e.code === "INVALID_PILLAR")).toBe(false);
    expect(result.warnings.some((w) => w.code === "ORPHAN_PAGE")).toBe(false);
  });
});
