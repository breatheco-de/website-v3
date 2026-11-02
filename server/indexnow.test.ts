import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const mocks = vi.hoisted(() => ({
  settings: { enabled: true, key: "abcdef1234567890" },
  blocked: false,
  enqueueJob: vi.fn().mockResolvedValue({ queued: true }),
}));

vi.mock("./jobs/queue", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("./settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./settings")>()),
  getIndexNowSettings: () => ({ ...mocks.settings }),
  isIndexingBlocked: () => mocks.blocked,
}));
vi.mock("./site-config", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./site-config")>();
  return {
    ...orig,
    getSiteConfigs: () => [
      ...orig.getSiteConfigs(),
      { domain: "example.com", contentFolder: "site_indexnow-test", aliases: ["www.example.com"] },
    ],
  };
});

import { clearSiteSqliteCacheForTests } from "./db";
import { resetPipelineDbCache } from "./pipeline-db/runner";
import { scanPublicUrlChanges } from "./public-url-changes/scanner";
import { getConsumer, listChangesAfter, updateConsumer } from "./public-url-changes/store";
import {
  INDEXNOW_CHUNK_URLS,
  INDEXNOW_NEXT_CHUNK_DELAY_MS,
  getIndexNowStatus,
  pickChunk,
  rejectionBackoffMs,
  runIndexNowSubmit,
  type IndexNowSubmitPayload,
  type IndexNowSubmitResult,
} from "./indexnow";
import type { PublicUrlSnapshotEntry } from "./sitemap";

const SITE = "site_indexnow-test";
const BASE = "https://example.com";
const HOUR = 60 * 60 * 1000;

function entry(p: string, base = BASE): PublicUrlSnapshotEntry {
  return { url: `${base}${p}`, entryKey: null, contentType: "page", slug: p, locale: "en", updatedAt: "2026-01-01T00:00:00Z" };
}

function seedChanges(count: number, base = BASE): void {
  scanPublicUrlChanges({ site: SITE, snapshot: [entry("/seed")], indexingBlocked: false });
  const snap = [entry("/seed"), ...Array.from({ length: count }, (_, i) => entry(`/n${i}`, base))];
  // Below the brake: additions only.
  scanPublicUrlChanges({ site: SITE, snapshot: snap, indexingBlocked: false });
}

function deps(result: Partial<IndexNowSubmitResult> & { outcome: IndexNowSubmitResult["outcome"] }, now = 1_000_000) {
  const submit = vi.fn(async (_h: string, _k: string, _u: string[]) => ({ status: 200, detail: "", ...result }));
  const enqueue = vi.fn(async (_p: IndexNowSubmitPayload, _o?: { delayMs?: number }) => true);
  return { submit, enqueue, now, live: true };
}

const payload: IndexNowSubmitPayload = { site: SITE, contentRoot: "/tmp/site_indexnow-test" };

