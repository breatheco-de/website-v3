import { describe, expect, it } from "vitest";
import type { Response } from "express";
import { applyServerTiming, markTiming, serverTimingHeader, startServerTiming } from "./server-timing";

function fakeRes(): Response & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    locals: {},
    headersSent: false,
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
  } as unknown as Response & { headers: Record<string, string> };
}

describe("server timing", () => {
  it("records each step since the previous mark, plus total", () => {
    const res = fakeRes();
    startServerTiming(res, 100);
    markTiming(res, "pre", 112.34);
    markTiming(res, "lookup", 115);
    expect(serverTimingHeader(res, 120)).toBe("pre;dur=12.3, lookup;dur=2.7, total;dur=20.0");
  });

  it("does nothing when timing was not started", () => {
    const res = fakeRes();
    markTiming(res, "pre");
    expect(serverTimingHeader(res)).toBeNull();
    applyServerTiming(res);
    expect(res.headers["Server-Timing"]).toBeUndefined();
  });

  it("sets the header once timing has started", () => {
    const res = fakeRes();
    startServerTiming(res);
    markTiming(res, "render");
    applyServerTiming(res);
    expect(res.headers["Server-Timing"]).toMatch(/^render;dur=\d+\.\d, total;dur=\d+\.\d$/);
  });
});
