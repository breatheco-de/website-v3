import os from "os";
import path from "path";
import fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentIndex } from "../content-index";
import { getVisitsDb, setVisitsDataDirForTests } from "./first-party/visits-db";
import { rowFromMessage, writeBuffered, type PageMessage, type PageViewRow } from "./first-party/ingest";
import { openWindow, closeWindow } from "./first-party/windows";
import { latestCoverage, planFirstPartyWindow, queryFirstPartyPageDetail } from "./first-party/page-detail";
import * as bq from "../ecommerce/bigquery-client";

const flagged = new Set<string>();
vi.mock("../content-types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../content-types")>()),
  getType: (t: string) => t,
  isAdsOptimizedType: (t: string) => flagged.has(t),
}));

const { getAnalyticsReport, clearAnalyticsReportCache, AnalyticsReportValidationError } = await import("./reports");

const SITE = "site_fp-test";
const PAGE = "/en/landing/a";
const NOW = Date.parse("2026-10-29T12:00:00Z");
const ci = { getAlternateUrls: () => ({ en: PAGE }) } as unknown as ContentIndex;
const at = (iso: string) => Date.parse(iso);

let dir: string;
let seq = 0;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-report-"));
  setVisitsDataDirForTests(dir);
  flagged.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearAnalyticsReportCache();
  setVisitsDataDirForTests(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

function db() {
  return getVisitsDb(SITE, { create: true })!;
}

function view(iso: string, p: Partial<PageMessage> = {}): PageViewRow {
  seq += 1;
  return rowFromMessage({ m: "s", id: `rep-${String(seq).padStart(6, "0")}`, u: PAGE, tk: "t", ms: 15_000, ...p } as PageMessage, {
    now: Date.parse(iso),
    contentType: "landing",
    device: "mobile",
    country: "US",
  });
}

function write(rows: PageViewRow[]) {
  writeBuffered(db(), { views: new Map(rows.map((r) => [r.view_key, r])), transitions: new Map(), credits: [] });
}

function report(extra: Record<string, unknown> = {}) {
  return getAnalyticsReport({ report: "page_detail", content_type: "landing", slug: "a", site: SITE, ci, ...extra });
}

async function failure(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AnalyticsReportValidationError);
  return err as InstanceType<typeof AnalyticsReportValidationError>;
}

