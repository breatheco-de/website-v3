import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRegistry } from "./content-types";
import {
  assertMainKeywordAvailable,
  buildMainKeywordOwners,
  findMainKeywordConflict,
  invalidateSeoIndexCache,
  loadSeoIndex,
  readSeoIndexFile,
  resetSeoOverlayField,
  seoEntryId,
  writeSeoFields,
  type SeoIndex,
} from "./seo-index";
import type { ContentIndex } from "./content-index";

vi.mock("./events/emit-entry-events", () => ({
  emitEntrySeoChanged: vi.fn(),
}));

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;

function stubCi(selfPath: string): ContentIndex {
  return {
    getAlternateUrls: () => ({ en: selfPath }),
    getRedirects: () => [],
    refreshCustomRedirects: () => [],
    isKnownUrl: (url: string) => url === selfPath || url.startsWith("/en/"),
    findBySlug: () => [],
  } as unknown as ContentIndex;
}

function seedEmptySeoIndex(): void {
  const index: SeoIndex = {
    version: 1,
    generated_at: new Date().toISOString(),
    entries: {},
    by_path: {},
    clusters: {},
    orphans: [],
    warnings: [],
  };
  fs.writeFileSync(path.join(contentRoot, "seo-index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf-8");
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "seo-index-test-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(path.join(contentRoot, "blog", "post-a"), { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  url_pattern:
    en: /en/blog/:slug
  seo_monitoring:
    enabled: true
    require_cluster: true
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(contentRoot, "blog", "post-a", "en.yml"),
    `slug: post-a
content: |
  # Keep me
  markdown body
meta:
  page_title: Post A
  description: SEO
`,
    "utf-8",
  );
  seedEmptySeoIndex();
  resetRegistry();
  invalidateSeoIndexCache();
  process.chdir(tempDir);
  resetRegistry(contentRoot);
});

afterEach(() => {
  resetRegistry();
  invalidateSeoIndexCache();
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("writeSeoFields", () => {
  it("does not yaml.dump the content: block", () => {
    const result = writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "learn javascript" },
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    expect(result.success).toBe(true);
    const text = fs.readFileSync(path.join(contentRoot, "blog", "post-a", "en.yml"), "utf-8");
    expect(text).toContain("content: |");
    expect(text).toContain("  # Keep me");
    expect(text).toContain("markdown body");
    expect(text).toContain("main_keyword: learn javascript");
  });

  it("mirrors kw_monthly_volume and kw_difficulty on the live index row", () => {
    const result = writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: {
        main_keyword: "learn javascript",
        kw_monthly_volume: 1500,
        kw_difficulty: 37,
        pillar_path: "/en/blog/hub",
      },
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    expect(result.success).toBe(true);
    const text = fs.readFileSync(path.join(contentRoot, "blog", "post-a", "en.yml"), "utf-8");
    expect(text).toMatch(/kw_monthly_volume: 1500/);
    expect(text).toMatch(/kw_difficulty: 37/);
    const index = loadSeoIndex(contentRoot);
    const row = index.entries["blog/post-a/en"];
    expect(row?.kw_monthly_volume).toBe(1500);
    expect(row?.kw_difficulty).toBe(37);
    expect(row?.main_keyword).toBe("learn javascript");
  });

  it("rejects SEO writes on draft while live exists", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "draft.en.yml"),
      `slug: post-a
meta:
  page_title: Draft
  description: Draft SEO
`,
      "utf-8",
    );
    const result = writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "draft kw" },
      contentRoot,
      variant: "draft",
      ci: stubCi("/en/blog/post-a"),
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("seo_draft_while_live_forbidden");
  });

  it("allows draft SEO when unpublished and does not index until live", () => {
    fs.unlinkSync(path.join(contentRoot, "blog", "post-a", "en.yml"));
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "draft.en.yml"),
      `slug: post-a
meta:
  page_title: Draft
  description: Draft SEO
`,
      "utf-8",
    );
    const result = writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "draft kw", pillar_path: "/en/blog/hub" },
      contentRoot,
      variant: "draft",
      ci: stubCi("/en/blog/post-a"),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.isVariantLayer).toBe(true);
    const index = loadSeoIndex(contentRoot);
    expect(index.entries["blog/post-a/en"]).toBeUndefined();
  });

  it("rejects SEO writes on A/B variants", () => {
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "b.en.yml"),
      `slug: post-a
meta:
  page_title: B
  description: B SEO
`,
      "utf-8",
    );
    const result = writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "b kw" },
      contentRoot,
      variant: "b",
      ci: stubCi("/en/blog/post-a"),
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("seo_variant_forbidden");
  });
});

