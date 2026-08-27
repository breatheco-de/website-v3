/**
 * Async diagnostics jobs shared by MCP and the staff Diagnostics dashboard.
 *
 * - Max 1 running job per contentRoot
 * - Exact-scope dedupe returns the existing job_id
 * - Envelopes under {contentRoot}/.cache/diagnostics-jobs/{jobId}.json (last 50)
 * - Heavy work runs in a forked child (scripts/validation/diagnostics-worker.ts)
 * - Issues persist in ValidationCacheService; artifacts in {jobId}-results.json
 */

import * as fs from "fs";
import * as path from "path";
import { fork, type ChildProcess } from "child_process";
import type { ValidatorResult } from "../../scripts/validation/shared/types";
import {
  effectiveValidatorNames,
  issuesBySlugFromTargets,
  resolveUrlTargets,
  type MappedIssue,
} from "../../scripts/validation/runDiagnosticsJob";
import type {
  DiagnosticsFreshness,
  DiagnosticsJobResultsFile,
  DiagnosticsWorkerOutboundMessage,
  DiagnosticsWorkerStartMessage,
} from "../../scripts/validation/diagnosticsIpc";
import { CROSS_ENTRY_VALIDATOR_NAMES } from "../../scripts/validation/shared/runClass";
import type { ContentIndex } from "../content-index";
import type { ValidationCacheService } from "./validationCacheService";
import { listCacheIssuesFromStore } from "./validationCacheService";
import { isUrlStaleForFullRun } from "./validationCacheMerge";
import { child } from "../logger";

const log = child({ module: "diagnosticsJobService" });

const MAX_JOB_ENVELOPES = 50;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_JOB_LOG_LINES = 200;

export type { DiagnosticsFreshness, MappedIssue };
export type DiagnosticsJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cached"
  | "busy"
  | "not_found";

export type DiagnosticsJobLogLevel = "info" | "warn" | "error";

export interface DiagnosticsJobLogLine {
  t: number;
  level: DiagnosticsJobLogLevel;
  text: string;
}

export interface DiagnosticsJobRequest {
  contentRoot: string;
  contentRootName: string;
  ci: ContentIndex;
  cache: ValidationCacheService;
  slugs?: string[];
  urls?: string[];
  /**
   * Optional absolute YAML file path to scope the job to a single entry.
   * When provided, the runner will resolve the file to its canonical URL target.
   */
  file?: string;
  freshness?: DiagnosticsFreshness;
  max_age_seconds?: number;
  validators?: string[];
  include_artifacts?: boolean;
  categories?: string[];
  /**
   * Required when a new job would start (hard or stale under max_age).
   * Same-scope reuse and cached responses skip this. On-save callers omit it
   * (in-process bypass — no HTTP confirm).
   */
  confirm?: boolean;
}

export interface LastFullSiteWideDiagnosticsStats {
  last_site_wide_run_at: string | null;
  last_site_wide_run_ago: string;
  last_site_wide_duration_ms: number | null;
  last_site_wide_duration_human: string | null;
  last_site_wide_url_count: number | null;
}

export interface DiagnosticsJobEnvelope {
  jobId: string;
  status: Exclude<DiagnosticsJobStatus, "cached" | "busy" | "not_found">;
  contentRootName: string;
  scopeKey: string;
  slugs?: string[];
  urls?: string[];
  freshness: DiagnosticsFreshness;
  max_age_seconds: number;
  validators?: string[];
  include_artifacts: boolean;
  categories?: string[];
  startedAt: number;
  completedAt?: number;
  processed: number;
  total: number;
  staleUrlCount: number;
  urlCount: number;
  summary?: { errorCount: number; warningCount: number };
  error?: string;
  partial: boolean;
}

export interface DiagnosticsJobRecord extends DiagnosticsJobEnvelope {
  validatorResults?: ValidatorResult[];
  resultIssuesBySlug?: Record<string, MappedIssue[]>;
  /** In-memory only — not written to disk envelopes */
  log?: DiagnosticsJobLogLine[];
}

