import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  buildSidequestDashboardConfig,
  getEngineStatus,
  getSidequestDashboardInternalAuth,
  getWorkerHealthPort,
  isSidequestDashboardEnabled,
  SIDEQUEST_DASHBOARD_BASE_PATH,
} from "./queue";

describe("sidequest dashboard queue config", () => {
  const prev = {
    enabled: process.env.SIDEQUEST_DASHBOARD_ENABLED,
    user: process.env.SIDEQUEST_DASHBOARD_USER,
    password: process.env.SIDEQUEST_DASHBOARD_PASSWORD,
    nodeEnv: process.env.NODE_ENV,
    secret: process.env.SESSION_SECRET,
    healthPort: process.env.SIDEQUEST_WORKER_HEALTH_PORT,
    confirmDelay: process.env.SIDEQUEST_HEALTH_CONFIRM_DELAY_MS,
  };

  beforeEach(() => {
    // Avoid 1.5s confirm wait when tests only care about dashboard config / status shape.
    process.env.SIDEQUEST_HEALTH_CONFIRM_DELAY_MS = "0";
  });

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
                : k === "healthPort"
                  ? "SIDEQUEST_WORKER_HEALTH_PORT"
                  : k === "confirmDelay"
                    ? "SIDEQUEST_HEALTH_CONFIRM_DELAY_MS"
                    : "SESSION_SECRET";
      if (v === undefined) delete process.env[envKey];
      else process.env[envKey] = v;
    }
    vi.unstubAllGlobals();
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

  it("defaults worker health port to 8679", () => {
    delete process.env.SIDEQUEST_WORKER_HEALTH_PORT;
    expect(getWorkerHealthPort()).toBe(8679);
  });

  it("getEngineStatus reports running when worker /health returns 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const status = await getEngineStatus();
    expect(status.status).toBe("running");
    expect(status.restartAttempts).toBe(0);
  });

  it("getEngineStatus reports stopped only after a confirmed failed probe", async () => {
    process.env.SIDEQUEST_HEALTH_CONFIRM_DELAY_MS = "0";
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);
    const status = await getEngineStatus();
    expect(status.status).toBe("stopped");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("getEngineStatus recovers to running if the confirm probe succeeds", async () => {
    process.env.SIDEQUEST_HEALTH_CONFIRM_DELAY_MS = "0";
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const status = await getEngineStatus();
    expect(status.status).toBe("running");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
