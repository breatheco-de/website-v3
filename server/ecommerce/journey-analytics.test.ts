import { describe, expect, it } from "vitest";
import { normalizeAnalyticsPath } from "./journey-analytics";
import {
  DEFAULT_TRACKING_BIGQUERY,
  parseTrackingBigQuerySettings,
} from "../settings";

describe("normalizeAnalyticsPath", () => {
  it("strips origin query and hash", () => {
    expect(normalizeAnalyticsPath("https://4geeks.com/us/ai-fluency?x=1#y")).toBe(
      "/us/ai-fluency",
    );
  });

  it("removes trailing slash except root", () => {
    expect(normalizeAnalyticsPath("/us/foo/")).toBe("/us/foo");
    expect(normalizeAnalyticsPath("/")).toBe("/");
  });

  it("adds leading slash", () => {
    expect(normalizeAnalyticsPath("us/foo")).toBe("/us/foo");
  });
});

describe("parseTrackingBigQuerySettings", () => {
  it("returns defaults for empty", () => {
    expect(parseTrackingBigQuerySettings(undefined)).toEqual(DEFAULT_TRACKING_BIGQUERY);
  });

  it("normalizes table_prefix with trailing underscore", () => {
    const parsed = parseTrackingBigQuerySettings({
      enabled: true,
      project_id: "p",
      dataset_id: "d",
      table_prefix: "events",
    });
    expect(parsed.table_prefix).toBe("events_");
    expect(parsed.enabled).toBe(true);
  });
});
