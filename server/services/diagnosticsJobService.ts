/**
 * Async diagnostics jobs shared by MCP and the staff Diagnostics dashboard.
 *
 * - Max 1 async (forked) job per contentRoot (including single-slug runs)
 * - Exact-scope dedupe returns the existing async job_id
 * - Envelopes under {contentRoot}/.cache/diagnostics-jobs/{jobId}.json (last 50)
 * - All recomputes run in a forked child (diagnostics-worker.ts) — never in-process
 * - Issues persist in ValidationCacheService; artifacts in {jobId}-results.json
 */

import * as fs from "fs";
import * as path from "path";
import { fork, type ChildProcess } from "child_process";
import type { StoredValidationIssue, ValidatorResult } from "../../scripts/validation/shared/types";
import {
  effectiveValidatorNames,
  issuesBySlugFromTargets,
  type MappedIssue,
} from "../../scripts/validation/runDiagnosticsJob";
import type {
  DiagnosticsFreshness,
  DiagnosticsJobKind,
  DiagnosticsJobPurpose,
  DiagnosticsJobResultsFile,
  DiagnosticsLane,
  DiagnosticsWorkerOutboundMessage,
  DiagnosticsWorkerStartMessage,
} from "../../scripts/validation/diagnosticsIpc";
import { CROSS_ENTRY_VALIDATOR_NAMES } from "../../scripts/validation/shared/runClass";
import type { ContentIndex } from "../content-index";
import type { ValidationCacheService } from "./validationCacheService";
import { listCacheIssuesFromStore } from "./validationCacheService";
import { getPackageRoot, getProjectRoot } from "@shared/paths";
import { child } from "../logger";
import {
  applyDeferredDiagnosticsCache,
  enqueueCacheApply,
} from "./applyDeferredDiagnostics";
import type { VerifiedCompleteResult } from "./verifiedCompleteIssue";

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
  /**
   * Staff username / MCP author (audit / future use). Optional.
   */
  callerId?: string;
  /** Overrides lane classification. Routes for images, traffic, complete set this. */
  kind?: DiagnosticsJobKind;
  purpose?: DiagnosticsJobPurpose;
  entry?: {
    contentType: string;
    slug: string;
    locale: string;
    variant?: string;
  };
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
  code?: string;
  partial: boolean;
  lane?: DiagnosticsLane;
  kind?: DiagnosticsJobKind;
  purpose?: DiagnosticsJobPurpose;
  reportPath?: string;
}

export interface DiagnosticsJobRecord extends DiagnosticsJobEnvelope {
  validatorResults?: ValidatorResult[];
  resultIssuesBySlug?: Record<string, MappedIssue[]>;
  /** In-memory only — not written to disk envelopes */
  log?: DiagnosticsJobLogLine[];
  /** Copy of the issue before this complete job writes the cache. Not written to disk. */
  completeSnapshot?: { issueBefore: StoredValidationIssue | null; openBefore: StoredValidationIssue[] };
  completeVerdict?: VerifiedCompleteResult;
  completeSettle?: Promise<VerifiedCompleteResult>;
}

function countMapped(issuesBySlug: Record<string, MappedIssue[]>): {
  errorCount: number;
  warningCount: number;
} {
  let errorCount = 0;
  let warningCount = 0;
  for (const issues of Object.values(issuesBySlug)) {
    for (const issue of issues) {
      if (issue.severity === "error") errorCount += 1;
      else warningCount += 1;
    }
  }
  return { errorCount, warningCount };
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

const IMAGE_VALIDATOR_NAMES = new Set([
  "images",
  "image-tags",
  "hero-image-tags",
  "image-optimization",
]);

type SharedSlot = {
  child: ChildProcess | null;
  currentJobId: string | null;
  queue: string[];
  starts: Map<string, DiagnosticsWorkerStartMessage>;
};

const jobsById = new Map<string, DiagnosticsJobRecord>();
const runningByContentRoot = new Map<string, string>();
const sharedByRoot = new Map<string, SharedSlot>();
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
  const { cache, job } = opts;
  // The child does not flush the issues file mid-run. Partial polls stay empty
  // until the web process applies the results file on completed.
  if (!job.urls?.length) return {};
  return issuesFlushedSinceJobStart(
    cache,
    job,
    job.urls.map((url) => ({ url, slug: url })),
    job.categories,
  );
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
    code: job.code,
    partial: job.partial,
    lane: job.lane,
    kind: job.kind,
    purpose: job.purpose,
    reportPath: job.reportPath,
  };
}

function jobIsActive(jobId: string | undefined): DiagnosticsJobRecord | undefined {
  if (!jobId) return undefined;
  const job = jobsById.get(jobId);
  if (!job) return undefined;
  if (job.status !== "queued" && job.status !== "running") return undefined;
  return job;
}

