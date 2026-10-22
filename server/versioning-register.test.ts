import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { markFileAsModified } = vi.hoisted(() => ({ markFileAsModified: vi.fn() }));

vi.mock("./sync-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sync-state")>()),
  markFileAsModified,
}));
vi.mock("./routes/_helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./routes/_helpers")>()),
  requireCapability: async () => ({ authorized: true, token: null, username: "alice", author: "alice" }),
}));

import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { VersioningManager } from "./versioning/VersioningManager";
import { registerVersioningRoutes } from "./routes/versioning";

let tempDir: string;
let contentRoot: string;
let entryDir: string;
let server: http.Server | null = null;
let baseUrl = "";

async function call(method: string, pathname: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeEach(async () => {
  markFileAsModified.mockClear();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "versioning-register-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    "landing:\n  directory: landings\n  url_pattern:\n    en: /en/landing/:slug\n    es: /es/landing/:slug\n",
    "utf-8",
  );
  entryDir = path.join(contentRoot, "landings", "promo");
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(path.join(entryDir, "_common.yml"), "slug: promo\n", "utf-8");
  fs.writeFileSync(path.join(entryDir, "en.yml"), "title: Live\nsections: []\n", "utf-8");
  fs.writeFileSync(path.join(entryDir, "rewrite.en.yml"), "title: Rewrite\nsections: []\n", "utf-8");
  resetRegistry(contentRoot);
  const ci = new ContentIndex(contentRoot);
  ci.scanFast();

  const app = express();
  app.use(express.json());
  const versioningManager = new VersioningManager(contentRoot);
  app.use((_req, res, next) => {
    res.locals.site = { contentIndex: ci, contentRoot, versioningManager } as any;
    next();
  });
  registerVersioningRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("unregistered variant files", () => {
  it("GET lists a variant file that has no versioning.yml entry", async () => {
    const { status, body } = await call("GET", "/api/versioning/landing/promo");
    expect(status).toBe(200);
    expect(body.hasVersioningFile).toBe(false);
    expect(body.unregisteredVariants).toEqual([{ locale: "en", slug: "rewrite", fileName: "rewrite.en.yml" }]);
  });

  it("POST register adds it at 0% under the person, then lists nothing unregistered", async () => {
    const { status, body } = await call("POST", "/api/versioning/landing/promo/register", {
      variantSlug: "rewrite",
      locale: "en",
    });
    expect(status).toBe(200);
    expect(body.versioning).toEqual({ en: { variants: [{ slug: "rewrite", allocation: 0 }] } });
    expect(body.unregisteredVariants).toEqual([]);
    expect(fs.readFileSync(path.join(entryDir, "versioning.yml"), "utf-8")).toContain("slug: rewrite");
    expect(markFileAsModified).toHaveBeenCalledWith(
      path.join(entryDir, "versioning.yml"),
      "alice",
      undefined,
      contentRoot,
    );

    const again = await call("POST", "/api/versioning/landing/promo/register", { variantSlug: "rewrite", locale: "en" });
    expect(again.status).toBe(409);
  });

  it("POST register 404s when the variant file does not exist", async () => {
    const { status } = await call("POST", "/api/versioning/landing/promo/register", {
      variantSlug: "missing",
      locale: "en",
    });
    expect(status).toBe(404);
    expect(fs.existsSync(path.join(entryDir, "versioning.yml"))).toBe(false);
  });
});

describe("create variant", () => {
  it("queues the variant file and versioning.yml under the same person", async () => {
    const { status } = await call("POST", "/api/versioning/landing/promo", { variantSlug: "test-b", locale: "en" });
    expect(status).toBe(200);

    const authorFor = (suffix: string) =>
      markFileAsModified.mock.calls.find(([p]) => String(p).endsWith(suffix))?.[1];
    expect(authorFor("test-b.en.yml")).toBe("alice");
    expect(authorFor("versioning.yml")).toBe("alice");
  });
});
