import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __setVectorSearchTestDoubles,
  search,
  siteCollectionName,
  syncIndex,
  vectorItemKey,
} from "./vector-search";
import { makeFakeEmbedder, makeFakeQdrant } from "./test-helpers/fake-qdrant";

const FIELDS = ["excerpt"];
const COLLECTION = "site_test__testimonials";

function testimonials(texts: string[]): Record<string, unknown>[] {
  return texts.map((t) => ({ locale: "en", excerpt: t }));
}

describe("vectorItemKey", () => {
  it("uses slug, then id, then a content hash", () => {
    expect(vectorItemKey({ slug: "a", id: 2 }, FIELDS)).toBe("a");
    expect(vectorItemKey({ id: 7 }, FIELDS)).toBe("7");
    const k = vectorItemKey({ locale: "en", excerpt: "Great course" }, FIELDS);
    expect(k).toMatch(/^c:[0-9a-f]{40}$/);
    expect(vectorItemKey({ locale: "en", excerpt: "Great course" }, FIELDS)).toBe(k);
  });

  it("includes locale and collapses identical rows", () => {
    const en = vectorItemKey({ locale: "en", excerpt: "Same" }, FIELDS);
    const es = vectorItemKey({ locale: "es", excerpt: "Same" }, FIELDS);
    expect(en).not.toBe(es);
    expect(vectorItemKey({ locale: "en", excerpt: "Same" }, FIELDS)).toBe(en);
  });
});

describe("siteCollectionName", () => {
  it("uses the folder name of a content root", () => {
    expect(siteCollectionName("/srv/app/site_4geeks-com", "testimonials")).toBe("site_4geeks-com__testimonials");
    expect(siteCollectionName("site_4geeks-com", "faqs")).toBe("site_4geeks-com__faqs");
  });
});

describe("syncIndex", () => {
  let qdrant: ReturnType<typeof makeFakeQdrant>;
  let emb: ReturnType<typeof makeFakeEmbedder>;

  beforeEach(() => {
    qdrant = makeFakeQdrant();
    emb = makeFakeEmbedder();
    __setVectorSearchTestDoubles({ client: qdrant, embedder: emb.embedder });
  });

  afterEach(() => {
    __setVectorSearchTestDoubles(null);
  });

  it("creates the collection and embeds everything the first time", async () => {
    const res = await syncIndex(COLLECTION, testimonials(["a", "b", "c"]), FIELDS);
    expect(res).toMatchObject({ embedded: 3, unchanged: 0, deleted: 0, total: 3 });
    expect(qdrant.cols.get(COLLECTION)?.size).toBe(3);
  });

  it("skips unchanged rows", async () => {
    const items = testimonials(["a", "b", "c"]);
    await syncIndex(COLLECTION, items, FIELDS);
    const before = emb.embeddedCount();
    const res = await syncIndex(COLLECTION, items, FIELDS);
    expect(res).toMatchObject({ embedded: 0, unchanged: 3, deleted: 0 });
    expect(emb.embeddedCount()).toBe(before);
  });

  it("replaces exactly one point when a slugless row is edited", async () => {
    await syncIndex(COLLECTION, testimonials(["a", "b", "c"]), FIELDS);
    const res = await syncIndex(COLLECTION, testimonials(["a", "B edited", "c"]), FIELDS);
    expect(res).toMatchObject({ embedded: 1, unchanged: 2, deleted: 1, total: 3 });
    expect(qdrant.cols.get(COLLECTION)?.size).toBe(3);
  });

  it("updates a slugged row in place", async () => {
    await syncIndex(COLLECTION, [{ slug: "x", excerpt: "old" }], FIELDS);
    const res = await syncIndex(COLLECTION, [{ slug: "x", excerpt: "new" }], FIELDS);
    expect(res).toMatchObject({ embedded: 1, deleted: 0 });
  });

  it("deletes removed rows", async () => {
    await syncIndex(COLLECTION, testimonials(["a", "b", "c"]), FIELDS);
    const res = await syncIndex(COLLECTION, testimonials(["a", "c"]), FIELDS);
    expect(res).toMatchObject({ embedded: 0, deleted: 1, total: 2 });
    expect(qdrant.cols.get(COLLECTION)?.size).toBe(2);
  });

  it("embeds only the new row when one is inserted at the top of a slugless list", async () => {
    await syncIndex(COLLECTION, testimonials(["a", "b", "c", "d"]), FIELDS);
    const res = await syncIndex(COLLECTION, testimonials(["new", "a", "b", "c", "d"]), FIELDS);
    expect(res).toMatchObject({ embedded: 1, unchanged: 4, deleted: 0 });
  });

  it("re-embeds everything when the embedded fields change", async () => {
    const items = [
      { locale: "en", excerpt: "a", full_text: "aa" },
      { locale: "en", excerpt: "b", full_text: "bb" },
    ];
    await syncIndex(COLLECTION, items, ["excerpt"]);
    const res = await syncIndex(COLLECTION, items, ["excerpt", "full_text"]);
    expect(res.embedded).toBe(2);
  });

  it("deletes the collection first on rebuild", async () => {
    const items = testimonials(["a", "b"]);
    await syncIndex(COLLECTION, items, FIELDS);
    const res = await syncIndex(COLLECTION, items, FIELDS, { rebuild: true });
    expect(qdrant.deleteCollection).toHaveBeenCalledWith(COLLECTION);
    expect(res).toMatchObject({ embedded: 2, unchanged: 0 });
  });

  it("throws when Qdrant is unreachable", async () => {
    qdrant.collectionExists.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    await expect(syncIndex(COLLECTION, testimonials(["a"]), FIELDS)).rejects.toThrow(/ECONNREFUSED/);
  });

  it("stores key, locale and text_hash in the payload", async () => {
    await syncIndex(COLLECTION, [{ slug: "s1", locale: "es", excerpt: "hola" }], FIELDS);
    const [point] = [...(qdrant.cols.get(COLLECTION)?.values() ?? [])];
    expect(point.payload).toMatchObject({ key: "s1", slug: "s1", locale: "es" });
    expect(point.payload.text_hash).toMatch(/^[0-9a-f]{40}$/);
    expect(point.payload).not.toHaveProperty("_idx");
  });
});

describe("search", () => {
  afterEach(() => {
    __setVectorSearchTestDoubles(null);
  });

  it("reports a missing collection instead of failing silently", async () => {
    const qdrant = makeFakeQdrant();
    __setVectorSearchTestDoubles({ client: qdrant, embedder: makeFakeEmbedder().embedder });
    const res = await search("site_test__nope", "hello", 10);
    expect(res).toEqual({ hits: [], missingCollection: true });
  });

  it("returns hits with their row key", async () => {
    const qdrant = makeFakeQdrant();
    const emb = makeFakeEmbedder();
    __setVectorSearchTestDoubles({ client: qdrant, embedder: emb.embedder });
    await syncIndex(COLLECTION, [{ slug: "s1", excerpt: "hola" }], FIELDS);
    const res = await search(COLLECTION, "hola", 10);
    expect(res.missingCollection).toBe(false);
    expect(res.hits[0]).toMatchObject({ slug: "s1", key: "s1" });
  });
});