function rmSite(): void {
  const dir = path.join("data", SITE);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

beforeEach(() => {
  resetPipelineDbCache();
  clearSiteSqliteCacheForTests();
  rmSite();
  mocks.settings = { enabled: true, key: "abcdef1234567890" };
  mocks.blocked = false;
});

afterEach(() => {
  clearSiteSqliteCacheForTests();
  resetPipelineDbCache();
  rmSite();
});

describe("runIndexNowSubmit gates", () => {
  it("does nothing off the live server, when disabled, or while indexing is blocked", async () => {
    seedChanges(2);
    const d = deps({ outcome: "accepted" });
    expect((await runIndexNowSubmit(payload, { ...d, live: false })).status).toBe("skipped_off_live");
    mocks.settings = { enabled: false, key: "abcdef1234567890" };
    expect((await runIndexNowSubmit(payload, d)).status).toBe("skipped_disabled");
    mocks.settings = { enabled: true, key: "abcdef1234567890" };
    mocks.blocked = true;
    expect((await runIndexNowSubmit(payload, d)).status).toBe("skipped_paused");
    expect(d.submit).not.toHaveBeenCalled();
  });
});

describe("chunks and bookmark", () => {
  it("sends at most 500 URLs and re-enqueues while the backlog remains", async () => {
    seedChanges(INDEXNOW_CHUNK_URLS + 20);
    const d = deps({ outcome: "accepted" });
    const res = await runIndexNowSubmit(payload, d);
    expect(res).toMatchObject({ status: "sent", sent: INDEXNOW_CHUNK_URLS, more: true });
    expect(d.submit.mock.calls[0]![2]).toHaveLength(INDEXNOW_CHUNK_URLS);
    expect(d.enqueue).toHaveBeenCalledWith(expect.objectContaining({ site: SITE }), { delayMs: INDEXNOW_NEXT_CHUNK_DELAY_MS });
    const consumer = getConsumer(SITE, "indexnow");
    expect(listChangesAfter(SITE, consumer.lastChangeId, 1000)).toHaveLength(20);
    expect(consumer.verifiedAt).toBe(d.now);

    const d2 = deps({ outcome: "accepted" });
    const res2 = await runIndexNowSubmit(payload, d2);
    expect(res2).toMatchObject({ sent: 20, more: false });
    expect(d2.enqueue).not.toHaveBeenCalled();
  });

  it("drops URLs on other hosts (aliases, localhost) but still advances past them", async () => {
    seedChanges(3, "https://www.example.com");
    const d = deps({ outcome: "accepted" });
    const res = await runIndexNowSubmit(payload, d);
    expect(res.status).toBe("nothing_to_send");
    expect(d.submit).not.toHaveBeenCalled();
    expect(listChangesAfter(SITE, getConsumer(SITE, "indexnow").lastChangeId, 10)).toHaveLength(0);
  });

  it("moved rows submit both the old and new URL", () => {
    const chunk = pickChunk(
      [
        {
          id: 1,
          url: `${BASE}/new`,
          kind: "moved",
          previousUrl: `${BASE}/old`,
          entryKey: null,
          contentType: null,
          slug: null,
          locale: null,
          updatedAt: null,
          causeEventId: null,
          detectedAt: 1,
        },
      ],
      "example.com",
    );
    expect(chunk).toEqual({ urls: [`${BASE}/old`, `${BASE}/new`], lastId: 1 });
  });

  it("202 advances the bookmark but does not mark the key verified", async () => {
    seedChanges(2);
    await runIndexNowSubmit(payload, deps({ outcome: "accepted_pending_key", status: 202 }));
    const c = getConsumer(SITE, "indexnow");
    expect(c.lastChangeId).toBeGreaterThan(0);
    expect(c.verifiedAt).toBeNull();
  });
});

describe("failures", () => {
  it("429 / 5xx keep the bookmark and back off", async () => {
    seedChanges(2);
    const d = deps({ outcome: "rate_limited", status: 429 });
    await runIndexNowSubmit(payload, d);
    expect(getConsumer(SITE, "indexnow").lastChangeId).toBe(0);
    expect(d.enqueue.mock.calls[0]![0]).toMatchObject({ transientAttempt: 1 });
    expect(d.enqueue.mock.calls[0]![1]).toEqual({ delayMs: 2 * 60 * 1000 });
  });

  it("403 follows 15 min / 1 h / 4 h and stops after 24 h; resume clears it", async () => {
    seedChanges(2);
    const t0 = 10_000_000;
    let d = deps({ outcome: "rejected_key", status: 403 }, t0);
    await runIndexNowSubmit(payload, d);
    let c = getConsumer(SITE, "indexnow");
    expect(c).toMatchObject({ lastChangeId: 0, rejectedSince: t0, nextAttemptAt: t0 + 15 * 60 * 1000 });

    expect(rejectionBackoffMs(t0, t0 + 15 * 60 * 1000)).toBe(HOUR);
    expect(rejectionBackoffMs(t0, t0 + 2 * HOUR)).toBe(4 * HOUR);

    d = deps({ outcome: "rejected_key", status: 403 }, t0 + 60_000);
    expect((await runIndexNowSubmit(payload, d)).status).toBe("skipped_waiting");

    d = deps({ outcome: "rejected_key", status: 403 }, t0 + 24 * HOUR);
    await runIndexNowSubmit(payload, { ...d, now: t0 + 24 * HOUR });
    c = getConsumer(SITE, "indexnow");
    expect(c.stoppedAt).toBe(t0 + 24 * HOUR);
    expect((await runIndexNowSubmit(payload, deps({ outcome: "accepted" }, t0 + 25 * HOUR))).status).toBe("skipped_stopped");

    updateConsumer(SITE, "indexnow", { stoppedAt: null, rejectedSince: null, nextAttemptAt: null });
    const ok = await runIndexNowSubmit(payload, deps({ outcome: "accepted" }, t0 + 26 * HOUR));
    expect(ok.status).toBe("sent");
    expect(getConsumer(SITE, "indexnow").rejectedSince).toBeNull();
  });
});

describe("submit all", () => {
  it("walks the current URL set in chunks and then moves the bookmark to the captured max", async () => {
    seedChanges(3);
    const d = deps({ outcome: "accepted" });
    const res = await runIndexNowSubmit({ ...payload, mode: "all" }, d);
    expect(res.status).toBe("sent");
    expect(d.submit.mock.calls[0]![2]).toHaveLength(4);
    const max = listChangesAfter(SITE, 0, 100).at(-1)!.id;
    expect(getConsumer(SITE, "indexnow").lastChangeId).toBe(max);
  });
});

describe("status", () => {
  it("stuck only on the live server with changes waiting over an hour", () => {
    seedChanges(1);
    const detected = listChangesAfter(SITE, 0, 1)[0]!.detectedAt;
    expect(getIndexNowStatus(SITE, "/tmp/x", { now: detected + 30 * 60 * 1000, live: true }).stuck).toBe(false);
    expect(getIndexNowStatus(SITE, "/tmp/x", { now: detected + 2 * HOUR, live: true }).stuck).toBe(true);
    expect(getIndexNowStatus(SITE, "/tmp/x", { now: detected + 2 * HOUR, live: false }).stuck).toBe(false);
    const s = getIndexNowStatus(SITE, "/tmp/x", { now: detected, live: true });
    expect(s).toMatchObject({ waiting: 1, host: "example.com", keyFileUrl: "https://example.com/abcdef1234567890.txt" });
  });
});
