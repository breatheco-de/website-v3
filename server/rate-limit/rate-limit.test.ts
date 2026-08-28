import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response } from "express";
import { MemoryRateLimitStore } from "./memory-store.js";
import { rateLimitIdentityKey, bucketKey } from "./keys.js";
import {
  checkRateLimit,
  recordRateLimitSuccess,
  createRateLimitMiddleware,
  markRateLimitNoCharge,
  markRateLimitSuccess,
  sendRateLimitResponse,
} from "./limiter.js";
import { devLimitMultiplier, effectiveLimits } from "./policies.js";
import { api } from "./api.js";
import express from "express";

function mockReq(overrides: Partial<Request> & { headers?: Record<string, string> } = {}): Request {
  return {
    ip: "203.0.113.1",
    headers: {},
    socket: { remoteAddress: "203.0.113.1" },
    ...overrides,
  } as Request;
}

function mockRes(): Response & { statusCode: number; body?: unknown } {
  const res = {
    locals: {},
    statusCode: 200,
    body: undefined as unknown,
    setHeader: vi.fn(),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    end: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      if (event === "finish") {
        (res as { _finish?: () => void })._finish = cb;
      }
    }),
  } as Response & { statusCode: number; body?: unknown; _finish?: () => void };
  return res;
}

function emitFinish(res: ReturnType<typeof mockRes>): void {
  res._finish?.();
}

describe("MemoryRateLimitStore", () => {
  let store: MemoryRateLimitStore;

  beforeEach(() => {
    store = new MemoryRateLimitStore({ pruneIntervalMs: 60_000 });
  });

  afterEach(() => {
    store.destroy();
  });

  it("increments and reads count within window", () => {
    expect(store.getCount("k1")).toBe(0);
    expect(store.increment("k1", 60_000)).toBe(1);
    expect(store.getCount("k1")).toBe(1);
    expect(store.increment("k1", 60_000)).toBe(2);
  });

  it("expires buckets after window", () => {
    vi.useFakeTimers();
    store.increment("k1", 1000);
    expect(store.getCount("k1")).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(store.getCount("k1")).toBe(0);
    vi.useRealTimers();
  });
});

describe("rateLimitIdentityKey", () => {
  const prevSecret = process.env.MCP_SERVER_SECRET;

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.MCP_SERVER_SECRET;
    else process.env.MCP_SERVER_SECRET = prevSecret;
  });

  it("prefers x-mcp-author", () => {
    const key = rateLimitIdentityKey(
      mockReq({ headers: { "x-mcp-author": "agent@example.com" } }),
    );
    expect(key).toBe("user:agent@example.com");
  });

  it("uses mcp:anonymous for loopback without author", () => {
    process.env.MCP_SERVER_SECRET = "test-secret";
    const key = rateLimitIdentityKey(
      mockReq({ headers: { authorization: "Bearer test-secret" } }),
    );
    expect(key).toBe("mcp:anonymous");
  });

  it("falls back to ip", () => {
    delete process.env.MCP_SERVER_SECRET;
    const key = rateLimitIdentityKey(mockReq());
    expect(key).toBe("ip:203.0.113.1");
  });
});

