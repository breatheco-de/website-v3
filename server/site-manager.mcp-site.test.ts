import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
  resetSiteContextMap,
  restoreSiteContextMap,
  siteResolutionMiddleware,
  type SiteContext,
} from "./site-manager";

const SECRET = "test-mcp-site-secret";

function fakeSite(domain: string, contentFolder: string): SiteContext {
  return {
    config: { domain, contentFolder },
    contentRootName: contentFolder,
    contentRoot: `/tmp/${contentFolder}`,
  } as SiteContext;
}

function mockReq(opts: {
  hostname?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  authorization?: string;
}): Request {
  return {
    hostname: opts.hostname ?? "127.0.0.1",
    headers: {
      ...(opts.headers ?? {}),
      ...(opts.authorization ? { authorization: opts.authorization } : {}),
    },
    query: opts.query ?? {},
    protocol: "http",
    originalUrl: "/",
  } as unknown as Request;
}

function mockRes(): Response & { body?: unknown; statusCode?: number } {
  const res: Response & { body?: unknown; statusCode?: number; locals: Record<string, unknown> } = {
    locals: {},
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    redirect() {
      return this;
    },
  } as unknown as Response & { body?: unknown; statusCode?: number };
  return res;
}

describe("siteResolutionMiddleware: x-mcp-site", () => {
  const primary = fakeSite("4geeks.com", "site_4geeks-com");
  const florida = fakeSite("fl.4geeksacademy.com", "site_4geeks-florida");
  let prevSecret: string | undefined;

  beforeEach(() => {
    prevSecret = process.env.MCP_SERVER_SECRET;
    process.env.MCP_SERVER_SECRET = SECRET;
    delete process.env.MCP_API_KEY;
    restoreSiteContextMap({
      map: new Map([
        ["4geeks.com", primary],
        ["fl.4geeksacademy.com", florida],
      ]),
      defaultSite: primary,
    });
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.MCP_SERVER_SECRET;
    else process.env.MCP_SERVER_SECRET = prevSecret;
    resetSiteContextMap();
    vi.unstubAllEnvs();
  });

  it("uses x-mcp-site on trusted MCP loopback", () => {
    const req = mockReq({
      authorization: `Bearer ${SECRET}`,
      headers: { "x-mcp-site": "fl.4geeksacademy.com" },
    });
    const res = mockRes();
    const next = vi.fn();
    siteResolutionMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.locals.site.config.domain).toBe("fl.4geeksacademy.com");
    expect(res.locals.site.contentRootName).toBe("site_4geeks-florida");
  });

  it("matches x-mcp-site case-insensitively", () => {
    const req = mockReq({
      authorization: `Bearer ${SECRET}`,
      headers: { "x-mcp-site": "FL.4GeeksAcademy.com" },
    });
    const res = mockRes();
    siteResolutionMiddleware(req, res, vi.fn());
    expect(res.locals.site.config.domain).toBe("fl.4geeksacademy.com");
  });

  it("falls through when MCP loopback omits x-mcp-site (multi-site)", () => {
    const req = mockReq({ authorization: `Bearer ${SECRET}`, hostname: "127.0.0.1" });
    const res = mockRes();
    const next = vi.fn();
    siteResolutionMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(res.locals.site.config.domain).toBe("4geeks.com");
  });

  it("returns 400 for unknown x-mcp-site on trusted loopback", () => {
    const req = mockReq({
      authorization: `Bearer ${SECRET}`,
      headers: { "x-mcp-site": "not-a-real-site.test" },
    });
    const res = mockRes();
    const next = vi.fn();
    siteResolutionMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: "unknown_site" });
  });

  it("ignores spoofed x-mcp-site without the MCP secret", () => {
    const req = mockReq({
      hostname: "4geeks.com",
      headers: { "x-mcp-site": "fl.4geeksacademy.com" },
    });
    const res = mockRes();
    siteResolutionMiddleware(req, res, vi.fn());
    expect(res.locals.site.config.domain).toBe("4geeks.com");
  });

  it("honors ?__site= in non-production without MCP secret", () => {
    vi.stubEnv("NODE_ENV", "development");
    const req = mockReq({
      hostname: "127.0.0.1",
      query: { __site: "fl.4geeksacademy.com" },
    });
    const res = mockRes();
    siteResolutionMiddleware(req, res, vi.fn());
    expect(res.locals.site.config.domain).toBe("fl.4geeksacademy.com");
    expect(res.locals.site.isDevOverride).toBe(true);
  });

  it("ignores ?__site= in production without MCP secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    const req = mockReq({
      hostname: "4geeks.com",
      query: { __site: "fl.4geeksacademy.com" },
    });
    const res = mockRes();
    siteResolutionMiddleware(req, res, vi.fn());
    expect(res.locals.site.config.domain).toBe("4geeks.com");
  });

  it("prefers x-mcp-site over ?__site= on trusted loopback in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const req = mockReq({
      authorization: `Bearer ${SECRET}`,
      headers: { "x-mcp-site": "fl.4geeksacademy.com" },
      query: { __site: "4geeks.com" },
    });
    const res = mockRes();
    siteResolutionMiddleware(req, res, vi.fn());
    expect(res.locals.site.config.domain).toBe("fl.4geeksacademy.com");
  });
});
