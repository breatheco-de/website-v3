import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  shouldHardDenyLlmCrawler: vi.fn((_ua?: string | null, _root?: string) => false),
}));

vi.mock("./settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./settings")>();
  return {
    ...actual,
    shouldHardDenyLlmCrawler: mocks.shouldHardDenyLlmCrawler,
  };
});

import { isSeoControlPath, maybeHardDenyLlmRequest } from "./crawl-control";
import { isLlmHtmlAudience } from "../shared/runtime-issues";

describe("maybeHardDenyLlmRequest", () => {
  beforeEach(() => {
    mocks.shouldHardDenyLlmCrawler.mockReset();
    mocks.shouldHardDenyLlmCrawler.mockReturnValue(false);
  });

  function fakeRes() {
    const headers: Record<string, string> = {};
    let statusCode = 200;
    let body: unknown;
    const res = {
      status(code: number) {
        statusCode = code;
        return res;
      },
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      send(payload: unknown) {
        body = payload;
      },
      get statusCode() {
        return statusCode;
      },
      get body() {
        return body;
      },
      get headers() {
        return headers;
      },
    };
    return res as unknown as Response & { statusCode: number; body: unknown; headers: Record<string, string> };
  }

  function fakeReq(path: string, ua?: string): Request {
    return {
      path,
      url: path,
      get: (name: string) => (name.toLowerCase() === "user-agent" ? ua : undefined),
    } as unknown as Request;
  }

  it("never denies /robots.txt even when LLM deny is on", () => {
    mocks.shouldHardDenyLlmCrawler.mockReturnValue(true);
    const res = fakeRes();
    expect(maybeHardDenyLlmRequest(fakeReq("/robots.txt", "GPTBot/1.0"), res)).toBe(false);
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 for LLM UA when deny is on", () => {
    mocks.shouldHardDenyLlmCrawler.mockReturnValue(true);
    const res = fakeRes();
    expect(maybeHardDenyLlmRequest(fakeReq("/us/blog", "GPTBot/1.0"), res)).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
    expect(res.body).toBe("Forbidden");
  });

  it("does not deny when shouldHardDenyLlmCrawler is false", () => {
    mocks.shouldHardDenyLlmCrawler.mockReturnValue(false);
    const res = fakeRes();
    expect(maybeHardDenyLlmRequest(fakeReq("/us/blog", "GPTBot/1.0"), res)).toBe(false);
  });
});

describe("isLlmHtmlAudience (detector used by hard deny)", () => {
  it("tags GPTBot as LLM and Googlebot as not", () => {
    expect(isLlmHtmlAudience("GPTBot/1.0")).toBe(true);
    expect(isLlmHtmlAudience("Mozilla/5.0 compatible; Googlebot/2.1")).toBe(false);
  });
});

describe("isSeoControlPath", () => {
  it("recognizes control files", () => {
    expect(isSeoControlPath("/robots.txt")).toBe(true);
    expect(isSeoControlPath("/sitemap.xml?x=1")).toBe(true);
  });
});
