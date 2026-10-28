import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bufferCredit,
  bufferPageView,
  bufferTransition,
  deviceFromUserAgent,
  flushSite,
  pageMessageSchema,
  pruneVisits,
  resetVisitBuffersForTests,
  rowFromMessage,
  setPageViewCountry,
  type PageMessage,
} from "./ingest";
import { closeVisitsDbs, getVisitsDb, openVisitsDatabase, setVisitsDataDirForTests } from "./visits-db";
import { getVisitsSchemaVersion, runVisitsMigrations, VISITS_SCHEMA_VERSION } from "./visits-schema";
import { closeWindow, listWindows, openWindow } from "./windows";

const NOW = Date.parse("2026-10-27T15:42:31Z");
const ctx = { now: NOW, contentType: "landing", device: "mobile", country: "US" };

function msg(p: Partial<PageMessage>): PageMessage {
  return { m: "a", id: "view-0001", u: "/en/landing/a", tk: "t", ...p } as PageMessage;
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "visits-"));
  setVisitsDataDirForTests(dir);
  resetVisitBuffersForTests();
});
afterEach(() => {
  closeVisitsDbs();
  setVisitsDataDirForTests(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("visits.db schema", () => {
  it("creates a fresh file at the current version and re-running is a no-op", () => {
    const db = openVisitsDatabase(path.join(dir, "s", "visits.db"));
    expect(getVisitsSchemaVersion(db)).toBe(VISITS_SCHEMA_VERSION);
    expect(runVisitsMigrations(db)).toBe(VISITS_SCHEMA_VERSION);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(["fp_page_views", "fp_type_windows", "fp_path_credits", "fp_transitions", "fp_daily"]));
  });

  it("upgrades a file at version 0 (empty) without losing unrelated tables", () => {
    const file = path.join(dir, "old.db");
    const raw = new Database(file);
    raw.exec("CREATE TABLE keep_me (x INTEGER); INSERT INTO keep_me VALUES (1);");
    expect(getVisitsSchemaVersion(raw)).toBe(0);
    runVisitsMigrations(raw);
    expect(getVisitsSchemaVersion(raw)).toBe(VISITS_SCHEMA_VERSION);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM keep_me").get()).toEqual({ n: 1 });
    raw.close();
  });

  it("read paths never create the file", () => {
    expect(getVisitsDb("site_x")).toBeNull();
    expect(fs.existsSync(path.join(dir, "site_x", "visits.db"))).toBe(false);
  });
});

describe("rowFromMessage", () => {
  it("counts a fresh landing as a visit and an entrance, minute-rounded UTC", () => {
    const r = rowFromMessage(msg({ nt: "n", rh: "www.google.com", q: { s: "Google", m: "CPC", c: "fall" }, ck: "gclid" }), ctx);
    expect(r).toMatchObject({ counted_visit: 1, entrance: 1, channel: "paid", source: "google", medium: "cpc", click_id_type: "gclid", day: "2026-10-27" });
    expect(r.arrived_at).toBe(Date.parse("2026-10-27T15:42:00Z"));
  });

  it("does not count reloads or back/forward as visits", () => {
    expect(rowFromMessage(msg({ nt: "r" }), ctx)).toMatchObject({ counted_visit: 0, entrance: 0 });
    expect(rowFromMessage(msg({ nt: "b" }), ctx)).toMatchObject({ counted_visit: 0, entrance: 0 });
  });

  it("files in-site page views as internal and keeps the previous path", () => {
    const r = rowFromMessage(msg({ nt: "s", pp: "/en/blog/post/" }), ctx);
    expect(r).toMatchObject({ entrance: 0, channel: "internal", prev_path: "/en/blog/post" });
  });

  it("marks engaged and low-quality visits from the summary", () => {
    expect(rowFromMessage(msg({ m: "s", ms: 12_000 }), ctx)).toMatchObject({ engaged: 1, low_quality: 0, seconds: 12 });
    expect(rowFromMessage(msg({ m: "s", ms: 400 }), ctx)).toMatchObject({ engaged: 0, low_quality: 1 });
    expect(rowFromMessage(msg({ m: "s", ms: 400, i: 1 }), ctx)).toMatchObject({ low_quality: 0 });
    expect(rowFromMessage(msg({ m: "s", ms: 3000, nx: "/en/apply" }), ctx)).toMatchObject({ engaged: 1, next_path: "/en/apply" });
  });

  it("never stores a click-ID value, only a known parameter name", () => {
    expect(rowFromMessage(msg({ ck: "gclid" }), ctx).click_id_type).toBe("gclid");
    expect(rowFromMessage(msg({ ck: "abc123" }), ctx).click_id_type).toBeNull();
  });
});

describe("message keys", () => {
  it("contain no tracker-blocklist words", () => {
    const words = /track|analytic|collect|beacon|pixel|pageview|hit|stats|metric|event/i;
    const keys = Object.keys(pageMessageSchema.shape);
    for (const k of keys) expect(k).not.toMatch(words);
    for (const p of ["/api/page-ready", "/api/page-link"]) expect(p).not.toMatch(words);
  });
});

function rows(site: string) {
  return getVisitsDb(site)!.prepare("SELECT * FROM fp_page_views ORDER BY view_key").all() as Array<Record<string, unknown>>;
}

describe("buffer + flush", () => {
  it("arrival only: a counted visit that is not engaged", () => {
    bufferPageView("s1", rowFromMessage(msg({}), ctx));
    flushSite("s1");
    expect(rows("s1")).toMatchObject([{ counted_visit: 1, summary_received: 0, engaged: 0 }]);
  });

  it("summary after arrival (same or later flush) keeps the arrival minute; latest summary wins", () => {
    bufferPageView("s1", rowFromMessage(msg({}), ctx));
    flushSite("s1");
    bufferPageView("s1", rowFromMessage(msg({ m: "s", ms: 2000 }), { ...ctx, now: NOW + 5 * 60_000 }));
    bufferPageView("s1", rowFromMessage(msg({ m: "s", ms: 15_000, c: 1 }), { ...ctx, now: NOW + 6 * 60_000 }));
    flushSite("s1");
    const [r] = rows("s1");
    expect(r).toMatchObject({ summary_received: 1, seconds: 15, cta_clicks: 1, engaged: 1, arrived_at: Date.parse("2026-10-27T15:42:00Z") });
  });

  it("summary only (arrival lost) still creates the row; a late arrival does not overwrite it", () => {
    bufferPageView("s1", rowFromMessage(msg({ m: "s", ms: 20_000 }), ctx));
    flushSite("s1");
    bufferPageView("s1", rowFromMessage(msg({}), ctx));
    flushSite("s1");
    expect(rows("s1")).toMatchObject([{ summary_received: 1, seconds: 20 }]);
  });

  it("fills the country after a background lookup, buffered or already written, and a later summary keeps it", () => {
    const noCountry = { ...ctx, country: null };
    bufferPageView("s1", rowFromMessage(msg({ id: "view-c1" }), noCountry));
    setPageViewCountry("s1", "view-c1", "CO");
    bufferPageView("s1", rowFromMessage(msg({ id: "view-c1", m: "s", ms: 5000 }), noCountry));
    bufferPageView("s1", rowFromMessage(msg({ id: "view-c2" }), noCountry));
    flushSite("s1");
    setPageViewCountry("s1", "view-c2", "MX");
    expect(rows("s1").map((r) => [r.view_key, r.country])).toEqual([
      ["view-c1", "CO"],
      ["view-c2", "MX"],
    ]);
  });

  it("adds transitions and credits earlier page views once", () => {
    bufferPageView("s1", rowFromMessage(msg({ id: "view-aaaa" }), ctx));
    bufferTransition("s1", "2026-10-27", "/en/landing/a", "/en/programs");
    bufferTransition("s1", "2026-10-27", "/en/landing/a", "/en/programs");
    bufferCredit("s1", "reached_decision", ["view-aaaa", "missing-key"]);
    bufferCredit("s1", "reached_decision", ["view-aaaa"]);
    flushSite("s1");
    const db = getVisitsDb("s1")!;
    expect(db.prepare("SELECT count FROM fp_transitions").get()).toEqual({ count: 2 });
    expect(rows("s1")[0]).toMatchObject({ reached_decision: 1 });
    expect(db.prepare("SELECT kind, count FROM fp_path_credits").all()).toEqual([{ kind: "reached_decision", count: 1 }]);
  });
});

describe("pruneVisits", () => {
  it("keeps daily totals and deletes raw rows older than 90 days in batches", async () => {
    const old = Date.parse("2026-06-01T10:00:00Z");
    for (let i = 0; i < 12; i++) {
      bufferPageView("s1", rowFromMessage(msg({ id: `old-view-${i}`, m: "s", ms: 15_000 }), { ...ctx, now: old }));
    }
    bufferPageView("s1", rowFromMessage(msg({ id: "new-view-1" }), ctx));
    flushSite("s1");
    const db = getVisitsDb("s1")!;
    const removed = await pruneVisits(db, NOW, 0);
    expect(removed).toBe(12);
    expect(rows("s1").map((r) => r.view_key)).toEqual(["new-view-1"]);
    expect(db.prepare("SELECT sessions, engaged FROM fp_daily WHERE day = '2026-06-01'").get()).toEqual({ sessions: 12, engaged: 12 });
  });
});

describe("on/off windows", () => {
  it("opens once, closes, and reopens as a new period", () => {
    const db = openVisitsDatabase(path.join(dir, "w", "visits.db"));
    openWindow(db, "landing", 1000);
    openWindow(db, "landing", 2000);
    closeWindow(db, "landing", 3000);
    openWindow(db, "landing", 4000);
    expect(listWindows(db, "landing")).toEqual([
      { content_type: "landing", enabled_at: 1000, disabled_at: 3000 },
      { content_type: "landing", enabled_at: 4000, disabled_at: null },
    ]);
  });
});

describe("deviceFromUserAgent", () => {
  it("splits mobile, tablet and desktop", () => {
    expect(deviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148")).toBe("mobile");
    expect(deviceFromUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Safari/537.36")).toBe("tablet");
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36")).toBe("mobile");
    expect(deviceFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("desktop");
  });
});
