/**
 * Dedicated Sidequest worker process — runs Sidequest.start() so jobs do not
 * share the Express event loop. Start via `npm run sidequest` (dev) or
 * scripts/start-sidequest.sh (prod / systemd).
 *
 * Build: esbuild → dist/sidequest-worker.js
 */

import "dotenv/config";
import http from "http";
import { registerAllJobs } from "./register";
import {
  getWorkerHealthPort,
  startJobQueue,
  stopJobQueue,
} from "./queue";
import { child } from "../logger";

const log = child({ module: "sidequest-worker" });

let healthServer: http.Server | null = null;
let shuttingDown = false;

function startHealthServer(): Promise<void> {
  const port = getWorkerHealthPort();
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && (req.url === "/health" || req.url?.startsWith("/health?"))) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, engine: "running", pid: process.pid }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      healthServer = server;
      log.info({ port, pid: process.pid }, "[SidequestWorker] health listening on loopback");
      resolve();
    });
  });
}

async function stopHealthServer(): Promise<void> {
  if (!healthServer) return;
  const server = healthServer;
  healthServer = null;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "[SidequestWorker] shutting down");
  try {
    await stopHealthServer();
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
  await startHealthServer();
  log.info("[SidequestWorker] engine ready");
}

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

void main().catch((err) => {
  log.error({ err }, "[SidequestWorker] failed to start");
  process.exit(1);
});
