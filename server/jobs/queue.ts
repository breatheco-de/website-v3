/**
 * Thin wrapper over Sidequest.js — swap transport here if needed.
 *
 * Web process: configure + enqueue only (never Sidequest.start).
 * Worker process: startJobQueue() runs the engine + dashboard.
 *
 * Engine liveness for the web: PID file (data/sidequest.pid), not HTTP —
 * inline jobs can block the worker event loop and make an HTTP /health flake.
 */

import path from "path";
import fs from "fs";
import crypto from "crypto";
import { DuplicatedJobError } from "@sidequest/core";
import { Sidequest, Job } from "sidequest";
import { child } from "../logger";

const log = child({ module: "job-queue" });

const dataDir = path.resolve("data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const SIDEQUEST_DB = path.join(dataDir, "sidequest.sqlite");

/** Written by the Sidequest worker; web probes process liveness via this path. */
export const SIDEQUEST_PID_PATH = path.join(dataDir, "sidequest.pid");

/** Worker heartbeat — refreshed every 30s; used for stuck detection. */
export const SIDEQUEST_HEARTBEAT_PATH = path.join(dataDir, "sidequest.heartbeat");

/** Touched by webmaster restart API; systemd path unit restarts website-sidequest. */
export const SIDEQUEST_RESTART_FLAG_PATH = path.join(dataDir, "sidequest.restart-requested");

/** Sidequest worker JSON log (tail via admin API). */
export const SIDEQUEST_LOG_PATH = path.join(dataDir, "logs", "sidequest.log");

export const SIDEQUEST_DB_PATH = SIDEQUEST_DB;

/** Same-origin path for the staff-proxied Sidequest UI. */
export const SIDEQUEST_DASHBOARD_BASE_PATH = "/admin/sidequest";

export type SidequestHeartbeatPayload = {
  pid: number;
  ts: string;
  startedAt: string;
  lastJobFinishedAt?: string;
  currentJob?: string;
};

export function getSidequestHeartbeatStaleMs(): number {
  return Number(process.env.SIDEQUEST_HEARTBEAT_STALE_MS || 120_000);
}

export function readSidequestHeartbeat(): {
  exists: boolean;
  mtimeMs: number | null;
  payload: SidequestHeartbeatPayload | null;
} {
  try {
    const stat = fs.statSync(SIDEQUEST_HEARTBEAT_PATH);
    const raw = fs.readFileSync(SIDEQUEST_HEARTBEAT_PATH, "utf-8").trim();
    let payload: SidequestHeartbeatPayload | null = null;
    if (raw) {
      try {
        payload = JSON.parse(raw) as SidequestHeartbeatPayload;
      } catch {
        payload = null;
      }
    }
    return { exists: true, mtimeMs: stat.mtimeMs, payload };
  } catch {
    return { exists: false, mtimeMs: null, payload: null };
  }
}

export function writeSidequestHeartbeat(partial: Partial<SidequestHeartbeatPayload> & { pid: number }): void {
  fs.mkdirSync(path.dirname(SIDEQUEST_HEARTBEAT_PATH), { recursive: true });
  const existing = readSidequestHeartbeat().payload;
  const now = new Date().toISOString();
  const merged: SidequestHeartbeatPayload = {
    pid: partial.pid,
    ts: now,
    startedAt: partial.startedAt ?? existing?.startedAt ?? now,
    lastJobFinishedAt: partial.lastJobFinishedAt ?? existing?.lastJobFinishedAt,
    currentJob: "currentJob" in partial ? partial.currentJob : existing?.currentJob,
  };
  fs.writeFileSync(SIDEQUEST_HEARTBEAT_PATH, `${JSON.stringify(merged)}\n`, "utf-8");
}

export function clearSidequestHeartbeat(expectedPid?: number): void {
  try {
    if (expectedPid !== undefined) {
      const hb = readSidequestHeartbeat().payload;
      if (hb !== null && hb.pid !== expectedPid) return;
    }
    fs.unlinkSync(SIDEQUEST_HEARTBEAT_PATH);
  } catch {
    // missing file is fine
  }
}

export function readSidequestRestartFlag(): { exists: boolean; mtimeMs: number | null; requestedAt?: string; requestedBy?: string } {
  try {
    const stat = fs.statSync(SIDEQUEST_RESTART_FLAG_PATH);
    let requestedAt: string | undefined;
    let requestedBy: string | undefined;
    try {
      const raw = fs.readFileSync(SIDEQUEST_RESTART_FLAG_PATH, "utf-8").trim();
      if (raw) {
        const parsed = JSON.parse(raw) as { requestedAt?: string; requestedBy?: string };
        requestedAt = parsed.requestedAt;
        requestedBy = parsed.requestedBy;
      }
    } catch {
      // flag may be empty touch-only
    }
    return { exists: true, mtimeMs: stat.mtimeMs, requestedAt, requestedBy };
  } catch {
    return { exists: false, mtimeMs: null };
  }
}

export function writeSidequestRestartFlag(requestedBy: string | null): void {
  fs.mkdirSync(path.dirname(SIDEQUEST_RESTART_FLAG_PATH), { recursive: true });
  const body = JSON.stringify({
    requestedAt: new Date().toISOString(),
    requestedBy: requestedBy ?? "unknown",
  });
  fs.writeFileSync(SIDEQUEST_RESTART_FLAG_PATH, `${body}\n`, "utf-8");
}

export const SIDEQUEST_RESTART_DEBOUNCE_MS = 30_000;

let configured = false;
let starting: Promise<void> | null = null;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 10;

export type EngineStatusState = "running" | "starting" | "stopped" | "restarting";

export function getSidequestDashboardPort(): number {
  return Number(process.env.SIDEQUEST_DASHBOARD_PORT || 8678);
}

/** Kill switch: SIDEQUEST_DASHBOARD_ENABLED=false disables; unset/true enables. */
export function isSidequestDashboardEnabled(): boolean {
  const raw = process.env.SIDEQUEST_DASHBOARD_ENABLED;
  if (raw === undefined || raw === "") return true;
  return raw !== "false" && raw !== "0";
}

/**
 * Internal Basic auth for the raw Sidequest port (proxy injects these).
 * Prefer SIDEQUEST_DASHBOARD_USER / PASSWORD; otherwise derive from SESSION_SECRET.
 */
export function getSidequestDashboardInternalAuth(): { user: string; password: string } {
  const user = process.env.SIDEQUEST_DASHBOARD_USER?.trim();
  const password = process.env.SIDEQUEST_DASHBOARD_PASSWORD?.trim();
  if (user && password) {
    return { user, password };
  }
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET or SIDEQUEST_DASHBOARD_USER/PASSWORD required when the Sidequest dashboard is enabled",
    );
  }
  const material = secret || "dev-sidequest-dashboard";
  const derived = crypto
    .createHash("sha256")
    .update(`sidequest-dash:${material}`)
    .digest("hex")
    .slice(0, 32);
  return { user: "sidequest-proxy", password: derived };
}