describe("checkRateLimit and recordRateLimitSuccess", () => {
  let store: MemoryRateLimitStore;
  const prevEnv = process.env.NODE_ENV;

  beforeEach(() => {
    store = new MemoryRateLimitStore({ pruneIntervalMs: 60_000 });
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    store.destroy();
    process.env.NODE_ENV = prevEnv;
  });

  it("allows under limit and blocks after success increments", () => {
    const req = mockReq({ headers: { "x-mcp-author": "u1" } });
    const policyId = "expensiveAi" as const;
    const hourWindow = effectiveLimits(policyId).find((w) => w.windowMs === 3_600_000)!;

    expect(checkRateLimit(policyId, req, store).ok).toBe(true);
    for (let i = 0; i < hourWindow.effectiveLimit; i++) {
      recordRateLimitSuccess(policyId, req, store);
    }
    const blocked = checkRateLimit(policyId, req, store);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.policy).toBe("expensiveAi");
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it("applies 10x multiplier in non-production", () => {
    process.env.NODE_ENV = "development";
    expect(devLimitMultiplier()).toBe(10);
    const limits = effectiveLimits("expensiveAi");
    const hour = limits.find((w) => w.windowMs === 3_600_000 && w.scope === "identity");
    expect(hour?.effectiveLimit).toBe(100);
  });
});

describe("createRateLimitMiddleware post-success counting", () => {
  it("does not increment on non-2xx", () => {
    const store = new MemoryRateLimitStore();
    const mw = createRateLimitMiddleware("auth", store);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    res.status(503).json({ error: "fail" });
    emitFinish(res);
    expect(store.getCount(bucketKey("auth", "identity", "ip:203.0.113.1", 15 * 60 * 1000))).toBe(
      0,
    );
    store.destroy();
  });

  it("increments on 2xx finish", () => {
    const store = new MemoryRateLimitStore();
    process.env.NODE_ENV = "production";
    const mw = createRateLimitMiddleware("auth", store);
    const req = mockReq({ headers: { "x-mcp-author": "counter-test" } });
    const res = mockRes();
    const next = vi.fn();
    mw(req, res, next);
    res.status(200).json({ ok: true });
    emitFinish(res);
    expect(
      store.getCount(bucketKey("auth", "identity", "user:counter-test", 15 * 60 * 1000)),
    ).toBe(1);
    store.destroy();
  });

  it("respects markRateLimitNoCharge on 200", () => {
    const store = new MemoryRateLimitStore();
    const mw = createRateLimitMiddleware("auth", store);
    const req = mockReq();
    const res = mockRes();
    mw(req, res, vi.fn());
    markRateLimitNoCharge(res);
    res.status(200).json({ streamed: true });
    emitFinish(res);
    expect(store.getCount(bucketKey("auth", "identity", "ip:203.0.113.1", 15 * 60 * 1000))).toBe(
      0,
    );
    store.destroy();
  });

  it("returns 429 when pre-check fails", () => {
    const store = new MemoryRateLimitStore();
    process.env.NODE_ENV = "production";
    const req = mockReq({ headers: { "x-mcp-author": "blocked" } });
    for (let i = 0; i < 20; i++) {
      recordRateLimitSuccess("auth", req, store);
    }
    const res = mockRes();
    const next = vi.fn();
    createRateLimitMiddleware("auth", store)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect((res.body as { code?: string }).code).toBe("rate_limited");
    store.destroy();
  });
});

describe("sendRateLimitResponse", () => {
  it("sets Retry-After header", () => {
    const res = mockRes();
    sendRateLimitResponse(res, {
      ok: false,
      policy: "expensiveAi",
      scope: "identity",
      retryAfterSec: 42,
      limit: 10,
      windowMs: 3600000,
    });
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "42");
    expect(res.statusCode).toBe(429);
  });
});

describe("api wrapper", () => {
  it("exempt requires reason at registration", () => {
    const app = express();
    expect(() =>
      api.get(app, "/x", { rate: "exempt", reason: "" }, (_req, res) => res.end()),
    ).toThrow(/reason/);
  });

  it("registers exempt route without limiter", () => {
    const app = express();
    let called = false;
    api.get(app, "/health", { rate: "exempt", reason: "health" }, (_req, res) => {
      called = true;
      res.end();
    });
    expect(called).toBe(false);
    expect(app._router).toBeDefined();
  });
});

describe("markRateLimitSuccess flag", () => {
  it("sets res.locals flag", () => {
    const res = mockRes();
    markRateLimitSuccess(res);
    expect(res.locals.rateLimitCountSuccess).toBe(true);
  });
});
