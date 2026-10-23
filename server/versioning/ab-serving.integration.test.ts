/**
 * What visitors get is what gets reported: real Express server, temp site, the real
 * initial-data middleware (first load) and the page API assignment path.
 */
import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import express from "express";
import cookieParser from "cookie-parser";
import * as yaml from "js-yaml";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { markFileAsModified } = vi.hoisted(() => ({ markFileAsModified: vi.fn() }));
vi.mock("../sync-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync-state")>()),
  markFileAsModified,
}));
vi.mock("../image-registry-resolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../image-registry-resolver")>()),
  getMergedImageRegistry: () => ({ presets: {}, images: {} }),
}));
vi.mock("../routes/_helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../routes/_helpers")>()),
  requireCapability: async () => ({ authorized: true, token: null, username: "alice", author: "alice" }),
}));

import { ContentIndex } from "../content-index";
import { resetRegistry } from "../content-types";
import { VersioningManager } from "./VersioningManager";
import { initialDataMiddleware } from "../initial-data-middleware";
import { attachPageVersionToJson, resolveVariantAssignment } from "../routes/_helpers";
import { registerVersioningRoutes } from "../routes/versioning";
import { parseCheckPage, runAbCheck } from "../ab-testing/check";
import {
  _resetAbTestingStateCacheForTests,
  recordAbCheckRun,
  setAbTestingDataDirForTests,
  writeAbTestingState,
} from "../ab-testing/state";
import { checkPageFiles } from "../ab-testing/setup";

let tempDir: string;
let contentRoot: string;
let server: http.Server | null = null;
let baseUrl = "";
let vm: VersioningManager;
let ci: ContentIndex;
const SITE = "site_abtest";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SHELL = "<!DOCTYPE html><html><head><title>x</title><!-- Google Tag Manager --></head><body><div id=\"root\"></div></body></html>";

function writeEntry(slug: string, files: Record<string, string>) {
  const dir = path.join(contentRoot, "landings", slug);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body, "utf-8");
}

function setVersioning(variants: Array<{ slug: string; allocation: number }>, startedAt = "2026-10-01") {
  fs.writeFileSync(
    path.join(contentRoot, "landings", "promo", "versioning.yml"),
    yaml.dump({ en: { variants, started_at: startedAt } }),
    "utf-8",
  );
  vm.clearCache();
}

function markSetUp(status: "passed" | "failed" = "passed") {
  writeAbTestingState(SITE, { check_token: "tok", check_page: { contentType: "landing", slug: "ab-check", locale: "en" }, first_passed_at: null, runs: [] });
  recordAbCheckRun(SITE, {
    at: new Date().toISOString(), trigger: "manual", deploy_sha: null, status: "passed", url: null, requests: 0,
    observed: {}, expected: {}, p_value: null, checks: {},
  });
  if (status === "failed") {
    recordAbCheckRun(SITE, {
      at: new Date().toISOString(), trigger: "deploy", deploy_sha: null, status: "failed", url: null, requests: 0,
      observed: {}, expected: {}, p_value: null, checks: {},
    });
  }
}

async function get(pathname: string, opts: { cookie?: string; ua?: string; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      "user-agent": opts.ua ?? BROWSER_UA,
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookies = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
  return { res, body: await res.text(), setCookies };
}

function versioningCookie(setCookies: string[]): string | null {
  const line = setCookies.find((c) => c.startsWith("4g_versioning_v2="));
  return line ? line.split(";")[0].slice("4g_versioning_v2=".length) : null;
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-serving-"));
  contentRoot = path.join(tempDir, SITE);
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    "landing:\n  directory: landings\n  url_pattern:\n    en: /en/landing/:slug\n",
    "utf-8",
  );
  writeEntry("promo", {
    "_common.yml": "slug: promo\n",
    "en.yml": "title: Live\nab_check_version: default\nsections: []\n",
    "b.en.yml": "title: B\nab_check_version: b\nsections: []\n",
  });
  writeEntry("ab-check", checkPageFiles());
  writeEntry("plain", { "_common.yml": "slug: plain\n", "en.yml": "title: Plain\nsections: []\n" });
  resetRegistry(contentRoot);
  ci = new ContentIndex(contentRoot);
  ci.scanFast();
  vm = new VersioningManager(contentRoot);
  setAbTestingDataDirForTests(path.join(tempDir, "data"));

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.locals.site = {
      contentIndex: ci,
      contentRoot,
      contentRootName: SITE,
      versioningManager: vm,
      config: { domain: "abtest.local" },
      mediaGallery: { getRegistry: () => ({ presets: {}, images: {} }) },
    } as any;
    next();
  });
  app.use("/api", (req, res, next) => (req.method === "GET" ? attachPageVersionToJson(req, res, next) : next()));
  app.get("/api/landings/:slug", (req, res) => {
    const variant = resolveVariantAssignment(req, res, "landing", req.params.slug, "en") as Record<string, unknown> | null;
    res.json(variant ?? ci.loadContent({ contentType: "landing", slug: req.params.slug, localeOrVariant: "en" }).data);
  });
  registerVersioningRoutes(app);
  app.use(initialDataMiddleware);
  app.get(/^\/en\/landing\/.*/, (_req, res) => {
    res.set("Content-Type", "text/html; charset=utf-8").send(SHELL);
  });
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

beforeEach(() => {
  fs.rmSync(path.join(tempDir, "data"), { recursive: true, force: true });
  _resetAbTestingStateCacheForTests();
  setVersioning([{ slug: "b", allocation: 30 }]);
});

const ids = Array.from({ length: 1000 }, (_, i) => crypto.createHash("sha256").update(`visitor-${i}`).digest("hex"));

