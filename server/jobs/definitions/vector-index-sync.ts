import { Job } from "sidequest";
import path from "path";
import { DatabaseManager } from "../../database";
import { setJobState } from "../../db-job-state";
import { child } from "../../logger";
import { markJobFinished, markJobStarted } from "../heartbeat";
import type { VectorIndexSyncPayload } from "../../vector-index-queue";

const log = child({ module: "job:vector-index-sync" });

/** Passes per run: the first plus re-checks when the data changed mid-run. */
export const VECTOR_INDEX_MAX_PASSES = 3;

export type VectorIndexSyncOutcome = {
  ok: boolean;
  skipped?: "invalid_payload" | "not_enabled";
  passes?: number;
  embedded?: number;
  unchanged?: number;
  deleted?: number;
};

export type VectorIndexSyncDeps = {
  createDb?: (contentRoot: string) => Pick<DatabaseManager, "exists" | "get" | "fetchItems" | "forgetFetchedItems" | "getLastGoodItems">;
  attempt?: number;
  maxAttempts?: number;
};

/** Runs one sync (with re-check passes). Throws on failure so Sidequest retries. */
export async function runVectorIndexSync(
  payload: VectorIndexSyncPayload,
  deps: VectorIndexSyncDeps = {},
): Promise<VectorIndexSyncOutcome> {
  if (!payload?.dbName || !payload.contentRoot) return { ok: false, skipped: "invalid_payload" };
  const { contentRoot, dbName } = payload;
  const db = deps.createDb ? deps.createDb(contentRoot) : new DatabaseManager(contentRoot);
  if (!db.exists(dbName)) return { ok: false, skipped: "not_enabled" };
  const vs = db.get(dbName).vector_search;
  const fields = vs?.enabled && Array.isArray(vs.fields) ? vs.fields : [];
  if (fields.length === 0) return { ok: false, skipped: "not_enabled" };

  const vector = await import("../../vector-search");
  const collection = vector.siteCollectionName(contentRoot, dbName);
  const startedAt = new Date().toISOString();
  setJobState(
    dbName,
    "index",
    {
      status: "running",
      startedAt,
      collection,
      fetched: 0,
      total: null,
      error: undefined,
      ...(payload.rebuild ? { ready: false } : {}),
    },
    contentRoot,
  );

  const totals = { embedded: 0, unchanged: 0, deleted: 0, total: 0 };
  let passes = 0;
  try {
    for (let pass = 1; pass <= VECTOR_INDEX_MAX_PASSES; pass++) {
      passes = pass;
      db.forgetFetchedItems(dbName);
      const data = await db.fetchItems(dbName, false, { skipVectorIndex: true });
      const result = await vector.syncIndex(collection, data.items, fields, {
        rebuild: payload.rebuild === true && pass === 1,
        onProgress: (done, toEmbed) => {
          setJobState(dbName, "index", { status: "running", fetched: done, total: toEmbed }, contentRoot);
        },
      });
      totals.embedded += result.embedded;
      totals.deleted += result.deleted;
      totals.unchanged = result.unchanged;
      totals.total = result.total;

      const latest = db.getLastGoodItems(dbName)?.fetchedAt;
      if (!latest || latest === data.fetched_at) break;
      log.info({ dbName, pass }, "[vector-index] Data changed during sync — running another pass");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempt = deps.attempt ?? 1;
    const maxAttempts = deps.maxAttempts ?? 1;
    const final = attempt >= maxAttempts;
    setJobState(
      dbName,
      "index",
      final
        ? { status: "error", error: `Qdrant unreachable or sync failed: ${message}`, finishedAt: new Date().toISOString() }
        : { status: "queued", error: `Attempt ${attempt} of ${maxAttempts} failed (${message}); retrying` },
      contentRoot,
    );
    throw err;
  }

  const finishedAt = new Date().toISOString();
  const changed = totals.embedded + totals.deleted > 0;
  setJobState(
    dbName,
    "index",
    {
      status: "done",
      ready: true,
      collection,
      finishedAt,
      fetched: totals.total,
      total: totals.total,
      embedded: totals.embedded,
      unchanged: totals.unchanged,
      deleted: totals.deleted,
      error: undefined,
      ...(changed ? { changedAt: finishedAt } : {}),
    },
    contentRoot,
  );

  if (changed) {
    try {
      const { invalidateDatabaseSearchCache } = await import("../../database-search");
      await invalidateDatabaseSearchCache(dbName, path.basename(contentRoot));
    } catch (err) {
      log.warn({ err, dbName }, "[vector-index] Search cache invalidate failed");
    }
  }

  const legacy = vector.legacyCollectionName(dbName);
  if (legacy !== collection) await vector.deleteCollection(legacy);

  log.info({ dbName, collection, passes, ...totals }, "[vector-index] Sync done");
  return { ok: true, passes, embedded: totals.embedded, unchanged: totals.unchanged, deleted: totals.deleted };
}

export class VectorIndexSyncJob extends Job {
  async run(payload: VectorIndexSyncPayload): Promise<VectorIndexSyncOutcome> {
    markJobStarted("vector_index_sync");
    try {
      return await runVectorIndexSync(payload, {
        attempt: this.attempt,
        maxAttempts: this.max_attempts,
      });
    } finally {
      markJobFinished("vector_index_sync");
    }
  }
}
