import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { clearSiteSqliteCacheForTests } from "../db";
import { resetPipelineDbCache } from "../pipeline-db/runner";
import type { PublicUrlSnapshotEntry } from "../sitemap";
import { isLargeDrop, scanPublicUrlChanges } from "./scanner";
import {
  advanceConsumer,
  getConsumer,
  getScanState,
  listChangesAfter,
  listRecentChanges,
  listState,
  pruneChanges,
  publicUrlDb,
  queuePendingUpdates,
  releaseHeldDrop,
} from "./store";

const BASE = "https://example.com";
let site = "";

function entry(p: string, updatedAt: string | null = "2026-01-01T00:00:00.000Z"): PublicUrlSnapshotEntry {
  return {
    url: `${BASE}${p}`,
    entryKey: `page:${p.slice(1)}:en`,
    contentType: "page",
    slug: p.slice(1),
    locale: "en",
    updatedAt,
  };
}

function pages(n: number, prefix = "/p"): PublicUrlSnapshotEntry[] {
  return Array.from({ length: n }, (_, i) => entry(`${prefix}${i}`));
}

function kinds(): string[] {
  return listChangesAfter(site, 0, 1000).map((c) => `${c.kind}:${c.url.replace(BASE, "")}`);
}

function rmSite(name: string): void {
  const dir = path.join("data", name);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

beforeEach(() => {
  resetPipelineDbCache();
  clearSiteSqliteCacheForTests();
  site = `site_public-url-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  rmSite(site);
});

afterEach(() => {
  clearSiteSqliteCacheForTests();
  resetPipelineDbCache();
  rmSite(site);
});

describe("public URL scanner", () => {
  it("baseline records the starting point without change rows and starts bookmarks at the end", () => {
    const res = scanPublicUrlChanges({ site, snapshot: [entry("/a"), entry("/b")], indexingBlocked: false, now: 1 });
    expect(res.status).toBe("baseline");
    expect(kinds()).toEqual([]);
    expect(listState(site).map((r) => r.url).sort()).toEqual([`${BASE}/a`, `${BASE}/b`]);
    expect(getConsumer(site, "indexnow").lastChangeId).toBe(0);
    expect(getScanState(site).lastScanAt).toBe(1);
  });

  it("an empty first read is not treated as a baseline", () => {
    expect(scanPublicUrlChanges({ site, snapshot: [], indexingBlocked: false }).status).toBe("baseline");
    expect(getScanState(site).lastScanAt).toBeNull();
  });

  it("records published, updated (same day, different time) and removed, and is idempotent", () => {
    scanPublicUrlChanges({ site, snapshot: [entry("/a"), entry("/b")], indexingBlocked: false, now: 1 });
    const next = [entry("/a", "2026-01-01T09:30:00.000Z"), entry("/c")];
    const res = scanPublicUrlChanges({ site, snapshot: next, indexingBlocked: false, now: 2, causeEventId: 7 });
    expect(res).toMatchObject({ status: "ok", published: 1, updated: 1, removed: 1, moved: 0 });
    expect(kinds().sort()).toEqual(["published:/c", "removed:/b", "updated:/a"]);
    expect(listChangesAfter(site, 0, 10)[0]!.causeEventId).toBe(7);

    const again = scanPublicUrlChanges({ site, snapshot: next, indexingBlocked: false, now: 3 });
    expect(again).toMatchObject({ published: 0, updated: 0, removed: 0, moved: 0 });
    expect(kinds()).toHaveLength(3);
  });

  it("pairs a removal with a new URL into one moved row when a redirect points there", () => {
    scanPublicUrlChanges({ site, snapshot: [entry("/old"), entry("/x")], indexingBlocked: false });
    const res = scanPublicUrlChanges({
      site,
      snapshot: [entry("/new"), entry("/x")],
      indexingBlocked: false,
      resolveRedirect: (url) => (url === `${BASE}/old` ? `${BASE}/new/` : null),
    });
    expect(res).toMatchObject({ moved: 1, published: 0, removed: 0 });
    const [row] = listChangesAfter(site, 0, 10);
    expect(row).toMatchObject({ kind: "moved", url: `${BASE}/new`, previousUrl: `${BASE}/old` });
  });

  it("records removed + published when no redirect points to the new URL", () => {
    scanPublicUrlChanges({ site, snapshot: [entry("/old"), entry("/x")], indexingBlocked: false });
    scanPublicUrlChanges({ site, snapshot: [entry("/new"), entry("/x")], indexingBlocked: false, resolveRedirect: () => null });
    expect(kinds().sort()).toEqual(["published:/new", "removed:/old"]);
  });

  it("pages left out of the snapshot (noindex, drafts) are never logged", () => {
    scanPublicUrlChanges({ site, snapshot: [entry("/a")], indexingBlocked: false });
    scanPublicUrlChanges({ site, snapshot: [entry("/a")], indexingBlocked: false });
    expect(kinds()).toEqual([]);
  });
});

describe("large-drop brake", () => {
  it("threshold: 20% with at least 10 pages, or more than 200", () => {
    expect(isLargeDrop(1, 5)).toBe(false);
    expect(isLargeDrop(9, 20)).toBe(false);
    expect(isLargeDrop(10, 50)).toBe(true);
    expect(isLargeDrop(10, 100)).toBe(false);
    expect(isLargeDrop(201, 10_000)).toBe(true);
  });

  it("holds a big drop, writes nothing, then a normal scan clears the hold", () => {
    const all = pages(40);
    scanPublicUrlChanges({ site, snapshot: all, indexingBlocked: false });
    const broken = all.slice(0, 20);
    const held = scanPublicUrlChanges({ site, snapshot: broken, indexingBlocked: false, now: 5 });
    expect(held).toMatchObject({ status: "held", heldRemovedCount: 20 });
    expect(kinds()).toEqual([]);
    expect(listState(site)).toHaveLength(40);
    expect(getScanState(site)).toMatchObject({ heldReason: "large_drop", heldRemovedCount: 20, heldAt: 5 });

    const recovered = scanPublicUrlChanges({ site, snapshot: all, indexingBlocked: false });
    expect(recovered.status).toBe("ok");
    expect(getScanState(site).heldReason).toBeNull();
  });

  it("staff release records the removals once and resets the flag", () => {
    const all = pages(40);
    scanPublicUrlChanges({ site, snapshot: all, indexingBlocked: false });
    const shrunk = all.slice(0, 20);
    scanPublicUrlChanges({ site, snapshot: shrunk, indexingBlocked: false });
    expect(releaseHeldDrop(site)).toBe(true);
    const res = scanPublicUrlChanges({ site, snapshot: shrunk, indexingBlocked: false });
    expect(res).toMatchObject({ status: "ok", removed: 20 });
    expect(getScanState(site)).toMatchObject({ heldReason: null, releaseNextDrop: false });
    expect(releaseHeldDrop(site)).toBe(false);
  });
});

describe("paused while indexing is blocked", () => {
  it("leaves state frozen and logs only real edits after unblocking", () => {
    scanPublicUrlChanges({ site, snapshot: [entry("/a"), entry("/b")], indexingBlocked: false });
    const paused = scanPublicUrlChanges({ site, snapshot: [], indexingBlocked: true });
    expect(paused.status).toBe("paused");
    expect(getScanState(site).pausedReason).toBe("indexing_blocked");
    expect(listState(site)).toHaveLength(2);
    expect(kinds()).toEqual([]);

    const res = scanPublicUrlChanges({
      site,
      snapshot: [entry("/a"), entry("/b", "2026-02-01T00:00:00.000Z")],
      indexingBlocked: false,
    });
    expect(res).toMatchObject({ status: "ok", updated: 1, published: 0, removed: 0 });
    expect(getScanState(site).pausedReason).toBeNull();
  });
});

describe("database row updates", () => {
  it("pending updates become updated rows for still-public URLs; gone URLs are dropped", () => {
    scanPublicUrlChanges({ site, snapshot: [entry("/db-a"), entry("/db-b")], indexingBlocked: false });
    queuePendingUpdates(site, [
      { url: `${BASE}/db-a`, entryKey: null, causeEventId: 3 },
      { url: `${BASE}/gone`, entryKey: null, causeEventId: 3 },
    ]);
    const res = scanPublicUrlChanges({ site, snapshot: [entry("/db-a"), entry("/db-b")], indexingBlocked: false });
    expect(res.updated).toBe(1);
    expect(kinds()).toEqual(["updated:/db-a"]);
    const left = publicUrlDb(site).prepare("SELECT COUNT(*) AS c FROM public_url_pending_updates").get() as { c: number };
    expect(left.c).toBe(0);
  });

  it("does not double-log a URL already changed in the same scan", () => {
    scanPublicUrlChanges({ site, snapshot: [entry("/db-a")], indexingBlocked: false });
    queuePendingUpdates(site, [{ url: `${BASE}/db-a`, entryKey: null, causeEventId: 1 }]);
    scanPublicUrlChanges({ site, snapshot: [entry("/db-a", "2026-03-01T00:00:00.000Z")], indexingBlocked: false });
    expect(kinds()).toEqual(["updated:/db-a"]);
  });
});

describe("store", () => {
  it("bookmark only moves forward and listChangesAfter pages from it", () => {
    scanPublicUrlChanges({ site, snapshot: [entry("/a")], indexingBlocked: false });
    scanPublicUrlChanges({ site, snapshot: [entry("/a"), entry("/b"), entry("/c")], indexingBlocked: false });
    const all = listChangesAfter(site, 0, 10);
    expect(all).toHaveLength(2);
    advanceConsumer(site, "indexnow", all[0]!.id);
    expect(listChangesAfter(site, getConsumer(site, "indexnow").lastChangeId, 10)).toHaveLength(1);
    advanceConsumer(site, "indexnow", 0);
    expect(getConsumer(site, "indexnow").lastChangeId).toBe(all[0]!.id);
  });

  it("listRecentChanges filters by page, including moves away from it", () => {
    scanPublicUrlChanges({ site, snapshot: [entry("/old"), entry("/x")], indexingBlocked: false });
    scanPublicUrlChanges({
      site,
      snapshot: [entry("/new"), entry("/x", "2026-05-01T00:00:00.000Z")],
      indexingBlocked: false,
      resolveRedirect: () => `${BASE}/new`,
    });
    expect(listRecentChanges(site, { url: `${BASE}/old` }).map((c) => c.kind)).toEqual(["moved"]);
    expect(listRecentChanges(site, { url: `${BASE}/x` }).map((c) => c.kind)).toEqual(["updated"]);
  });

  it("prunes rows older than 12 months", () => {
    const year = 365 * 24 * 60 * 60 * 1000;
    scanPublicUrlChanges({ site, snapshot: [entry("/a")], indexingBlocked: false, now: 1_000 });
    scanPublicUrlChanges({ site, snapshot: [entry("/a"), entry("/b")], indexingBlocked: false, now: 2_000 });
    scanPublicUrlChanges({ site, snapshot: [entry("/a"), entry("/b"), entry("/c")], indexingBlocked: false, now: 2_000 + year });
    expect(pruneChanges(site, year, 2_000 + year + 10)).toBe(1);
    expect(kinds()).toEqual(["published:/c"]);
  });
});
