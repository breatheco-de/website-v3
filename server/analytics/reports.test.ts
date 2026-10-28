import { describe, expect, it, afterEach, vi } from "vitest";
import {
  resolvePageDetailPaths,
  clearAnalyticsReportCache,
  AnalyticsReportValidationError,
  getAnalyticsReport,
} from "./reports";
import * as bq from "../ecommerce/bigquery-client";
import * as settings from "../settings";

vi.mock("../content-index", () => ({
  contentIndex: {
    getAlternateUrls: (slug: string, contentType: string) => {
      if (contentType === "program" && slug === "ai-fluency") {
        return { en: "/us/coding-bootcamps/ai-fluency", es: "/es/bootcamps/ai-fluency" };
      }
      if (contentType === "blog" && slug === "hello") {
        return { en: "/en/blog/hello" };
      }
      return {};
    },
  },
}));

afterEach(() => {
  clearAnalyticsReportCache();
  vi.restoreAllMocks();
});

describe("resolvePageDetailPaths", () => {
  it("normalizes a raw path", () => {
    const r = resolvePageDetailPaths({ path: "https://example.com/en/blog/foo?x=1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.paths).toEqual(["/en/blog/foo"]);
  });

  it("rejects path combined with content_type", () => {
    const r = resolvePageDetailPaths({ path: "/en/x", content_type: "blog", slug: "x" });
    expect(r.ok).toBe(false);
  });

  it("resolves content_type+slug to primary en and warns on multiple locales", () => {
    const r = resolvePageDetailPaths({ content_type: "program", slug: "ai-fluency" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.paths).toEqual(["/us/coding-bootcamps/ai-fluency"]);
      expect(r.warnings.some((w) => w.code === "primary_locale_chosen")).toBe(true);
    }
  });

  it("honors locale", () => {
    const r = resolvePageDetailPaths({
      content_type: "program",
      slug: "ai-fluency",
      locale: "es",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.paths).toEqual(["/es/bootcamps/ai-fluency"]);
  });

  it("fails when entry has no urls", () => {
    const r = resolvePageDetailPaths({ content_type: "blog", slug: "missing" });
    expect(r.ok).toBe(false);
  });
});

describe("getAnalyticsReport validation", () => {
  it("rejects bare slug for page_detail", async () => {
    await expect(
      getAnalyticsReport({ report: "page_detail", slug: "ai-fluency" }),
    ).rejects.toBeInstanceOf(AnalyticsReportValidationError);
  });

  it("rejects page_detail without path or identity", async () => {
    await expect(getAnalyticsReport({ report: "page_detail" })).rejects.toBeInstanceOf(
      AnalyticsReportValidationError,
    );
  });

  it("returns not_configured when BigQuery is disabled", async () => {
    vi.spyOn(bq, "getBigQueryConfigStatus").mockReturnValue({
      configured: false,
      enabled: false,
      settings: {
        enabled: false,
        project_id: "",
        dataset_id: "",
        location: "US",
        table_prefix: "events_",
      },
      credentials_hint: "",
      credentials_source: "none",
      warnings: ["BigQuery is disabled in tracking settings."],
    });

    const result = await getAnalyticsReport({ report: "site_summary", days: 7 });
    expect(result.status).toBe("not_configured");
    expect(result.rows).toEqual([]);
    expect(result.warnings.some((w) => w.code === "configure_at")).toBe(true);
  });

  it("reads the calling site's settings, not the default site's", async () => {
    const status = vi.spyOn(bq, "getBigQueryConfigStatus").mockReturnValue({
      configured: false,
      enabled: false,
      settings: { enabled: false, project_id: "", dataset_id: "", location: "US", table_prefix: "events_" },
      credentials_hint: "",
      credentials_source: "none",
      warnings: [],
    });
    await getAnalyticsReport({ report: "site_summary", days: 7, contentRoot: "/tmp/site_other" });
    expect(status.mock.calls.length).toBeGreaterThan(0);
    expect(status.mock.calls.every(([root]) => root === "/tmp/site_other")).toBe(true);
  });

  it("rejects source outside page_detail", async () => {
    await expect(getAnalyticsReport({ report: "site_summary", source: "ga4" })).rejects.toBeInstanceOf(
      AnalyticsReportValidationError,
    );
  });
});

describe("resolvePageDetailPaths site index", () => {
  it("uses the passed site's content index", () => {
    const ci = { getAlternateUrls: () => ({ en: "/en/other-site/page" }) } as unknown as Parameters<
      typeof resolvePageDetailPaths
    >[0]["ci"];
    const r = resolvePageDetailPaths({ content_type: "blog", slug: "missing", ci });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.paths).toEqual(["/en/other-site/page"]);
  });
});

function mockBqReady() {
  vi.spyOn(bq, "getBigQueryConfigStatus").mockReturnValue({
    configured: true,
    enabled: true,
    settings: {
      enabled: true,
      project_id: "p",
      dataset_id: "d",
      location: "US",
      table_prefix: "events_",
    },
    credentials_hint: "ok",
    credentials_source: "json",
    warnings: [],
  });
  vi.spyOn(bq, "getBigQuerySettings").mockReturnValue({
    enabled: true,
    project_id: "p",
    dataset_id: "d",
    location: "US",
    table_prefix: "events_",
  });
  vi.spyOn(bq, "fqEventsWildcard").mockReturnValue("`p.d.events_*`");
}

describe("traffic_source_conversions", () => {
  it("defaults attribution to session_last_click and warns when lead catalog empty", async () => {
    mockBqReady();
    vi.spyOn(settings, "getLeadConversionEventNames").mockReturnValue([]);
    vi.spyOn(settings, "isCountsAsLeadConfigured").mockReturnValue(true);
    vi.spyOn(settings, "getTrackingSettings").mockReturnValue({
      conversion_events: [{ name: "x", counts_as_lead: false }],
    } as ReturnType<typeof settings.getTrackingSettings>);

    const query = vi.fn().mockResolvedValue([
      [
        {
          source: "google",
          medium: "organic",
          campaign: "(not set)",
          sessions: 10,
          leads: 0,
          fallback_hits: 0,
          leads_unattributed: 0,
          leads_missing_item_id: 0,
          orphan_fallback_hits: 0,
        },
      ],
    ]);
    vi.spyOn(bq, "getBigQueryClient").mockReturnValue({ query } as never);

    const result = await getAnalyticsReport({
      report: "traffic_source_conversions",
      days: 7,
    });
    expect(result.status).toBe("ok");
    expect(result.totals.attribution).toBe("session_last_click");
    expect(result.warnings.some((w) => w.code === "no_lead_events_configured")).toBe(true);
    expect(result.rows[0]?.source).toBe("google");
    expect(result.rows[0]?.lead_rate).toBe(0);
    expect(query).toHaveBeenCalled();
  });

  it("includes item_id warnings and totals when filtering", async () => {
    mockBqReady();
    vi.spyOn(settings, "getLeadConversionEventNames").mockReturnValue(["student_application"]);
    vi.spyOn(settings, "isCountsAsLeadConfigured").mockReturnValue(true);
    vi.spyOn(settings, "getTrackingSettings").mockReturnValue({
      conversion_events: [{ name: "student_application", counts_as_lead: true }],
    } as ReturnType<typeof settings.getTrackingSettings>);

    const query = vi.fn().mockResolvedValue([
      [
        {
          source: "meta",
          medium: "paid",
          campaign: "q1",
          sessions: 100,
          leads: 4,
          fallback_hits: 0,
          leads_unattributed: 2,
          leads_missing_item_id: 7,
          orphan_fallback_hits: 0,
        },
      ],
    ]);
    vi.spyOn(bq, "getBigQueryClient").mockReturnValue({ query } as never);

    const result = await getAnalyticsReport({
      report: "traffic_source_conversions",
      item_id: "ai-fluency",
      days: 14,
    });
    expect(result.totals.item_id).toBe("ai-fluency");
    expect(result.totals.leads_missing_item_id).toBe(7);
    expect(result.totals.leads_unattributed).toBe(2);
    expect(result.rows[0]?.leads).toBe(4);
    expect(result.rows[0]?.lead_rate).toBe(0.04);
    expect(result.warnings.some((w) => w.code === "lead_rate_channel_sessions")).toBe(true);
    expect(result.warnings.some((w) => w.code === "leads_missing_item_id")).toBe(true);
    expect(result.warnings.some((w) => w.code === "leads_unattributed")).toBe(true);
  });

  it("honors first_user attribution in totals", async () => {
    mockBqReady();
    vi.spyOn(settings, "getLeadConversionEventNames").mockReturnValue(["request_more_info"]);
    vi.spyOn(settings, "isCountsAsLeadConfigured").mockReturnValue(true);
    vi.spyOn(settings, "getTrackingSettings").mockReturnValue({
      conversion_events: [{ name: "request_more_info", counts_as_lead: true }],
    } as ReturnType<typeof settings.getTrackingSettings>);

    const query = vi.fn().mockResolvedValue([
      [
        {
          source: "(direct)",
          medium: "(none)",
          campaign: "(not set)",
          sessions: 5,
          leads: 1,
          fallback_hits: 0,
          leads_unattributed: 9,
          leads_missing_item_id: 0,
          orphan_fallback_hits: 0,
        },
      ],
    ]);
    vi.spyOn(bq, "getBigQueryClient").mockReturnValue({ query } as never);

    const result = await getAnalyticsReport({
      report: "traffic_source_conversions",
      attribution: "first_user",
    });
    expect(result.totals.attribution).toBe("first_user");
    expect(result.totals.leads_unattributed).toBeUndefined();
    expect(result.warnings.some((w) => w.code === "leads_unattributed")).toBe(false);
  });

  it("caches separately by item_id", async () => {
    mockBqReady();
    vi.spyOn(settings, "getLeadConversionEventNames").mockReturnValue(["student_application"]);
    vi.spyOn(settings, "isCountsAsLeadConfigured").mockReturnValue(true);
    vi.spyOn(settings, "getTrackingSettings").mockReturnValue({
      conversion_events: [{ name: "student_application", counts_as_lead: true }],
    } as ReturnType<typeof settings.getTrackingSettings>);

    const query = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            source: "a",
            medium: "b",
            campaign: "c",
            sessions: 1,
            leads: 1,
            fallback_hits: 0,
            leads_unattributed: 0,
            leads_missing_item_id: 0,
            orphan_fallback_hits: 0,
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            source: "a",
            medium: "b",
            campaign: "c",
            sessions: 1,
            leads: 0,
            fallback_hits: 0,
            leads_unattributed: 0,
            leads_missing_item_id: 3,
            orphan_fallback_hits: 0,
          },
        ],
      ]);
    vi.spyOn(bq, "getBigQueryClient").mockReturnValue({ query } as never);

    await getAnalyticsReport({ report: "traffic_source_conversions" });
    await getAnalyticsReport({ report: "traffic_source_conversions", item_id: "sku-1" });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
