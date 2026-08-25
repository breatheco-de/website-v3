import { describe, it, expect, afterEach } from "vitest";
import {
  getEngineStatus,
  getSidequestDashboardInternalAuth,
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
  });

  it("defaults dashboard enabled and returns same-origin path", () => {
    delete process.env.SIDEQUEST_DASHBOARD_ENABLED;
    expect(isSidequestDashboardEnabled()).toBe(true);
    expect(getEngineStatus().dashboardUrl).toBe(SIDEQUEST_DASHBOARD_BASE_PATH);
  });

  it("respects SIDEQUEST_DASHBOARD_ENABLED=false", () => {
    process.env.SIDEQUEST_DASHBOARD_ENABLED = "false";
    expect(isSidequestDashboardEnabled()).toBe(false);
    expect(getEngineStatus().dashboardUrl).toBeUndefined();
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
});