describe("A/B serving", () => {
  it("first load: the content matches the reported version, split ~30/70, cookie set, private cache", async () => {
    markSetUp();
    const counts: Record<string, number> = {};
    for (const id of ids) {
      const { res, body, setCookies } = await get("/en/landing/promo", { cookie: `4g_user_id=${id}` });
      const parsed = parseCheckPage(body);
      expect(parsed.variant).not.toBeNull();
      expect(parsed.marker).toBe(parsed.variant);
      expect(versioningCookie(setCookies)).not.toBeNull();
      expect(res.headers.get("cache-control")).toMatch(/private/);
      expect(body).toContain('id="__AB_PAGE_VERSION__"');
      counts[parsed.variant!] = (counts[parsed.variant!] ?? 0) + 1;
    }
    expect(Math.abs(counts.b / ids.length - 0.3)).toBeLessThan(0.05);
    expect(counts.b + counts.default).toBe(ids.length);

    const stats = vm.getRunCounts("landing", "promo", "en");
    expect(stats.b).toBe(counts.b);
    expect(stats.default).toBe(counts.default);
  });

  it("page API: body matches _page_version and return visits stick", async () => {
    markSetUp();
    for (const id of ids.slice(0, 200)) {
      const first = await get("/api/landings/promo", { cookie: `4g_user_id=${id}` });
      const json = JSON.parse(first.body) as { title: string; _page_version?: { variant: string; experiment_id: string } };
      expect(json._page_version?.experiment_id).toBe("landing:promo:en@2026-10-01");
      expect(json.title).toBe(json._page_version?.variant === "b" ? "B" : "Live");
      const cookie = versioningCookie(first.setCookies)!;
      const again = await get("/api/landings/promo", { cookie: `4g_user_id=${id}; 4g_versioning_v2=${cookie}` });
      expect(JSON.parse(again.body)._page_version.variant).toBe(json._page_version!.variant);
    }
  });

  it("staff, bots and forced previews are never assigned or counted", async () => {
    markSetUp();
    const before = vm.getRunCounts("landing", "promo", "en");
    const staff = await get("/en/landing/promo", { cookie: `4g_user_id=${ids[0]}`, headers: { "x-debug-token": "staff" } });
    expect(parseCheckPage(staff.body).variant).toBeNull();
    const bot = await get("/en/landing/promo", { cookie: `4g_user_id=${ids[1]}`, ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
    expect(parseCheckPage(bot.body).variant).toBeNull();
    expect(versioningCookie(bot.setCookies)).toBeNull();
    const forced = await get("/en/landing/promo?force_variant=b", { cookie: `4g_user_id=${ids[2]}` });
    expect(versioningCookie(forced.setCookies)).toBeNull();
    expect(vm.getRunCounts("landing", "promo", "en")).toEqual(before);
  });

  it("pages without a test keep public caching and no version label", async () => {
    markSetUp();
    const { res, body } = await get("/en/landing/plain", { cookie: `4g_user_id=${ids[0]}` });
    expect(res.headers.get("cache-control") ?? "").not.toMatch(/private/);
    expect(body).not.toContain("__AB_PAGE_VERSION__");
  });

  it("before setup only the check page assigns visitors", async () => {
    const promo = await get("/en/landing/promo", { cookie: `4g_user_id=${ids[0]}` });
    expect(parseCheckPage(promo.body).variant).toBeNull();
    const check = await get("/en/landing/ab-check", { cookie: `4g_user_id=${ids[0]}` });
    expect(["b", "default"]).toContain(parseCheckPage(check.body).variant);
  });

  it("traffic changes: raising is blocked until set up and while the check fails; lowering always works", async () => {
    const raise = { variants: [{ slug: "b", allocation: 40 }], confirm_publish_variants: true };
    const notSetUp = await fetch(`${baseUrl}/api/versioning/landing/promo/en`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(raise),
    });
    expect(notSetUp.status).toBe(400);
    expect((await notSetUp.json()).code).toBe("ab_testing_not_setup");

    markSetUp("failed");
    const failing = await fetch(`${baseUrl}/api/versioning/landing/promo/en`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(raise),
    });
    expect(failing.status).toBe(400);
    expect((await failing.json()).code).toBe("ab_check_failing");

    const lower = await fetch(`${baseUrl}/api/versioning/landing/promo/en`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variants: [{ slug: "b", allocation: 10 }] }),
    });
    expect(lower.status).toBe(200);
    const saved = yaml.load(fs.readFileSync(path.join(contentRoot, "landings", "promo", "versioning.yml"), "utf-8")) as any;
    expect(saved.en.variants[0].allocation).toBe(10);
    expect(saved.en.started_at).toBe("2026-10-01");
  });

  it("the A/B check passes end to end and its visits are not counted", async () => {
    markSetUp();
    const site = {
      contentRoot,
      contentRootName: SITE,
      contentIndex: ci,
      versioningManager: vm,
      config: { domain: "abtest.local" },
    };
    const before = vm.getRunCounts("landing", "ab-check", "en");
    const out = await runAbCheck(site, { trigger: "manual", baseUrl, requests: 300, concurrency: 20, spreadMs: 0, record: false });
    expect(out.not_set_up).toBe(false);
    if (out.not_set_up) return;
    expect(out.run.checks).toMatchObject({
      split: { ok: true },
      content: { ok: true },
      cache: { ok: true },
      cookie: { ok: true },
      sticky: { ok: true },
    });
    expect(out.run.status).toBe("passed");
    expect(vm.getRunCounts("landing", "ab-check", "en")).toEqual(before);
  });

  it("the check page is locked against variant and traffic changes", async () => {
    const res = await fetch(`${baseUrl}/api/versioning/landing/ab-check/en`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variants: [{ slug: "b", allocation: 0 }] }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("system_page_locked");
  });
});
