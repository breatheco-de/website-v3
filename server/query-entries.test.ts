import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import {
  hydrateStaticListingContent,
  invalidateStaticListingCache,
  isDetachedLocaleOnlyPubliclyHidden,
  queryEntries,
} from "./query-entries";
import { HIDDEN_LOCATION_SENTINEL } from "./shared-layout-sync";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;
let ci: ContentIndex;

function writeBlogFixture() {
  const blogDir = path.join(contentRoot, "blog");
  fs.mkdirSync(blogDir, { recursive: true });

  const postA = path.join(blogDir, "post-alpha");
  fs.mkdirSync(postA, { recursive: true });
  fs.writeFileSync(
    path.join(postA, "_common.yml"),
    `image: https://example.com/a.jpg
published_at: '2025-06-01T00:00:00.000Z'
status: PUBLISHED
category: ai
lang: en
slug: post-alpha
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(postA, "en.yml"),
    `title: Alpha Post
description: Alpha description
content: |
  # Long markdown that should not appear in listing
  lots of content
sections:
  - type: hero
`,
    "utf-8",
  );

  const postB = path.join(blogDir, "post-beta");
  fs.mkdirSync(postB, { recursive: true });
  fs.writeFileSync(
    path.join(postB, "_common.yml"),
    `image: https://example.com/b.jpg
published_at: '2025-07-01T00:00:00.000Z'
status: PUBLISHED
category: careers
lang: en
slug: post-beta
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(postB, "en.yml"),
    `title: Beta Post
description: Beta description
`,
    "utf-8",
  );

  const postEs = path.join(blogDir, "post-gamma-es");
  fs.mkdirSync(postEs, { recursive: true });
  fs.writeFileSync(
    path.join(postEs, "_common.yml"),
    `image: https://example.com/c.jpg
published_at: '2025-05-01T00:00:00.000Z'
status: DRAFT
category: ai
lang: es
slug: post-gamma-es
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(postEs, "es.yml"),
    `title: Gamma ES
description: Spanish only
`,
    "utf-8",
  );
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "query-entries-test-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
    description: description
    image: image
    published_at: published_at
    status: status
    category: category
    lang: lang
    content: content
    slug: slug
  indexes:
    - status
    - category
  url_pattern:
    en: /en/blog/:category/:slug
    es: /es/blog/:category/:slug
`,
    "utf-8",
  );
  writeBlogFixture();
  process.chdir(tempDir);
  resetRegistry(contentRoot);
  invalidateStaticListingCache();
  ci = new ContentIndex(contentRoot);
  ci.scanFast();
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  invalidateStaticListingCache();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("queryEntries static content type", () => {
  it("loads light projections for static blog entries", async () => {
    const { items, total, meta } = await queryEntries(
      { from: { contentType: "blog" } },
      { contentIndex: ci, contentRoot },
    );

    expect(meta.source).toBe("content_type");
    expect(meta.key).toBe("blog");
    expect(total).toBe(3);
    expect(items).toHaveLength(3);

    const alpha = items.find((i) => i.slug === "post-alpha");
    expect(alpha).toMatchObject({
      title: "Alpha Post",
      description: "Alpha description",
      image: "https://example.com/a.jpg",
      status: "PUBLISHED",
      lang: "en",
    });
    expect(alpha?.category).toBe("ai");
    expect(alpha).not.toHaveProperty("content");
    expect(alpha).not.toHaveProperty("sections");
  });

  it("filters by locale from filename", async () => {
    const { items } = await queryEntries(
      { from: { contentType: "blog" }, locale: "en" },
      { contentIndex: ci, contentRoot },
    );
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.lang === "en")).toBe(true);
  });

  it("applies filters, sort, and limit", async () => {
    const { items, total } = await queryEntries(
      {
        from: { contentType: "blog" },
        locale: "en",
        filters: [{ field: "status", value: "PUBLISHED" }],
        sort: "-published_at",
        limit: 1,
      },
      { contentIndex: ci, contentRoot },
    );

    expect(total).toBe(2);
    expect(items).toHaveLength(1);
    expect(items[0].slug).toBe("post-beta");
  });

  it("filters category by string slug", async () => {
    const { items } = await queryEntries(
      {
        from: { contentType: "blog" },
        locale: "en",
        filters: [{ field: "category", value: "ai" }],
      },
      { contentIndex: ci, contentRoot },
    );
    expect(items).toHaveLength(1);
    expect(items[0].slug).toBe("post-alpha");
  });

  it("attaches _resolved_url when locale is provided", async () => {
    const { items } = await queryEntries(
      { from: { contentType: "blog" }, locale: "en" },
      { contentIndex: ci, contentRoot },
    );
    const alpha = items.find((i) => i.slug === "post-alpha");
    expect(alpha?._resolved_url).toBe("/en/blog/ai/post-alpha");
  });

  it("hydrates omitted content bodies for OG live preview", async () => {
    const { items } = await queryEntries(
      { from: { contentType: "blog" }, locale: "en" },
      { contentIndex: ci, contentRoot },
    );
    const alpha = items.find((i) => i.slug === "post-alpha");
    expect(alpha).not.toHaveProperty("content");

    const hydrated = hydrateStaticListingContent(items, "blog", {
      ci,
      contentRoot,
    });
    const hydratedAlpha = hydrated.find((i) => i.slug === "post-alpha");
    expect(typeof hydratedAlpha?.content).toBe("string");
    expect(String(hydratedAlpha?.content)).toContain("Long markdown");

    const hydratedBeta = hydrated.find((i) => i.slug === "post-beta");
    expect(hydratedBeta).not.toHaveProperty("content");
  });

  it("caches static projections until invalidated", async () => {
    const first = await queryEntries(
      { from: { contentType: "blog" }, locale: "en" },
      { contentIndex: ci, contentRoot },
    );
    expect(first.items).toHaveLength(2);

    // Mutate a fixture file; without invalidate, cache should still return old data
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-alpha", "en.yml"),
      `title: Alpha Changed
description: changed
`,
      "utf-8",
    );

    const cached = await queryEntries(
      { from: { contentType: "blog" }, locale: "en" },
      { contentIndex: ci, contentRoot },
    );
    expect(cached.items.find((i) => i.slug === "post-alpha")?.title).toBe("Alpha Post");

    invalidateStaticListingCache("blog", contentRoot);

    const refreshed = await queryEntries(
      { from: { contentType: "blog" }, locale: "en" },
      { contentIndex: ci, contentRoot },
    );
    expect(refreshed.items.find((i) => i.slug === "post-alpha")?.title).toBe(
      "Alpha Changed",
    );
  });
});

