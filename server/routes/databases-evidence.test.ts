import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../sync-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sync-state")>();
  return { ...actual, markFileAsModified: () => undefined };
});

vi.mock("./_helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_helpers")>();
  const allow = { authorized: true, token: "t", username: "alice", author: "alice" };
  return {
    ...actual,
    requireCapability: async () => allow,
    requireAnyCapability: async () => allow,
    requireDatabasesBrowseAccess: async () => ({ ...allow, canManage: true }),
    markContentFileModified: () => undefined,
  };
});

import { DatabaseManager } from "../database";
import { registerDatabasesRoutes } from "./databases";
import { ROW_STAMP_KEY, rowTrust } from "@shared/evidence-kinds";

let tempDir: string;
let contentRoot: string;
let dbName: string;
let db: DatabaseManager;
let server: http.Server | null = null;
let baseUrl = "";

function rowsOnDisk(): Record<string, unknown>[] {
  const raw = yaml.load(fs.readFileSync(path.join(contentRoot, "db", dbName, "rows.yml"), "utf-8")) as {
    press: Record<string, unknown>[];
  };
  return raw.press;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-evidence-"));
  contentRoot = path.join(tempDir, "site_ev");
  dbName = `press-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(contentRoot, "db", dbName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.yml"),
    yaml.dump({
      name: "Press",
      source: { type: "local", local: { filename: "rows.yml", results_path: "press" } },
      evidence: {
        enabled: true,
        proves: ["press_coverage"],
        proof_field: "link_url",
        match_fields: ["organization"],
      },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "rows.yml"),
    yaml.dump({ press: [{ title: "Bahamas", organization: "Government of the Bahamas", link_url: "https://a", image: "a.png" }] }),
  );
  db = new DatabaseManager(contentRoot);
  db.reload();

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.site = { contentRoot, contentRootName: "site_ev", database: db, config: { domain: "ev.local" } } as any;
    next();
  });
  registerDatabasesRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  db.clearCache(dbName);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const json = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const AGENT = { "x-mcp-author": "mcp" };

describe("evidence row stamps", () => {
  it("legacy rows with no stamp count as trusted", () => {
    expect(rowTrust(rowsOnDisk()[0])).toBe("trusted");
  });

  it("an agent image-only edit keeps the row trusted", async () => {
    const res = await json("PATCH", `/api/databases/${dbName}/items/0`, { image: "b.png" }, AGENT);
    expect(res.status).toBe(200);
    expect(rowTrust(rowsOnDisk()[0])).toBe("trusted");
  });

  it("an agent link edit makes the row unverified and the client stamp is dropped", async () => {
    const res = await json(
      "PATCH",
      `/api/databases/${dbName}/items/0`,
      { link_url: "https://b", [ROW_STAMP_KEY]: { type: "staff", author: "fake", at: "x" } },
      AGENT,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: Record<string, unknown> };
    expect(ROW_STAMP_KEY in body.item).toBe(false);
    const row = rowsOnDisk()[0];
    expect(rowTrust(row)).toBe("unverified");
    expect((row[ROW_STAMP_KEY] as { author: string }).author).toBe("alice");
  });

  it("lists evidence trust per row without exposing the stamp", async () => {
    const res = await json("GET", `/api/databases/${dbName}/items`);
    const body = (await res.json()) as { items: Record<string, unknown>[]; evidence_trust: string[] };
    expect(body.evidence_trust).toEqual(["unverified"]);
    expect(ROW_STAMP_KEY in body.items[0]).toBe(false);
  });

  it("the verify route refuses agents", async () => {
    const res = await json("POST", `/api/databases/${dbName}/items/0/verify`, {}, AGENT);
    expect(res.status).toBe(403);
    expect(rowTrust(rowsOnDisk()[0])).toBe("unverified");
  });

  it("staff verify marks the row verified", async () => {
    const res = await json("POST", `/api/databases/${dbName}/items/0/verify`, {});
    expect(res.status).toBe(200);
    expect(rowTrust(rowsOnDisk()[0])).toBe("verified");
  });

  it("a new agent row is unverified", async () => {
    const res = await json(
      "POST",
      `/api/databases/${dbName}/items`,
      { item: { title: "New", organization: "Oxford", link_url: "https://c" } },
      AGENT,
    );
    expect(res.status).toBe(200);
    expect(rowTrust(rowsOnDisk()[1])).toBe("unverified");
  });

  it("rejects an invalid evidence config", async () => {
    const res = await json("PUT", `/api/databases/${dbName}/config`, {
      name: "Press",
      source: { type: "local", local: { filename: "rows.yml", results_path: "press" } },
      evidence: { enabled: true, proves: ["made_up"], proof_field: "link_url", match_fields: ["organization"] },
    });
    expect(res.status).toBe(400);
  });
});
