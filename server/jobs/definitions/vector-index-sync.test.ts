import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getJobState } from "../../db-job-state";
import { __setVectorSearchTestDoubles } from "../../vector-search";
import { makeFakeEmbedder, makeFakeQdrant } from "../../test-helpers/fake-qdrant";
import { runVectorIndexSync, VECTOR_INDEX_MAX_PASSES } from "./vector-index-sync";

type Copy = { items: Record<string, unknown>[]; fetched_at: string };

/** Database double: each fetchItems returns the next copy; getLastGoodItems reports `latest()`. */
function fakeDb(copies: Copy[], latest: () => string | undefined) {
  let i = 0;
  return {
    exists: () => true,
    get: () => ({ name: "Testimonials", source: { type: "local" }, vector_search: { enabled: true, fields: ["excerpt"] } }),
    fetchItems: async () => {
      const copy = copies[Math.min(i, copies.length - 1)];
      i++;
      return { ...copy, raw_count: copy.items.length, from_cache: true };
    },
    forgetFetchedItems: () => {},
    getLastGoodItems: () => {
      const fetchedAt = latest();
      return fetchedAt ? { fetchedAt, items: [], stale: false } : null;
    },
  };
}

const rows = (texts: string[]) => texts.map((t) => ({ locale: "en", excerpt: t }));

describe("runVectorIndexSync", () => {
  let contentRoot: string;
  let qdrant: ReturnType<typeof makeFakeQdrant>;

  beforeEach(() => {
    contentRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vector-job-")), "site_test");
    fs.mkdirSync(contentRoot, { recursive: true });
    qdrant = makeFakeQdrant();
    __setVectorSearchTestDoubles({ client: qdrant, embedder: makeFakeEmbedder().embedder });
  });

  afterEach(() => {
    __setVectorSearchTestDoubles(null);
  });

  const payload = (extra: Record<string, unknown> = {}) => ({
    siteId: "site_test",
    contentRoot,
    dbName: "testimonials",
    reason: "manual" as const,
    ...extra,
  });

  it("syncs into the site-scoped collection and marks it ready", async () => {
    const copy = { items: rows(["a", "b"]), fetched_at: "t1" };
    const out = await runVectorIndexSync(payload(), {
      createDb: () => fakeDb([copy], () => "t1") as never,
    });
    expect(out).toMatchObject({ ok: true, passes: 1, embedded: 2 });
    expect(qdrant.cols.get("site_test__testimonials")?.size).toBe(2);
    const state = getJobState("testimonials", contentRoot).index;
    expect(state).toMatchObject({ status: "done", ready: true, collection: "site_test__testimonials", embedded: 2 });
    expect(state.changedAt).toBeTruthy();
  });

  it("runs a second pass when the data changed during the first", async () => {
    const out = await runVectorIndexSync(payload(), {
      createDb: () =>
        fakeDb(
          [
            { items: rows(["a"]), fetched_at: "t1" },
            { items: rows(["a", "edited during run"]), fetched_at: "t2" },
          ],
          () => "t2",
        ) as never,
    });
    expect(out.passes).toBe(2);
    expect(qdrant.cols.get("site_test__testimonials")?.size).toBe(2);
  });

  it("stops after the pass cap even if data keeps changing", async () => {
    let n = 0;
    const out = await runVectorIndexSync(payload(), {
      createDb: () =>
        fakeDb(
          [1, 2, 3, 4, 5].map((k) => ({ items: rows([`v${k}`]), fetched_at: `t${k}` })),
          () => `t${++n + 100}`,
        ) as never,
    });
    expect(out.passes).toBe(VECTOR_INDEX_MAX_PASSES);
  });

  it("deletes the legacy bare-name collection after success", async () => {
    qdrant.cols.set("testimonials", new Map());
    await runVectorIndexSync(payload(), {
      createDb: () => fakeDb([{ items: rows(["a"]), fetched_at: "t1" }], () => "t1") as never,
    });
    expect(qdrant.cols.has("testimonials")).toBe(false);
    expect(qdrant.cols.has("site_test__testimonials")).toBe(true);
  });

  it("does not clear search caches when nothing changed", async () => {
    const db = () => fakeDb([{ items: rows(["a"]), fetched_at: "t1" }], () => "t1") as never;
    await runVectorIndexSync(payload(), { createDb: db });
    const firstChangedAt = getJobState("testimonials", contentRoot).index.changedAt;
    await new Promise((r) => setTimeout(r, 5));
    const out = await runVectorIndexSync(payload(), { createDb: db });
    expect(out.embedded).toBe(0);
    expect(getJobState("testimonials", contentRoot).index.changedAt).toBe(firstChangedAt);
  });

  it("marks retrying, then failed on the last attempt, and rethrows", async () => {
    qdrant.collectionExists.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const db = () => fakeDb([{ items: rows(["a"]), fetched_at: "t1" }], () => "t1") as never;

    await expect(runVectorIndexSync(payload(), { createDb: db, attempt: 1, maxAttempts: 5 })).rejects.toThrow();
    expect(getJobState("testimonials", contentRoot).index).toMatchObject({ status: "queued" });
    expect(getJobState("testimonials", contentRoot).index.error).toMatch(/Attempt 1 of 5/);

    await expect(runVectorIndexSync(payload(), { createDb: db, attempt: 5, maxAttempts: 5 })).rejects.toThrow();
    expect(getJobState("testimonials", contentRoot).index).toMatchObject({ status: "error" });
  });

  it("skips databases without vector search", async () => {
    const db = {
      ...fakeDb([{ items: [], fetched_at: "t1" }], () => "t1"),
      get: () => ({ name: "x", source: { type: "local" } }),
    };
    const out = await runVectorIndexSync(payload(), { createDb: () => db as never });
    expect(out).toEqual({ ok: false, skipped: "not_enabled" });
  });
});
