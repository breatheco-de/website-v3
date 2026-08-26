/**
 * Sidequest restart — dev spawn or prod systemd flag file.
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

export type SidequestRestartResult =
  | { ok: true; mechanism: "dev-spawn" | "systemd-flag"; message: string }
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

  if (engine.status === "running") {
    log.info(
      { action: "restart", username: requestedBy, mechanism: "systemd-flag", pid: engine.pid },
      "Sidequest restart flag written (worker was running)",
    );
  } else {
    log.info(
      { action: "restart", username: requestedBy, mechanism: "systemd-flag" },
      "Sidequest restart flag written (worker was stopped)",
    );
  }

  writeSidequestRestartFlag(requestedBy);
  return {
    ok: true,
    mechanism: "systemd-flag",
    message:
      "Restart signal written. If website-sidequest-restart.path is enabled on the VPS, Sidequest will restart shortly.",
  };
}
