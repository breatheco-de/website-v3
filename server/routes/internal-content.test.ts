import http from "http";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const flushMock = vi.hoisted(() => vi.fn(async () => ({ ok: true, sites: [] })));
vi.mock("../content-flush", () => ({ flushUnpushedContent: flushMock }));

import { registerInternalContentRoutes } from "./internal-content";
import {
  _resetContentWritePauseForTests,
  contentWritePauseMiddleware,
  isContentWritePaused,
  pauseContentWrites,
  waitForContentWritesInFlight,
} from "../content-write-pause";

const SECRET = "deploy-secret";
const MCP = "mcp-secret";
let server: http.Server | null = null;
let baseUrl = "";
let releaseSlowWrite: (() => void) | null = null;

beforeAll(async () => {
  process.env.SESSION_SECRET = SECRET;
  process.env.MCP_SERVER_SECRET = MCP;
  const app = express();
  app.use(express.json());
  app.use(contentWritePauseMiddleware);
  registerInternalContentRoutes(app);
  app.post("/api/content/save", (_req, res) => res.json({ saved: true }));
  app.get("/api/content/read", (_req, res) => res.json({ read: true }));
  app.post("/api/leads/webhook-delivery", (_req, res) => res.json({ lead: true }));
  app.post("/api/auth/logout", (_req, res) => res.json({ out: true }));
  app.post("/api/content/slow", (_req, res) => {
    releaseSlowWrite = () => res.json({ saved: true });
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

beforeEach(() => {
  _resetContentWritePauseForTests();
  flushMock.mockClear();
});

const call = (p: string, init: RequestInit = {}) => fetch(`${baseUrl}${p}`, init);
const deployPost = (p: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  call(p, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}`, ...headers },
    body: JSON.stringify(body),
  });
const staffSave = (p = "/api/content/save") => call(p, { method: "POST", headers: { Authorization: "Token staff-1" } });

describe("deploy hook guard", () => {
  it("refuses a wrong token, no token, or a forwarded (proxied) request", async () => {
    expect((await deployPost("/api/internal/content/flush", {}, { Authorization: "Bearer nope" })).status).toBe(403);
    expect((await call("/api/internal/content/flush", { method: "POST" })).status).toBe(403);
    expect((await deployPost("/api/internal/content/flush", {}, { "X-Forwarded-For": "1.2.3.4" })).status).toBe(403);
    expect((await deployPost("/api/internal/content/resume-writes", {}, { Authorization: "Bearer nope" })).status).toBe(403);
    expect(flushMock).not.toHaveBeenCalled();
  });

  it("flushes without pausing by default", async () => {
    const res = await deployPost("/api/internal/content/flush", { deploy_sha: "abc" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, paused: false });
    expect(flushMock).toHaveBeenCalledTimes(1);
    expect((await staffSave()).status).toBe(200);
  });
});

describe("write pause", () => {
  it("pauses staff and agent saves only; public posts, reads and auth keep working", async () => {
    const res = await deployPost("/api/internal/content/flush", { pause_writes: true });
    expect(await res.json()).toMatchObject({ paused: true });

    const blocked = await staffSave();
    expect(blocked.status).toBe(503);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toMatchObject({ code: "site_updating" });

    const mcp = await call("/api/content/save", { method: "POST", headers: { Authorization: `Bearer ${MCP}` } });
    expect(mcp.status).toBe(503);

    expect((await call("/api/leads/webhook-delivery", { method: "POST" })).status).toBe(200);
    expect((await call("/api/content/read", { headers: { Authorization: "Token staff-1" } })).status).toBe(200);
    expect((await call("/api/auth/logout", { method: "POST", headers: { Authorization: "Token staff-1" } })).status).toBe(200);

    const state = await call("/api/internal/content/write-pause", { headers: { Authorization: `Bearer ${MCP}` } });
    expect(await state.json()).toMatchObject({ paused: true });
  });

  it("resume-writes lifts the pause", async () => {
    await deployPost("/api/internal/content/flush", { pause_writes: true });
    expect((await deployPost("/api/internal/content/resume-writes")).status).toBe(200);
    expect((await staffSave()).status).toBe(200);
  });

  it("expires on its own", () => {
    pauseContentWrites(2);
    expect(isContentWritePaused()).toBe(true);
    expect(isContentWritePaused(Date.now() + 3000)).toBe(false);
  });

  it("waits for a save that started before the pause", async () => {
    const slow = staffSave("/api/content/slow");
    await vi.waitFor(() => expect(releaseSlowWrite).not.toBeNull());
    pauseContentWrites(60);
    const waiting = waitForContentWritesInFlight(5000);
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(settled).toBe(false);
    releaseSlowWrite!();
    expect((await slow).status).toBe(200);
    expect(await waiting).toBe(0);
  });
});
