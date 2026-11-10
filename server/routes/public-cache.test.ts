import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { grants, renderMode } = vi.hoisted(() => ({
  grants: new Set<string>(),
  renderMode: { value: "ok" as "ok" | "fail" },
}));

vi.mock("./_helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_helpers")>();
  return {
    ...actual,
    requireCapability: async (_req: express.Request, res: express.Response, cap: string) => {
      if (grants.has(cap)) return { authorized: true, token: "t", username: "pat", author: "pat" };
      res.status(403).json({ error: `Insufficient permissions: ${cap} required` });
      return { authorized: false, token: null, username: "pat", author: null };
    },
  };
});

vi.mock("../render-hub-html", async () => {
  const cache = await import("../html-page-cache");
  const { AUDIENCE_LLM_VARIANT } = await import("../../shared/llm-html-audience");
  return {
    renderHubHtml: vi.fn(
      async (opts: { site: { contentRootName: string }; pathname: string; variantKey?: string; generation?: number }) => {
        if (renderMode.value === "fail") return null;
        const variantKey = opts.variantKey ?? "live";
        if (variantKey === AUDIENCE_LLM_VARIANT) return { html: "", status: 204, fromCache: false };
        const key = cache.buildHtmlCacheKey(opts.site.contentRootName, opts.pathname, variantKey);
        const html = `<html>refreshed ${opts.generation}</html>`;
        cache.setCachedHtml(key, html, 200, { generation: opts.generation });
        return { html, status: 200, fromCache: false };
      },
    ),
  };
});

import { resetRegistry } from "../content-types";
import {
  buildHtmlCacheKey,
  getCachedHtml,
  htmlRebuildInFlight,
  invalidateHtmlPageCache,
  noteHtmlRebuildPending,
  resetHtmlPageCacheForTests,
  setCachedHtml,
  setHtmlCacheClockForTests,
} from "../html-page-cache";
import { VersioningManager } from "../versioning/VersioningManager";
import { registerPublicCacheRoutes } from "./public-cache";

const SITE_ID = "site_pc";
const LIVE_PATH = "/en/landing/promo";
const API = "/api/public-cache/landing/promo/en";

let tempDir: string;
let contentRoot: string;
let entryFile: string;
let server: http.Server | null = null;
let baseUrl = "";

const liveKey = () => buildHtmlCacheKey(SITE_ID, LIVE_PATH, "live");

function setEntryMtime(ms: number) {
  const t = new Date(ms);
  fs.utimesSync(entryFile, t, t);
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-cache-"));
  contentRoot = path.join(tempDir, SITE_ID);
  fs.mkdirSync(path.join(contentRoot, "landings", "promo"), { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    "landing:\n  directory: landings\n  url_pattern:\n    en: /en/landing/:slug\n",
    "utf-8",
  );
  entryFile = path.join(contentRoot, "landings", "promo", "en.yml");
  fs.writeFileSync(entryFile, "slug: promo\nsections: []\n", "utf-8");
  resetRegistry(contentRoot);
  const vm = new VersioningManager(contentRoot);
  const ci = {
    contentRoot,
    getFolderName: () => "landings",
    resolveBaseSlug: (slug: string) => slug,
    normalizeType: (type: string) => type,
    getAlternateUrls: () => ({ en: LIVE_PATH }),
    resolveUrl: () => null,
    buildUrl: () => LIVE_PATH,
  };

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.site = {
      contentRoot,
      contentRootName: SITE_ID,
      versioningManager: vm,
      config: { domain: "pc.local" },
      contentIndex: ci,
    } as any;
    next();
  });
  registerPublicCacheRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  invalidateHtmlPageCache();
  resetHtmlPageCacheForTests();
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  invalidateHtmlPageCache();
  resetHtmlPageCacheForTests();
  grants.clear();
  grants.add("content_view");
  renderMode.value = "ok";
  setEntryMtime(Date.now() - 60 * 60 * 1000);
});

const getStatus = async () => {
  const res = await fetch(`${baseUrl}${API}`);
  return { status: res.status, body: await res.json() };
};
const postRefresh = async () => {
  const res = await fetch(`${baseUrl}${API}/refresh`, { method: "POST" });
  return { status: res.status, body: await res.json() };
};

