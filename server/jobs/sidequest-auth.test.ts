import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../staff-session-resolve", () => ({
  resolveOwnedStaffSession: vi.fn(),
}));

vi.mock("../user-store", () => ({
  hasCapability: vi.fn(),
}));

import { resolveOwnedStaffSession } from "../staff-session-resolve";
import * as userStore from "../user-store";
import { requireWorkerManage } from "./sidequest-auth";

function mockRes(): Response {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response;
}

function session(username: string) {
  return {
    token: "abc",
    username,
    staffId: null,
    roles: ["platform_ops"],
    expiresAt: Date.now() + 60_000,
  };
}

describe("requireWorkerManage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "production");
  });

  it("returns 401 when the staff session is missing", async () => {
    vi.mocked(resolveOwnedStaffSession).mockResolvedValue(null);

    const req = { headers: { authorization: "Token abc" } } as Request;
    const res = mockRes();
    const result = await requireWorkerManage(req, res);
    expect(result.authorized).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Your session has expired. Please log in again." });
    expect(userStore.hasCapability).not.toHaveBeenCalled();
  });

  it("returns 403 when user lacks worker_manage", async () => {
    vi.mocked(resolveOwnedStaffSession).mockResolvedValue(session("editor"));
    vi.mocked(userStore.hasCapability).mockReturnValue(false);

    const req = { headers: { authorization: "Token abc" } } as Request;
    const res = mockRes();
    const result = await requireWorkerManage(req, res);
    expect(result.authorized).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(userStore.hasCapability).toHaveBeenCalledWith("editor", "worker_manage");
  });

  it("allows worker_manage in production", async () => {
    vi.mocked(resolveOwnedStaffSession).mockResolvedValue(session("ops"));
    vi.mocked(userStore.hasCapability).mockReturnValue(true);

    const req = { headers: { authorization: "Token abc" } } as Request;
    const res = mockRes();
    const result = await requireWorkerManage(req, res);
    expect(result.authorized).toBe(true);
    expect(result.username).toBe("ops");
  });
});
