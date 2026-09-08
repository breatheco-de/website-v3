import { describe, it, expect } from "vitest";
import {
  filterRowsMatchingPathKey,
  finalizeOrganicUrlQueries,
  organicUrlPathKey,
  sqlNormalizedPathExpression,
} from "./gsc-organic-url-queries";
import { queryUrlOrganicQueries } from "./gsc-bigquery-client";
import fs from "fs";
import os from "os";
import path from "path";
import { resetSettings } from "./settings";

describe("organicUrlPathKey", () => {
  it("normalizes absolute URLs and paths the same way", () => {
    expect(organicUrlPathKey("https://www.4geeks.com/us/css-exercises/")).toBe(
      "/us/css-exercises",
    );
    expect(organicUrlPathKey("/us/css-exercises")).toBe("/us/css-exercises");
  });

  it("returns null for empty", () => {
    expect(organicUrlPathKey("")).toBeNull();
    expect(organicUrlPathKey("   ")).toBeNull();
  });
});

describe("filterRowsMatchingPathKey", () => {
  it("keeps only matching paths across host/trailing-slash variants", () => {
    const rows = [
      { url: "https://4geeks.com/us/css-exercises", query: "a" },
      { url: "https://www.4geeks.com/us/css-exercises/", query: "b" },
      { url: "https://4geeks.com/us/other", query: "c" },
    ];
    const kept = filterRowsMatchingPathKey(rows, "/us/css-exercises");
    expect(kept.map((r) => r.query).sort()).toEqual(["a", "b"]);
  });
});

describe("finalizeOrganicUrlQueries", () => {
  it("drops blank queries, sorts by impressions, derives position and ctr", () => {
    const { queries, truncated } = finalizeOrganicUrlQueries(
      [
        { query: "  ", clicks: 9, impressions: 90, sum_position: 90 },
        { query: "css exercises", clicks: 2, impressions: 20, sum_position: 40 },
        { query: "learn css", clicks: 10, impressions: 100, sum_position: 300 },
      ],
      100,
    );
    expect(truncated).toBe(false);
    expect(queries).toHaveLength(2);
    expect(queries[0]!.query).toBe("learn css");
    expect(queries[0]!.position).toBeCloseTo(3);
    expect(queries[0]!.ctr).toBeCloseTo(0.1);
    expect(queries[1]!.query).toBe("css exercises");
    expect(queries[1]!.position).toBeCloseTo(2);
  });

  it("sets truncated when over cap", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      query: `q${i}`,
      clicks: i,
      impressions: 10 - i,
      sum_position: 10,
    }));
    const { queries, truncated } = finalizeOrganicUrlQueries(rows, 3);
    expect(truncated).toBe(true);
    expect(queries).toHaveLength(3);
  });
});

describe("sqlNormalizedPathExpression", () => {
  it("embeds the url column name", () => {
    expect(sqlNormalizedPathExpression("url")).toContain("REGEXP_EXTRACT(url");
    expect(sqlNormalizedPathExpression("page_url")).toContain("REGEXP_EXTRACT(page_url");
  });
});

describe("queryUrlOrganicQueries not configured", () => {
  let tmp: string;

  it("returns bq_not_configured without throwing", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-bq-q-"));
    fs.writeFileSync(path.join(tmp, "settings.yml"), "i18n: {}\n", "utf-8");
    resetSettings(tmp);
    const result = await queryUrlOrganicQueries({
      urlOrPath: "/us/css-exercises",
      start: "2026-08-01",
      end: "2026-08-28",
      contentRoot: tmp,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("bq_not_configured");
    }
    resetSettings(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns invalid_path for empty url", async () => {
    const result = await queryUrlOrganicQueries({
      urlOrPath: "   ",
      start: "2026-08-01",
      end: "2026-08-28",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_path");
    }
  });
});
