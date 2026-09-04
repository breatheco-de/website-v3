import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { CACHE_DIR } from "./db-cache";
import {
  anyKeepRulesStale,
  buildKeepContext,
  gscOrganicDaysDir,
  loadOrganicDay,
  pruneOrganicDays,
  saveOrganicDay,
  type GscOrganicDayFile,
} from "./gsc-organic-days";
import { KEEP_RULES_VERSION } from "./gsc-keep-filter";
import { aggregateDayRows } from "./seo-organic-opportunities";
import { resetSettings } from "./settings";

const FOLDER = "vitest-gsc-organic-days";

function day(date: string, version: number, rows: GscOrganicDayFile["rows"]): GscOrganicDayFile {
  return {
    date,
    fetched_at: "2026-01-01T00:00:00.000Z",
    keep_rules_version: version,
    truncated: false,
    rows,
  };
}

describe("gsc organic days + weighted position", () => {
  beforeEach(() => {
    fs.rmSync(gscOrganicDaysDir(FOLDER), { recursive: true, force: true });
  });
  afterEach(() => {
    fs.rmSync(gscOrganicDaysDir(FOLDER), { recursive: true, force: true });
  });

  it("flags keep_rules_version mismatch", () => {
    saveOrganicDay(day("2026-08-01", 0, []), FOLDER);
    saveOrganicDay(day("2026-08-02", KEEP_RULES_VERSION, []), FOLDER);
    expect(anyKeepRulesStale(["2026-08-01", "2026-08-02"], FOLDER)).toBe(true);
    expect(loadOrganicDay("2026-08-01", FOLDER)?.keep_rules_version).toBe(0);
  });

  it("does not flag when every day matches KEEP_RULES_VERSION", () => {
    saveOrganicDay(day("2026-08-01", KEEP_RULES_VERSION, []), FOLDER);
    expect(anyKeepRulesStale(["2026-08-01"], FOLDER)).toBe(false);
  });

  it("prunes older than 60 days", () => {
    const dates: string[] = [];
    for (let m = 1; m <= 3; m++) {
      for (let d = 1; d <= 28; d++) {
        dates.push(`2026-0${m}-${String(d).padStart(2, "0")}`);
      }
    }
    for (const d of dates) saveOrganicDay(day(d, KEEP_RULES_VERSION, []), FOLDER);
    expect(dates.length).toBe(84);
    const dropped = pruneOrganicDays(FOLDER, 60);
    expect(dropped.length).toBe(24);
    expect(fs.readdirSync(path.join(CACHE_DIR, FOLDER, "gsc-organic-days")).length).toBe(60);
  });

  it("aggregates impressions-weighted position across days (not average of averages)", () => {
    const rows = aggregateDayRows([
      {
        date: "2026-08-01",
        fetched_at: "",
        keep_rules_version: 1,
        truncated: false,
        rows: [
          {
            query: "python bootcamp",
            url: "https://example.com/a",
            country: "",
            clicks: 0,
            impressions: 300,
            sum_position: 300 * 10,
            ctr: 0,
          },
        ],
      },
      {
        date: "2026-08-02",
        fetched_at: "",
        keep_rules_version: 1,
        truncated: false,
        rows: [
          {
            query: "python bootcamp",
            url: "https://example.com/a",
            country: "",
            clicks: 0,
            impressions: 100,
            sum_position: 100 * 20,
            ctr: 0,
          },
        ],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.position).toBeCloseTo(12.5);
    expect(rows[0]!.impressions).toBe(400);
  });
});

describe("buildKeepContext hosts", () => {
  let tmp: string;
  let prevSiteUrl: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-keep-ctx-"));
    prevSiteUrl = process.env.SITE_URL;
    process.env.SITE_URL = "https://donna-privacy-treating-funeral.trycloudflare.com";
    resetSettings(tmp);
  });

  afterEach(() => {
    if (prevSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = prevSiteUrl;
    resetSettings(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("ignores SITE_URL tunnels and uses Search Console site_url", () => {
    fs.writeFileSync(
      path.join(tmp, "settings.yml"),
      `search_console:
  site_url: sc-domain:4geeks.com
`,
      "utf-8",
    );
    resetSettings(tmp);
    const ctx = buildKeepContext(tmp);
    expect([...ctx.ourHosts]).toEqual(["4geeks.com"]);
  });

  it("leaves hosts empty when Search Console site_url is unset (do not lock to SITE_URL)", () => {
    fs.writeFileSync(path.join(tmp, "settings.yml"), "i18n: {}\n", "utf-8");
    resetSettings(tmp);
    const ctx = buildKeepContext(tmp);
    expect(ctx.ourHosts.size).toBe(0);
  });
});