function appendJobLog(
  job: DiagnosticsJobRecord,
  text: string,
  level: DiagnosticsJobLogLevel = "info",
): void {
  if (!job.log) job.log = [];
  job.log.push({ t: Date.now(), level, text });
  if (job.log.length > MAX_JOB_LOG_LINES) {
    job.log.splice(0, job.log.length - MAX_JOB_LOG_LINES);
  }
}

export type StartDiagnosticsResult =
  | {
      status: "cached";
      issuesBySlug: Record<string, MappedIssue[]>;
      lastFullRunAtBySlug: Record<string, string | null>;
      cacheMisses: string[];
      retry_after_seconds: number;
    }
  | {
      status: "queued" | "running";
      job_id: string;
      reused?: boolean;
      retry_after_seconds: number;
      scope: {
        urlCount: number;
        staleUrlCount: number;
        slugs?: string[];
        validators?: string[];
        partial: boolean;
      };
    }
  | {
      status: "busy";
      code: "diagnostics_busy";
      job_id: string;
      retry_after_seconds: number;
      message: string;
    }
  | ({
      status: "needs_confirm";
      code: "confirm_run_diagnostics";
      message: string;
      /** True when the request scopes by slugs and/or urls (or file→urls). */
      scoped: boolean;
    } & LastFullSiteWideDiagnosticsStats);

const jobsById = new Map<string, DiagnosticsJobRecord>();
const runningByContentRoot = new Map<string, string>();
const jobCache = new Map<string, ValidationCacheService>();
const jobContentRoot = new Map<string, string>();
const jobChildren = new Map<string, ChildProcess>();
const jobIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const jobTerminalHandled = new Set<string>();
const lastCacheReloadByRoot = new Map<string, number>();
const CACHE_RELOAD_DEBOUNCE_MS = 5_000;

