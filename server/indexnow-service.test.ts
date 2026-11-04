import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  enqueueJob: vi.fn().mockResolvedValue({ queued: true }),
}));

vi.mock("./jobs/queue", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("./site-config", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./site-config")>();
  return {
    ...orig,
    getSiteConfigs: () => [
      ...orig.getSiteConfigs(),
      { domain: "example.com", contentFolder: "site_indexnow-svc-test" },
    ],
  };
});

import { clearSiteSqliteCacheForTests } from "./db";
import { resetPipelineDbCache } from "./pipeline-db/runner";
import { resetSettings } from "./settings";
import { scanPublicUrlChanges } from "./public-url-changes/scanner";
import { advanceConsumer, getConsumer, listChangesAfter, updateConsumer } from "./public-url-changes/store";
import {
  confirmHeldRemovals,
  listPublicUrlChangesForStaff,
  saveIndexNowSettingsForSite,
  testIndexNowConnection,
} from "./indexnow-service";
import { indexNowKeyFileHandler } from "./indexnow-key-route";
import type { PublicUrlSnapshotEntry } from "./sitemap";

const SITE = "site_indexnow-svc-test";
const BASE = "https://example.com";
let contentRoot = "";

function entry(p: string): PublicUrlSnapshotEntry {
  return { url: `${BASE}${p}`, entryKey: null, contentType: "page", slug: p, locale: "en", updatedAt: "2026-01-01T00:00:00Z" };
}

function rmData(): void {
  const dir = path.join("data", SITE);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

beforeEach(() => {
  resetPipelineDbCache();
  clearSiteSqliteCacheForTests();
  rmData();
  contentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "indexnow-svc-"));
  fs.writeFileSync(path.join(contentRoot, "settings.yml"), "i18n:\n  default_locale: en\n");
  resetSettings(contentRoot);
  mocks.enqueueJob.mockClear();
});

afterEach(() => {
  clearSiteSqliteCacheForTests();
  resetPipelineDbCache();
  rmData();
  fs.rmSync(contentRoot, { recursive: true, force: true });
});

const okKey = vi.fn(async (host: string, key: string) => ({ ok: true, url: `https://${host}/${key}.txt`, detail: "The live site serves the key" }));
const missingKey = vi.fn(async (host: string, key: string) => ({
  ok: false,
  url: `https://${host}/${key}.txt`,
  detail: "The live site answered HTTP 404 for the key file",
}));

describe("saveIndexNowSettingsForSite", () => {
  it("generates a key, warns when the live site does not serve it, and changing the key clears verified", async () => {
    const first = await saveIndexNowSettingsForSite(
      { site: SITE, contentRoot, input: { generateKey: true } },
      { live: false, checkKey: missingKey },
    );
    expect(first.settings.key).toMatch(/^[a-f0-9]{32}$/);
    expect(first.warnings).toEqual([]);

    updateConsumer(SITE, "indexnow", { verifiedAt: 123, stoppedAt: 456 });
    const on = await saveIndexNowSettingsForSite(
      { site: SITE, contentRoot, input: { enabled: true } },
      { live: false, checkKey: missingKey },
    );
    expect(on.settings.enabled).toBe(true);
    expect(on.warnings[0]).toContain("publish settings first");
    expect(getConsumer(SITE, "indexnow")).toMatchObject({ verifiedAt: 123, stoppedAt: null });

    await saveIndexNowSettingsForSite({ site: SITE, contentRoot, input: { generateKey: true } }, { live: false, checkKey: okKey });
    expect(getConsumer(SITE, "indexnow").verifiedAt).toBeNull();
  });

  it("refuses to turn on without a key", async () => {
    await expect(
      saveIndexNowSettingsForSite({ site: SITE, contentRoot, input: { enabled: true } }, { live: false, checkKey: okKey }),
    ).rejects.toThrow(/key/i);
  });
});

