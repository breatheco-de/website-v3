/**
 * Ads diagnostics fork lane: full Runs and big-scope Re-checks run in a forked worker
 * (scripts/ads-diagnostics-worker.ts), never in the web event loop.
 *
 * - One Ads fork job per site (own lane — not the site-diagnostics lock).
 * - Busy rules: fork busy or Ads Sync active → reject (409 "busy"), nothing queued.
 * - The run lock (`ads-diagnostics/run.lock`) tells Sync and `ads_recheck` (Sidequest process)
 *   to wait until the Run finishes.
 * - The worker writes a result file; this process saves it (single cache writer).
 */

import { fork, type ChildProcess } from "child_process";
import path from "path";
import type { AdsCheckPlatform, AdsDiagnosticsJobRecord, AdsRecheckScope } from "@shared/ads-issues";
import { isRefreshActive } from "@shared/ads-refresh-status";
import { getPackageRoot, getProjectRoot } from "@shared/paths";
import { getAdsRefreshStatus } from "../ads-refresh";
import { child } from "../../logger";
import { getAdsCodeDefinition } from "./codes";
import type { PendingForVerify } from "./engine";
import { failInterruptedAdsJobs, newAdsJobId, readAdsJobRecord, updateAdsJobRecord, writeAdsJobRecord } from "./jobs";
import { clearAdsRunLock, isAdsRunActive, readAdsRunLock, writeAdsRunLock } from "./run-lock";
import { adsValidationCache, processPendingAdsResults } from "./save";

const log = child({ module: "ads/diagnostics/fork" });

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export type AdsWorkerStartMessage = {
  type: "start";
  job_id: string;
  site: string;
  contentRoot?: string;
  kind: AdsDiagnosticsJobRecord["kind"];
  mode: "full" | "scope";
  platforms: AdsCheckPlatform[];
  pending: PendingForVerify[];
  scopes?: AdsRecheckScope[];
  refreshMeta?: { ad_ids: string[]; issue_ids: string[] };
  requested_by?: string | null;
};

export type AdsWorkerOutboundMessage =
  | { type: "progress"; job_id: string; message: string }
  | { type: "completed"; job_id: string; results_path: string }
  | { type: "failed"; job_id: string; error: string };

export type StartAdsForkResult =
  | { ok: true; job: AdsDiagnosticsJobRecord }
  | { ok: false; code: "ads_run_busy" | "ads_sync_active"; message: string; active_job_id?: string | null };

const running = new Map<string, { jobId: string; proc: ChildProcess; idle: ReturnType<typeof setTimeout> }>();

/** Pending (marked fixed) fresh_days issues for post-fix judging. */
export function pendingForVerify(site: string): PendingForVerify[] {
  const cache = adsValidationCache(site);
  if (!cache) return [];
  const out: PendingForVerify[] = [];
  for (const issue of cache.getAdsIssues()) {
    const completion = cache.getCompletion(issue.id);
    if (!completion?.verify) continue;
    if (getAdsCodeDefinition(issue.validator, issue.code)?.verify.kind !== "fresh_days") continue;
    out.push({ issue, completion });
  }
  return out;
}

export function isAdsForkBusy(site: string): boolean {
  return running.has(site) || isAdsRunActive(site);
}

export function adsBusyReason(site: string): StartAdsForkResult | null {
  if (isAdsForkBusy(site)) {
    return {
      ok: false,
      code: "ads_run_busy",
      message: "An Ads Run is already in progress. Wait for it to finish, then try again.",
      active_job_id: running.get(site)?.jobId ?? readAdsRunLock(site)?.job_id ?? null,
    };
  }
  if (isRefreshActive(getAdsRefreshStatus(site))) {
    return { ok: false, code: "ads_sync_active", message: "Ads Sync is running. Run checks after it finishes so they use the new numbers." };
  }
  return null;
}

