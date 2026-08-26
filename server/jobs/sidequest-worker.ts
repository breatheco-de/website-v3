/**
 * Dedicated Sidequest worker process — runs Sidequest.start() so jobs do not
 * share the Express event loop. Start via `npm run sidequest` (dev) or
 * scripts/start-sidequest.sh (prod / systemd).
 *
 * Build: esbuild → dist/sidequest-worker.js
 * Liveness: writes data/sidequest.pid for the web process (getEngineStatus).
 */

import "dotenv/config";
import { registerAllJobs } from "./register";
import {
  clearSidequestWorkerPid,
  startJobQueue,
  stopJobQueue,
  writeSidequestWorkerPid,
} from "./queue";
import { child } from "../logger";

const log = child({ module: "sidequest-worker" });

let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "[SidequestWorker] shutting down");
  try {
    clearSidequestWorkerPid(process.pid);
    await stopJobQueue();
  } catch (err) {
    log.error({ err }, "[SidequestWorker] error during shutdown");
  }
  process.exit(0);
}

async function main(): Promise<void> {
  log.info(
    { pid: process.pid },
    "[SidequestWorker] starting — jobs run in this process, not Express",
  );
  registerAllJobs();
  await startJobQueue();
  writeSidequestWorkerPid(process.pid);
  log.info({ pid: process.pid }, "[SidequestWorker] engine ready (pid file written)");
}

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

void main().catch((err) => {
  log.error({ err }, "[SidequestWorker] failed to start");
  clearSidequestWorkerPid(process.pid);
  process.exit(1);
});