/** Human duration for confirm messages (e.g. "4m 20s", "45s", "never"). */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "unknown";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/** Relative ago from an ISO timestamp or epoch ms. */
export function formatRunAgo(at: string | number | null | undefined): string {
  if (at == null) return "never";
  const ms = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return "never";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function isFullSiteWideCompleted(e: DiagnosticsJobEnvelope): boolean {
  if (e.status !== "completed" || e.completedAt == null) return false;
  if (e.partial) return false;
  if (e.slugs && e.slugs.length > 0) return false;
  if (e.urls && e.urls.length > 0) return false;
  return true;
}

/**
 * Newest completed full site-wide job (no slug/url scope, !partial).
 * Prefers freshness "hard" when any such job exists.
 */
export function getLastFullSiteWideDiagnosticsStats(
  contentRoot: string,
): LastFullSiteWideDiagnosticsStats {
  const candidates = listDiagnosticsJobs(contentRoot).filter(isFullSiteWideCompleted);
  const hard = candidates.filter((j) => j.freshness === "hard");
  const best = (hard.length > 0 ? hard : candidates)[0];
  if (!best || best.completedAt == null) {
    return {
      last_site_wide_run_at: null,
      last_site_wide_run_ago: "never",
      last_site_wide_duration_ms: null,
      last_site_wide_duration_human: null,
      last_site_wide_url_count: null,
    };
  }
  const durationMs = Math.max(0, best.completedAt - best.startedAt);
  const runAt = new Date(best.completedAt).toISOString();
  return {
    last_site_wide_run_at: runAt,
    last_site_wide_run_ago: formatRunAgo(best.completedAt),
    last_site_wide_duration_ms: durationMs,
    last_site_wide_duration_human: formatDurationMs(durationMs),
    last_site_wide_url_count: best.urlCount ?? null,
  };
}

function buildNeedsConfirmResult(
  contentRoot: string,
  scoped: boolean,
): Extract<StartDiagnosticsResult, { status: "needs_confirm" }> {
  const stats = getLastFullSiteWideDiagnosticsStats(contentRoot);
  const durationPart =
    stats.last_site_wide_duration_human != null
      ? ` and took ${stats.last_site_wide_duration_human}`
      : "";
  const urlPart =
    stats.last_site_wide_url_count != null
      ? ` (${stats.last_site_wide_url_count} URLs)`
      : "";
  const when =
    stats.last_site_wide_run_at == null
      ? "No full site-wide diagnostics run recorded yet"
      : `Last full site-wide run was ${stats.last_site_wide_run_ago}${durationPart}${urlPart}`;
  const message = `Are you sure you want to run diagnostics? ${when}. Re-call with confirm: true to proceed.`;
  return {
    status: "needs_confirm",
    code: "confirm_run_diagnostics",
    message,
    scoped,
    ...stats,
  };
}

/** Debounced disk reload so mid-run polls see worker flushes without hammering IO. */
export function maybeReloadValidationCache(
  contentRoot: string,
  cache: ValidationCacheService,
): void {
  const now = Date.now();
  const last = lastCacheReloadByRoot.get(contentRoot) ?? 0;
  if (now - last < CACHE_RELOAD_DEBOUNCE_MS) return;
  lastCacheReloadByRoot.set(contentRoot, now);
  try {
    cache.reloadFromDisk();
  } catch (err) {
    log.warn({ err, contentRoot }, "Debounced validation-cache reload failed");
  }
}

/**
 * Issues for URLs flushed since this job started (lastFullRunAt >= startedAt).
 * Used for mid-run GET /diagnostics-jobs/:id partial payloads.
 */
export function issuesFlushedSinceJobStart(
  cache: ValidationCacheService,
  job: Pick<DiagnosticsJobEnvelope, "startedAt" | "categories">,
  targets: { url: string; slug: string }[],
  categories?: string[],
): Record<string, MappedIssue[]> {
  const sinceMs = job.startedAt;
  const flushed = targets.filter((t) => {
    const entry = cache.getByUrl(t.url);
    const full = entry?.lastFullRunAt;
    if (!full) return false;
    const tMs = Date.parse(full);
    return Number.isFinite(tMs) && tMs >= sinceMs;
  });
  const { issuesBySlug } = issuesBySlugFromTargets(
    cache,
    flushed,
    categories ?? job.categories,
  );
  return issuesBySlug;
}

/** Resolve job scope targets and return issues flushed since job.startedAt. */
export async function getPartialIssuesForRunningJob(opts: {
  contentRoot: string;
  ci: ContentIndex;
  cache: ValidationCacheService;
  job: DiagnosticsJobEnvelope | DiagnosticsJobRecord;
}): Promise<Record<string, MappedIssue[]>> {
  const { contentRoot, ci, cache, job } = opts;
  maybeReloadValidationCache(contentRoot, cache);
  const targets = await resolveUrlTargets(contentRoot, ci, job.slugs, job.urls);
  return issuesFlushedSinceJobStart(cache, job, targets, job.categories);
}

function jobsDir(contentRoot: string): string {
  return path.join(contentRoot, ".cache", "diagnostics-jobs");
}

function ensureJobsDir(contentRoot: string): string {
  const dir = jobsDir(contentRoot);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isResultsFileName(name: string): boolean {
  return name.endsWith("-results.json");
}

function resultsFilePath(contentRoot: string, jobId: string): string {
  return path.join(jobsDir(contentRoot), `${jobId}-results.json`);
}

function writeEnvelope(contentRoot: string, job: DiagnosticsJobEnvelope): void {
  const dir = ensureJobsDir(contentRoot);
  const filePath = path.join(dir, `${job.jobId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(job, null, 2) + "\n", "utf-8");
  pruneEnvelopes(dir);
}

function pruneEnvelopes(dir: string): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json") && !isResultsFileName(f))
      .map((f) => {
        const full = path.join(dir, f);
        return { full, base: f, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const stale of files.slice(MAX_JOB_ENVELOPES)) {
      try {
        fs.unlinkSync(stale.full);
        const resultsAlt = path.join(dir, stale.base.replace(/\.json$/, "-results.json"));
        if (fs.existsSync(resultsAlt)) fs.unlinkSync(resultsAlt);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function readEnvelopeFromDisk(
  contentRoot: string,
  jobId: string,
): DiagnosticsJobEnvelope | null {
  const filePath = path.join(jobsDir(contentRoot), `${jobId}.json`);
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as DiagnosticsJobEnvelope;
  } catch {
    return null;
  }
}

function readResultsFromDisk(
  contentRoot: string,
  jobId: string,
): DiagnosticsJobResultsFile | null {
  const filePath = resultsFilePath(contentRoot, jobId);
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as DiagnosticsJobResultsFile;
  } catch {
    return null;
  }
}

function scopeKey(req: {
  slugs?: string[];
  urls?: string[];
  files?: string[];
  validators?: string[];
  freshness: DiagnosticsFreshness;
  max_age_seconds: number;
  validator_only?: boolean;
}): string {
  const slugs = [...(req.slugs ?? [])].map((s) => s.toLowerCase()).sort();
  const urls = [...(req.urls ?? [])].map((u) => u.toLowerCase()).sort();
  const files = [...(req.files ?? [])].map((f) => f.toLowerCase()).sort();
  const validators = [...(req.validators ?? [])].map((v) => v.toLowerCase()).sort();
  return JSON.stringify({
    slugs,
    urls,
    files,
    validators,
    freshness: req.freshness,
    max_age_seconds: req.freshness === "hard" ? 0 : req.max_age_seconds,
    validator_only: req.validator_only ?? false,
  });
}

function retryAfterSeconds(urlCount: number): number {
  return urlCount > 50 ? 15 : 5;
}

function toEnvelope(job: DiagnosticsJobRecord): DiagnosticsJobEnvelope {
  return {
    jobId: job.jobId,
    status: job.status,
    contentRootName: job.contentRootName,
    scopeKey: job.scopeKey,
    slugs: job.slugs,
    urls: job.urls,
    freshness: job.freshness,
    max_age_seconds: job.max_age_seconds,
    validators: job.validators,
    include_artifacts: job.include_artifacts,
    categories: job.categories,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    processed: job.processed,
    total: job.total,
    staleUrlCount: job.staleUrlCount,
    urlCount: job.urlCount,
    summary: job.summary,
    error: job.error,
    partial: job.partial,
  };
}

export function isDiagnosticsRunning(contentRoot: string): boolean {
  const id = runningByContentRoot.get(contentRoot);
  if (!id) return false;
  const job = jobsById.get(id);
  return !!(job && (job.status === "queued" || job.status === "running"));
}

/** Mark leftover queued/running envelopes failed after server restart. */
export function failInterruptedEnvelopes(contentRoot: string): void {
  const dir = jobsDir(contentRoot);
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || isResultsFileName(f)) continue;
    try {
      const full = path.join(dir, f);
      const e = JSON.parse(fs.readFileSync(full, "utf-8")) as DiagnosticsJobEnvelope;
      if (e.status === "queued" || e.status === "running") {
        e.status = "failed";
        e.error = "interrupted (server restart)";
        e.completedAt = Date.now();
        fs.writeFileSync(full, JSON.stringify(e, null, 2) + "\n", "utf-8");
        log.info({ jobId: e.jobId }, "Marked interrupted diagnostics job as failed");
      }
    } catch {
      /* ignore */
    }
  }
}

function clearIdleTimer(jobId: string): void {
  const t = jobIdleTimers.get(jobId);
  if (t) clearTimeout(t);
  jobIdleTimers.delete(jobId);
}

function resetIdleTimer(contentRoot: string, jobId: string): void {
  clearIdleTimer(jobId);
  jobIdleTimers.set(
    jobId,
    setTimeout(() => {
      log.warn({ jobId }, "Diagnostics job idle timeout — killing child");
      const childProc = jobChildren.get(jobId);
      try {
        childProc?.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      void finalizeJob(contentRoot, jobId, {
        status: "failed",
        error: "idle timeout (no progress for 15 minutes)",
      });
    }, IDLE_TIMEOUT_MS),
  );
}

function clearRunningLock(contentRoot: string, jobId: string): void {
  if (runningByContentRoot.get(contentRoot) === jobId) {
    runningByContentRoot.delete(contentRoot);
  }
}

async function finalizeJob(
  contentRoot: string,
  jobId: string,
  outcome:
    | { status: "completed"; summary: { errorCount: number; warningCount: number }; resultsPath?: string }
    | { status: "failed"; error: string },
): Promise<void> {
  if (jobTerminalHandled.has(jobId)) return;
  jobTerminalHandled.add(jobId);

  clearIdleTimer(jobId);
  const childProc = jobChildren.get(jobId);
  jobChildren.delete(jobId);
  if (outcome.status === "failed" && childProc && !childProc.killed) {
    try {
      childProc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }

  const job = jobsById.get(jobId);
  const cache = jobCache.get(jobId);

  if (job) {
    job.completedAt = Date.now();
    if (outcome.status === "completed") {
      job.status = "completed";
      job.summary = outcome.summary;
      job.processed = job.total;
      const results = readResultsFromDisk(contentRoot, jobId);
      if (results) {
        job.resultIssuesBySlug = results.issuesBySlug as Record<string, MappedIssue[]>;
        job.validatorResults = results.validatorResults as ValidatorResult[] | undefined;
      }
      appendJobLog(
        job,
        `Completed — ${outcome.summary.errorCount} errors, ${outcome.summary.warningCount} warnings`,
      );
    } else {
      job.status = "failed";
      job.error = outcome.error;
      appendJobLog(job, `Failed — ${outcome.error}`, "error");
    }
    writeEnvelope(contentRoot, toEnvelope(job));
  } else {
    const disk = readEnvelopeFromDisk(contentRoot, jobId);
    if (disk && (disk.status === "queued" || disk.status === "running")) {
      disk.status = outcome.status === "completed" ? "completed" : "failed";
      disk.completedAt = Date.now();
      if (outcome.status === "completed") disk.summary = outcome.summary;
      else disk.error = outcome.error;
      writeEnvelope(contentRoot, disk);
    }
  }

  clearRunningLock(contentRoot, jobId);
  jobCache.delete(jobId);

  if (cache) {
    try {
      cache.reloadFromDisk();
      // Parent owns GCS upload after worker local flush
      await cache.flush();
    } catch (err) {
      log.warn({ err, jobId }, "Failed to reload validation cache after diagnostics job");
    }
  }
}

function attachChildHandlers(
  contentRoot: string,
  jobId: string,
  childProc: ChildProcess,
): void {
  childProc.on("message", (raw: DiagnosticsWorkerOutboundMessage) => {
    const job = jobsById.get(jobId);
    if (!job) return;
    if (!raw || typeof raw !== "object") return;

    if (raw.type === "progress") {
      if (raw.jobId && raw.jobId !== jobId) return;
      job.status = "running";
      if (typeof raw.processed === "number") job.processed = raw.processed;
      if (typeof raw.total === "number" && raw.total > 0) job.total = raw.total;
      if (typeof raw.staleUrlCount === "number") job.staleUrlCount = raw.staleUrlCount;
      if (typeof raw.urlCount === "number") job.urlCount = raw.urlCount;
      if (raw.message) {
        const prefix =
          typeof raw.total === "number" && raw.total > 0
            ? `[${raw.processed ?? job.processed}/${raw.total}] `
            : "";
        appendJobLog(job, `${prefix}${raw.message}`);
      }
      writeEnvelope(contentRoot, toEnvelope(job));
      resetIdleTimer(contentRoot, jobId);
      return;
    }

    if (raw.type === "completed") {
      void finalizeJob(contentRoot, jobId, {
        status: "completed",
        summary: raw.summary,
        resultsPath: raw.resultsPath,
      });
      return;
    }

    if (raw.type === "failed") {
      void finalizeJob(contentRoot, jobId, {
        status: "failed",
        error: raw.error || "Worker reported failure",
      });
    }
  });

  childProc.on("error", (err) => {
    log.error({ err, jobId }, "Diagnostics worker process error");
    void finalizeJob(contentRoot, jobId, {
      status: "failed",
      error: err.message || "Worker process error",
    });
  });

  childProc.on("exit", (code, signal) => {
    if (jobTerminalHandled.has(jobId)) return;
    const msg =
      signal != null
        ? `Worker exited from signal ${signal}`
        : `Worker exited with code ${code ?? "unknown"}`;
    log.warn({ jobId, code, signal }, msg);
    void finalizeJob(contentRoot, jobId, { status: "failed", error: msg });
  });
}

function spawnWorker(contentRoot: string, jobId: string, start: DiagnosticsWorkerStartMessage): void {
  const workerFile = path.join(process.cwd(), "scripts/validation/diagnostics-worker.ts");
  let childProc: ChildProcess;
  try {
    childProc = fork(workerFile, [], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      execArgv: ["--import", "tsx"],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, jobId }, "Failed to fork diagnostics worker");
    void finalizeJob(contentRoot, jobId, {
      status: "failed",
      error: `Failed to spawn diagnostics worker: ${message}`,
    });
    return;
  }

  jobChildren.set(jobId, childProc);
  attachChildHandlers(contentRoot, jobId, childProc);
  resetIdleTimer(contentRoot, jobId);

  const job = jobsById.get(jobId);
  if (job) {
    job.status = "running";
    appendJobLog(job, "Worker forked");
    writeEnvelope(contentRoot, toEnvelope(job));
  }

  try {
    childProc.send(start);
    if (job) appendJobLog(job, "Start message sent to worker");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void finalizeJob(contentRoot, jobId, {
      status: "failed",
      error: `Failed to send start message to worker: ${message}`,
    });
  }
}

export async function startDiagnosticsJob(
  req: DiagnosticsJobRequest,
): Promise<StartDiagnosticsResult> {
  const freshness: DiagnosticsFreshness = req.freshness === "hard" ? "hard" : "max_age";
  const maxAge =
    typeof req.max_age_seconds === "number" && req.max_age_seconds > 0
      ? req.max_age_seconds
      : 86400;
  const hasUrlOrSlugScope = !!(req.slugs?.length || req.urls?.length);
  // Prefer URL/slug scoping whenever available. File scoping is a fallback only.
  let filePaths = !hasUrlOrSlugScope && req.file ? [req.file] : undefined;
  let validatorOnly = false;
  const slugFiltered = !!(req.slugs?.length || req.urls?.length || filePaths?.length);
  const { pageValidators, siteWideValidators, partial } = effectiveValidatorNames(req.validators, {
    slugFiltered,
  });

  if (req.slugs && req.slugs.length > 0) {
    const targetsProbe = await resolveUrlTargets(
      req.contentRoot,
      req.ci,
      req.slugs,
      req.urls,
    );
    if (targetsProbe.length === 0) {
      throw new Error(`No YAML-backed pages found for slugs: ${req.slugs.join(", ")}`);
    }
  }

  let allTargets = await resolveUrlTargets(
    req.contentRoot,
    req.ci,
    req.slugs,
    req.urls,
    filePaths,
  );
  if (filePaths && allTargets.length === 0) {
    const isSharedTemplateFile = /\/((?:template|single)\.[^/]+\.ya?ml|_common\.(?:template|single)\.ya?ml)$/i.test(
      req.file ?? "",
    );
    if (!isSharedTemplateFile) {
      throw new Error(`No YAML-backed pages found for file: ${req.file}`);
    }
    validatorOnly = true;
    filePaths = undefined;
    allTargets = [];
  }

  const key = scopeKey({
    slugs: req.slugs,
    urls: req.urls,
    files: filePaths,
    validators: req.validators,
    freshness,
    max_age_seconds: maxAge,
    validator_only: validatorOnly,
  });

  const runningId = runningByContentRoot.get(req.contentRoot);
  if (runningId) {
    const running = jobsById.get(runningId);
    if (running && (running.status === "queued" || running.status === "running")) {
      if (running.scopeKey === key) {
        return {
          status: running.status,
          job_id: running.jobId,
          reused: true,
          retry_after_seconds: retryAfterSeconds(running.urlCount || 1),
          scope: {
            urlCount: running.urlCount,
            staleUrlCount: running.staleUrlCount,
            slugs: running.slugs,
            validators: running.validators,
            partial: running.partial,
          },
        };
      }
      return {
        status: "busy",
        code: "diagnostics_busy",
        job_id: running.jobId,
        retry_after_seconds: retryAfterSeconds(running.urlCount || 1),
        message:
          "Another diagnostics job is already running for this site. Poll that job_id or wait and retry.",
      };
    }
  }

  // When scoping by a YAML file, resolve it to canonical URL targets so the worker
  // validates only that single entry (instead of the whole site).
  const scopedSlugs = validatorOnly
    ? undefined
    : req.slugs ?? (filePaths ? allTargets.map((t) => t.slug) : undefined);
  const scopedUrls = validatorOnly
    ? undefined
    : req.urls ?? (filePaths ? allTargets.map((t) => t.url) : undefined);

  let staleTargets = allTargets;
  if (!partial && freshness === "max_age") {
    staleTargets = allTargets.filter((t) =>
      isUrlStaleForFullRun(req.cache.getByUrl(t.url), maxAge),
    );
  }

  const needsWork =
    (validatorOnly && pageValidators.length > 0) ||
    (pageValidators.length > 0 && (partial || freshness === "hard" || staleTargets.length > 0)) ||
    (siteWideValidators.length > 0 && (partial || freshness === "hard" || staleTargets.length > 0));

  if (
    !validatorOnly &&
    !partial &&
    freshness === "max_age" &&
    staleTargets.length === 0 &&
    allTargets.length > 0
  ) {
    const { issuesBySlug, lastFullRunAtBySlug, cacheMisses } = issuesBySlugFromTargets(
      req.cache,
      allTargets,
      req.categories,
    );
    return {
      status: "cached",
      issuesBySlug,
      lastFullRunAtBySlug,
      cacheMisses,
      retry_after_seconds: 0,
    };
  }

  if (!needsWork && allTargets.length === 0 && siteWideValidators.length === 0 && !validatorOnly) {
    return {
      status: "cached",
      issuesBySlug: {},
      lastFullRunAtBySlug: {},
      cacheMisses: [],
      retry_after_seconds: 0,
    };
  }

  // Real job would start — require confirm (HTTP/MCP). In-process callers omit confirm.
  if (req.confirm !== true) {
    const scoped = !!(
      (scopedSlugs && scopedSlugs.length > 0) ||
      (scopedUrls && scopedUrls.length > 0) ||
      validatorOnly
    );
    return buildNeedsConfirmResult(req.contentRoot, scoped);
  }

  const jobId = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: DiagnosticsJobRecord = {
    jobId,
    status: "queued",
    contentRootName: req.contentRootName,
    scopeKey: key,
    slugs: scopedSlugs,
    urls: scopedUrls,
    freshness,
    max_age_seconds: maxAge,
    validators: req.validators,
    include_artifacts: !!req.include_artifacts,
    categories: req.categories,
    startedAt: Date.now(),
    processed: 0,
    total: validatorOnly
      ? Math.max(
          (pageValidators.length > 0 ? 1 : 0) + (siteWideValidators.length > 0 ? 1 : 0),
          1,
        )
      : Math.max(
          (pageValidators.length > 0
            ? partial || freshness === "hard"
              ? allTargets.length
              : staleTargets.length
            : 0) + (siteWideValidators.length > 0 ? 1 : 0),
          1,
        ),
    staleUrlCount: validatorOnly ? 0 : staleTargets.length,
    urlCount: validatorOnly ? 0 : allTargets.length,
    partial,
    log: [],
  };

  jobsById.set(jobId, job);
  jobCache.set(jobId, req.cache);
  jobContentRoot.set(jobId, req.contentRoot);
  runningByContentRoot.set(req.contentRoot, jobId);
  jobTerminalHandled.delete(jobId);
  appendJobLog(job, "Job queued");
  writeEnvelope(req.contentRoot, toEnvelope(job));

  const startMsg: DiagnosticsWorkerStartMessage = {
    type: "start",
    jobId,
    contentRoot: req.contentRoot,
    contentRootName: req.contentRootName,
    slugs: scopedSlugs,
    urls: scopedUrls,
    freshness,
    max_age_seconds: maxAge,
    validators: req.validators,
    include_artifacts: !!req.include_artifacts,
    categories: req.categories,
    validator_only: validatorOnly,
    resultsPath: resultsFilePath(req.contentRoot, jobId),
  };

  spawnWorker(req.contentRoot, jobId, startMsg);

  return {
    status: "queued",
    job_id: jobId,
    retry_after_seconds: retryAfterSeconds(validatorOnly ? 1 : allTargets.length),
    scope: {
      urlCount: validatorOnly ? 0 : allTargets.length,
      staleUrlCount: validatorOnly ? 0 : staleTargets.length,
      slugs: scopedSlugs,
      validators: req.validators,
      partial,
    },
  };
}

export function getDiagnosticsJob(
  contentRoot: string,
  jobId: string,
): {
  status: DiagnosticsJobStatus;
  job?: DiagnosticsJobRecord;
  code?: string;
  message?: string;
  retry_after_seconds?: number;
} {
  const mem = jobsById.get(jobId);
  if (mem) {
    if (
      (mem.status === "completed" || mem.status === "failed") &&
      !mem.resultIssuesBySlug
    ) {
      const results = readResultsFromDisk(contentRoot, jobId);
      if (results?.issuesBySlug) {
        mem.resultIssuesBySlug = results.issuesBySlug as Record<string, MappedIssue[]>;
        mem.validatorResults = results.validatorResults as ValidatorResult[] | undefined;
      }
    }
    const retry =
      mem.status === "queued" || mem.status === "running"
        ? retryAfterSeconds(mem.urlCount || 1)
        : 0;
    return { status: mem.status, job: mem, retry_after_seconds: retry };
  }

  const disk = readEnvelopeFromDisk(contentRoot, jobId);
  if (disk) {
    if (disk.status === "completed" || disk.status === "failed") {
      const results = readResultsFromDisk(contentRoot, jobId);
      const job: DiagnosticsJobRecord = {
        ...disk,
        resultIssuesBySlug: results?.issuesBySlug as Record<string, MappedIssue[]> | undefined,
        validatorResults: results?.validatorResults as ValidatorResult[] | undefined,
      };
      return {
        status: disk.status,
        job,
        retry_after_seconds: 0,
        message:
          disk.status === "completed"
            ? "Job finished. Issues are in validation-cache.json; artifacts may be in the results file."
            : disk.error,
      };
    }
    return {
      status: "not_found",
      code: "diagnostics_job_lost",
      message:
        "Job expired, evicted, or lost on restart. Call run_page_diagnostics / start a new diagnostics job — do not keep polling this job_id.",
      retry_after_seconds: 0,
    };
  }

  return {
    status: "not_found",
    code: "diagnostics_job_lost",
    message:
      "Job expired, evicted, or lost on restart. Call run_page_diagnostics / start a new diagnostics job — do not keep polling this job_id.",
    retry_after_seconds: 0,
  };
}

export function listDiagnosticsJobs(contentRoot: string): DiagnosticsJobEnvelope[] {
  const dir = jobsDir(contentRoot);
  const byId = new Map<string, DiagnosticsJobEnvelope>();
  try {
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && !isResultsFileName(x))) {
        try {
          const e = JSON.parse(
            fs.readFileSync(path.join(dir, f), "utf-8"),
          ) as DiagnosticsJobEnvelope;
          byId.set(e.jobId, e);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  for (const [id, j] of jobsById) {
    if (jobContentRoot.get(id) === contentRoot || fs.existsSync(path.join(dir, `${id}.json`))) {
      byId.set(id, toEnvelope(j));
    }
  }
  return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_JOB_ENVELOPES);
}

export function listCacheIssues(
  cache: ValidationCacheService,
  filters?: import("./validationCacheService").ListCacheIssuesFilters,
): ReturnType<typeof listCacheIssuesFromStore> {
  return listCacheIssuesFromStore(cache, filters);
}

/** Validators that must not run in per-page / slug-filtered mode (cross-entry). */
export const DIAGNOSTICS_SKIP_FOR_PER_PAGE = new Set(CROSS_ENTRY_VALIDATOR_NAMES);
