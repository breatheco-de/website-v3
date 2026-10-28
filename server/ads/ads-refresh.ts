/**
 * One background refresh for Ads data: Meta insights (when connected), Google Ads
 * from the BigQuery Data Transfer (when connected), then GA4 paid-landing days
 * (when BigQuery is configured). Stale reads (> ~24h) enqueue it and return cached
 * data immediately with a `refresh` status.
 *
 * Status (`getAdsRefreshStatus`) combines this site's refresh-state file, the
 * newest AdsSyncJob / legacy MetaAdsSyncJob row in the Sidequest DB, and worker
 * liveness, so a job that never runs surfaces as `failed` / `worker_down` instead of spinning.
 */

import fs from "fs";
import path from "path";
import { CACHE_DIR } from "../db-cache";
import { getAdsSettings } from "../settings";
import { ADS_CONFIG_FILENAME, adsConfigReadError } from "../ads-config";
import { child } from "../logger";
import { isMetaTokenConfigured } from "./meta-client";
import {
  isMetaStale,
  isMetaSyncInFlight,
  listMetaDayDates,
  loadMetaState,
  META_STALE_MS,
  planMetaSyncSteps,
  saveMetaState,
  syncMetaAds,
  type MetaSyncMode,
  type MetaSyncResult,
} from "./meta-ads-days";
import {
  isGa4Configured,
  listPaidLandingDates,
  loadPaidLandingState,
  planPaidLandingSteps,
  syncPaidLandingDays,
  type PaidLandingSyncResult,
} from "./paid-detection";
import {
  isGoogleConnected,
  isGoogleStale,
  isGoogleSyncInFlight,
  loadGoogleState,
  planGoogleSyncSteps,
  syncGoogleAds,
  type GoogleSyncResult,
} from "./google-ads-days";
import { currentWorkerJob, isSidequestWorkerAlive, latestJobRows, type JobRowSummary } from "../jobs/job-rows";
import { afterAdsSync } from "./ads-rollups";
import { backupAdsHistory } from "./ads-history-backup";
import { waitForAdsRunToFinish } from "./diagnostics/run-lock";
import {
  ADS_REFRESH_QUEUED_STUCK_MS,
  adsRefreshBackoffMs,
  isRefreshActive,
  type AdsRefreshProgress,
  type AdsRefreshState,
  type AdsRefreshStatus,
} from "@shared/ads-refresh-status";

const log = child({ module: "ads/ads-refresh" });

/** A started run with no finish after this long is treated as crashed (unless the worker reports it is still on it). */
const REFRESH_WINDOW_MS = 15 * 60 * 1000;
const JOB_CLASSES = ["AdsSyncJob", "MetaAdsSyncJob"];
const JOB_TYPE = "ads_sync";
/** Worker heartbeat job names that mean "the Ads refresh is running" (legacy alias included). */
const JOB_TYPES = new Set([JOB_TYPE, "meta_ads_sync"]);

type RefreshState = {
  requested_at?: string;
  started_at?: string;
  finished_at?: string;
  failure_count?: number;
  last_failure_at?: string;
  last_error?: string;
  /** Which request/run the last failure was recorded for — keeps recording idempotent across reads. */
  failure_key?: string;
  /** Written by the run itself (often in the worker process); `run` = that run's `started_at`. */
  progress?: AdsRefreshProgress & { run: string };
};

function statePath(site: string): string {
  return path.join(CACHE_DIR, site, "ads-refresh-state.json");
}

function loadState(site: string): RefreshState {
  try {
    const f = statePath(site);
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf-8")) as RefreshState) : {};
  } catch {
    return {};
  }
}

function patchState(site: string, patch: RefreshState): RefreshState {
  const next = { ...loadState(site), ...patch };
  fs.mkdirSync(path.dirname(statePath(site)), { recursive: true });
  fs.writeFileSync(statePath(site), JSON.stringify(next), "utf-8");
  return next;
}

