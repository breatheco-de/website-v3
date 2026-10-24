import * as fs from "fs";
import * as path from "path";
import { child } from "./logger";
import { getDefaultContentRoot } from "./site-config";
const log = child({ module: "db-job-state" });

function getStatePath(contentRoot?: string): string {
  const root = contentRoot ?? getDefaultContentRoot();
  return path.join(root, ".db-job-state.json");
}

/** `waiting_worker` is derived for display (queued while the Sidequest worker is down); never persisted. */
export type JobStatus = "idle" | "queued" | "waiting_worker" | "running" | "done" | "error";

export interface JobState {
  status: JobStatus;
  fetched?: number;
  total?: number | null;
  page?: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  queuedAt?: string;
  /** Vector index: rows embedded / left as-is / removed in the last run. */
  embedded?: number;
  unchanged?: number;
  deleted?: number;
  /** Vector index: the site-scoped collection is fully built and may be searched. */
  ready?: boolean;
  collection?: string;
  /** Vector index: last time a run changed the collection (search caches older than this are stale). */
  changedAt?: string;
}

export interface DbJobState {
  fetch: JobState;
  index: JobState;
}

type AllState = Record<string, DbJobState>;

const DEFAULT_JOB_STATE: JobState = { status: "idle" };

/**
 * The web process and the Sidequest worker both write this file, so every read
 * re-checks the file's mtime/size and every write merges into the latest copy.
 */
const stateCache = new Map<string, { mtimeMs: number; size: number; state: AllState }>();

function statFile(filePath: string): { mtimeMs: number; size: number } | null {
  try {
    const st = fs.statSync(filePath);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

function load(contentRoot?: string): AllState {
  const filePath = getStatePath(contentRoot);
  const st = statFile(filePath);
  const hit = stateCache.get(filePath);
  if (!st) {
    if (hit && hit.mtimeMs === -1) return hit.state;
    const empty: AllState = {};
    stateCache.set(filePath, { mtimeMs: -1, size: 0, state: empty });
    return empty;
  }
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.state;
  let state: AllState;
  try {
    state = JSON.parse(fs.readFileSync(filePath, "utf8")) as AllState;
  } catch {
    state = hit?.state ?? {};
  }
  stateCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, state });
  return state;
}

function persist(contentRoot: string | undefined, state: AllState): void {
  const filePath = getStatePath(contentRoot);
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, filePath);
    const st = statFile(filePath);
    if (st) stateCache.set(filePath, { ...st, state });
  } catch (err) {
    log.error({ err: err }, "[DbJobState] Failed to persist:");
    try {
      fs.unlinkSync(tmp);
    } catch {
      // tmp never written
    }
  }
}

export function getJobState(dbName: string, contentRoot?: string): DbJobState {
  const state = load(contentRoot);
  return state[dbName] ?? { fetch: DEFAULT_JOB_STATE, index: DEFAULT_JOB_STATE };
}

export function getAllJobStates(contentRoot?: string): Record<string, DbJobState> {
  return load(contentRoot);
}

export function setJobState(
  dbName: string,
  jobType: "fetch" | "index",
  patch: Partial<JobState>,
  contentRoot?: string,
): void {
  const state = { ...load(contentRoot) };
  const current = state[dbName] ?? { fetch: { status: "idle" as const }, index: { status: "idle" as const } };
  state[dbName] = { ...current, [jobType]: { ...current[jobType], ...patch } };
  persist(contentRoot, state);
}

/** Display status: a queued job with no live worker shows as waiting_worker. */
export function displayIndexStatus(index: JobState, workerRunning: boolean): JobStatus {
  if (index.status === "queued" && !workerRunning) return "waiting_worker";
  return index.status;
}
