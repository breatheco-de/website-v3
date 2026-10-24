import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  normalizeSearchQuery,
  intersectSearchWithFiltersAndBackfill,
  clearDatabaseSearchMemoryCacheForTests,
  getDatabaseSearchCacheStats,
  peekDatabaseSearchCacheL1,
  resolveRefs,
  searchDatabaseItems,
  SEARCH_CACHE_TTL_MS,
} from "./database-search";
import { setJobState } from "./db-job-state";
import { __setVectorSearchTestDoubles, syncIndex, vectorItemKey } from "./vector-search";
import { makeFakeEmbedder, makeFakeQdrant } from "./test-helpers/fake-qdrant";
import type { DatabaseManager } from "./database";

describe("normalizeSearchQuery", () => {
  it("trims, lower-cases, and collapses whitespace", () => {
    expect(normalizeSearchQuery("  Job   Guarantee  ")).toBe("job guarantee");
  });
});

describe("intersectSearchWithFiltersAndBackfill", () => {
  it("keeps search rank then backfills from filter-only", () => {
    const searchHits = [
      { slug: "a", question: "A?" },
      { slug: "b", question: "B?" },
    ];
    const filterOnly = [
      { slug: "b", question: "B?" },
      { slug: "c", question: "C?" },
      { slug: "d", question: "D?" },
    ];
    const result = intersectSearchWithFiltersAndBackfill(searchHits, filterOnly, 3);
    expect(result.map((i) => i.slug)).toEqual(["a", "b", "c"]);
  });

  it("stops at remaining slots", () => {
    const result = intersectSearchWithFiltersAndBackfill(
      [{ slug: "a" }, { slug: "b" }],
      [{ slug: "c" }],
      1,
    );
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("a");
  });
});

describe("search cache L1 helpers", () => {
  beforeEach(() => {
    clearDatabaseSearchMemoryCacheForTests();
  });

  it("starts empty", () => {
    expect(getDatabaseSearchCacheStats("faqs").memoryEntries).toBe(0);
    expect(peekDatabaseSearchCacheL1("faqs", "job guarantee", "en")).toBeNull();
  });
});

describe("resolveRefs", () => {
  const fields = ["excerpt"];
  const items = [
    { locale: "en", excerpt: "first" },
    { locale: "en", excerpt: "second" },
  ];
  const keyMap = () => new Map(items.map((i) => [vectorItemKey(i, fields), i]));

  it("maps keyed refs through the key map", () => {
    const key = vectorItemKey(items[1], fields);
    const out = resolveRefs([{ slug: "", key, score: 0.9 }], items, keyMap);
    expect(out.items).toEqual([items[1]]);
  });

  it("maps legacy refs by position, including slugless rows stored with their position as slug", () => {
    const out = resolveRefs([{ slug: "1", _idx: 1, score: 0.5 }], items, keyMap);
    expect(out.items).toEqual([items[1]]);
  });

  it("drops duplicate hits that resolve to the same row", () => {
    const key = vectorItemKey(items[0], fields);
    const out = resolveRefs(
      [
        { slug: "", key, score: 0.9 },
        { slug: "0", _idx: 0, score: 0.8 },
      ],
      items,
      keyMap,
    );
    expect(out.items).toHaveLength(1);
    expect(out.refs).toHaveLength(1);
  });
});

describe("searchDatabaseItems collection choice", () => {
  const fields = ["excerpt"];
  const items = [
    { locale: "en", excerpt: "career support after graduation" },
    { locale: "en", excerpt: "mentors are great" },
  ];
  let contentRoot: string;
  let qdrant: ReturnType<typeof makeFakeQdrant>;
  let queueVectorIndex: ReturnType<typeof vi.fn>;
  let db: DatabaseManager;

  beforeEach(() => {
    clearDatabaseSearchMemoryCacheForTests();
    contentRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "db-search-")), "site_test");
    fs.mkdirSync(contentRoot, { recursive: true });
    qdrant = makeFakeQdrant();
    __setVectorSearchTestDoubles({ client: qdrant, embedder: makeFakeEmbedder().embedder });
    queueVectorIndex = vi.fn(async () => ({ queued: true }));
    db = {
      get: () => ({ name: "T", source: { type: "local" }, vector_search: { enabled: true, fields } }),
      fetchItems: async () => ({ items, raw_count: items.length, fetched_at: "t1", from_cache: true }),
      getContentRoot: () => contentRoot,
      queueVectorIndex,
    } as unknown as DatabaseManager;
  });

  afterEach(() => {
    __setVectorSearchTestDoubles(null);
  });

  it("uses the ready site-scoped collection and maps hits by key", async () => {
    await syncIndex("site_test__testimonials", items, fields);
    setJobState("testimonials", "index", { status: "done", ready: true, collection: "site_test__testimonials" }, contentRoot);
    const res = await searchDatabaseItems("testimonials", "career", { db, contentFolder: "site_test" });
    expect(res.semantic).toBe(true);
    expect(res.items).toHaveLength(2);
    expect(queueVectorIndex).not.toHaveBeenCalled();
    expect(qdrant.search).toHaveBeenCalledWith("site_test__testimonials", expect.anything());
  });

  it("falls back to the legacy collection while the site-scoped one is not ready", async () => {
    qdrant.cols.set(
      "testimonials",
      new Map([["1", { id: 1, payload: { slug: "1", _idx: 1, locale: "en" } }]]),
    );
    const res = await searchDatabaseItems("testimonials", "mentors", { db, contentFolder: "site_test" });
    expect(res.semantic).toBe(true);
    expect(res.items).toEqual([items[1]]);
    expect(queueVectorIndex).toHaveBeenCalledWith("testimonials", "missing_collection");
  });

  it("uses keyword matching and queues a sync when no collection is usable", async () => {
    const res = await searchDatabaseItems("testimonials", "mentors", { db, contentFolder: "site_test" });
    expect(res.semantic).toBe(false);
    expect(res.fallback_reason).toBe("semantic_index_empty");
    expect(res.items).toEqual([items[1]]);
    expect(queueVectorIndex).toHaveBeenCalled();
  });

  it("marks the index not ready and re-queues when a ready collection went missing", async () => {
    setJobState("testimonials", "index", { status: "done", ready: true, collection: "site_test__testimonials" }, contentRoot);
    const res = await searchDatabaseItems("testimonials", "mentors", { db, contentFolder: "site_test" });
    expect(res.semantic).toBe(false);
    expect(queueVectorIndex).toHaveBeenCalledWith("testimonials", "missing_collection");
    const { getJobState } = await import("./db-job-state");
    expect(getJobState("testimonials", contentRoot).index.ready).toBe(false);
  });
});

describe("SEARCH_CACHE_TTL_MS", () => {
  it("is seven days", () => {
    expect(SEARCH_CACHE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
