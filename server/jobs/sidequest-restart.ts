/**
 * Sidequest restart — dev spawn or prod supervisor signal (pm2 relaunches).
 */

import { spawn } from "child_process";
import path from "path";
import { child } from "../logger";
import {
  getEngineStatus,
  isProcessAlive,
  readSidequestRestartFlag,
  readSidequestWorkerPid,
  SIDEQUEST_RESTART_DEBOUNCE_MS,
  writeSidequestRestartFlag,
} from "./queue";

const log = child({ module: "sidequest-admin" });

const SIGKILL_AFTER_MS = 30_000;

export type SidequestRestartResult =
  | { ok: true; mechanism: "dev-spawn" | "supervisor-signal"; message: string }
  | { ok: false; status: number; error: string };

export async function requestSidequestRestart(requestedBy: string | null): Promise<SidequestRestartResult> {
  const flag = readSidequestRestartFlag();
  if (flag.exists && flag.mtimeMs !== null && Date.now() - flag.mtimeMs < SIDEQUEST_RESTART_DEBOUNCE_MS) {
    return {
      ok: false,
      status: 429,
      error: `Restart already requested ${Math.round((Date.now() - flag.mtimeMs) / 1000)}s ago — wait before retrying.`,
    };
  }

  const engine = await getEngineStatus();
  const isDev = process.env.NODE_ENV !== "production";

  if (isDev) {
    const pid = readSidequestWorkerPid();
    if (pid !== null && isProcessAlive(pid)) {
      return { ok: false, status: 409, error: "Sidequest worker is already running." };
    }

    const workerScript = path.resolve("server/jobs/sidequest-worker.ts");
    const childProc = spawn("npx", ["tsx", workerScript], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, NODE_ENV: "development" },
    });
    childProc.unref();

    log.info({ action: "restart", username: requestedBy, mechanism: "dev-spawn" }, "Sidequest dev spawn requested");
    return {
      ok: true,
      mechanism: "dev-spawn",
      message: "Sidequest worker spawn initiated (development).",
    };
  }

  const pid = readSidequestWorkerPid();
  if (pid === null || !isProcessAlive(pid)) {
    return {
      ok: false,
      status: 409,
      error:
        "Sidequest worker is not running (no live PID). The process supervisor (pm2) should start it — check website.service / pm2 status, then retry.",
    };
  }

  // Audit + debounce marker (not a systemd bridge anymore)
  writeSidequestRestartFlag(requestedBy);

  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    log.warn({ err, pid }, "Failed to SIGTERM Sidequest worker");
    return {
      ok: false,
      status: 500,
      error: "Failed to signal Sidequest worker process.",
    };
  }

  setTimeout(() => {
    if (isProcessAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
        log.warn({ pid }, "Sidequest worker still alive after SIGTERM — sent SIGKILL");
      } catch {
        // already gone
      }
    }
  }, SIGKILL_AFTER_MS).unref();

  log.info(
    { action: "restart", username: requestedBy, mechanism: "supervisor-signal", pid, wasRunning: engine.status === "running" },
    "Sidequest supervisor signal sent (pm2 will relaunch)",
  );

  return {
    ok: true,
    mechanism: "supervisor-signal",
    message:
      "Restart signal sent to the Sidequest worker. The process supervisor (pm2) will relaunch it within a few seconds.",
  };
}
