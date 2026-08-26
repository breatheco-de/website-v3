/**
 * Thin wrapper over Sidequest.js — swap transport here if needed.
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

/** Same-origin path for the staff-proxied Sidequest UI. */
export const SIDEQUEST_DASHBOARD_BASE_PATH = "/admin/sidequest";

let configured = false;
let starting: Promise<void> | null = null;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 10;

export type EngineStatusState = "running" | "starting" | "stopped" | "restarting";

let engineStatus: EngineStatusState = "stopped";

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

export function getEngineStatus(): {
  status: EngineStatusState;
  restartAttempts: number;
  dashboardUrl?: string;
} {
  return {
    status: engineStatus,
    restartAttempts,
    dashboardUrl: isSidequestDashboardEnabled() ? `${SIDEQUEST_DASHBOARD_BASE_PATH}/` : undefined,
  };
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

export async function startJobQueue(): Promise<void> {
  if (starting) return starting;
  engineStatus = restartAttempts > 0 ? "restarting" : "starting";
  starting = (async () => {
    try {
      await configureJobQueue();
      // Must pass dashboard here — Sidequest.start spreads config?.dashboard into Dashboard.start.
      // A bare Sidequest.start() after configure() boots the UI at "/" with no auth/basePath.
      const dashboard = buildSidequestDashboardConfig();
      await Sidequest.start({ dashboard });
      restartAttempts = 0;
      engineStatus = "running";
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
      engineStatus = "restarting";
      scheduleRestart();
      throw err;
    }
  })();
  return starting;
}

function scheduleRestart(): void {
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    log.error("[JobQueue] Max restart attempts reached");
    engineStatus = "stopped";
    return;
  }
  restartAttempts++;
  engineStatus = "restarting";
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
  engineStatus = "stopped";
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
