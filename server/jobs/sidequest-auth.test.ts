import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../user-manager", () => ({
  validateToken: vi.fn(),
}));

vi.mock("../user-store", () => ({
  hasCapability: vi.fn(),
}));

import * as userManager from "../user-manager";
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

describe("requireWorkerManage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "production");
  });

  it("returns 403 when user lacks worker_manage", async () => {
    vi.mocked(userManager.validateToken).mockResolvedValue({
      valid: true,
      username: "editor",
      email: "editor@test.com",
    });
    vi.mocked(userStore.hasCapability).mockReturnValue(false);

    const req = { headers: { authorization: "Token abc" } } as Request;
    const res = mockRes();
    const result = await requireWorkerManage(req, res);
    expect(result.authorized).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(userStore.hasCapability).toHaveBeenCalledWith("editor", "worker_manage");
  });

  it("allows worker_manage in production", async () => {
    vi.mocked(userManager.validateToken).mockResolvedValue({
      valid: true,
      username: "ops",
      email: "ops@test.com",
    });
    vi.mocked(userStore.hasCapability).mockReturnValue(true);

    const req = { headers: { authorization: "Token abc" } } as Request;
    const res = mockRes();
    const result = await requireWorkerManage(req, res);
    expect(result.authorized).toBe(true);
    expect(result.username).toBe("ops");
  });
});