describe("public cache status", () => {
  it("reports not_cached when visitors have no copy", async () => {
    const { status, body } = await getStatus();
    expect(status).toBe(200);
    expect(body.state).toBe("not_cached");
    expect(body.livePath).toBe(LIVE_PATH);
    expect(body.copies).toEqual([]);
  });

  it("reports fresh when the copy is newer than the entry files", async () => {
    setCachedHtml(liveKey(), "<html>v1</html>", 200);
    const { body } = await getStatus();
    expect(body.state).toBe("fresh");
    expect(body.copies).toHaveLength(1);
    expect(body.copies[0]).toMatchObject({ pathname: LIVE_PATH, variantKey: "live", state: "fresh" });
  });

  it("reports stale when the entry was edited after the copy was built", async () => {
    setCachedHtml(liveKey(), "<html>v1</html>", 200);
    setEntryMtime(Date.now() + 60_000);
    const { body } = await getStatus();
    expect(body.state).toBe("stale");
  });

  it("reports rebuilding while a background rebuild is pending", async () => {
    setCachedHtml(liveKey(), "<html>v1</html>", 200);
    const base = Date.now() + 60_000;
    setHtmlCacheClockForTests(() => base);
    noteHtmlRebuildPending(liveKey(), 2);
    const { body } = await getStatus();
    expect(body.state).toBe("rebuilding");
  });

  it("does not drop a copy whose rebuild has been pending past the slow limit", async () => {
    setCachedHtml(liveKey(), "<html>v1</html>", 200);
    const base = Date.now() + 60_000;
    setHtmlCacheClockForTests(() => base);
    noteHtmlRebuildPending(liveKey(), 2, true);
    setHtmlCacheClockForTests(() => base + 9_000);

    const { body } = await getStatus();
    expect(body.state).toBe("rebuilding");
    expect(htmlRebuildInFlight(liveKey())).toBe(true);
    // A real serve would drop it now, which proves the status call did not.
    expect(getCachedHtml(liveKey())).toBeNull();
  });
});

describe("public cache refresh", () => {
  it("rebuilds the copy now and ignores an older rebuild written afterwards", async () => {
    setCachedHtml(liveKey(), "<html>v1</html>", 200);
    setEntryMtime(Date.now() + 60_000);

    const { status, body } = await postRefresh();
    expect(status).toBe(200);
    expect(body.refreshed).toEqual([{ pathname: LIVE_PATH, variantKey: "live" }]);
    expect(body.failed).toEqual([]);
    expect(body.livePath).toBe(LIVE_PATH);

    const refreshedHtml = getCachedHtml(liveKey())?.html;
    const refreshedGeneration = Number(refreshedHtml?.match(/refreshed (\d+)/)?.[1]);
    expect(refreshedGeneration).toBeGreaterThan(0);
    setCachedHtml(liveKey(), "<html>older job</html>", 200, { generation: refreshedGeneration - 1 });
    expect(getCachedHtml(liveKey())?.html).toBe(refreshedHtml);
  });

  it("keeps the previous copy when the rebuild fails", async () => {
    setCachedHtml(liveKey(), "<html>v1</html>", 200);
    renderMode.value = "fail";

    const { status, body } = await postRefresh();
    expect(status).toBe(500);
    expect(body.refreshed).toEqual([]);
    expect(body.failed.map((f: { variantKey: string }) => f.variantKey)).toContain("live");
    expect(getCachedHtml(liveKey())?.html).toBe("<html>v1</html>");
  });

  it("builds a copy for a page that was not cached yet", async () => {
    expect(getCachedHtml(liveKey())).toBeNull();
    const { status, body } = await postRefresh();
    expect(status).toBe(200);
    expect(body.refreshed).toEqual([{ pathname: LIVE_PATH, variantKey: "live" }]);
    expect(getCachedHtml(liveKey())).not.toBeNull();
  });
});

describe("public cache permissions", () => {
  it("lets anyone with content_view check and refresh", async () => {
    expect((await getStatus()).status).toBe(200);
    expect((await postRefresh()).status).toBe(200);
  });

  it("refuses both routes without content_view", async () => {
    grants.clear();
    grants.add("metrics_view");
    expect((await getStatus()).status).toBe(403);
    expect((await postRefresh()).status).toBe(403);
  });
});