function ms(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

const inFlight = new Set<string>();

export function isMetaConnected(contentRoot?: string): boolean {
  const meta = getAdsSettings(contentRoot).meta;
  return meta.enabled && meta.ad_account_ids.length > 0 && isMetaTokenConfigured();
}

/** Local cache was replaced by "Download from production" (dev only). */
export function isProductionSnapshot(site: string): boolean {
  return !!loadMetaState(site).pulled_from_production_at;
}

/**
 * Reports and diagnostics may read Meta rows: connected, or a production download with day files.
 * Anything that starts a sync must keep using `isMetaConnected`.
 */
export function hasMetaData(site: string, contentRoot?: string): boolean {
  const meta = getAdsSettings(contentRoot).meta;
  if (!meta.enabled || meta.ad_account_ids.length === 0) return false;
  if (isMetaTokenConfigured()) return true;
  return isProductionSnapshot(site) && listMetaDayDates(site).length > 0;
}

/** Reports may read GA4 paid-landing days: BigQuery configured, or a production download with day files. */
export function hasGa4Data(site: string, contentRoot?: string): boolean {
  if (isGa4Configured(contentRoot)) return true;
  return isProductionSnapshot(site) && listPaidLandingDates(site).length > 0;
}

export type RefreshStatusDeps = {
  now?: number;
  workerAlive?: () => boolean;
  /** Job type the worker is currently running, if any. */
  workerCurrentJob?: () => string | undefined;
  /** Newest MetaAdsSyncJob row for `site` inserted at/after `sinceMs`. */
  latestJob?: (site: string, sinceMs: number) => JobRowSummary | null;
};

function jobSite(args: unknown): string | undefined {
  const first = Array.isArray(args) ? args[0] : args;
  const site = (first as { site?: unknown } | null)?.site;
  return typeof site === "string" ? site : undefined;
}

function defaultLatestJob(site: string, sinceMs: number): JobRowSummary | null {
  const rows = JOB_CLASSES.flatMap((cls) => latestJobRows(cls, sinceMs).filter((r) => jobSite(r.args) === site));
  return rows.sort((a, b) => (b.inserted_at ?? 0) - (a.inserted_at ?? 0))[0] ?? null;
}

function retryAfterMs(s: RefreshState): number {
  if (!s.failure_count || !s.last_failure_at) return 0;
  return ms(s.last_failure_at) + adsRefreshBackoffMs(s.failure_count);
}

function recordFailure(site: string, s: RefreshState, error: string, key: string, now: number): RefreshState {
  if (s.failure_key === key) return s;
  const failure_count = (s.failure_count ?? 0) + 1;
  log.warn({ site, error, failure_count }, "[ads-refresh] refresh did not complete");
  return patchState(site, { failure_count, last_failure_at: new Date(now).toISOString(), last_error: error, failure_key: key });
}

/** Progress of the run that is in the state file now; leftovers from a crashed run never match. */
function currentProgress(s: RefreshState): AdsRefreshProgress | null {
  const p = s.progress;
  if (!p || !s.started_at || p.run !== s.started_at || !(p.total > 0)) return null;
  return { done: Math.min(p.done, p.total), total: p.total, label: p.label };
}

/** Current refresh status for a site. May persist a newly observed failure (idempotent). */
export function getAdsRefreshStatus(site: string, deps: RefreshStatusDeps = {}): AdsRefreshStatus {
  const now = deps.now ?? Date.now();
  const workerAlive = deps.workerAlive ?? isSidequestWorkerAlive;
  let s = loadState(site);

  const build = (state: AdsRefreshState): AdsRefreshStatus => {
    const retryAt = retryAfterMs(s);
    const waiting = retryAt > now;
    return {
      state,
      requested_at: s.requested_at ?? null,
      started_at: s.started_at ?? null,
      finished_at: s.finished_at ?? null,
      error: state === "failed" || (state === "idle" && waiting) ? (s.last_error ?? null) : null,
      retry_after: waiting ? new Date(retryAt).toISOString() : null,
      progress: state === "running" ? currentProgress(s) : null,
    };
  };

  if (inFlight.has(site) || isMetaSyncInFlight(site) || isGoogleSyncInFlight(site)) return build("running");

  const req = ms(s.requested_at);
  const started = ms(s.started_at);
  const finished = ms(s.finished_at);

  if (started && started > finished && started >= req) {
    if (now - started <= REFRESH_WINDOW_MS) return build("running");
    const workerJob = (deps.workerCurrentJob ?? currentWorkerJob)();
    if (workerJob && JOB_TYPES.has(workerJob)) return build("running");
    s = recordFailure(site, s, "The last sync stopped before finishing.", `started:${s.started_at}`, now);
    return build("failed");
  }

  if (req && req > Math.max(started, finished)) {
    const key = `requested:${s.requested_at}`;
    if (s.failure_key === key) return build("failed");
    const job = (deps.latestJob ?? defaultLatestJob)(site, req - 1000);
    if (job && (job.state === "failed" || job.state === "canceled")) {
      s = recordFailure(site, s, job.error ?? "The background job failed.", key, now);
      return build("failed");
    }
    if (job?.state === "completed") return build("idle");
    if (!workerAlive()) return build("worker_down");
    if (now - req > ADS_REFRESH_QUEUED_STUCK_MS) {
      s = recordFailure(site, s, "The background worker never picked this up.", key, now);
      return build("failed");
    }
    return build("queued");
  }

  return build("idle");
}

/** When the last refresh run started (any trigger: daily, Sync now, stale read). */
export function lastAdsRefreshStartedAt(site: string): string | undefined {
  return loadState(site).started_at;
}

/** True while a refresh is queued or running. */
export function isAdsRefreshing(site: string, deps?: RefreshStatusDeps): boolean {
  return isRefreshActive(getAdsRefreshStatus(site, deps));
}

export function isAdsDataStale(site: string, contentRoot?: string, now = Date.now()): boolean {
  if (isMetaConnected(contentRoot) && isMetaStale(loadMetaState(site), now)) return true;
  if (isGoogleConnected(contentRoot) && isGoogleStale(loadGoogleState(site), now)) return true;
  if (isGa4Configured(contentRoot)) {
    const last = loadPaidLandingState(site).last_success_at;
    const t = last ? Date.parse(last) : NaN;
    if (!Number.isFinite(t) || now - t > META_STALE_MS) return true;
  }
  return false;
}

export type AdsRefreshResult = { meta: MetaSyncResult | null; google?: GoogleSyncResult | null; ga4: PaidLandingSyncResult | null };

/**
 * Each call marks the previous step finished and names the one starting, so `done`
 * counts finished steps. With no planned steps it writes nothing (spinner fallback).
 */
function progressReporter(site: string, run: string, total: number): ((label: string) => void) | undefined {
  if (total <= 0) return undefined;
  let started = 0;
  patchState(site, { progress: { done: 0, total, label: "Starting sync", run } });
  return (label) => {
    const done = Math.min(started, total);
    started++;
    try {
      patchState(site, { progress: { done, total, label, run } });
    } catch (err) {
      log.warn({ err, site }, "[ads-refresh] could not save progress");
    }
  };
}

/** Push `ads-history/` to the content repo (production only) and note the outcome in the Meta state. */
async function recordHistoryBackup(site: string, contentRoot: string | undefined): Promise<void> {
  const res = await backupAdsHistory(site, contentRoot);
  if (res.skipped && res.skipped !== "no_changes") return;
  const state = loadMetaState(site);
  if (res.pushed || res.skipped === "no_changes") {
    if (res.pushed) state.backup_pushed_at = new Date().toISOString();
    state.backup_error = undefined;
  } else {
    state.backup_error = res.error ?? "push failed";
    log.warn({ site, error: res.error }, "[ads-refresh] history backup push failed (sync still saved)");
  }
  saveMetaState(site, state);
}

export async function runAdsRefresh(opts: { site: string; contentRoot?: string; mode?: MetaSyncMode }): Promise<AdsRefreshResult> {
  if (inFlight.has(opts.site)) return { meta: null, google: null, ga4: null };
  inFlight.add(opts.site);
  // Sync and an Ads diagnostics Run never write at the same time: wait for the Run to finish.
  await waitForAdsRunToFinish(opts.site);
  const startedAt = new Date().toISOString();
  patchState(opts.site, { started_at: startedAt, progress: undefined });
  let failure: string | null = null;
  try {
    const configError = adsConfigReadError(opts.contentRoot);
    if (configError) {
      failure = `${ADS_CONFIG_FILENAME} can't be read (${configError}). Syncs are paused until the file is fixed.`;
      return { meta: null, google: null, ga4: null };
    }
    const metaConnected = isMetaConnected(opts.contentRoot);
    const runGa4 = opts.mode !== "older";
    const runGoogle = opts.mode !== "older" && isGoogleConnected(opts.contentRoot);
    const total =
      (metaConnected ? planMetaSyncSteps(opts.site, opts.contentRoot, opts.mode) : 0) +
      (runGoogle ? planGoogleSyncSteps(opts.contentRoot) : 0) +
      (runGa4 ? planPaidLandingSteps(opts.site, opts.contentRoot) : 0);
    const onStep = progressReporter(opts.site, startedAt, total);

    const meta = metaConnected
      ? await syncMetaAds({ site: opts.site, contentRoot: opts.contentRoot, mode: opts.mode, onStep })
      : null;
    const google = runGoogle ? await syncGoogleAds({ site: opts.site, contentRoot: opts.contentRoot, onStep }) : null;
    const ga4 = runGa4 ? await syncPaidLandingDays(opts.site, opts.contentRoot, undefined, onStep) : null;
    const dirty = [...(meta?.ok ? meta.dates : []), ...(google?.dates ?? []), ...(ga4?.fetched ?? [])];
    try {
      onStep?.("Saving daily numbers");
      await afterAdsSync(opts.site, dirty, { contentRoot: opts.contentRoot });
    } catch (err) {
      log.warn({ err, site: opts.site }, "[ads-refresh] rollups / report windows failed (day files still saved)");
    }
    if (meta?.ok || google?.ok) await recordHistoryBackup(opts.site, opts.contentRoot);
    if (meta && !meta.ok && !meta.skipped && meta.error) failure = `Meta: ${meta.error}`;
    else if (google && !google.ok && !google.skipped && google.error) failure = `Google Ads: ${google.error}`;
    else if (ga4 && !ga4.ok && !ga4.skipped && ga4.error) failure = `GA4: ${ga4.error}`;
    return { meta, google, ga4 };
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const finishedAt = new Date().toISOString();
    if (failure) {
      const s = loadState(opts.site);
      patchState(opts.site, {
        finished_at: finishedAt,
        progress: undefined,
        failure_count: (s.failure_count ?? 0) + 1,
        last_failure_at: finishedAt,
        last_error: failure,
        failure_key: `started:${startedAt}`,
      });
    } else {
      patchState(opts.site, {
        finished_at: finishedAt,
        progress: undefined,
        failure_count: 0,
        last_failure_at: undefined,
        last_error: undefined,
        failure_key: undefined,
      });
    }
    inFlight.delete(opts.site);
  }
}

function runInProcess(site: string, contentRoot: string | undefined, mode: MetaSyncMode): void {
  void runAdsRefresh({ site, contentRoot, mode }).catch((err) => log.warn({ err, site }, "[ads-refresh] in-process refresh failed"));
}

export type RequestAdsRefreshOpts = {
  /** Staff clicked Sync now / Try again (or saved new accounts): skip the retry wait, and run here if the worker is down. */
  manual?: boolean;
  deps?: RefreshStatusDeps;
  /** Tests only: replace the Sidequest enqueue. */
  enqueue?: (payload: { site: string; contentRoot?: string; mode: MetaSyncMode }) => Promise<{ queued: boolean; deduped?: boolean }>;
  /** Tests only: replace the in-process fallback. */
  runLocal?: (site: string, contentRoot: string | undefined, mode: MetaSyncMode) => void;
};

async function defaultEnqueue(payload: { site: string; contentRoot?: string; mode: MetaSyncMode }) {
  const { enqueueJob } = await import("../jobs/queue");
  return enqueueJob(JOB_TYPE, payload, {
    uniqueKey: `${JOB_TYPE}:${payload.site}:${payload.mode}`,
    uniqueWithArgs: true,
    uniqueWhileAlive: true,
  });
}

/**
 * Request a refresh. Automatic callers respect the retry wait and never run in the
 * web process; `manual` skips the wait and falls back to running here when the worker is down.
 */
export async function requestAdsRefresh(
  site: string,
  contentRoot: string | undefined,
  mode: MetaSyncMode = "refresh",
  opts: RequestAdsRefreshOpts = {},
): Promise<AdsRefreshStatus> {
  const deps = opts.deps ?? {};
  const now = deps.now ?? Date.now();
  const current = getAdsRefreshStatus(site, deps);
  if (isRefreshActive(current)) return current;
  if (!opts.manual) {
    if (current.state === "worker_down") return current;
    if (current.retry_after && Date.parse(current.retry_after) > now) return current;
  }

  patchState(site, { requested_at: new Date(now).toISOString() });
  const runLocal = opts.runLocal ?? runInProcess;
  const workerAlive = (deps.workerAlive ?? isSidequestWorkerAlive)();
  if (opts.manual && !workerAlive) {
    runLocal(site, contentRoot, mode);
    return getAdsRefreshStatus(site, deps);
  }

  try {
    const res = await (opts.enqueue ?? defaultEnqueue)({ site, contentRoot, mode });
    if (res.queued || res.deduped) return getAdsRefreshStatus(site, deps);
  } catch (err) {
    log.warn({ err, site }, "[ads-refresh] enqueue failed");
  }
  if (opts.manual) {
    runLocal(site, contentRoot, mode);
  } else {
    const s = loadState(site);
    recordFailure(site, s, "Could not queue the background job.", `requested:${s.requested_at}`, now);
  }
  return getAdsRefreshStatus(site, deps);
}

/** Enqueue when stale and not waiting after a failure; returns true when a refresh is queued or running. */
export async function triggerAdsRefreshIfStale(site: string, contentRoot?: string, deps: RefreshStatusDeps = {}): Promise<boolean> {
  const status = getAdsRefreshStatus(site, deps);
  if (isRefreshActive(status)) return true;
  if (status.state === "worker_down") return false;
  if (status.retry_after && Date.parse(status.retry_after) > (deps.now ?? Date.now())) return false;
  if (!isAdsDataStale(site, contentRoot, deps.now)) return false;
  return isRefreshActive(await requestAdsRefresh(site, contentRoot, "refresh", { deps }));
}
