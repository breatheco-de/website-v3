import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  buildSidequestSummary,
  deriveSidequestHealth,
} from "./sidequest-diagnostics";
import {
  clearSidequestHeartbeat,
  clearSidequestWorkerPid,
  SIDEQUEST_HEARTBEAT_PATH,
  SIDEQUEST_PID_PATH,
  writeSidequestHeartbeat,
  writeSidequestWorkerPid,
} from "./queue";

describe("sidequest-diagnostics", () => {
  afterEach(() => {
    clearSidequestWorkerPid();
    clearSidequestHeartbeat();
    vi.restoreAllMocks();
  });

  it("deriveSidequestHealth returns stopped when pid is dead", () => {
    expect(
      deriveSidequestHealth({
        engineStatus: "stopped",
        pid: 999_999_999,
        heartbeatAgeMs: null,
        heartbeatExists: false,
      }),
    ).toBe("stopped");
  });

  it("deriveSidequestHealth returns running_stuck when heartbeat is stale", () => {
    expect(
      deriveSidequestHealth({
        engineStatus: "running",
        pid: process.pid,
        heartbeatAgeMs: 300_000,
        heartbeatExists: true,
      }),
    ).toBe("running_stuck");
  });

  it("deriveSidequestHealth returns running_idle when heartbeat is fresh", () => {
    expect(
      deriveSidequestHealth({
        engineStatus: "running",
        pid: process.pid,
        heartbeatAgeMs: 5_000,
        heartbeatExists: true,
      }),
    ).toBe("running_idle");
  });

  it("buildSidequestSummary includes waiting events", () => {
    const summary = buildSidequestSummary({
      derivedHealth: "stopped",
      engine: { status: "stopped", restartAttempts: 0, pidFileExists: false, pidFileMtimeMs: null },
      outbox: {
        site: "site_test",
        unpublishedCount: 3,
        oldestAgeMs: 120_000,
        currentGeneration: 10,
        lastAppliedGeneration: 7,
        behindBy: 3,
      },
      artifacts: {
        workerJs: { path: "dist/sidequest-worker.js", exists: true, mtimeMs: 1 },
        jobsJs: { path: "dist/sidequest.jobs.js", exists: true, mtimeMs: 1 },
      },
      queueDb: { path: "", exists: true, sizeBytes: 1, countsByState: {}, recentFailed: [] },
    });
    expect(summary).toContain("Stopped");
    expect(summary).toContain("3 events waiting");
    expect(summary).toContain("3 generations behind");
  });

  it("readSidequestHeartbeat round-trips payload", () => {
    writeSidequestHeartbeat({ pid: process.pid, startedAt: "2026-01-01T00:00:00.000Z", currentJob: "index_refresh" });
    const hb = fs.readFileSync(SIDEQUEST_HEARTBEAT_PATH, "utf-8");
    expect(hb).toContain("index_refresh");
    writeSidequestHeartbeat({ pid: process.pid, currentJob: undefined });
    const cleared = JSON.parse(fs.readFileSync(SIDEQUEST_HEARTBEAT_PATH, "utf-8"));
    expect(cleared.currentJob).toBeUndefined();
  });

  it("getEngineStatus reports stopped for dead pid file", async () => {
    fs.writeFileSync(SIDEQUEST_PID_PATH, "999999999\n", "utf-8");
    const { getEngineStatus } = await import("./queue");
    const status = await getEngineStatus();
    expect(status.status).toBe("stopped");
  });
});

describe("sidequest-restart debounce", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sq-restart-"));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requestSidequestRestart returns 429 when flag is recent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { writeSidequestRestartFlag, readSidequestRestartFlag, SIDEQUEST_RESTART_FLAG_PATH } = await import("./queue");
    const orig = SIDEQUEST_RESTART_FLAG_PATH;
    // Use direct write via queue export
    writeSidequestRestartFlag("tester");
    const flag = readSidequestRestartFlag();
    expect(flag.exists).toBe(true);

    const { requestSidequestRestart } = await import("./sidequest-restart");
    const result = await requestSidequestRestart("tester2");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(429);

    void tmpDir;
    void orig;
  });
});