describe("resetSeoOverlayField", () => {
  it("removes a seo: key and falls back to empty when no DB baseline", () => {
    writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "keep", pillar_path: "/en/blog/hub" },
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    const result = resetSeoOverlayField({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      fieldPath: "seo.pillar_path",
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    expect(result.success).toBe(true);
    expect(result.noop).toBeFalsy();
    const text = fs.readFileSync(path.join(contentRoot, "blog", "post-a", "en.yml"), "utf-8");
    expect(text).toContain("main_keyword: keep");
    expect(text).not.toMatch(/pillar_path:/);
  });

  it("returns noop when key is absent", () => {
    const result = resetSeoOverlayField({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      fieldPath: "seo.main_keyword",
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    expect(result.success).toBe(true);
    expect(result.noop).toBe(true);
  });
});

describe("main keyword uniqueness", () => {
  it("buildMainKeywordOwners keys by exact trimmed keyword", () => {
    const index: SeoIndex = {
      version: 1,
      generated_at: new Date().toISOString(),
      entries: {
        "blog/a/en": {
          content_type: "blog",
          slug: "a",
          locale: "en",
          file: "blog/a/en.yml",
          path: "/en/blog/a",
          main_keyword: "AI Tools",
          kw_monthly_volume: null,
          kw_difficulty: null,
          is_pillar: false,
          pillar_path: "",
          pillar_live: null,
        },
        "blog/b/en": {
          content_type: "blog",
          slug: "b",
          locale: "en",
          file: "blog/b/en.yml",
          path: "/en/blog/b",
          main_keyword: "ai tools",
          kw_monthly_volume: null,
          kw_difficulty: null,
          is_pillar: false,
          pillar_path: "",
          pillar_live: null,
        },
      },
      by_path: {},
      clusters: {},
      orphans: [],
      warnings: [],
    };
    const owners = buildMainKeywordOwners(index);
    expect(owners.get("AI Tools")?.map((o) => o.slug)).toEqual(["a"]);
    expect(owners.get("ai tools")?.map((o) => o.slug)).toEqual(["b"]);
    expect(
      findMainKeywordConflict({
        index,
        keyword: "AI Tools",
        excludeId: "blog/a/en",
      }),
    ).toBeNull();
    expect(
      findMainKeywordConflict({
        index,
        keyword: "AI Tools",
        excludeId: "blog/other/en",
      })?.slug,
    ).toBe("a");
  });

  it("allows re-saving the same keyword on the current entry", () => {
    const first = writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "learn javascript" },
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    expect(first.success).toBe(true);
    const again = writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "learn javascript", is_pillar: false },
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    expect(again.success).toBe(true);
  });

  it("blocks another entry from taking an exact keyword", () => {
    writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "learn javascript" },
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    fs.mkdirSync(path.join(contentRoot, "blog", "post-b"), { recursive: true });
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-b", "en.yml"),
      `slug: post-b
meta:
  page_title: Post B
  description: SEO
`,
      "utf-8",
    );
    const taken = writeSeoFields({
      contentType: "blog",
      slug: "post-b",
      locale: "en",
      updates: { main_keyword: "learn javascript" },
      contentRoot,
      ci: stubCi("/en/blog/post-b"),
    });
    expect(taken.success).toBe(false);
    if (taken.success) throw new Error("expected failure");
    expect(taken.code).toBe("seo_keyword_taken");
    expect(taken.error).toMatch(/already used/i);

    const differentCase = writeSeoFields({
      contentType: "blog",
      slug: "post-b",
      locale: "en",
      updates: { main_keyword: "Learn javascript" },
      contentRoot,
      ci: stubCi("/en/blog/post-b"),
    });
    expect(differentCase.success).toBe(true);
  });

  it("skips uniqueness for empty keyword", () => {
    const gate = assertMainKeywordAvailable({
      contentRoot,
      keyword: "   ",
      contentType: "blog",
      slug: "post-a",
      locale: "en",
    });
    expect(gate.ok).toBe(true);
  });

  it("blocks when seo-index.json is missing", () => {
    fs.unlinkSync(path.join(contentRoot, "seo-index.json"));
    invalidateSeoIndexCache();
    const gate = assertMainKeywordAvailable({
      contentRoot,
      keyword: "anything",
      contentType: "blog",
      slug: "post-a",
      locale: "en",
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("expected failure");
    expect(gate.code).toBe("seo_index_unavailable");
    expect(readSeoIndexFile(contentRoot)).toBeNull();

    const write = writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "anything" },
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    expect(write.success).toBe(false);
    if (write.success) throw new Error("expected failure");
    expect(write.code).toBe("seo_index_unavailable");
    expect(write.statusCode).toBe(503);
  });

  it("seoEntryId matches exclude id format", () => {
    expect(seoEntryId("blog", "post-a", "en")).toBe("blog/post-a/en");
  });
});

