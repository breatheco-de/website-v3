import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import {
  buildSidequestDashboardConfig,
  clearSidequestWorkerPid,
  getEngineStatus,
  getSidequestDashboardInternalAuth,
  isSidequestDashboardEnabled,
  SIDEQUEST_DASHBOARD_BASE_PATH,
  SIDEQUEST_PID_PATH,
  writeSidequestWorkerPid,
} from "./queue";

describe("sidequest dashboard queue config", () => {
  const prev = {
    enabled: process.env.SIDEQUEST_DASHBOARD_ENABLED,
    user: process.env.SIDEQUEST_DASHBOARD_USER,
    password: process.env.SIDEQUEST_DASHBOARD_PASSWORD,
    nodeEnv: process.env.NODE_ENV,
    secret: process.env.SESSION_SECRET,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      const envKey =
        k === "enabled"
          ? "SIDEQUEST_DASHBOARD_ENABLED"
          : k === "user"
            ? "SIDEQUEST_DASHBOARD_USER"
            : k === "password"
              ? "SIDEQUEST_DASHBOARD_PASSWORD"
              : k === "nodeEnv"
                ? "NODE_ENV"
                : "SESSION_SECRET";
      if (v === undefined) delete process.env[envKey];
      else process.env[envKey] = v;
    }
    clearSidequestWorkerPid();
    vi.restoreAllMocks();
  });

  it("defaults dashboard enabled and returns same-origin path", async () => {
    delete process.env.SIDEQUEST_DASHBOARD_ENABLED;
    expect(isSidequestDashboardEnabled()).toBe(true);
    expect((await getEngineStatus()).dashboardUrl).toBe(`${SIDEQUEST_DASHBOARD_BASE_PATH}/`);
  });

  it("respects SIDEQUEST_DASHBOARD_ENABLED=false", async () => {
    process.env.SIDEQUEST_DASHBOARD_ENABLED = "false";
    expect(isSidequestDashboardEnabled()).toBe(false);
    expect((await getEngineStatus()).dashboardUrl).toBeUndefined();
  });

  it("uses env credentials when set", () => {
    process.env.SIDEQUEST_DASHBOARD_USER = "proxy-user";
    process.env.SIDEQUEST_DASHBOARD_PASSWORD = "proxy-pass";
    expect(getSidequestDashboardInternalAuth()).toEqual({
      user: "proxy-user",
      password: "proxy-pass",
    });
  });

  it("derives dev credentials when unset outside production", () => {
    delete process.env.SIDEQUEST_DASHBOARD_USER;
    delete process.env.SIDEQUEST_DASHBOARD_PASSWORD;
    process.env.NODE_ENV = "development";
    process.env.SESSION_SECRET = "unit-test-secret";
    const auth = getSidequestDashboardInternalAuth();
    expect(auth.user).toBe("sidequest-proxy");
    expect(auth.password.length).toBeGreaterThan(8);
  });

  it("buildSidequestDashboardConfig sets basePath and auth when enabled", () => {
    delete process.env.SIDEQUEST_DASHBOARD_ENABLED;
    process.env.SIDEQUEST_DASHBOARD_USER = "proxy-user";
    process.env.SIDEQUEST_DASHBOARD_PASSWORD = "proxy-pass";
    const cfg = buildSidequestDashboardConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.basePath).toBe(SIDEQUEST_DASHBOARD_BASE_PATH);
    expect(cfg.auth).toEqual({ user: "proxy-user", password: "proxy-pass" });
  });

  it("buildSidequestDashboardConfig omits basePath/auth when disabled", () => {
    process.env.SIDEQUEST_DASHBOARD_ENABLED = "false";
    const cfg = buildSidequestDashboardConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.basePath).toBeUndefined();
    expect(cfg.auth).toBeUndefined();
  });

  it("getEngineStatus reports running when pid file points at a live process", async () => {
    writeSidequestWorkerPid(process.pid);
    const status = await getEngineStatus();
    expect(status.status).toBe("running");
    expect(status.pid).toBe(process.pid);
  });

  it("getEngineStatus reports stopped when pid file is missing", async () => {
    clearSidequestWorkerPid();
    const status = await getEngineStatus();
    expect(status.status).toBe("stopped");
    expect(status.pid).toBeUndefined();
  });

  it("getEngineStatus reports stopped when pid file points at a dead process", async () => {
    fs.writeFileSync(SIDEQUEST_PID_PATH, "999999999\n", "utf-8");
    const status = await getEngineStatus();
    expect(status.status).toBe("stopped");
  });
});
