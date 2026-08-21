import { describe, expect, it } from "vitest";
import {
  classifyClusterEntry,
  computeClusterHealth,
  listClusterBucketEntries,
} from "./seo-cluster-stats";
import type { SeoIndex, SeoIndexEntry } from "./seo-index";

function row(partial: Partial<SeoIndexEntry> & { slug: string }): SeoIndexEntry {
  return {
    content_type: "blog",
    slug: partial.slug,
    locale: "en",
    file: "blog/x/en.yml",
    path: "/en/blog/x",
    main_keyword: null,
    is_pillar: false,
    pillar_path: null,
    pillar_live: null,
    ...partial,
  };
}

function emptyIndex(entries: Record<string, SeoIndexEntry> = {}): SeoIndex {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    rebuilt: true,
    entries,
    by_path: {},
    clusters: {},
    orphans: [],
    warnings: [],
  };
}

describe("classifyClusterEntry", () => {
  it("classifies hub, clustered, partially set, unclustered, opted out, broken", () => {
    const orphans = new Set(["blog/broken/en"]);
    expect(classifyClusterEntry(row({ slug: "hub", is_pillar: true }), orphans)).toBe("hub");
    expect(
      classifyClusterEntry(row({ slug: "spoke", pillar_path: "/en/hub" }), orphans),
    ).toBe("clustered");
    expect(
      classifyClusterEntry(row({ slug: "kw", main_keyword: "javascript", pillar_path: "" }), orphans),
    ).toBe("partiallySet");
    expect(classifyClusterEntry(row({ slug: "bare", pillar_path: "" }), orphans)).toBe("unclustered");
    expect(
      classifyClusterEntry(row({ slug: "solo", pillar_opted_out: true, main_keyword: "x" }), orphans),
    ).toBe("optedOut");
    expect(
      classifyClusterEntry(row({ slug: "broken", pillar_path: "/en/missing" }), orphans),
    ).toBe("brokenRef");
  });
});

describe("computeClusterHealth", () => {
  it("counts no-signal monitored gaps as unclustered and keeps opted-out separate", () => {
    const opted = row({
      slug: "opted",
      pillar_opted_out: true,
      main_keyword: "solo topic",
      pillar_path: null,
    });
    const partial = row({
      slug: "partial",
      main_keyword: "javascript",
      pillar_path: "",
    });
    const clustered = row({
      slug: "spoke",
      pillar_path: "/en/hub",
      main_keyword: "hub topic",
    });
    const index = emptyIndex({
      "blog/opted/en": opted,
      "blog/partial/en": partial,
      "blog/spoke/en": clustered,
    });

    const health = computeClusterHealth(index, undefined, [
      { contentType: "blog", slug: "missing-seo", locale: "en" },
      { contentType: "blog", slug: "also-bare", locale: "es" },
    ]);

    expect(health.stats.unclustered).toBe(2);
    expect(health.stats.optedOut).toBe(1);
    expect(health.stats.partiallySet).toBe(1);
    expect(health.stats.clustered).toBe(1);
    expect(health.byContentType.blog.unclustered).toBe(2);
    expect(health.byLocale.en.unclustered).toBe(1);
    expect(health.byLocale.es.unclustered).toBe(1);
  });

  it("does not double-count a gap that already has an index entry", () => {
    const bare = row({ slug: "bare", pillar_path: "" });
    const index = emptyIndex({ "blog/bare/en": bare });
    const health = computeClusterHealth(index, undefined, [
      { contentType: "blog", slug: "bare", locale: "en" },
    ]);
    expect(health.stats.unclustered).toBe(1);
  });

  it("counts bare index rows as unclustered without gaps", () => {
    const bare = row({ slug: "bare", pillar_path: "" });
    const health = computeClusterHealth(emptyIndex({ "blog/bare/en": bare }));
    expect(health.stats.unclustered).toBe(1);
    expect(health.stats.optedOut).toBe(0);
  });
});

describe("listClusterBucketEntries", () => {
  it("includes no-signal gaps in unclustered and excludes hubs from clustered", () => {
    const hub = row({
      slug: "hub",
      is_pillar: true,
      path: "/en/blog/hub",
      pillar_path: "/en/blog/hub",
    });
    const spoke = row({
      slug: "spoke",
      pillar_path: "/en/blog/hub",
      main_keyword: "topic",
      path: "/en/blog/spoke",
    });
    const bare = row({ slug: "bare", pillar_path: "", path: "/en/blog/bare" });
    const index = emptyIndex({
      "blog/hub/en": hub,
      "blog/spoke/en": spoke,
      "blog/bare/en": bare,
    });
    index.by_path["/en/blog/hub"] = "blog/hub/en";
    index.clusters["blog/hub/en"] = { path: "/en/blog/hub", members: ["blog/spoke/en"] };

    const unclustered = listClusterBucketEntries(index, {
      bucket: "unclustered",
      noSignalGaps: [{ contentType: "blog", slug: "gap-page", locale: "en" }],
    });
    expect(unclustered.total).toBe(2);
    expect(unclustered.items.map((r) => r.slug).sort()).toEqual(["bare", "gap-page"]);

    const clustered = listClusterBucketEntries(index, { bucket: "clustered" });
    expect(clustered.total).toBe(1);
    expect(clustered.items[0]?.slug).toBe("spoke");
  });

  it("lists empty hubs and paginates / filters by q", () => {
    const emptyHub = row({
      slug: "lonely",
      is_pillar: true,
      path: "/en/blog/lonely",
      pillar_path: "/en/blog/lonely",
      main_keyword: "lonely topic",
    });
    const filledHub = row({
      slug: "busy",
      is_pillar: true,
      path: "/en/blog/busy",
      pillar_path: "/en/blog/busy",
    });
    const spoke = row({ slug: "member", pillar_path: "/en/blog/busy" });
    const index = emptyIndex({
      "blog/lonely/en": emptyHub,
      "blog/busy/en": filledHub,
      "blog/member/en": spoke,
    });
    index.clusters["blog/lonely/en"] = { path: "/en/blog/lonely", members: [] };
    index.clusters["blog/busy/en"] = { path: "/en/blog/busy", members: ["blog/member/en"] };

    const empty = listClusterBucketEntries(index, { bucket: "emptyHubs" });
    expect(empty.total).toBe(1);
    expect(empty.items[0]?.slug).toBe("lonely");

    const filtered = listClusterBucketEntries(index, {
      bucket: "emptyHubs",
      q: "lonely topic",
    });
    expect(filtered.total).toBe(1);

    const miss = listClusterBucketEntries(index, { bucket: "emptyHubs", q: "zzzz" });
    expect(miss.total).toBe(0);

    const page1 = listClusterBucketEntries(index, {
      bucket: "unclustered",
      page: 1,
      pageSize: 1,
      noSignalGaps: [
        { contentType: "blog", slug: "a-gap", locale: "en" },
        { contentType: "blog", slug: "b-gap", locale: "en" },
      ],
    });
    expect(page1.total).toBe(2);
    expect(page1.items).toHaveLength(1);
    expect(page1.pageSize).toBe(1);
  });

  it("resolves public path for no-signal gap rows", () => {
    const index = emptyIndex();
    const ci = {
      getAlternateUrls: (slug: string) =>
        slug === "gap-page" ? { en: "/en/blog/topic/gap-page" } : {},
    } as unknown as import("./content-index").ContentIndex;

    const result = listClusterBucketEntries(index, {
      bucket: "unclustered",
      noSignalGaps: [{ contentType: "blog", slug: "gap-page", locale: "en" }],
      ci,
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.path).toBe("/en/blog/topic/gap-page");
  });
});