describe("queryEntries database from", () => {
  it("returns empty when database is missing", async () => {
    const { items, total, meta } = await queryEntries(
      { from: { database: "does_not_exist" } },
      { contentIndex: ci, contentRoot },
    );
    expect(meta.source).toBe("database");
    expect(meta.key).toBe("does_not_exist");
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });
});

describe("isDetachedLocaleOnlyPubliclyHidden / listing gate", () => {
  it("skips detached locales whose sections are all publicly hidden", async () => {
    const hiddenPost = path.join(contentRoot, "blog", "post-hidden-mirror");
    fs.mkdirSync(hiddenPost, { recursive: true });
    fs.writeFileSync(
      path.join(hiddenPost, "_common.yml"),
      `image: https://example.com/h.jpg
published_at: '2025-08-01T00:00:00.000Z'
status: PUBLISHED
category:
  slug: ai-powered-learning
slug: post-hidden-mirror
detached: true
`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(hiddenPost, "en.yml"),
      `title: Visible EN
description: Live english
sections:
  - type: hero
    title: Hello
`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(hiddenPost, "es.yml"),
      `title: Mirrored ES
description: Should not list
sections:
  - type: hero
    title: Hola
    showOnLocations:
      - ${HIDDEN_LOCATION_SENTINEL}
  - type: cta_banner
    title: CTA
    showOnLocations:
      - ${HIDDEN_LOCATION_SENTINEL}
`,
      "utf-8",
    );

    invalidateStaticListingCache("blog", contentRoot);
    ci.scanFast();

    expect(
      isDetachedLocaleOnlyPubliclyHidden({
        contentType: "blog",
        slug: "post-hidden-mirror",
        contentRoot,
        localeData: {
          sections: [
            { type: "hero", showOnLocations: [HIDDEN_LOCATION_SENTINEL] },
          ],
        },
      }),
    ).toBe(true);

    const { items: esItems } = await queryEntries(
      { from: { contentType: "blog" }, locale: "es" },
      { contentIndex: ci, contentRoot },
    );
    expect(esItems.find((i) => i.slug === "post-hidden-mirror")).toBeUndefined();

    const { items: enItems } = await queryEntries(
      { from: { contentType: "blog" }, locale: "en" },
      { contentIndex: ci, contentRoot },
    );
    expect(enItems.find((i) => i.slug === "post-hidden-mirror")?.title).toBe("Visible EN");
  });
});
