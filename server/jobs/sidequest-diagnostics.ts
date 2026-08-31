/**
 * Staff-facing Sidequest engine diagnostics (read-only).
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import Database from "better-sqlite3";
import {
  getEngineStatus,
  getSidequestDashboardInternalAuth,
  getSidequestDashboardPort,
  getSidequestHeartbeatStaleMs,
  isProcessAlive,
  isSidequestDashboardEnabled,
  readSidequestHeartbeat,
  readSidequestRestartFlag,
  readSidequestWorkerPid,
  SIDEQUEST_DB_PATH,
  SIDEQUEST_HEARTBEAT_PATH,
  SIDEQUEST_PID_PATH,
  SIDEQUEST_RESTART_FLAG_PATH,
  SIDEQUEST_RESTART_DEBOUNCE_MS,
  type EngineStatusResult,
} from "./queue";
import {
  getLatestWriteGeneration,
  getOldestUnpublishedAgeMs,
  getUnpublishedCount,
  listEvents,
} from "../events/event-store";
import { getLastAppliedSnapshot } from "./applier";
import { getSiteContextMap } from "../site-manager";

const execFileAsync = promisify(execFile);

export type SidequestDerivedHealth =
  | "stopped"
  | "running"
  | "running_idle"
  | "running_stuck";

export type SidequestDiagnostics = {
  engine: EngineStatusResult & {
    pidFileExists: boolean;
    pidFileMtimeMs: number | null;
  };
  heartbeat: {
    path: string;
    exists: boolean;
    ageMs: number | null;
    payload: ReturnType<typeof readSidequestHeartbeat>["payload"];
  };
  derivedHealth: SidequestDerivedHealth;
  artifacts: {
    workerJs: { path: string; exists: boolean; mtimeMs: number | null };
    jobsJs: { path: string; exists: boolean; mtimeMs: number | null };
  };
  queueDb: {
    path: string;
    exists: boolean;
    sizeBytes: number | null;
    countsByState: Record<string, number>;
    recentFailed: Array<{
      class: string;
      state: string;
      failedAt: string | null;
      errorsPreview: string | null;
    }>;
    error?: string;
  };
  dashboardProbe: {
    probeOnly: true;
    enabled: boolean;
    reachable: boolean;
    statusCode?: number;
    error?: string;
  };
  outbox: {
    site: string;
    unpublishedCount: number;
    oldestAgeMs: number | null;
    currentGeneration: number;
    lastAppliedGeneration: number;
    behindBy: number;
  };
  recentFailures: Array<{
    id: number;
    site: string;
    createdAt: number;
    payload: Record<string, unknown>;
  }>;
  restart: {
    available: boolean;
    mechanism: "dev-spawn" | "systemd-flag" | "none";
    pathUnitDetected: boolean;
    pending: boolean;
    lastRequestedAt: string | null;
    lastRequestedBy: string | null;
    debounceMs: number;
  };
  summary: string;
};

function statFile(filePath: string): { exists: boolean; mtimeMs: number | null; sizeBytes: number | null } {
  try {
    const stat = fs.statSync(filePath);
    return { exists: true, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
  } catch {
    return { exists: false, mtimeMs: null, sizeBytes: null };
  }
}

function resolvePrimarySite(site?: string): string {
  if (site) return site;
  const first = getSiteContextMap().values().next().value as { contentRootName: string } | undefined;
  return first?.contentRootName ?? "";
}

export function deriveSidequestHealth(opts: {
  engineStatus: EngineStatusResult["status"];
  pid: number | null;
  heartbeatAgeMs: number | null;
  heartbeatExists: boolean;
  currentJob?: string;
}): SidequestDerivedHealth {
  const staleMs = getSidequestHeartbeatStaleMs();
  const pidAlive = opts.pid !== null && isProcessAlive(opts.pid);

  if (!pidAlive || opts.engineStatus === "stopped") {
    return "stopped";
  }

  if (!opts.heartbeatExists || opts.heartbeatAgeMs === null) {
    return "running_idle";
  }

  if (opts.heartbeatAgeMs > staleMs) {
    return "running_stuck";
  }

  if (opts.currentJob) {
    return "running_idle";
  }

  return "running_idle";
}

function queryQueueDb(): SidequestDiagnostics["queueDb"] {
  const base: SidequestDiagnostics["queueDb"] = {
    path: SIDEQUEST_DB_PATH,
    exists: false,
    sizeBytes: null,
    countsByState: {},
    recentFailed: [],
  };
  const stat = statFile(SIDEQUEST_DB_PATH);
  if (!stat.exists) return base;

  base.exists = true;
  base.sizeBytes = stat.sizeBytes;

  let db: Database.Database | null = null;
  try {
    db = new Database(SIDEQUEST_DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 500");
    const rows = db
      .prepare("SELECT state, COUNT(*) AS cnt FROM sidequest_jobs GROUP BY state")
      .all() as Array<{ state: string; cnt: number }>;
    for (const row of rows) {
      base.countsByState[row.state] = row.cnt;
    }
    const failed = db
      .prepare(
        `SELECT class, state, failed_at, errors FROM sidequest_jobs
         WHERE state = 'failed' ORDER BY failed_at DESC LIMIT 5`,
      )
      .all() as Array<{ class: string; state: string; failed_at: string | null; errors: string | null }>;
    base.recentFailed = failed.map((row) => ({
      class: row.class,
      state: row.state,
      failedAt: row.failed_at,
      errorsPreview: row.errors ? row.errors.slice(0, 300) : null,
    }));
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
  return base;
}

async function probeDashboard(): Promise<SidequestDiagnostics["dashboardProbe"]> {
  const enabled = isSidequestDashboardEnabled();
  if (!enabled) {
    return { probeOnly: true, enabled: false, reachable: false };
  }
  const port = getSidequestDashboardPort();
  try {
    const { user, password } = getSidequestDashboardInternalAuth();
    const auth = Buffer.from(`${user}:${password}`).toString("base64");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: controller.signal,
      });
      return { probeOnly: true, enabled: true, reachable: res.ok || res.status < 500, statusCode: res.status };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return {
      probeOnly: true,
      enabled: true,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function detectPathUnit(): Promise<boolean> {
  if (process.env.SIDEQUEST_SYSTEMD_RESTART_ENABLED === "true") return true;
  try {
    const { stdout } = await execFileAsync("systemctl", ["is-active", "website-sidequest-restart.path"], {
      timeout: 2000,
    });
    return stdout.trim() === "active";
  } catch {
    return false;
  }
}

function formatAge(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function buildSidequestSummary(d: Pick<SidequestDiagnostics, "derivedHealth" | "engine" | "outbox" | "artifacts" | "queueDb">): string {
  const parts: string[] = [];

  if (d.derivedHealth === "stopped") {
    if (!d.engine.pidFileExists) {
      parts.push("Stopped — PID file missing");
    } else {
      parts.push("Stopped — worker process not alive");
    }
  } else if (d.derivedHealth === "running_stuck") {
    parts.push("Running but heartbeat stale — worker may be stuck");
  } else {
    parts.push("Running");
  }

  if (d.outbox.unpublishedCount > 0) {
    const age = d.outbox.oldestAgeMs !== null ? ` (oldest ${formatAge(d.outbox.oldestAgeMs)})` : "";
    parts.push(`${d.outbox.unpublishedCount} event${d.outbox.unpublishedCount === 1 ? "" : "s"} waiting${age}`);
  }

  if (d.outbox.behindBy > 0) {
    parts.push(`index ${d.outbox.behindBy} generation${d.outbox.behindBy === 1 ? "" : "s"} behind`);
  }

  if (!d.artifacts.workerJs.exists || !d.artifacts.jobsJs.exists) {
    parts.push("missing dist build artifacts — run npm run build");
  }

  const pending = (d.queueDb.countsByState.pending ?? 0) + (d.queueDb.countsByState.scheduled ?? 0);
  if (pending > 0) {
    parts.push(`${pending} Sidequest job${pending === 1 ? "" : "s"} queued`);
  }

  return parts.join(". ") + (parts.length ? "." : "Sidequest engine status unknown.");
}

export async function collectSidequestDiagnostics(site?: string): Promise<SidequestDiagnostics> {
  const resolvedSite = resolvePrimarySite(site);
  const engineBase = await getEngineStatus();
  const pidStat = statFile(SIDEQUEST_PID_PATH);
  const pid = readSidequestWorkerPid();
  const hb = readSidequestHeartbeat();
  const now = Date.now();
  const heartbeatAgeMs = hb.mtimeMs !== null ? now - hb.mtimeMs : null;

  const derivedHealth = deriveSidequestHealth({
    engineStatus: engineBase.status,
    pid,
    heartbeatAgeMs,
    heartbeatExists: hb.exists,
    currentJob: hb.payload?.currentJob,
  });

  const workerPath = path.resolve("dist/sidequest-worker.js");
  const jobsPath = path.resolve("dist/sidequest.jobs.js");
  const workerStat = statFile(workerPath);
  const jobsStat = statFile(jobsPath);

  const queueDb = queryQueueDb();
  const dashboardProbe = await probeDashboard();

  const currentGeneration = resolvedSite ? getLatestWriteGeneration(resolvedSite) : 0;
  const lastApplied = resolvedSite ? getLastAppliedSnapshot(resolvedSite) : null;
  const lastAppliedGeneration = lastApplied?.generation ?? 0;

  const outbox = {
    site: resolvedSite,
    unpublishedCount: resolvedSite ? getUnpublishedCount(resolvedSite) : 0,
    oldestAgeMs: resolvedSite ? getOldestUnpublishedAgeMs(resolvedSite) : null,
    currentGeneration,
    lastAppliedGeneration,
    behindBy: Math.max(0, currentGeneration - lastAppliedGeneration),
  };

  const recentFailures: SidequestDiagnostics["recentFailures"] = [];
  for (const ctx of getSiteContextMap().values()) {
    const failures = listEvents({ site: ctx.contentRootName, type: "job_failed", limit: 5 });
    for (const ev of failures) {
      recentFailures.push({
        id: ev.id,
        site: ctx.contentRootName,
        createdAt: ev.created_at,
        payload: ev.payload as Record<string, unknown>,
      });
    }
  }
  recentFailures.sort((a, b) => b.createdAt - a.createdAt);
  recentFailures.splice(5);

  const isDev = process.env.NODE_ENV !== "production";
  const flag = readSidequestRestartFlag();
  const pathUnitDetected = isDev ? false : await detectPathUnit();
  let flagWritable = false;
  try {
    fs.accessSync(path.dirname(SIDEQUEST_RESTART_FLAG_PATH), fs.constants.W_OK);
    flagWritable = true;
  } catch {
    flagWritable = false;
  }

  const restart: SidequestDiagnostics["restart"] = {
    available: isDev ? true : flagWritable,
    mechanism: isDev ? "dev-spawn" : flagWritable ? "systemd-flag" : "none",
    pathUnitDetected,
    pending: flag.exists,
    lastRequestedAt: flag.requestedAt ?? null,
    lastRequestedBy: flag.requestedBy ?? null,
    debounceMs: SIDEQUEST_RESTART_DEBOUNCE_MS,
  };

  const engine = {
    ...engineBase,
    pidFileExists: pidStat.exists,
    pidFileMtimeMs: pidStat.mtimeMs,
  };

  const diagnostics: SidequestDiagnostics = {
    engine,
    heartbeat: {
      path: SIDEQUEST_HEARTBEAT_PATH,
      exists: hb.exists,
      ageMs: heartbeatAgeMs,
      payload: hb.payload,
    },
    derivedHealth,
    artifacts: {
      workerJs: { path: workerPath, exists: workerStat.exists, mtimeMs: workerStat.mtimeMs },
      jobsJs: { path: jobsPath, exists: jobsStat.exists, mtimeMs: jobsStat.mtimeMs },
    },
    queueDb,
    dashboardProbe,
    outbox,
    recentFailures,
    restart,
    summary: "",
  };

  diagnostics.summary = buildSidequestSummary(diagnostics);
  return diagnostics;
}

export function tailSidequestLog(maxLines: number): { lines: string[]; truncated: boolean; hint?: string } {
  const cap = Math.min(Math.max(1, maxLines), 200);
  try {
    const raw = fs.readFileSync(SIDEQUEST_LOG_PATH, "utf-8");
    const all = raw.split("\n").filter((l) => l.length > 0);
    const truncated = all.length > cap;
    return { lines: all.slice(-cap), truncated };
  } catch {
    return {
      lines: [],
      truncated: false,
      hint: "Log file not found — the Sidequest worker may never have started.",
    };
  }
}