describe("seo-index lifecycle helpers", () => {
  it("syncSeoIndexEntryFromLiveDisk patches the index from live YAML", async () => {
    const { syncSeoIndexEntryFromLiveDisk } = await import("./seo-index");
    fs.writeFileSync(
      path.join(contentRoot, "blog", "post-a", "en.yml"),
      `slug: post-a
seo:
  main_keyword: synced-kw
  pillar_path: /en/blog/hub
meta:
  page_title: Post A
  description: SEO
`,
      "utf-8",
    );
    syncSeoIndexEntryFromLiveDisk({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
      emitEvent: false,
    });
    const index = loadSeoIndex(contentRoot);
    expect(index.entries["blog/post-a/en"]?.main_keyword).toBe("synced-kw");
  });

  it("removeSeoIndexEntries drops keys from the index", async () => {
    const { removeSeoIndexEntries } = await import("./seo-index");
    writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "gone", pillar_path: "/en/blog/hub" },
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    expect(loadSeoIndex(contentRoot).entries["blog/post-a/en"]).toBeDefined();
    removeSeoIndexEntries({
      entryIds: ["blog/post-a/en"],
      contentRoot,
    });
    expect(loadSeoIndex(contentRoot).entries["blog/post-a/en"]).toBeUndefined();
  });

  it("ensureSeoIndexBeforeDiagnostics repairs a stale index before validators", async () => {
    const { ensureSeoIndexBeforeDiagnostics, invalidateSeoIndexCache } = await import("./seo-index");
    writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "fresh", pillar_path: "/en/blog/hub" },
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    const indexPath = path.join(contentRoot, "seo-index.json");
    const stale = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    stale.entries["blog/post-a/en"].main_keyword = "stale";
    fs.writeFileSync(indexPath, JSON.stringify(stale), "utf-8");
    invalidateSeoIndexCache();
    ensureSeoIndexBeforeDiagnostics({
      contentRoot,
      entryKeys: ["blog/post-a/en"],
      ci: stubCi("/en/blog/post-a"),
    });
    const repaired = loadSeoIndex(contentRoot);
    expect(repaired.entries["blog/post-a/en"]?.main_keyword).toBe("fresh");
  });
});

describe("cluster priority preserve", () => {
  function seedHubAndSpoke() {
    fs.mkdirSync(path.join(contentRoot, "blog", "hub"), { recursive: true });
    fs.writeFileSync(
      path.join(contentRoot, "blog", "hub", "en.yml"),
      `slug: hub
seo:
  main_keyword: hub kw
  is_pillar: true
meta:
  page_title: Hub
  description: Hub SEO
`,
      "utf-8",
    );
    writeSeoFields({
      contentType: "blog",
      slug: "hub",
      locale: "en",
      updates: { main_keyword: "hub kw", is_pillar: true },
      contentRoot,
      ci: stubCi("/en/blog/hub"),
    });
    writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "spoke kw", pillar_path: "/en/blog/hub" },
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
  }

  it("survives patch recompute and full rebuild; drops when hub is gone", async () => {
    const {
      setClusterPriority,
      rebuildSeoIndex,
      invalidateSeoIndexCache: invalidate,
    } = await import("./seo-index");
    seedHubAndSpoke();
    const hubId = "blog/hub/en";
    expect(loadSeoIndex(contentRoot).clusters[hubId]).toBeDefined();

    const set = setClusterPriority({ hubId, priority: 1, contentRoot });
    expect(set.success).toBe(true);
    expect(loadSeoIndex(contentRoot).clusters[hubId]?.priority).toBe(1);

    // Patch a spoke — recomputeGraph must preserve priority
    writeSeoFields({
      contentType: "blog",
      slug: "post-a",
      locale: "en",
      updates: { main_keyword: "spoke kw updated", pillar_path: "/en/blog/hub" },
      contentRoot,
      ci: stubCi("/en/blog/post-a"),
    });
    expect(loadSeoIndex(contentRoot).clusters[hubId]?.priority).toBe(1);

    // Full rebuild from YAML — disk snapshot must restore priority
    invalidate();
    rebuildSeoIndex({ contentRoot, reason: "test", ci: stubCi("/en/blog/hub"), mark: false });
    expect(loadSeoIndex(contentRoot).clusters[hubId]?.priority).toBe(1);

    // Remove hub pillar → priority dropped
    writeSeoFields({
      contentType: "blog",
      slug: "hub",
      locale: "en",
      updates: { main_keyword: "hub kw", is_pillar: false },
      contentRoot,
      ci: stubCi("/en/blog/hub"),
    });
    expect(loadSeoIndex(contentRoot).clusters[hubId]).toBeUndefined();
  });

  it("setClusterPriority clears with null", async () => {
    const { setClusterPriority } = await import("./seo-index");
    seedHubAndSpoke();
    const hubId = "blog/hub/en";
    setClusterPriority({ hubId, priority: 2, contentRoot });
    expect(loadSeoIndex(contentRoot).clusters[hubId]?.priority).toBe(2);
    const cleared = setClusterPriority({ hubId, priority: null, contentRoot });
    expect(cleared.success).toBe(true);
    expect(loadSeoIndex(contentRoot).clusters[hubId]?.priority).toBeUndefined();
  });
});
