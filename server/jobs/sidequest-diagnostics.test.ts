import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
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

describe("sidequest-restart", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    clearSidequestWorkerPid();
  });

  it("requestSidequestRestart returns 429 when flag is recent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { writeSidequestRestartFlag, readSidequestRestartFlag } = await import("./queue");
    writeSidequestRestartFlag("tester");
    const flag = readSidequestRestartFlag();
    expect(flag.exists).toBe(true);

    const { requestSidequestRestart } = await import("./sidequest-restart");
    const result = await requestSidequestRestart("tester2");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(429);
  });

  it("requestSidequestRestart prod returns 409 when no live PID", async () => {
    vi.stubEnv("NODE_ENV", "production");
    clearSidequestWorkerPid();
    // Clear any leftover flag from prior tests so debounce does not 429
    const { clearSidequestRestartFlag } = await import("./queue");
    clearSidequestRestartFlag();
    const { requestSidequestRestart } = await import("./sidequest-restart");
    const result = await requestSidequestRestart("tester");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/not running/i);
    }
  });

  it("requestSidequestRestart prod signals live PID", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
    const { clearSidequestRestartFlag } = await import("./queue");
    clearSidequestRestartFlag();
    writeSidequestWorkerPid(process.pid);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((
      _pid: number,
      signal?: NodeJS.Signals | number,
    ) => {
      if (signal === 0) return true;
      return true;
    }) as typeof process.kill);

    try {
      const { requestSidequestRestart } = await import("./sidequest-restart");
      const result = await requestSidequestRestart("tester");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.mechanism).toBe("supervisor-signal");
      }
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
      // Advance past SIGKILL backup timer while kill is still mocked
      await vi.advanceTimersByTimeAsync(31_000);
    } finally {
      killSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("resolveForeignSidequestPidConflict", () => {
  afterEach(() => {
    clearSidequestWorkerPid();
    vi.restoreAllMocks();
  });

  it("ignores stale dead PID", async () => {
    fs.writeFileSync(SIDEQUEST_PID_PATH, "999999999\n", "utf-8");
    const { resolveForeignSidequestPidConflict } = await import("./queue");
    await expect(resolveForeignSidequestPidConflict()).resolves.toBe("none");
  });

  it("refuses when live PID is not sidequest", async () => {
    const { spawn } = await import("child_process");
    const child = spawn("sleep", ["60"], { stdio: "ignore", detached: true });
    child.unref();
    const foreignPid = child.pid;
    expect(foreignPid).toBeTypeOf("number");
    try {
      writeSidequestWorkerPid(foreignPid!);
      const { resolveForeignSidequestPidConflict } = await import("./queue");
      await expect(resolveForeignSidequestPidConflict()).rejects.toThrow(/Refusing to start/);
    } finally {
      try {
        process.kill(foreignPid!, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });
});
