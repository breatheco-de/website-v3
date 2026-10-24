/**
 * Web-process check that every vector-enabled database has a complete,
 * site-scoped Qdrant collection. Only enqueues; the Sidequest worker embeds.
 */
import type { DatabaseManager } from "./database";
import { getJobState } from "./db-job-state";
import { child } from "./logger";
import type { VectorIndexReason } from "./vector-index-queue";

const log = child({ module: "vector-index-reconcile" });

const QDRANT_RETRY_MS = 60_000;

export type ReconcileSite = {
  contentRoot: string;
  database: Pick<DatabaseManager, "list" | "queueVectorIndex">;
};

export type ReconcileResult = {
  qdrantAvailable: boolean;
  queued: string[];
};

export async function reconcileVectorIndexes(
  sites: ReconcileSite[],
  reason: VectorIndexReason,
): Promise<ReconcileResult> {
  const vector = await import("./vector-search");
  if (!(await vector.isAvailable())) return { qdrantAvailable: false, queued: [] };

  const queued: string[] = [];
  for (const site of sites) {
    for (const { name, config } of site.database.list()) {
      const vs = config.vector_search;
      if (!vs?.enabled || !Array.isArray(vs.fields) || vs.fields.length === 0) continue;
      const collection = vector.siteCollectionName(site.contentRoot, name);
      const state = getJobState(name, site.contentRoot).index;
      let points: number | null;
      try {
        points = await vector.getCollectionPointCount(collection);
      } catch (err) {
        log.warn({ err, collection }, "[vector-index] Reconcile could not read collection");
        return { qdrantAvailable: false, queued };
      }
      const stale =
        points === null ||
        !state.ready ||
        state.collection !== collection ||
        (typeof state.total === "number" && points !== state.total);
      if (!stale) continue;
      const res = await site.database.queueVectorIndex(name, reason);
      if (res.queued) queued.push(collection);
    }
  }
  if (queued.length > 0) log.info({ reason, queued }, "[vector-index] Reconcile queued syncs");
  return { qdrantAvailable: true, queued };
}

let started = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Run once after warmup. When Qdrant is not reachable yet (pm2 starts it with
 * web), retry every minute until it is. Also re-run when Qdrant recovers.
 */
export function startVectorIndexReconcile(getSites: () => ReconcileSite[]): void {
  if (started) return;
  started = true;

  const attempt = (reason: VectorIndexReason) => {
    reconcileVectorIndexes(getSites(), reason)
      .then((res) => {
        if (res.qdrantAvailable) return;
        if (retryTimer) return;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          attempt("startup_reconcile");
        }, QDRANT_RETRY_MS);
        retryTimer.unref?.();
      })
      .catch((err) => log.warn({ err }, "[vector-index] Reconcile failed"));
  };

  void import("./vector-search")
    .then(({ onQdrantRecovered }) => onQdrantRecovered(() => attempt("qdrant_recovered")))
    .catch((err) => log.warn({ err }, "[vector-index] Could not subscribe to Qdrant recovery"));
  attempt("startup_reconcile");
}