describe("testIndexNowConnection", () => {
  async function withKey(): Promise<string> {
    const r = await saveIndexNowSettingsForSite(
      { site: SITE, contentRoot, input: { generateKey: true } },
      { live: false, checkKey: okKey },
    );
    return r.settings.key;
  }

  it("off the live server only checks the key file and sends nothing", async () => {
    await withKey();
    const submit = vi.fn();
    const res = await testIndexNowConnection({ site: SITE, contentRoot }, { live: false, checkKey: missingKey, submit });
    expect(res).toMatchObject({ ok: false, mode: "key_file" });
    expect(res.detail).toContain("Publish settings first");
    expect(submit).not.toHaveBeenCalled();

    const good = await testIndexNowConnection({ site: SITE, contentRoot }, { live: false, checkKey: okKey, submit });
    expect(good).toMatchObject({ ok: true, mode: "key_file" });
  });

  it("on the live server submits only the homepage, never moves the bookmark, and a 200 sets verified", async () => {
    await withKey();
    scanPublicUrlChanges({ site: SITE, snapshot: [entry("/a")], indexingBlocked: false });
    scanPublicUrlChanges({ site: SITE, snapshot: [entry("/a"), entry("/b")], indexingBlocked: false });
    updateConsumer(SITE, "indexnow", { stoppedAt: 99 });
    const submit = vi.fn(async () => ({ outcome: "accepted" as const, status: 200, detail: "Accepted" }));
    const res = await testIndexNowConnection({ site: SITE, contentRoot }, { live: true, submit, now: 777 });
    expect(res).toMatchObject({ ok: true, mode: "notice", status: 200, detail: "Notice accepted" });
    expect(submit).toHaveBeenCalledWith("example.com", expect.any(String), ["https://example.com/"]);
    expect(getConsumer(SITE, "indexnow")).toMatchObject({ lastChangeId: 0, verifiedAt: 777, stoppedAt: null });
  });
});

describe("confirm removals + staff list", () => {
  it("confirm returns false when nothing is held", () => {
    expect(confirmHeldRemovals(SITE)).toBe(false);
  });

  it("marks rows sent or waiting from the bookmark and filters by page path", () => {
    scanPublicUrlChanges({ site: SITE, snapshot: [entry("/a")], indexingBlocked: false });
    scanPublicUrlChanges({ site: SITE, snapshot: [entry("/a"), entry("/b"), entry("/c")], indexingBlocked: false });
    const [first] = listChangesAfter(SITE, 0, 10);
    advanceConsumer(SITE, "indexnow", first!.id);

    const all = listPublicUrlChangesForStaff({ site: SITE });
    expect(all.changes.map((c) => [c.url.replace(BASE, ""), c.sent])).toEqual([
      ["/c", false],
      ["/b", true],
    ]);
    expect(all.summary).toMatchObject({ changesThisWeek: 2, sentThisWeek: 1, waiting: 1 });

    const one = listPublicUrlChangesForStaff({ site: SITE, path: "/c" });
    expect(one.changes.map((c) => c.url)).toEqual([`${BASE}/c`]);
  });
});

describe("key file route", () => {
  function run(opts: { path: string; host: string }) {
    const res = {
      locals: { site: { contentRoot, contentRootName: SITE } },
      headers: {} as Record<string, string>,
      body: undefined as unknown,
      set(k: string, v: string) {
        this.headers[k] = v;
        return this;
      },
      send(b: unknown) {
        this.body = b;
        return this;
      },
    };
    const next = vi.fn();
    indexNowKeyFileHandler({ path: opts.path, hostname: opts.host } as never, res as never, next);
    return { res, next };
  }

  it("serves the key on the main domain only, when on", async () => {
    const { settings } = await saveIndexNowSettingsForSite(
      { site: SITE, contentRoot, input: { generateKey: true } },
      { live: false, checkKey: okKey },
    );
    expect(run({ path: `/${settings.key}.txt`, host: "example.com" }).next).toHaveBeenCalled();

    await saveIndexNowSettingsForSite({ site: SITE, contentRoot, input: { enabled: true } }, { live: false, checkKey: okKey });
    const served = run({ path: `/${settings.key}.txt`, host: "example.com" });
    expect(served.next).not.toHaveBeenCalled();
    expect(served.res.body).toBe(settings.key);

    expect(run({ path: "/wrongwrongwrong.txt", host: "example.com" }).next).toHaveBeenCalled();
    expect(run({ path: `/${settings.key}.txt`, host: "www.example.com" }).next).toHaveBeenCalled();
    expect(run({ path: "/robots.txt", host: "example.com" }).next).toHaveBeenCalled();
  });
});