export type EngineStatusResult = {
  status: EngineStatusState;
  restartAttempts: number;
  dashboardUrl?: string;
  pid?: number;
};

/** True if `pid` refers to a live process (signal 0 — no kill). */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readSidequestWorkerPid(): number | null {
  try {
    const raw = fs.readFileSync(SIDEQUEST_PID_PATH, "utf-8").trim();
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

export function writeSidequestWorkerPid(pid: number = process.pid): void {
  fs.mkdirSync(path.dirname(SIDEQUEST_PID_PATH), { recursive: true });
  fs.writeFileSync(SIDEQUEST_PID_PATH, `${pid}\n`, "utf-8");
}

export function clearSidequestWorkerPid(expectedPid?: number): void {
  try {
    if (expectedPid !== undefined) {
      const current = readSidequestWorkerPid();
      if (current !== null && current !== expectedPid) return;
    }
    fs.unlinkSync(SIDEQUEST_PID_PATH);
  } catch {
    // missing file is fine
  }
}

/**
 * Liveness of the dedicated Sidequest worker via PID file.
 * Survives event-loop blocking from inline jobs (unlike HTTP /health).
 */
export async function getEngineStatus(): Promise<EngineStatusResult> {
  const dashboardUrl = isSidequestDashboardEnabled()
    ? `${SIDEQUEST_DASHBOARD_BASE_PATH}/`
    : undefined;

  const pid = readSidequestWorkerPid();
  if (pid !== null && isProcessAlive(pid)) {
    return { status: "running", restartAttempts: 0, dashboardUrl, pid };
  }

  return { status: "stopped", restartAttempts: 0, dashboardUrl };
}

export type JobEnqueueOpts = {
  uniqueKey?: string;
  /** When uniqueKey is set, default true — pass false to coalesce one job per class (e.g. index_refresh). */
  uniqueWithArgs?: boolean;
  delayMs?: number;
  queue?: string;
};

export type ConfigureJobQueueOpts = {
  /** Override Sidequest SQLite path (dry-run preflight on a copy). */
  sqlitePath?: string;
  /** Override jobs registry (tests only). */
  jobsFilePath?: string;
};

/** Prod: dist/sidequest.jobs.js. Dev (tsx): sidequest.jobs.ts at repo root. */
function sidequestJobsFilePath(): string {
  return path.resolve(
    process.cwd(),
    process.env.NODE_ENV === "production" ? "dist/sidequest.jobs.js" : "sidequest.jobs.ts",
  );
}

export type SidequestDashboardConfig = {
  enabled: boolean;
  port: number;
  basePath?: string;
  auth?: { user: string; password: string };
};

/**
 * Dashboard options for Sidequest.start({ dashboard }).
 * Sidequest.configure() ignores `dashboard` — only start() passes it to SidequestDashboard.
 */
export function buildSidequestDashboardConfig(): SidequestDashboardConfig {
  const enabled = isSidequestDashboardEnabled();
  const config: SidequestDashboardConfig = {
    enabled,
    port: getSidequestDashboardPort(),
  };
  if (enabled) {
    config.basePath = SIDEQUEST_DASHBOARD_BASE_PATH;
    config.auth = getSidequestDashboardInternalAuth();
  }
  return config;
}

export async function configureJobQueue(opts?: ConfigureJobQueueOpts): Promise<void> {
  const dbPath = opts?.sqlitePath ?? SIDEQUEST_DB;
  if (configured && !opts?.sqlitePath) return;
  const jobsFilePath = opts?.jobsFilePath
    ? path.resolve(opts.jobsFilePath)
    : sidequestJobsFilePath();

  await Sidequest.configure({
    backend: {
      driver: "@sidequest/sqlite-backend",
      config: dbPath,
    },
    // Run in the host process (tsx) so job scripts can resolve extensionless TS imports.
    // Worker threads / forked engine use plain Node ESM and fail on ../../content-index, etc.
    // Isolation from HTTP comes from a dedicated OS worker process, not Sidequest fork.
    fork: false,
    runner: "inline",
    // esbuild collapses the server into dist/index.js; stack-based script paths break
    // ("Invalid job class"). Manual registry: enqueue stores script "sidequest.jobs.js".
    manualJobResolution: true,
    jobsFilePath,
    queues: [{ name: "default", concurrency: 1, priority: 50, state: "active" }],
  });
  configured = true;
  log.info(
    { jobsFilePath, dashboardEnabled: isSidequestDashboardEnabled(), dashboardPort: getSidequestDashboardPort() },
    "[JobQueue] Sidequest configured with manual job resolution",
  );
}

/**
 * Worker-only: configure + Sidequest.start (engine + dashboard).
 * Do not call from the Express web process.
 */
export async function startJobQueue(): Promise<void> {
  if (starting) return starting;
  starting = (async () => {
    try {
      await configureJobQueue();
      // Must pass dashboard here — Sidequest.start spreads config?.dashboard into Dashboard.start.
      // A bare Sidequest.start() after configure() boots the UI at "/" with no auth/basePath.
      const dashboard = buildSidequestDashboardConfig();
      await Sidequest.start({ dashboard });
      restartAttempts = 0;
      log.info(
        {
          db: SIDEQUEST_DB,
          dashboardEnabled: dashboard.enabled,
          dashboardBasePath: dashboard.basePath,
          dashboardPort: dashboard.port,
        },
        "[JobQueue] Sidequest engine started",
      );
    } catch (err) {
      log.error({ err }, "[JobQueue] Failed to start Sidequest");
      scheduleRestart();
      throw err;
    }
  })();
  return starting;
}

function scheduleRestart(): void {
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    log.error("[JobQueue] Max restart attempts reached");
    return;
  }
  restartAttempts++;
  const delay = Math.min(60_000, 1000 * 2 ** restartAttempts);
  log.warn({ restartAttempts, delayMs: delay }, "[JobQueue] Scheduling engine restart");
  setTimeout(() => {
    starting = null;
    void startJobQueue().catch(() => {});
  }, delay);
}

export async function stopJobQueue(): Promise<void> {
  try {
    await Sidequest.stop();
  } catch (err) {
    log.warn({ err }, "[JobQueue] Error stopping Sidequest");
  }
  starting = null;
}

/** Register job class map for enqueue by type name. */
const jobClassRegistry = new Map<string, new () => Job>();

export function registerJobClass(name: string, JobClass: new () => Job): void {
  jobClassRegistry.set(name, JobClass);
}

export type EnqueueJobResult = {
  queued: boolean;
  /** True when Sidequest uniqueness rejected a duplicate within the uniqueness window. */
  deduped?: boolean;
};

export async function enqueueJob(
  jobType: string,
  payload: Record<string, unknown>,
  opts?: JobEnqueueOpts,
): Promise<EnqueueJobResult> {
  await configureJobQueue();
  const JobClass = jobClassRegistry.get(jobType);
  if (!JobClass) {
    log.error({ jobType }, "[JobQueue] Unknown job type");
    return { queued: false };
  }
  let builder = Sidequest.build(JobClass as never).queue(opts?.queue ?? "default");
  if (opts?.uniqueKey) {
    if (opts.uniqueWithArgs === false) {
      // Coalesce one pending job per class (e.g. index_refresh per site).
      builder = builder.unique(true);
    } else {
      // Dedupe by class + payload within a fixed window (requires period).
      builder = builder.unique({ withArgs: true, period: "hour" });
    }
  }
  if (opts?.delayMs && opts.delayMs > 0) {
    builder = builder.availableAt(new Date(Date.now() + opts.delayMs));
  }
  try {
    await builder.enqueue(payload);
    return { queued: true };
  } catch (err) {
    if (opts?.uniqueKey && err instanceof DuplicatedJobError) {
      log.debug({ jobType, uniqueKey: opts.uniqueKey }, "[JobQueue] Job already queued (deduped)");
      return { queued: false, deduped: true };
    }
    throw err;
  }
}
