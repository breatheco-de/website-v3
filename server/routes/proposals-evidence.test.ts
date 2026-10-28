import http from "http";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { calls } = vi.hoisted(() => ({ calls: [] as Array<{ id: string; name: string; reason: string; by: string | null }> }));

vi.mock("./_helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_helpers")>();
  const allow = { authorized: true, token: "t", username: "alice", author: "alice" };
  return { ...actual, requireAnyCapability: async () => allow };
});

vi.mock("../content-proposals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../content-proposals")>();
  return {
    ...actual,
    proposalServiceForSite: () => ({
      dismissEvidenceName: (id: string, input: { name: string; reason: string; by: string | null }) => {
        calls.push({ id, ...input });
        return input.reason.trim().length < 10
          ? { ok: false, status: 400, code: "reason_required", error: "Give a reason" }
          : { ok: true, dismissals: [{ ...input, at: 1 }] };
      },
      get: () => null,
      classifyLive: async () => null,
    }),
  };
});

import { registerProposalRoutes } from "./proposals";

let server: http.Server | null = null;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.site = { contentRoot: "/tmp/x", contentRootName: "site_x", config: { domain: "x.local" } } as any;
    next();
  });
  registerProposalRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

beforeEach(() => {
  calls.length = 0;
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}/api/admin/proposals/p-1/evidence-dismissals`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("evidence dismissal route", () => {
  it("refuses agents (MCP)", async () => {
    const res = await post({ name: "MIT", reason: "Example employer only" }, { "x-mcp-author": "mcp" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("staff_only");
    expect(calls).toHaveLength(0);
  });

  it("requires a reason", async () => {
    const res = await post({ name: "MIT", reason: "no" });
    expect(res.status).toBe(400);
  });

  it("records a staff dismissal", async () => {
    const res = await post({ name: "MIT", reason: "Example employer only" });
    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({ id: "p-1", name: "MIT", by: "alice" });
  });
});
