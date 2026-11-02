import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeVisitsDbs, getVisitsDb, setVisitsDataDirForTests } from "../analytics/first-party/visits-db";
import { resetVisitBuffersForTests } from "../analytics/first-party/ingest";
import { coveredDays, makeOwnPaidVisitsLookup } from "./own-paid-visits";

const SITE = "site_own_paid";
const NOW = Date.parse("2026-10-21T12:00:00Z");

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "own-paid-"));
  setVisitsDataDirForTests(dir);
  resetVisitBuffersForTests();
});
afterEach(() => {
  closeVisitsDbs();
  setVisitsDataDirForTests(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

function seed(opts: { windowFrom: string; windowTo: string | null }) {
  const db = getVisitsDb(SITE, { create: true })!;
  db.prepare("INSERT INTO fp_type_windows (content_type, enabled_at, disabled_at) VALUES (?, ?, ?)").run(
    "landing",
    Date.parse(opts.windowFrom),
    opts.windowTo ? Date.parse(opts.windowTo) : null,
  );
  const insert = db.prepare(
    `INSERT INTO fp_page_views (view_key, arrived_at, day, nav_type, counted_visit, summary_received, low_quality, path, channel)
     VALUES (?, ?, ?, 'n', ?, 1, ?, ?, ?)`,
  );
  let i = 0;
  const add = (day: string, p: string, channel: string, counted = 1, low = 0) =>
    insert.run(`v${i++}`, Date.parse(`${day}T10:00:00Z`), day, counted, low, p, channel);
  add("2026-10-10", "/en/landing/a", "paid");
  add("2026-10-11", "/en/landing/a", "paid");
  add("2026-10-11", "/en/landing/old-a", "paid");
  add("2026-10-11", "/en/landing/a", "paid", 0);
  add("2026-10-11", "/en/landing/a", "paid", 1, 1);
  add("2026-10-11", "/en/landing/a", "organic_search");
  add("2026-09-01", "/en/landing/a", "paid");
}

const row = (over: Partial<{ kind: string; content_type: string | null; path: string; redirected_from: string[] }> = {}) => ({
  kind: "entry",
  content_type: "landing",
  path: "/en/landing/a",
  redirected_from: ["/en/landing/old-a"],
  ...over,
});

describe("coveredDays", () => {
  it("counts days in the range touched by a counting window", () => {
    const w = [{ content_type: "landing", enabled_at: Date.parse("2026-10-05T15:00:00Z"), disabled_at: Date.parse("2026-10-07T09:00:00Z") }];
    expect(coveredDays(w, { start: "2026-10-01", end: "2026-10-10" }, NOW)).toBe(3);
    expect(coveredDays([], { start: "2026-10-01", end: "2026-10-10" }, NOW)).toBe(0);
  });
});

describe("makeOwnPaidVisitsLookup", () => {
  it("sums good paid visits on the page and its redirected paths inside the range", () => {
    seed({ windowFrom: "2026-10-01T00:00:00Z", windowTo: null });
    const lookup = makeOwnPaidVisitsLookup({
      site: SITE,
      contentRoot: dir,
      window: { start: "2026-10-01", end: "2026-10-20", days: 20 },
      rows: [row()],
      now: NOW,
    });
    expect(lookup(row())).toEqual({ paid_visits: 3, covered_days: 20, total_days: 20 });
  });

  it("reports partial coverage when counting started inside the range", () => {
    seed({ windowFrom: "2026-10-10T00:00:00Z", windowTo: null });
    const lookup = makeOwnPaidVisitsLookup({
      site: SITE,
      contentRoot: dir,
      window: { start: "2026-10-01", end: "2026-10-20", days: 20 },
      rows: [row()],
      now: NOW,
    });
    expect(lookup(row())).toMatchObject({ covered_days: 11, total_days: 20 });
  });

  it("returns nothing for types never counted, non-entry rows, or a site with no visits file", () => {
    expect(
      makeOwnPaidVisitsLookup({ site: SITE, contentRoot: dir, window: { start: "2026-10-01", end: "2026-10-20", days: 20 }, rows: [row()], now: NOW })(row()),
    ).toBeNull();
    seed({ windowFrom: "2026-10-01T00:00:00Z", windowTo: null });
    const lookup = makeOwnPaidVisitsLookup({
      site: SITE,
      contentRoot: dir,
      window: { start: "2026-10-01", end: "2026-10-20", days: 20 },
      rows: [row(), row({ content_type: "blog" })],
      now: NOW,
    });
    expect(lookup(row({ content_type: "blog" }))).toBeNull();
    expect(lookup(row({ kind: "instant_form" }))).toBeNull();
  });
});
