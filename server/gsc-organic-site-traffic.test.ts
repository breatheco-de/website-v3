import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { CACHE_DIR } from "./db-cache";

const FOLDER = "vitest-gsc-organic-site-traffic";

vi.mock("./gsc-bigquery-client", () => ({
  getGscBigQueryConfigStatus: vi.fn(),
  querySiteOrganicDailyTotals: vi.fn(),
}));

import {
  getGscBigQueryConfigStatus,
  querySiteOrganicDailyTotals,
} from "./gsc-bigquery-client";
import { buildSiteOrganicTraffic, SITE_ORGANIC_CACHE_TTL_MS } from "./gsc-organic-site-traffic";

const mockedStatus = vi.mocked(getGscBigQueryConfigStatus);
const mockedQuery = vi.mocked(querySiteOrganicDailyTotals);

function cacheDir() {
  return path.join(CACHE_DIR, FOLDER, "gsc-organic-site-totals");
}

describe("buildSiteOrganicTraffic", () => {
  beforeEach(() => {
    fs.rmSync(path.join(CACHE_DIR, FOLDER), { recursive: true, force: true });
    vi.clearAllMocks();
  });
  afterEach(() => {
    fs.rmSync(path.join(CACHE_DIR, FOLDER), { recursive: true, force: true });
  });

  it("returns empty when BigQuery is not configured", async () => {
    mockedStatus.mockReturnValue({
      configured: false,
      enabled: false,
      settings: {
        enabled: false,
        project_id: "",
        dataset_id: "",
        location: "US",
        url_impression_table: "searchdata_url_impression",
        export_log_table: "ExportLog",
      },
      credentials_hint: "",
      credentials_source: "none",
      warnings: ["Search Console BigQuery is disabled in settings."],
    });

    const result = await buildSiteOrganicTraffic({
      contentFolder: FOLDER,
      now: new Date("2026-09-03T12:00:00.000Z"),
    });

    expect(result.configured).toBe(false);
    expect(result.days_in_window).toBe(0);
    expect(result.totals).toEqual({ clicks: 0, impressions: 0, ctr: 0 });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("queries BigQuery, caches, and returns site totals", async () => {
    mockedStatus.mockReturnValue({
      configured: true,
      enabled: true,
      settings: {
        enabled: true,
        project_id: "p",
        dataset_id: "d",
        location: "US",
        url_impression_table: "searchdata_url_impression",
        export_log_table: "ExportLog",
      },
      credentials_hint: "",
      credentials_source: "gcs_json",
      warnings: [],
    });
    mockedQuery.mockResolvedValue([
      { day: "2026-08-04", clicks: 10, impressions: 100 },
      { day: "2026-08-05", clicks: 20, impressions: 200 },
    ]);

    const result = await buildSiteOrganicTraffic({
      contentFolder: FOLDER,
      days: 28,
      now: new Date("2026-09-03T12:00:00.000Z"),
    });

    expect(result.source).toBe("bigquery");
    expect(result.configured).toBe(true);
    expect(result.days_in_window).toBe(2);
    expect(result.incomplete).toBe(true);
    expect(result.totals).toEqual({ clicks: 30, impressions: 300, ctr: 0.1 });
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(cacheDir())).toBe(true);

    mockedQuery.mockClear();
    const cached = await buildSiteOrganicTraffic({
      contentFolder: FOLDER,
      days: 28,
      now: new Date("2026-09-03T12:00:00.000Z"),
    });
    expect(cached.source).toBe("cache");
    expect(cached.totals.clicks).toBe(30);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("falls back to stale cache when BigQuery fails", async () => {
    mockedStatus.mockReturnValue({
      configured: true,
      enabled: true,
      settings: {
        enabled: true,
        project_id: "p",
        dataset_id: "d",
        location: "US",
        url_impression_table: "searchdata_url_impression",
        export_log_table: "ExportLog",
      },
      credentials_hint: "",
      credentials_source: "gcs_json",
      warnings: [],
    });
    mockedQuery.mockResolvedValue([{ day: "2026-08-04", clicks: 5, impressions: 50 }]);

    await buildSiteOrganicTraffic({
      contentFolder: FOLDER,
      days: 28,
      now: new Date("2026-09-03T12:00:00.000Z"),
    });

    const files = fs.readdirSync(cacheDir());
    const filePath = path.join(cacheDir(), files[0]!);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { fetched_at: string };
    parsed.fetched_at = new Date(Date.now() - SITE_ORGANIC_CACHE_TTL_MS - 1000).toISOString();
    fs.writeFileSync(filePath, JSON.stringify(parsed), "utf-8");

    mockedQuery.mockRejectedValue(new Error("BQ unavailable"));
    const result = await buildSiteOrganicTraffic({
      contentFolder: FOLDER,
      days: 28,
      now: new Date("2026-09-03T12:00:00.000Z"),
    });

    expect(result.source).toBe("cache");
    expect(result.totals.clicks).toBe(5);
    expect(result.error).toMatch(/BQ unavailable/);
  });
});
