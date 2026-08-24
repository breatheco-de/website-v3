import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractUrlPatternParams,
  formatUrlParamFieldValue,
  getContentTypeConfig,
  getHreflangsSource,
  getCanonicalHreflangSlug,
  listExtraUrlPatternParams,
  normalizeHreflangMap,
  normalizeHreflangLocaleKey,
  normalizeContentTypeFieldConfig,
  resolveHreflangsFromRecord,
  resolveUrlPatternWithMapping,
  resetRegistry,
  updateContentTypeConfig,
} from "./content-types";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "content-types-test-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  field_mapping:
    _slug: slug
    _locale: lang
    title: title
    slug: slug
  database:
    slug: blog_posts
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

describe("updateContentTypeConfig database unlink", () => {
  it("removes the database key when database is null", () => {
    const before = getContentTypeConfig("blog", contentRoot);
    expect(before?.database?.slug).toBe("blog_posts");

    updateContentTypeConfig(
      "blog",
      {
        database: null,
        field_mapping: { slug: "slug", title: "title" },
      },
      contentRoot,
    );

    resetRegistry(contentRoot);
    const after = getContentTypeConfig("blog", contentRoot);
    expect(after?.database).toBeUndefined();
    expect(after?.field_mapping).toMatchObject({
      _slug: "slug",
      title: "title",
      _locale: expect.any(String),
      _image: expect.any(String),
      published_at: "published_at",
    });
    expect(after?.field_mapping).not.toHaveProperty("slug");
    expect(after?.url_pattern.en).toBe("/en/blog/:slug");

    const raw = fs.readFileSync(path.join(contentRoot, "content-types.yml"), "utf-8");
    expect(raw).not.toMatch(/database:/);
    expect(raw).not.toMatch(/blog_posts/);
  });

  it("still merges database slug updates when an object is passed", () => {
    updateContentTypeConfig("blog", { database: { slug: "other_db" } }, contentRoot);
    resetRegistry(contentRoot);
    const after = getContentTypeConfig("blog", contentRoot);
    expect(after?.database?.slug).toBe("other_db");
  });
});

describe("extractUrlPatternParams", () => {
  it("resolves multi-variable patterns from entry data with string category", () => {
    const { params, missing } = extractUrlPatternParams(
      "/en/blog/:category/:slug",
      { slug: "my-post", category: "uncategorized" },
    );
    expect(missing).toEqual([]);
    expect(params).toEqual({ category: "uncategorized" });
  });

  it("still unwraps leftover object.slug values via resolveFieldValue", () => {
    const { params, missing } = extractUrlPatternParams(
      "/en/blog/:category/:slug",
      { slug: "my-post", category: { slug: "legacy" } },
    );
    expect(missing).toEqual([]);
    expect(params).toEqual({ category: "legacy" });
  });

  it("resolves plain string fields and ignores slug/locale placeholders", () => {
    const { params, missing } = extractUrlPatternParams(
      "/:locale/posts/:author/:year/:slug",
      { author: "jane", year: 2026 },
    );
    expect(missing).toEqual([]);
    expect(params).toEqual({ author: "jane", year: "2026" });
  });

  it("reports missing variables instead of resolving them to empty strings", () => {
    const { params, missing } = extractUrlPatternParams(
      "/en/blog/:category/:slug",
      { slug: "my-post" },
    );
    expect(missing).toEqual(["category"]);
    expect(params).toEqual({});
  });

  it("applies field-mapping defaults when the record omits a URL param", () => {
    const { params, missing } = extractUrlPatternParams(
      "/en/blog/:category/:slug",
      { slug: "my-post" },
      { category: "category" },
      { category: "uncategorized" },
    );
    expect(missing).toEqual([]);
    expect(params).toEqual({ category: "uncategorized" });
  });

  it("resolveUrlPatternWithMapping fills defaults for missing params", () => {
    const url = resolveUrlPatternWithMapping(
      "/en/blog/:category/:slug",
      { slug: "my-post" },
      "en",
      { category: "category", _slug: "slug" },
      { category: "uncategorized" },
    );
    expect(url).toBe("/en/blog/uncategorized/my-post");
  });

  it("treats empty values as missing", () => {
    const { missing } = extractUrlPatternParams(
      "/en/blog/:category/:slug",
      { slug: "my-post", category: "" },
    );
    expect(missing).toEqual(["category"]);
  });

  it("uses field mapping to resolve variables from mapped source fields", () => {
    const { params, missing } = extractUrlPatternParams(
      "/en/blog/:category/:slug",
      { category_name: "trends-and-tech" },
      { category: "category_name" },
    );
    expect(missing).toEqual([]);
    expect(params).toEqual({ category: "trends-and-tech" });
  });
});

describe("formatUrlParamFieldValue", () => {
  it("writes category as a plain string when shape is string", () => {
    expect(formatUrlParamFieldValue("ai-tools", "string")).toBe("ai-tools");
    expect(formatUrlParamFieldValue("ai-tools", "object_slug")).toEqual({ slug: "ai-tools" });
  });
});

