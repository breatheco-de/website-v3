/**
 * Dedicated Sidequest worker process — runs Sidequest.start() so jobs do not
 * share the Express event loop. Start via `npm run sidequest` (dev) or
 * scripts/start-sidequest.sh (prod / systemd).
 *
 * Build: esbuild → dist/sidequest-worker.js
 * Liveness: writes data/sidequest.pid + data/sidequest.heartbeat for the web process.
 */

import "dotenv/config";
import { registerAllJobs } from "./register";
import {
  clearSidequestHeartbeat,
  clearSidequestWorkerPid,
  startJobQueue,
  stopJobQueue,
  writeSidequestHeartbeat,
  writeSidequestWorkerPid,
} from "./queue";
import { createSidequestWorkerLogger } from "./sidequest-worker-logger";

const log = createSidequestWorkerLogger();

const HEARTBEAT_INTERVAL_MS = 30_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

let shuttingDown = false;

function startHeartbeatLoop(): void {
  writeSidequestHeartbeat({ pid: process.pid, startedAt: new Date().toISOString() });
  heartbeatTimer = setInterval(() => {
    writeSidequestHeartbeat({ pid: process.pid });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
}

function stopHeartbeatLoop(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "[SidequestWorker] shutting down");
  stopHeartbeatLoop();
  try {
    clearSidequestWorkerPid(process.pid);
    clearSidequestHeartbeat(process.pid);
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
  startHeartbeatLoop();
  log.info({ pid: process.pid }, "[SidequestWorker] engine ready (pid + heartbeat written)");
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
  clearSidequestHeartbeat(process.pid);
  process.exit(1);
});
