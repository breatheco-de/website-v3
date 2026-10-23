import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Capabilities the fake session holds (scoped grants don't matter: these caps are unscoped). */
const { grants } = vi.hoisted(() => ({ grants: new Set<string>() }));

vi.mock("./_helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_helpers")>();
  const deny = (res: express.Response, caps: string[]) => {
    res.status(403).json({ error: `Insufficient permissions: ${caps.join(" or ")} required` });
    return { authorized: false, token: null, username: "pat", author: null };
  };
  const allow = { authorized: true, token: "t", username: "pat", author: "pat" };
  return {
    ...actual,
    requireCapability: async (_req: express.Request, res: express.Response, cap: string) =>
      grants.has(cap) ? allow : deny(res, [cap]),
    requireAnyCapability: async (_req: express.Request, res: express.Response, caps: string[]) =>
      caps.some((c) => grants.has(c)) ? allow : deny(res, caps),
  };
});

import { resetRegistry } from "../content-types";
import { registerAbTestingRoutes } from "./ab-testing";
import { setAbTestingDataDirForTests } from "../ab-testing/state";
import { VersioningManager } from "../versioning/VersioningManager";

let tempDir: string;
let contentRoot: string;
let server: http.Server | null = null;
let baseUrl = "";

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-perms-"));
  contentRoot = path.join(tempDir, "site_perm");
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    "landing:\n  directory: landings\n  url_pattern:\n    en: /en/landing/:slug\n",
    "utf-8",
  );
  resetRegistry(contentRoot);
  setAbTestingDataDirForTests(path.join(tempDir, "data"));
  const vm = new VersioningManager(contentRoot);

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.site = {
      contentRoot,
      contentRootName: "site_perm",
      versioningManager: vm,
      config: { domain: "perm.local" },
      contentIndex: { buildUrl: () => "/en/landing/ab-check" },
    } as any;
    next();
  });
  registerAbTestingRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  setAbTestingDataDirForTests(null);
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => grants.clear());

const post = (p: string) => fetch(`${baseUrl}${p}`, { method: "POST" });

describe("A/B testing permissions", () => {
  it("a landing-page traffic editor cannot set up, check, or create GA4 dimensions", async () => {
    grants.add("content_allocate_traffic");
    grants.add("content_view");
    for (const p of ["/api/settings/ab-testing/setup", "/api/settings/ab-testing/check", "/api/settings/ab-testing/ga4-dimensions"]) {
      const res = await post(p);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("ab_testing_settings");
    }
  });

  it("ab_testing_settings passes the permission check", async () => {
    grants.add("ab_testing_settings");
    // Not set up yet, so the check is refused for that reason — past the permission gate.
    const res = await post("/api/settings/ab-testing/check");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("ab_testing_not_setup");
  });

  it("anyone who reads diagnostics can see the status", async () => {
    grants.add("metrics_view");
    const res = await fetch(`${baseUrl}/api/settings/ab-testing`);
    expect(res.status).toBe(200);
    expect((await res.json()).set_up).toBe(false);
  });

  it("status is refused without metrics_view or ab_testing_settings", async () => {
    grants.add("content_view");
    const res = await fetch(`${baseUrl}/api/settings/ab-testing`);
    expect(res.status).toBe(403);
  });
});
