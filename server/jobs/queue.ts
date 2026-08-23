/**
 * Thin wrapper over Sidequest.js — swap transport here if needed.
 */

import path from "path";
import fs from "fs";
import { DuplicatedJobError } from "@sidequest/core";
import { Sidequest, Job } from "sidequest";
import { child } from "../logger";

const log = child({ module: "job-queue" });

const dataDir = path.resolve("data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const SIDEQUEST_DB = path.join(dataDir, "sidequest.sqlite");

let configured = false;
let starting: Promise<void> | null = null;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 10;

export type EngineStatusState = "running" | "starting" | "stopped" | "restarting";

let engineStatus: EngineStatusState = "stopped";

export function getEngineStatus(): {
  status: EngineStatusState;
  restartAttempts: number;
  dashboardUrl?: string;
} {
  const port = Number(process.env.SIDEQUEST_DASHBOARD_PORT || 8678);
  return {
    status: engineStatus,
    restartAttempts,
    dashboardUrl:
      process.env.NODE_ENV !== "production" ? `http://localhost:${port}` : undefined,
  };
}

export type JobEnqueueOpts = {
  uniqueKey?: string;
  /** When uniqueKey is set, default true — pass false to coalesce one job per class (e.g. index_refresh). */
  uniqueWithArgs?: boolean;
  delayMs?: number;
  queue?: string;
};

export async function configureJobQueue(): Promise<void> {
  if (configured) return;
  await Sidequest.configure({
    backend: {
      driver: "@sidequest/sqlite-backend",
      config: SIDEQUEST_DB,
    },
    // Run in the host process (tsx) so job scripts can resolve extensionless TS imports.
    // Worker threads / forked engine use plain Node ESM and fail on ../../content-index, etc.
    fork: false,
    runner: "inline",
    queues: [{ name: "default", concurrency: 1, priority: 50, state: "active" }],
    dashboard: {
      enabled: process.env.NODE_ENV !== "production",
      port: Number(process.env.SIDEQUEST_DASHBOARD_PORT || 8678),
    },
  });
  configured = true;
}

export async function startJobQueue(): Promise<void> {
  if (starting) return starting;
  engineStatus = restartAttempts > 0 ? "restarting" : "starting";
  starting = (async () => {
    try {
      await configureJobQueue();
      await Sidequest.start();
      restartAttempts = 0;
      engineStatus = "running";
      log.info({ db: SIDEQUEST_DB }, "[JobQueue] Sidequest engine started");
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

export async function enqueueJob(
  jobType: string,
  payload: Record<string, unknown>,
  opts?: JobEnqueueOpts,
): Promise<void> {
  await configureJobQueue();
  const JobClass = jobClassRegistry.get(jobType);
  if (!JobClass) {
    log.error({ jobType }, "[JobQueue] Unknown job type");
    return;
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
  } catch (err) {
    if (opts?.uniqueKey && err instanceof DuplicatedJobError) {
      log.debug({ jobType, uniqueKey: opts.uniqueKey }, "[JobQueue] Job already queued (deduped)");
      return;
    }
    throw err;
  }
}