export function isDiagnosticsRunning(contentRoot: string): boolean {
  if (jobIsActive(runningByContentRoot.get(contentRoot))) return true;
  const shared = sharedByRoot.get(contentRoot);
  if (!shared) return false;
  if (jobIsActive(shared.currentJobId ?? undefined)) return true;
  return shared.queue.some((id) => !!jobIsActive(id));
}

/** Test helper — clear async job maps. */
export function clearDiagnosticsRuntimeForTests(): void {
  jobsById.clear();
  runningByContentRoot.clear();
  sharedByRoot.clear();
}

/** Test helper — pretend an async site job holds the contentRoot lock. */
export function markAsyncJobRunningForTests(
  contentRoot: string,
  opts?: { jobId?: string; scopeKey?: string; slugs?: string[] },
): string {
  const jobId = opts?.jobId ?? `diag-test-${Date.now()}`;
  const job: DiagnosticsJobRecord = {
    jobId,
    status: "running",
    contentRootName: "test",
    scopeKey:
      opts?.scopeKey ??
      '{"slugs":[],"urls":[],"files":[],"validators":[],"freshness":"hard","max_age_seconds":0,"validator_only":false}',
    slugs: opts?.slugs,
    freshness: "hard",
    max_age_seconds: 0,
    include_artifacts: false,
    startedAt: Date.now(),
    processed: 0,
    total: 10,
    staleUrlCount: 10,
    urlCount: 10,
    partial: false,
    log: [],
  };
  jobsById.set(jobId, job);
  runningByContentRoot.set(contentRoot, jobId);
  return jobId;
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
  const shared = sharedByRoot.get(contentRoot);
  if (!shared) return;
  if (shared.currentJobId === jobId) shared.currentJobId = null;
  shared.queue = shared.queue.filter((id) => id !== jobId);
  shared.starts.delete(jobId);
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
  const finished = jobsById.get(jobId);
  const childProc = jobChildren.get(jobId);
  jobChildren.delete(jobId);
  const sharedLane = finished?.lane === "shared";
  if (!sharedLane && outcome.status === "failed" && childProc && !childProc.killed) {
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
        if (results.outcome === "not_found") {
          job.status = "failed";
          job.error = results.message || "Scope not found";
          job.code = results.code;
        } else if (results.outcome === "cached" && results.targets?.length && cache) {
          const mapped = issuesBySlugFromTargets(cache, results.targets, job.categories);
          job.resultIssuesBySlug = mapped.issuesBySlug;
          job.summary = countMapped(mapped.issuesBySlug);
        } else if (results.cacheApply && cache && !results.cacheApply.hold) {
          await enqueueCacheApply(contentRoot, async () => {
            await applyDeferredDiagnosticsCache(cache, results.cacheApply!);
          });
          if (results.targets?.length) {
            const mapped = issuesBySlugFromTargets(cache, results.targets, job.categories);
            job.resultIssuesBySlug = mapped.issuesBySlug;
            job.summary = countMapped(mapped.issuesBySlug);
          }
        }
        if (results.reportPath) job.reportPath = results.reportPath;
      }
      appendJobLog(
        job,
        job.status === "failed"
          ? `Failed — ${job.error ?? "Scope not found"}`
          : `Completed — ${outcome.summary.errorCount} errors, ${outcome.summary.warningCount} warnings`,
        job.status === "failed" ? "error" : "info",
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

  const lane = jobsById.get(jobId)?.lane;
  clearRunningLock(contentRoot, jobId);
  jobCache.delete(jobId);
  if (lane === "shared") pumpShared(contentRoot);
}

function forkDiagnosticsChild(): ChildProcess {
  const workerFile = path.join(getPackageRoot(), "scripts/validation/diagnostics-worker.ts");
  return fork(workerFile, [], {
    cwd: getProjectRoot(),
    env: { ...process.env, DIAGNOSTICS_WORKER: "1" },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    execArgv: ["--import", "tsx", "--perf-basic-prof-only-functions"],
  });
}

function attachChildHandlers(
  contentRoot: string,
  childProc: ChildProcess,
  lane: DiagnosticsLane,
): void {
  childProc.on("message", (raw: DiagnosticsWorkerOutboundMessage) => {
    if (!raw || typeof raw !== "object" || !("jobId" in raw)) return;
    const jobId = raw.jobId;
    const job = jobsById.get(jobId);
    if (!job) return;

    if (raw.type === "progress") {
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
    log.error({ err }, "Diagnostics worker process error");
    const jobId =
      lane === "shared"
        ? sharedByRoot.get(contentRoot)?.currentJobId ?? undefined
        : [...jobChildren.entries()].find(([, proc]) => proc === childProc)?.[0];
    if (!jobId) return;
    void finalizeJob(contentRoot, jobId, {
      status: "failed",
      error: err.message || "Worker process error",
    });
  });

  childProc.on("exit", (code, signal) => {
    const msg =
      signal != null
        ? `Worker exited from signal ${signal}`
        : `Worker exited with code ${code ?? "unknown"}`;
    if (lane === "shared") {
      const slot = sharedByRoot.get(contentRoot);
      if (!slot || slot.child !== childProc) return;
      slot.child = null;
      const current = slot.currentJobId;
      const queued = [...slot.queue];
      slot.currentJobId = null;
      slot.queue = [];
      log.warn({ code, signal }, msg);
      if (current && !jobTerminalHandled.has(current)) {
        void finalizeJob(contentRoot, current, { status: "failed", error: msg });
      }
      for (const id of queued) {
        if (!jobTerminalHandled.has(id)) {
          void finalizeJob(contentRoot, id, { status: "failed", error: msg });
        }
      }
      return;
    }
    for (const [jobId, proc] of jobChildren) {
      if (proc !== childProc || jobTerminalHandled.has(jobId)) continue;
      log.warn({ jobId, code, signal }, msg);
      void finalizeJob(contentRoot, jobId, { status: "failed", error: msg });
    }
  });
}

function pumpShared(contentRoot: string): void {
  const slot = sharedByRoot.get(contentRoot);
  if (!slot || slot.currentJobId) return;
  const nextId = slot.queue.shift();
  if (!nextId) {
    if (slot.child?.connected) {
      try {
        slot.child.send({ type: "stop" });
      } catch {
        /* ignore */
      }
    }
    slot.child = null;
    return;
  }
  const start = slot.starts.get(nextId);
  if (!start) return;
  slot.currentJobId = nextId;
  if (!slot.child?.connected) {
    try {
      slot.child = forkDiagnosticsChild();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      slot.currentJobId = null;
      void finalizeJob(contentRoot, nextId, {
        status: "failed",
        error: `Failed to spawn diagnostics worker: ${message}`,
      });
      return;
    }
    attachChildHandlers(contentRoot, slot.child, "shared");
  }
  jobChildren.set(nextId, slot.child);
  resetIdleTimer(contentRoot, nextId);
  const job = jobsById.get(nextId);
  if (job) {
    job.status = "running";
    appendJobLog(job, "Sent to shared worker");
    writeEnvelope(contentRoot, toEnvelope(job));
  }
  try {
    slot.child.send(start);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void finalizeJob(contentRoot, nextId, {
      status: "failed",
      error: `Failed to send start message to worker: ${message}`,
    });
  }
}

function spawnWorker(contentRoot: string, jobId: string, start: DiagnosticsWorkerStartMessage): void {
  let childProc: ChildProcess;
  try {
    childProc = forkDiagnosticsChild();
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
  attachChildHandlers(contentRoot, childProc, "site");
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

function inferDiagnosticsKind(req: DiagnosticsJobRequest): DiagnosticsJobKind {
  if (req.kind) return req.kind;
  const names = req.validators ?? [];
  const scoped = !!(req.slugs?.length || req.urls?.length || req.file);
  if (!scoped && names.length > 0 && names.every((n) => n === "redirects")) return "redirects";
  if (!scoped && names.length > 0 && names.every((n) => IMAGE_VALIDATOR_NAMES.has(n))) return "images";
  if (!scoped && names.length === 1 && names[0] === "seo-duplicates") return "seo-duplicates";
  return "diagnostics";
}

function classifyDiagnosticsJob(req: DiagnosticsJobRequest): {
  lane: DiagnosticsLane;
  kind: DiagnosticsJobKind;
} {
  const kind = inferDiagnosticsKind(req);
  if (kind === "seo-duplicates" || kind === "save-report" || kind === "section-variants") {
    return { lane: "site", kind };
  }
  if (kind !== "diagnostics") return { lane: "shared", kind };
  const scoped = !!(req.slugs?.length || req.urls?.length || req.file);
  return { lane: scoped ? "shared" : "site", kind };
}

function activeJobWithScope(
  contentRoot: string,
  key: string,
  lane: DiagnosticsLane,
): DiagnosticsJobRecord | undefined {
  if (lane === "site") {
    const job = jobIsActive(runningByContentRoot.get(contentRoot));
    return job?.scopeKey === key ? job : undefined;
  }
  const slot = sharedByRoot.get(contentRoot);
  if (!slot) return undefined;
  const ids = [...(slot.currentJobId ? [slot.currentJobId] : []), ...slot.queue];
  for (const id of ids) {
    const job = jobIsActive(id);
    if (job?.scopeKey === key) return job;
  }
  return undefined;
}

/** Requested slugs/file match no page. Not retryable; the route answers 404. */
export class DiagnosticsScopeError extends Error {
  constructor(
    message: string,
    public code: "diagnostics_slug_not_found" | "diagnostics_file_not_found",
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DiagnosticsScopeError";
  }
}

export function diagnosticsHttpStatus(result: StartDiagnosticsResult): number {
  return result.status === "busy" ? 409 : 200;
}

export async function startDiagnosticsJob(
  req: DiagnosticsJobRequest,
): Promise<StartDiagnosticsResult> {
  const freshness: DiagnosticsFreshness = req.freshness === "hard" ? "hard" : "max_age";
  const maxAge =
    typeof req.max_age_seconds === "number" && req.max_age_seconds > 0
      ? req.max_age_seconds
      : 86400;
  const { lane, kind } = classifyDiagnosticsJob(req);
  const slugFiltered = !!(req.slugs?.length || req.urls?.length || req.file);
  const { partial } = effectiveValidatorNames(req.validators, { slugFiltered });
  const key = scopeKey({
    slugs: req.slugs,
    urls: req.urls,
    files: req.file ? [req.file] : undefined,
    validators: req.validators,
    freshness,
    max_age_seconds: maxAge,
    validator_only: false,
  });

  const reused = activeJobWithScope(req.contentRoot, key, lane);
  if (reused) {
    return {
      status: reused.status === "running" ? "running" : "queued",
      job_id: reused.jobId,
      reused: true,
      retry_after_seconds: retryAfterSeconds(reused.urlCount || 1),
      scope: {
        urlCount: reused.urlCount,
        staleUrlCount: reused.staleUrlCount,
        slugs: reused.slugs,
        validators: reused.validators,
        partial: reused.partial,
      },
    };
  }

  if (lane === "site") {
    const siteJob = jobIsActive(runningByContentRoot.get(req.contentRoot));
    if (siteJob) {
      return {
        status: "busy",
        code: "diagnostics_busy",
        job_id: siteJob.jobId,
        retry_after_seconds: retryAfterSeconds(siteJob.urlCount || 1),
        message:
          "A site-wide diagnostics job is already running. Poll that job_id or wait and retry.",
      };
    }
  }

  const scoped = slugFiltered || kind !== "diagnostics";
  if (lane === "site" && req.confirm !== true && !scoped) {
    return buildNeedsConfirmResult(req.contentRoot, false);
  }

  const jobId = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: DiagnosticsJobRecord = {
    jobId,
    status: "queued",
    contentRootName: req.contentRootName,
    scopeKey: key,
    slugs: req.slugs,
    urls: req.urls,
    freshness,
    max_age_seconds: maxAge,
    validators: req.validators,
    include_artifacts: !!req.include_artifacts,
    categories: req.categories,
    startedAt: Date.now(),
    processed: 0,
    total: 1,
    staleUrlCount: 0,
    urlCount: req.slugs?.length || req.urls?.length || (req.file ? 1 : 0),
    partial,
    lane,
    kind,
    purpose: req.purpose,
    log: [],
  };

  jobsById.set(jobId, job);
  jobCache.set(jobId, req.cache);
  jobContentRoot.set(jobId, req.contentRoot);
  jobTerminalHandled.delete(jobId);
  appendJobLog(job, lane === "site" ? "Job queued (site)" : "Job queued (shared)");
  writeEnvelope(req.contentRoot, toEnvelope(job));

  const startMsg: DiagnosticsWorkerStartMessage = {
    type: "start",
    jobId,
    contentRoot: req.contentRoot,
    contentRootName: req.contentRootName,
    slugs: req.slugs,
    urls: req.urls,
    file: req.file,
    freshness,
    max_age_seconds: maxAge,
    validators: req.validators,
    include_artifacts: !!req.include_artifacts,
    categories: req.categories,
    kind,
    reusable: lane === "shared",
    entry: req.entry,
    resultsPath: resultsFilePath(req.contentRoot, jobId),
  };

  if (lane === "site") {
    runningByContentRoot.set(req.contentRoot, jobId);
    spawnWorker(req.contentRoot, jobId, startMsg);
  } else {
    let slot = sharedByRoot.get(req.contentRoot);
    if (!slot) {
      slot = { child: null, currentJobId: null, queue: [], starts: new Map() };
      sharedByRoot.set(req.contentRoot, slot);
    }
    slot.starts.set(jobId, startMsg);
    slot.queue.push(jobId);
    pumpShared(req.contentRoot);
  }

  return {
    status: "queued",
    job_id: jobId,
    retry_after_seconds: retryAfterSeconds(job.urlCount || 1),
    scope: {
      urlCount: job.urlCount,
      staleUrlCount: 0,
      slugs: req.slugs,
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
