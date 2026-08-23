import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { resolveEventActor } from "./_helpers";

function mockReq(headers: Record<string, string>, authorization?: string): Request {
  return {
    headers: {
      ...headers,
      ...(authorization ? { authorization } : {}),
    },
  } as Request;
}

describe("resolveEventActor", () => {
  it("returns ui for browser requests even with spoofed MCP headers", () => {
    const req = mockReq({
      "x-mcp-client": "Cursor",
      "x-mcp-author": "agent@example.com",
    });
    expect(resolveEventActor(req)).toEqual({ type: "ui" });
  });

  it("returns mcp actor on loopback bearer secret", () => {
    const secret = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "test-mcp-secret";
    process.env.MCP_SERVER_SECRET = secret;
    const req = mockReq({ "x-mcp-client": "Cursor" }, `Bearer ${secret}`);
    expect(resolveEventActor(req)).toEqual({ type: "mcp", client: "Cursor" });
  });
});
