import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import {
  gscOrganicDaysDir,
  saveOrganicDay,
  type GscOrganicDayFile,
} from "./gsc-organic-days";
import { KEEP_RULES_VERSION } from "./gsc-keep-filter";
import {
  aggregateTrafficByPath,
  buildOrganicPathTraffic,
  lookupPathTraffic,
  pathKeyFromUrlOrPath,
  sumDayTrafficSeries,
  sumPathTraffic,
  sumSeriesTotals,
  sumTrafficForPathSet,
} from "./gsc-organic-path-traffic";

const FOLDER = "vitest-gsc-organic-path-traffic";

function day(date: string, rows: GscOrganicDayFile["rows"]): GscOrganicDayFile {
  return {
    date,
    fetched_at: "2026-01-01T00:00:00.000Z",
    keep_rules_version: KEEP_RULES_VERSION,
    truncated: false,
    rows,
  };
}

describe("gsc-organic-path-traffic", () => {
  beforeEach(() => {
    fs.rmSync(gscOrganicDaysDir(FOLDER), { recursive: true, force: true });
  });
  afterEach(() => {
    fs.rmSync(gscOrganicDaysDir(FOLDER), { recursive: true, force: true });
  });

  it("pathKeyFromUrlOrPath normalizes absolute URLs and site paths", () => {
    expect(pathKeyFromUrlOrPath("https://www.4geeks.com/us/ai-engineer/")).toBe("/us/ai-engineer");
    expect(pathKeyFromUrlOrPath("/us/ai-engineer/")).toBe("/us/ai-engineer");
    expect(pathKeyFromUrlOrPath("")).toBeNull();
  });

  it("aggregates multi-query same URL into one path", () => {
    const byPath = aggregateTrafficByPath([
      {
        rows: [
          {
            query: "ai engineer",
            url: "https://example.com/us/ai-engineer",
            country: "",
            clicks: 10,
            impressions: 100,
            sum_position: 500,
            ctr: 0.1,
          },
          {
            query: "ai engineer salary",
            url: "https://example.com/us/ai-engineer",
            country: "",
            clicks: 5,
            impressions: 50,
            sum_position: 400,
            ctr: 0.1,
          },
        ],
      },
    ]);
    expect(byPath["/us/ai-engineer"]).toEqual({
      clicks: 15,
      impressions: 150,
      position: 900 / 150,
    });
  });

  it("lookup matches relative path to absolute GSC URL", () => {
    const byPath = aggregateTrafficByPath([
      {
        rows: [
          {
            query: "x",
            url: "https://4geeks.com/es/bootcamp/",
            country: "",
            clicks: 3,
            impressions: 30,
            sum_position: 150,
            ctr: 0.1,
          },
        ],
      },
    ]);
    expect(lookupPathTraffic(byPath, "/es/bootcamp")?.clicks).toBe(3);
    expect(lookupPathTraffic(byPath, "/missing")).toBeUndefined();
  });

  it("sumPathTraffic rolls hub + members; all missing stays undefined", () => {
    expect(sumPathTraffic([undefined, null])).toBeUndefined();
    const sum = sumPathTraffic([
      { clicks: 10, impressions: 100, position: 5 },
      { clicks: 2, impressions: 20, position: 10 },
      undefined,
    ]);
    expect(sum?.clicks).toBe(12);
    expect(sum?.impressions).toBe(120);
    expect(sum?.position).toBeCloseTo((100 * 5 + 20 * 10) / 120);
  });

  it("buildOrganicPathTraffic returns empty window when no day files", () => {
    const result = buildOrganicPathTraffic({ contentFolder: FOLDER });
    expect(result.window).toBeNull();
    expect(result.byPath).toEqual({});
    expect(result.incomplete).toBe(true);
    expect(result.days_in_window).toBe(0);
    expect(result.totals).toEqual({ clicks: 0, impressions: 0, ctr: 0 });
    expect(result.series).toEqual([]);
  });

  it("buildOrganicPathTraffic loads present days in the 28d window", () => {
    // completeDataDates ends at UTC today-2; write that latest date so loadDaysRange finds it
    const now = new Date();
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2));
    const date = last.toISOString().slice(0, 10);
    saveOrganicDay(
      day(date, [
        {
          query: "hub",
          url: "https://example.com/us/hub",
          country: "",
          clicks: 7,
          impressions: 70,
          sum_position: 350,
          ctr: 0.1,
        },
      ]),
      FOLDER,
    );
    const result = buildOrganicPathTraffic({ contentFolder: FOLDER });
    expect(result.window).not.toBeNull();
    expect(result.window?.end).toBe(date);
    expect(result.byPath["/us/hub"]?.clicks).toBe(7);
    expect(result.days_in_window).toBe(1);
    expect(result.days_expected).toBe(28);
    expect(result.incomplete).toBe(true);
    expect(result.totals).toEqual({ clicks: 7, impressions: 70, ctr: 0.1 });
    expect(result.series).toEqual([{ day: date, clicks: 7, impressions: 70 }]);
  });

  it("buildOrganicPathTraffic ignores empty day stubs when counting days_in_window", () => {
    const now = new Date();
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2));
    const withData = last.toISOString().slice(0, 10);
    const emptyDay = new Date(last);
    emptyDay.setUTCDate(last.getUTCDate() - 1);
    const emptyDate = emptyDay.toISOString().slice(0, 10);

    saveOrganicDay(day(emptyDate, []), FOLDER);
    saveOrganicDay(
      day(withData, [
        {
          query: "hub",
          url: "https://example.com/us/hub",
          country: "",
          clicks: 4,
          impressions: 40,
          sum_position: 200,
          ctr: 0.1,
        },
      ]),
      FOLDER,
    );

    const result = buildOrganicPathTraffic({ contentFolder: FOLDER });
    expect(result.days_in_window).toBe(1);
    expect(result.incomplete).toBe(true);
    expect(result.totals.clicks).toBe(4);
  });

  it("buildOrganicPathTraffic filters by market country", () => {
    const now = new Date();
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2));
    const date = last.toISOString().slice(0, 10);
    saveOrganicDay(
      day(date, [
        {
          query: "hub",
          url: "https://example.com/us/hub",
          country: "usa",
          clicks: 7,
          impressions: 70,
          sum_position: 350,
          ctr: 0.1,
        },
        {
          query: "hub",
          url: "https://example.com/us/hub",
          country: "esp",
          clicks: 3,
          impressions: 30,
          sum_position: 90,
          ctr: 0.1,
        },
        {
          query: "hub",
          url: "https://example.com/us/hub",
          country: "",
          clicks: 1,
          impressions: 10,
          sum_position: 50,
          ctr: 0.1,
        },
      ]),
      FOLDER,
    );
    const worldwide = buildOrganicPathTraffic({ contentFolder: FOLDER, market: "worldwide" });
    expect(worldwide.byPath["/us/hub"]?.clicks).toBe(11);
    const usa = buildOrganicPathTraffic({ contentFolder: FOLDER, market: "usa" });
    expect(usa.byPath["/us/hub"]?.clicks).toBe(7);
    expect(usa.market.id).toBe("usa");
    const spain = buildOrganicPathTraffic({ contentFolder: FOLDER, market: "spain" });
    expect(spain.byPath["/us/hub"]?.clicks).toBe(3);
  });

  it("sumDayTrafficSeries sums rows per day; empty rows are zeros", () => {
    const series = sumDayTrafficSeries([
      {
        date: "2026-08-01",
        rows: [
          {
            query: "a",
            url: "https://example.com/a",
            country: "",
            clicks: 2,
            impressions: 20,
            sum_position: 40,
            ctr: 0.1,
          },
          {
            query: "b",
            url: "https://example.com/b",
            country: "",
            clicks: 3,
            impressions: 30,
            sum_position: 90,
            ctr: 0.1,
          },
        ],
      },
      { date: "2026-08-02", rows: [] },
      {
        date: "2026-08-03",
        rows: [
          {
            query: "c",
            url: "https://example.com/c",
            country: "",
            clicks: 5,
            impressions: 50,
            sum_position: 100,
            ctr: 0.1,
          },
        ],
      },
    ]);
    expect(series).toEqual([
      { day: "2026-08-01", clicks: 5, impressions: 50 },
      { day: "2026-08-02", clicks: 0, impressions: 0 },
      { day: "2026-08-03", clicks: 5, impressions: 50 },
    ]);
    expect(sumSeriesTotals(series)).toEqual({
      clicks: 10,
      impressions: 100,
      ctr: 0.1,
    });
    expect(sumSeriesTotals([])).toEqual({ clicks: 0, impressions: 0, ctr: 0 });
  });

  it("sumDayTrafficSeries and kpiPaths scope totals to cluster paths only", () => {
    const files = [
      {
        date: "2026-08-01",
        rows: [
          {
            query: "hub",
            url: "https://example.com/us/hub",
            country: "",
            clicks: 10,
            impressions: 100,
            sum_position: 200,
            ctr: 0.1,
          },
          {
            query: "orphan",
            url: "https://example.com/us/orphan",
            country: "",
            clicks: 50,
            impressions: 500,
            sum_position: 1000,
            ctr: 0.1,
          },
        ],
      },
    ];
    const clusterOnly = sumDayTrafficSeries(files, new Set(["/us/hub"]));
    expect(clusterOnly).toEqual([{ day: "2026-08-01", clicks: 10, impressions: 100 }]);
    expect(sumSeriesTotals(clusterOnly)).toEqual({ clicks: 10, impressions: 100, ctr: 0.1 });
    expect(sumTrafficForPathSet(aggregateTrafficByPath(files), new Set(["/us/hub"]))).toEqual({
      clicks: 10,
      impressions: 100,
      ctr: 0.1,
    });
  });

  it("buildOrganicPathTraffic kpiPaths scopes series/totals but keeps full byPath", () => {
    const now = new Date();
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2));
    const date = last.toISOString().slice(0, 10);
    saveOrganicDay(
      day(date, [
        {
          query: "hub",
          url: "https://example.com/us/hub",
          country: "",
          clicks: 7,
          impressions: 70,
          sum_position: 350,
          ctr: 0.1,
        },
        {
          query: "other",
          url: "https://example.com/us/other",
          country: "",
          clicks: 100,
          impressions: 1000,
          sum_position: 2000,
          ctr: 0.1,
        },
      ]),
      FOLDER,
    );
    const result = buildOrganicPathTraffic({
      contentFolder: FOLDER,
      kpiPaths: new Set(["/us/hub"]),
    });
    expect(result.byPath["/us/hub"]?.clicks).toBe(7);
    expect(result.byPath["/us/other"]?.clicks).toBe(100);
    expect(result.totals).toEqual({ clicks: 7, impressions: 70, ctr: 0.1 });
    expect(result.series).toEqual([{ day: date, clicks: 7, impressions: 70 }]);
  });
});
