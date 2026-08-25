import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";
import {
  mintSidequestDashCookie,
  parseSidequestDashCookie,
  refreshSidequestDashCookie,
  verifySidequestDashCookie,
  SIDEQUEST_DASH_COOKIE_NAME,
  SIDEQUEST_DASH_COOKIE_PATH,
} from "./sidequest-dashboard-auth";

function mockRes() {
  const cookies: Array<{ name: string; value: string; opts?: Record<string, unknown> }> = [];
  const res = {
    cookie: (name: string, value: string, opts?: Record<string, unknown>) => {
      cookies.push({ name, value, opts });
    },
    clearCookie: () => {},
  } as unknown as Response;
  return { res, cookies };
}

describe("sidequest-dashboard-auth", () => {
  const prevSecret = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret-for-sidequest-dash";
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prevSecret;
  });

  it("mints a verifiable cookie with path /admin/sidequest", () => {
    const { res, cookies } = mockRes();
    mintSidequestDashCookie(res, { username: "alice", ttlSec: 600 });
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe(SIDEQUEST_DASH_COOKIE_NAME);
    expect(cookies[0].opts?.path).toBe(SIDEQUEST_DASH_COOKIE_PATH);
    expect(cookies[0].opts?.httpOnly).toBe(true);

    const parsed = parseSidequestDashCookie(cookies[0].value);
    expect(parsed?.username).toBe("alice");
    expect(parsed?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects tampered and expired cookies", () => {
    const { res, cookies } = mockRes();
    mintSidequestDashCookie(res, { username: "bob", ttlSec: 600 });
    const raw = cookies[0].value;
    expect(parseSidequestDashCookie(raw + "x")).toBeNull();
    expect(parseSidequestDashCookie(undefined)).toBeNull();

    const expired = `${Math.floor(Date.now() / 1000) - 10}|bob|deadbeef`;
    expect(parseSidequestDashCookie(expired)).toBeNull();
  });

  it("verifySidequestDashCookie reads req.cookies", () => {
    const { res, cookies } = mockRes();
    mintSidequestDashCookie(res, { username: "carol" });
    const req = {
      cookies: { [SIDEQUEST_DASH_COOKIE_NAME]: cookies[0].value },
    } as unknown as Request;
    const result = verifySidequestDashCookie(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.username).toBe("carol");
  });

  it("refreshSidequestDashCookie slides expiry forward", () => {
    const { res, cookies } = mockRes();
    const first = mintSidequestDashCookie(res, { username: "dave", ttlSec: 60 });
    const second = refreshSidequestDashCookie(res, first, 600);
    expect(second.exp).toBeGreaterThan(first.exp);
    expect(cookies).toHaveLength(2);
    expect(parseSidequestDashCookie(cookies[1].value)?.username).toBe("dave");
  });
});
