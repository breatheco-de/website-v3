/**
 * Enqueue a vector index sync on the Sidequest `vector_index` queue.
 * Never embeds in the calling process; the worker runs VectorIndexSyncJob.
 */
import path from "path";
import { getJobState, setJobState } from "./db-job-state";
import { child } from "./logger";

const log = child({ module: "vector-index-queue" });

export const VECTOR_INDEX_JOB = "vector_index_sync";
export const VECTOR_INDEX_QUEUE = "vector_index";
export const VECTOR_INDEX_MAX_ATTEMPTS = 5;
/** Exponential base: retries wait about 2, 4, 8, 16 minutes. */
export const VECTOR_INDEX_RETRY_DELAY_MS = 120_000;
const RECENT_ENQUEUE_MS = 60_000;

export type VectorIndexReason =
  | "fetch"
  | "config_changed"
  | "manual"
  | "rebuild"
  | "missing_collection"
  | "startup_reconcile"
  | "qdrant_recovered";

export type VectorIndexSyncPayload = {
  siteId: string;
  contentRoot: string;
  dbName: string;
  reason: VectorIndexReason;
  rebuild?: boolean;
};

export type EnqueueVectorIndexResult = {
  queued: boolean;
  deduped?: boolean;
  /** Skipped because this process enqueued the same database within the last minute. */
  throttled?: boolean;
};

const recentlyEnqueued = new Map<string, number>();
let allowInTests = false;

/** Test helper. */
export function clearVectorIndexEnqueueThrottleForTests(): void {
  recentlyEnqueued.clear();
}

/** Test helper: let vitest exercise the enqueue path (normally a no-op under vitest). */
export function allowVectorIndexEnqueueForTests(allow: boolean): void {
  allowInTests = allow;
}

/** Only the web process and the Sidequest worker enqueue; MCP, builds, scripts and vitest no-op. */
function canEnqueueFromThisProcess(): boolean {
  if (process.env.VITEST) return allowInTests;
  const proc = process.env.WEBLIFY_PROCESS;
  return proc === "web" || proc === "sidequest";
}

export async function enqueueVectorIndexSync(
  contentRoot: string,
  dbName: string,
  reason: VectorIndexReason,
  opts: { rebuild?: boolean } = {},
): Promise<EnqueueVectorIndexResult> {
  if (!canEnqueueFromThisProcess()) return { queued: false };
  const siteId = path.basename(contentRoot);
  const key = `${siteId}:${dbName}${opts.rebuild ? ":rebuild" : ""}`;
  const explicit = reason === "manual" || reason === "rebuild";
  const now = Date.now();
  const last = recentlyEnqueued.get(key);
  if (!explicit && last !== undefined && now - last < RECENT_ENQUEUE_MS) {
    return { queued: false, throttled: true };
  }
  recentlyEnqueued.set(key, now);

  try {
    const { enqueueJob } = await import("./jobs/queue");
    const payload: VectorIndexSyncPayload = {
      siteId,
      contentRoot,
      dbName,
      reason,
      ...(opts.rebuild ? { rebuild: true } : {}),
    };
    const result = await enqueueJob(VECTOR_INDEX_JOB, payload, {
      queue: VECTOR_INDEX_QUEUE,
      uniqueKey: `vector:${key}`,
      uniqueWhileAlive: true,
      maxAttempts: VECTOR_INDEX_MAX_ATTEMPTS,
      retryDelayMs: VECTOR_INDEX_RETRY_DELAY_MS,
    });
    if (result.queued && getJobState(dbName, contentRoot).index.status !== "running") {
      setJobState(
        dbName,
        "index",
        { status: "queued", queuedAt: new Date().toISOString(), error: undefined },
        contentRoot,
      );
    }
    if (result.queued) log.info({ siteId, dbName, reason, rebuild: !!opts.rebuild }, "[vector-index] Sync queued");
    return result;
  } catch (err) {
    recentlyEnqueued.delete(key);
    log.warn({ err, siteId, dbName, reason }, "[vector-index] Enqueue failed");
    return { queued: false };
  }
}
