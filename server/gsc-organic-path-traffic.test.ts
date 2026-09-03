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
  sumPathTraffic,
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
            clicks: 10,
            impressions: 100,
            sum_position: 500,
            ctr: 0.1,
          },
          {
            query: "ai engineer salary",
            url: "https://example.com/us/ai-engineer",
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
  });
});