export function startAdsForkJob(input: {
  site: string;
  contentRoot?: string;
  kind: AdsDiagnosticsJobRecord["kind"];
  mode: "full" | "scope";
  platforms: AdsCheckPlatform[];
  scopes?: AdsRecheckScope[];
  refreshMeta?: { ad_ids: string[]; issue_ids: string[] };
  requestedBy?: string | null;
}): StartAdsForkResult {
  const busy = adsBusyReason(input.site);
  if (busy) return busy;
  const now = new Date().toISOString();
  const jobId = newAdsJobId(input.kind);
  const record: AdsDiagnosticsJobRecord = {
    job_id: jobId,
    kind: input.kind,
    lane: "fork",
    status: "running",
    requested_at: now,
    started_at: now,
    finished_at: null,
    requested_by: input.requestedBy ?? null,
    ...(input.scopes ? { scopes: input.scopes } : {}),
    checked: [],
    skipped: [],
  };
  writeAdsJobRecord(input.site, record);
  writeAdsRunLock(input.site, { job_id: jobId, pid: process.pid, started_at: now, mode: input.mode });

  const start: AdsWorkerStartMessage = {
    type: "start",
    job_id: jobId,
    site: input.site,
    contentRoot: input.contentRoot,
    kind: input.kind,
    mode: input.mode,
    platforms: input.platforms,
    pending: pendingForVerify(input.site),
    ...(input.scopes ? { scopes: input.scopes } : {}),
    ...(input.refreshMeta ? { refreshMeta: input.refreshMeta } : {}),
    requested_by: input.requestedBy ?? null,
  };
  spawnAdsWorker(input.site, jobId, start);
  return { ok: true, job: record };
}

function finish(site: string, jobId: string, patch: Partial<AdsDiagnosticsJobRecord> | null): void {
  const cur = running.get(site);
  if (cur?.jobId === jobId) {
    clearTimeout(cur.idle);
    running.delete(site);
  }
  clearAdsRunLock(site, jobId);
  if (patch) updateAdsJobRecord(site, jobId, patch);
}

function spawnAdsWorker(site: string, jobId: string, start: AdsWorkerStartMessage): void {
  const workerFile = path.join(getPackageRoot(), "scripts/ads-diagnostics-worker.ts");
  let proc: ChildProcess;
  try {
    proc = fork(workerFile, [], {
      cwd: getProjectRoot(),
      env: { ...process.env, WEBLIFY_PROCESS: "" },
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      execArgv: ["--import", "tsx"],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, jobId }, "[ads-fork] failed to fork worker");
    finish(site, jobId, { status: "failed", finished_at: new Date().toISOString(), error: `Couldn't start the Ads worker: ${message}` });
    return;
  }
  const idle = setTimeout(() => {
    log.warn({ jobId }, "[ads-fork] worker idle timeout; killing");
    proc.kill("SIGKILL");
    finish(site, jobId, { status: "failed", finished_at: new Date().toISOString(), error: "The Run took too long and was stopped. Issues were left as they were." });
  }, IDLE_TIMEOUT_MS);
  idle.unref?.();
  running.set(site, { jobId, proc, idle });
  let terminal = false;

  proc.on("message", (raw: unknown) => {
    const msg = raw as AdsWorkerOutboundMessage;
    if (!msg || msg.job_id !== jobId) return;
    if (msg.type === "progress") {
      updateAdsJobRecord(site, jobId, { status: "running" });
      return;
    }
    terminal = true;
    if (msg.type === "completed") {
      void processPendingAdsResults(site)
        .catch((err) => log.error({ err, jobId }, "[ads-fork] save failed"))
        .finally(() => {
          finish(site, jobId, null);
          proc.kill();
        });
    } else {
      finish(site, jobId, { status: "failed", finished_at: new Date().toISOString(), error: msg.error });
      proc.kill();
    }
  });
  proc.on("error", (err) => {
    if (terminal) return;
    terminal = true;
    finish(site, jobId, { status: "failed", finished_at: new Date().toISOString(), error: err.message || "Ads worker error" });
  });
  proc.on("exit", (code, signal) => {
    if (terminal) return;
    terminal = true;
    const rec = readAdsJobRecord(site, jobId);
    if (rec && rec.status !== "running") return finish(site, jobId, null);
    finish(site, jobId, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error: `The Ads worker stopped unexpectedly (${signal ?? `code ${code ?? "unknown"}`}). Issues were left as they were.`,
    });
  });
  try {
    proc.send(start);
  } catch (err) {
    terminal = true;
    proc.kill();
    finish(site, jobId, { status: "failed", finished_at: new Date().toISOString(), error: `Couldn't start the Ads worker: ${err instanceof Error ? err.message : String(err)}` });
  }
}

/** Web start-up: Runs left running by a previous process → failed (issues kept). */
export function recoverInterruptedAdsRuns(site: string): void {
  if (running.has(site)) return;
  const n = failInterruptedAdsJobs(site, { lane: "fork" });
  if (n > 0) log.info({ site, n }, "[ads-fork] marked interrupted Ads Runs as failed");
  if (!isAdsRunActive(site)) clearAdsRunLock(site);
}