describe("latestCoverage / planFirstPartyWindow", () => {
  it("starts on the first full day after switch-on and ends yesterday while on", () => {
    const c = latestCoverage([{ content_type: "landing", enabled_at: at("2026-10-10T15:00:00Z"), disabled_at: null }], NOW);
    expect(c).toMatchObject({ collecting_since: "2026-10-11", start: "2026-10-11", end: "2026-10-28", enabled: true });
  });

  it("fails with collecting_since when no full day exists yet", () => {
    const coverage = latestCoverage([{ content_type: "landing", enabled_at: at("2026-10-29T08:00:00Z"), disabled_at: null }], NOW);
    const r = planFirstPartyWindow({ coverage, days: 28, daysExplicit: false, defaultDays: 28, shiftEnd: false, now: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.details.collecting_since).toBe("2026-10-30");
  });
});

describe("queryFirstPartyPageDetail", () => {
  it("excludes reloads and low-quality views from sessions but counts them as views", () => {
    write([
      view("2026-10-20T10:00:00Z", { c: 2 }),
      view("2026-10-21T10:00:00Z"),
      view("2026-10-21T11:00:00Z", { nt: "r" }),
      view("2026-10-22T10:00:00Z", { ms: 300 }),
    ]);
    const d = queryFirstPartyPageDetail(db(), [PAGE], { start: "2026-10-01", end: "2026-10-28" }, NOW);
    expect(d.totals.views).toBe(4);
    expect(d.totals.sessions).toBe(2);
    expect(d.totals.low_quality_excluded).toBe(1);
    expect(d.totals.top_events).toEqual([]);
    expect(d.totals.interactions.cta_clicks).toBe(2);
    expect(d.rows).toEqual([{ path: PAGE, views: 4, sessions: 2 }]);
  });
});

describe("getAnalyticsReport page_detail first_party", () => {
  it("picks the site's own counts for a flagged type, like the drawer", async () => {
    flagged.add("landing");
    openWindow(db(), "landing", at("2026-09-01T10:00:00Z"));
    write([view("2026-10-20T10:00:00Z"), view("2026-10-21T10:00:00Z")]);
    const r = await report({ days: 28 });
    expect(r.source).toBe("first_party");
    expect(r.window_start).toBe("2026-10-01");
    expect(r.window_end).toBe("2026-10-28");
    expect(r.totals.sessions).toBe(2);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["first_party_counts", "first_party_no_events"]));
  });

  it("fails when explicit days reach before coverage, with max_days", async () => {
    flagged.add("landing");
    openWindow(db(), "landing", at("2026-10-15T10:00:00Z"));
    const err = await failure(report({ days: 28 }));
    expect(err.details).toMatchObject({ source: "first_party", available_from: "2026-10-16", max_days: 13 });
  });

  it("shortens omitted days to the covered days", async () => {
    flagged.add("landing");
    openWindow(db(), "landing", at("2026-10-15T10:00:00Z"));
    const r = await report();
    expect(r.window_days).toBe(13);
    expect(r.days_shortened).toBe(true);
    expect(r.window_start).toBe("2026-10-16");
    expect(r.warnings.some((w) => w.code === "first_party_window_shortened")).toBe(true);
  });

  it("does not bridge an off-gap", async () => {
    flagged.add("landing");
    openWindow(db(), "landing", at("2026-09-01T10:00:00Z"));
    closeWindow(db(), "landing", at("2026-10-10T10:00:00Z"));
    openWindow(db(), "landing", at("2026-10-20T10:00:00Z"));
    const err = await failure(report({ days: 20 }));
    expect(err.details).toMatchObject({ available_from: "2026-10-21", max_days: 8 });
  });

  it("fails for explicit first_party on a type that never used the site's own counts", async () => {
    const err = await failure(report({ source: "first_party" }));
    expect(err.message).toContain("never used");
  });

  it("warns when GA4 is forced on a flagged type", async () => {
    flagged.add("landing");
    openWindow(db(), "landing", at("2026-09-01T10:00:00Z"));
    vi.spyOn(bq, "getBigQueryConfigStatus").mockReturnValue({
      configured: false,
      enabled: false,
      settings: { enabled: false, project_id: "", dataset_id: "", location: "US", table_prefix: "events_" },
      credentials_hint: "",
      credentials_source: "none",
      warnings: [],
    });
    const r = await report({ source: "ga4" });
    expect(r.source).toBe("ga4");
    expect(r.warnings.some((w) => w.code === "drawer_uses_first_party")).toBe(true);
  });

  it("ends the window on the switch-off day for explicit first_party on a switched-off type", async () => {
    openWindow(db(), "landing", at("2026-09-20T10:00:00Z"));
    closeWindow(db(), "landing", at("2026-10-15T10:00:00Z"));
    write([view("2026-10-01T10:00:00Z"), view("2026-10-20T10:00:00Z")]);
    const r = await report({ source: "first_party" });
    expect(r.window_end).toBe("2026-10-15");
    expect(r.window_start).toBe("2026-09-21");
    expect(r.window_end_shifted).toBe(true);
    expect(r.totals.sessions).toBe(1);
  });

  it("flags samples below the page-stats minimum", async () => {
    flagged.add("landing");
    openWindow(db(), "landing", at("2026-09-01T10:00:00Z"));
    write([view("2026-10-20T10:00:00Z")]);
    const r = await report();
    expect(r.low_sample).toBe(true);
    expect(r.warnings.some((w) => w.code === "first_party_low_sample")).toBe(true);
  });
});
