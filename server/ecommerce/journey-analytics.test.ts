import { describe, expect, it, afterEach } from "vitest";
import { normalizeAnalyticsPath } from "./journey-analytics";
import {
  DEFAULT_TRACKING_BIGQUERY,
  parseTrackingBigQuerySettings,
} from "../settings";
import {
  clearBigQueryClientCache,
  resolveBigQueryCredentials,
} from "./bigquery-client";

describe("normalizeAnalyticsPath", () => {
  it("strips origin query and hash without rewriting locale prefixes", () => {
    // Paths mirror content-type url_patterns; normalizer only cleans shape.
    expect(normalizeAnalyticsPath("https://4geeks.com/en/career-programs/foo?x=1#y")).toBe(
      "/en/career-programs/foo",
    );
    expect(normalizeAnalyticsPath("https://4geeks.com/es/programas-de-carrera/foo?x=1")).toBe(
      "/es/programas-de-carrera/foo",
    );
  });

  it("removes trailing slash except root", () => {
    expect(normalizeAnalyticsPath("/en/foo/")).toBe("/en/foo");
    expect(normalizeAnalyticsPath("/")).toBe("/");
  });

  it("adds leading slash", () => {
    expect(normalizeAnalyticsPath("en/foo")).toBe("/en/foo");
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

describe("resolveBigQueryCredentials", () => {
  const prevJson = process.env.GCS_CREDENTIALS_JSON;
  const prevKey = process.env.GCS_KEY_FILENAME;
  const prevGac = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  afterEach(() => {
    if (prevJson === undefined) delete process.env.GCS_CREDENTIALS_JSON;
    else process.env.GCS_CREDENTIALS_JSON = prevJson;
    if (prevKey === undefined) delete process.env.GCS_KEY_FILENAME;
    else process.env.GCS_KEY_FILENAME = prevKey;
    if (prevGac === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = prevGac;
    clearBigQueryClientCache();
  });

  it("prefers GCS_CREDENTIALS_JSON", () => {
    delete process.env.GCS_KEY_FILENAME;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GCS_CREDENTIALS_JSON = JSON.stringify({
      client_email: "sa@example.com",
      private_key: "x",
    });
    const r = resolveBigQueryCredentials();
    expect(r.source).toBe("gcs_json");
    if (r.source === "gcs_json") {
      expect(r.credentials.client_email).toBe("sa@example.com");
    }
  });

  it("uses GCS_KEY_FILENAME when JSON absent", () => {
    delete process.env.GCS_CREDENTIALS_JSON;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GCS_KEY_FILENAME = "/tmp/sa.json";
    expect(resolveBigQueryCredentials().source).toBe("gcs_key_file");
  });
});