describe("listExtraUrlPatternParams", () => {
  it("collects unique extra params across locale patterns", () => {
    expect(
      listExtraUrlPatternParams({
        en: "/en/blog/:category/:slug",
        es: "/es/blog/:category/:slug",
      }),
    ).toEqual(["category"]);
  });

  it("ignores slug and locale placeholders", () => {
    expect(
      listExtraUrlPatternParams({
        default: "/:locale/posts/:author/:slug",
      }),
    ).toEqual(["author"]);
  });

  it("returns empty for slug-only patterns", () => {
    expect(listExtraUrlPatternParams({ en: "/en/:slug" })).toEqual([]);
  });
});

describe("normalizeHreflangMap", () => {
  it("normalizes us→en and keeps string slugs", () => {
    expect(
      normalizeHreflangMap({
        us: "how-to-foo",
        es: "como-foo",
        fr: 123,
        "": "x",
      }),
    ).toEqual({
      en: "how-to-foo",
      es: "como-foo",
    });
  });

  it("merges self locale/slug when API omits current locale", () => {
    expect(
      normalizeHreflangMap(
        { us: "how-to-write-quizzes" },
        { locale: "es", slug: "como-crear-qui" },
      ),
    ).toEqual({
      en: "how-to-write-quizzes",
      es: "como-crear-qui",
    });
  });

  it("handles null/undefined raw", () => {
    expect(normalizeHreflangMap(null, { locale: "en", slug: "solo" })).toEqual({
      en: "solo",
    });
    expect(normalizeHreflangMap(undefined)).toEqual({});
  });
});

describe("normalizeHreflangLocaleKey / getCanonicalHreflangSlug", () => {
  it("maps us to en", () => {
    expect(normalizeHreflangLocaleKey("us")).toBe("en");
    expect(normalizeHreflangLocaleKey("EN-US")).toBe("en");
  });

  it("prefers en for canonical cluster slug", () => {
    expect(getCanonicalHreflangSlug({ es: "b", en: "a" })).toBe("a");
    expect(getCanonicalHreflangSlug({ es: "b", de: "c" })).toBe("c");
    expect(getCanonicalHreflangSlug({})).toBeNull();
  });
});

describe("getHreflangsSource / resolveHreflangsFromRecord", () => {
  it("reads _hreflangs from content type config", () => {
    updateContentTypeConfig(
      "blog",
      {
        field_mapping: {
          _slug: "slug",
          _locale: "lang",
          _hreflangs: "translations",
          title: "title",
          slug: "slug",
        },
      },
      contentRoot,
    );
    resetRegistry(contentRoot);
    expect(getHreflangsSource("blog", contentRoot)).toBe("translations");
  });

  it("resolves map from record and merges self", () => {
    updateContentTypeConfig(
      "blog",
      {
        field_mapping: {
          _slug: "slug",
          _locale: "lang",
          _hreflangs: "translations",
          title: "title",
          slug: "slug",
          lang: "lang",
        },
      },
      contentRoot,
    );
    resetRegistry(contentRoot);

    const map = resolveHreflangsFromRecord(
      {
        slug: "como-crear-qui",
        lang: "es",
        translations: { us: "how-to-write-quizzes" },
      },
      "blog",
      contentRoot,
    );
    expect(map).toEqual({
      en: "how-to-write-quizzes",
      es: "como-crear-qui",
    });
  });

  it("returns null when _hreflangs is not configured", () => {
    const map = resolveHreflangsFromRecord(
      { slug: "x", translations: { en: "x" } },
      "blog",
      contentRoot,
    );
    expect(map).toBeNull();
  });
});

describe("normalizeContentTypeFieldConfig locale indexes", () => {
  it("strips lang, locale, and language from explicit indexes", () => {
    const normalized = normalizeContentTypeFieldConfig(
      { _slug: "slug", _locale: "locale", title: "title" },
      {
        isDbBacked: false,
        indexes: ["status", "lang", "locale", "language", "category"],
      },
    );
    expect(normalized.indexes).toEqual(["status", "category"]);
  });

  it("allows seo_* DB baseline mapping keys", () => {
    const normalized = normalizeContentTypeFieldConfig(
      {
        _slug: "slug",
        seo_main_keyword: "cluster_keyword",
        seo_pillar_path: "cluster_url",
        seo_is_pillar: "is_hub",
      },
      { isDbBacked: true },
    );
    expect(normalized.field_mapping.seo_main_keyword).toBe("cluster_keyword");
    expect(normalized.field_mapping.seo_pillar_path).toBe("cluster_url");
    expect(normalized.field_mapping.seo_is_pillar).toBe("is_hub");
  });

  it("rejects dotted seo.* field_mapping keys", () => {
    expect(() =>
      normalizeContentTypeFieldConfig(
        { _slug: "slug", "seo.main_keyword": "cluster_keyword" },
        { isDbBacked: true },
      ),
    ).toThrow(/Invalid field_mapping key/);
  });
});
