import { describe, expect, it } from "vitest";
import {
  accountTables,
  buildCustomerSql,
  buildGoogleDayRows,
  buildSetAccountsSql,
  makeLeadActionMatcher,
  managerTableSets,
  missingTablesFor,
  parseFinalUrls,
  parseTransferLayout,
  type RawCampaignStat,
  type RawConversion,
  type RawLandingStat,
} from "./google-ads-bq";
import { planGoogleDates } from "./google-ads-days";

const CID = "1234567890";

describe("parseTransferLayout", () => {
  it("prefers ads_ views, keeps the partitioned table name, ignores other tables", () => {
    const layout = parseTransferLayout("proj", "ds", [
      { table_name: `p_ads_CampaignBasicStats_${CID}`, column_name: "segments_date" },
      { table_name: `ads_CampaignBasicStats_${CID}`, column_name: "segments_date" },
      { table_name: `ads_CampaignBasicStats_${CID}`, column_name: "metrics_cost_micros" },
      { table_name: `p_Campaign_${CID}`, column_name: "campaign_id" },
      { table_name: "events_20260901", column_name: "event_name" },
    ]);
    expect(Object.keys(layout.table_sets)).toEqual([CID]);
    expect(layout.accounts).toEqual({ [CID]: CID });
    const t = accountTables(layout, CID)!;
    expect(t.CampaignBasicStats).toMatchObject({ name: `ads_CampaignBasicStats_${CID}`, partitioned_name: `p_ads_CampaignBasicStats_${CID}` });
    expect(t.CampaignBasicStats!.columns).toContain("metrics_cost_micros");
    expect(t.Campaign?.name).toBe(`p_Campaign_${CID}`);
    expect(missingTablesFor(t)).toEqual(["CampaignConversionStats", "LandingPageStats", "Customer"]);
  });

  it("maps a manager-account table set to the accounts inside it", () => {
    const MCC = "2305323396";
    const layout = parseTransferLayout("proj", "ds", [{ table_name: `ads_CampaignBasicStats_${MCC}`, column_name: "customer_id" }], {
      [MCC]: ["4759757599", "6067074954"],
    });
    expect(layout.accounts).toEqual({ "4759757599": MCC, "6067074954": MCC });
    expect(accountTables(layout, "6067074954")?.CampaignBasicStats?.name).toBe(`ads_CampaignBasicStats_${MCC}`);
    expect(accountTables(layout, MCC)).toBeUndefined();
    expect(managerTableSets(layout)).toEqual({ [MCC]: ["4759757599", "6067074954"] });
  });

  it("prefers an account's own table set over its manager's", () => {
    const layout = parseTransferLayout(
      "proj",
      "ds",
      [
        { table_name: `ads_CampaignBasicStats_${CID}`, column_name: "customer_id" },
        { table_name: "ads_CampaignBasicStats_9999999999", column_name: "customer_id" },
      ],
      { [CID]: [CID], "9999999999": [CID, "1111111111"] },
    );
    expect(layout.accounts).toEqual({ [CID]: CID, "1111111111": "9999999999" });
  });
});

describe("buildCustomerSql", () => {
  it("casts missing columns to NULL instead of failing", () => {
    const sql = buildCustomerSql(
      { project: "p", dataset: "d" },
      { CampaignBasicStats: { name: "ads_CampaignBasicStats_1", columns: ["segments_date", "campaign_id", "metrics_cost_micros"] } },
    );
    expect(sql.campaign_stats).toContain("CAST(NULL AS STRING) AS network");
    expect(sql.campaign_stats).toContain("SUM(metrics_cost_micros)");
    expect(sql.campaign_stats).toContain("SUM(CAST(NULL AS INT64)) AS clicks");
    expect(sql.campaign_stats).not.toContain("@cid");
    expect(sql.landing_stats).toBeUndefined();
  });

  it("filters every query to the @cid account when the table has customer_id", () => {
    const cols = ["customer_id", "segments_date", "campaign_id", "_DATA_DATE", "_LATEST_DATE"];
    const sql = buildCustomerSql(
      { project: "p", dataset: "d" },
      {
        CampaignBasicStats: { name: "ads_CampaignBasicStats_1", columns: cols },
        LandingPageStats: { name: "ads_LandingPageStats_1", columns: cols },
        CampaignConversionStats: { name: "ads_CampaignConversionStats_1", columns: cols },
        Campaign: { name: "ads_Campaign_1", columns: cols },
        AdGroup: { name: "ads_AdGroup_1", columns: cols },
        Ad: { name: "ads_Ad_1", columns: cols },
        Customer: { name: "ads_Customer_1", columns: cols },
      },
    );
    for (const q of Object.values(sql)) expect(q).toContain("CAST(customer_id AS STRING) = @cid");
    expect(sql.campaigns).toContain("AND _DATA_DATE = _LATEST_DATE");
  });
});

describe("buildSetAccountsSql", () => {
  it("lists non-manager Customer rows plus accounts with recent stats", () => {
    const sql = buildSetAccountsSql(
      { project: "p", dataset: "d" },
      {
        Customer: { name: "ads_Customer_1", columns: ["customer_id", "customer_manager"] },
        CampaignBasicStats: { name: "ads_CampaignBasicStats_1", columns: ["customer_id", "segments_date"] },
      },
    )!;
    expect(sql).toContain("NOT IFNULL(customer_manager, FALSE)");
    expect(sql).toContain("UNION DISTINCT");
    expect(buildSetAccountsSql({ project: "p", dataset: "d" }, { Campaign: { name: "ads_Campaign_1", columns: ["campaign_id"] } })).toBeNull();
  });
});

describe("parseFinalUrls", () => {
  it("reads JSON arrays, JSON strings and bare URLs", () => {
    expect(parseFinalUrls('["https://a.com/x","https://a.com/y"]')).toEqual(["https://a.com/x", "https://a.com/y"]);
    expect(parseFinalUrls('"https://a.com/x"')).toEqual(["https://a.com/x"]);
    expect(parseFinalUrls("https://a.com/z")).toEqual(["https://a.com/z"]);
    expect(parseFinalUrls(null)).toEqual([]);
  });

  it("unwraps double-encoded arrays from TO_JSON_STRING over a JSON string column", () => {
    expect(parseFinalUrls('"[\\"https://a.com/es/x\\"]"')).toEqual(["https://a.com/es/x"]);
    expect(parseFinalUrls(JSON.stringify(['["https://a.com/x","https://a.com/y"]']))).toEqual(["https://a.com/x", "https://a.com/y"]);
    expect(parseFinalUrls('["not a url"]')).toEqual([]);
  });
});

describe("makeLeadActionMatcher", () => {
  it("counts the Submit lead form category plus staff-picked names or ids", () => {
    const m = makeLeadActionMatcher(["Apply form", "555"]);
    expect(m({ category: "SUBMIT_LEAD_FORM", action_name: "x", action_id: null })).toBe(true);
    expect(m({ category: "PURCHASE", action_name: "apply form", action_id: null })).toBe(true);
    expect(m({ category: "PURCHASE", action_name: "other", action_id: "555" })).toBe(true);
    expect(m({ category: "PURCHASE", action_name: "other", action_id: "1" })).toBe(false);
  });
});

describe("buildGoogleDayRows", () => {
  const D = "2026-09-15";
  const campaigns = {
    "11": { customer_id: CID, name: "Search brand", channel_type: "SEARCH", status: "ENABLED", final_url_suffix: null },
    "22": { customer_id: CID, name: "YouTube awareness", channel_type: "VIDEO", status: "ENABLED", final_url_suffix: null },
    "33": { customer_id: CID, name: "Lead form search", channel_type: "SEARCH", status: "ENABLED", final_url_suffix: null },
  };
  const stat = (campaign_id: string, network: string, cost: number, clicks: number): RawCampaignStat => ({
    date: D,
    campaign_id,
    network,
    cost_micros: cost * 1e6,
    clicks,
    impressions: clicks * 10,
  });
  const lp = (campaign_id: string, ad_group_id: string, url: string, cost: number, clicks: number): RawLandingStat => ({
    date: D,
    campaign_id,
    ad_group_id,
    url,
    cost_micros: cost * 1e6,
    clicks,
    impressions: clicks * 10,
  });
  const conv = (campaign_id: string, category: string, conversions: number): RawConversion => ({
    date: D,
    campaign_id,
    category,
    action_name: category,
    action_id: null,
    conversions,
  });

  const out = buildGoogleDayRows({
    customer_id: CID,
    currency: "USD",
    campaignStats: [stat("11", "SEARCH", 80, 60), stat("11", "SEARCH_PARTNERS", 20, 20), stat("22", "YOUTUBE_WATCH", 50, 5), stat("33", "SEARCH", 30, 0)],
    landingStats: [lp("11", "a1", "https://example.com/en/coding-bootcamp", 60, 50), lp("11", "a2", "https://example.com/en/apply", 30, 20)],
    conversions: [conv("11", "SUBMIT_LEAD_FORM", 7), conv("33", "SUBMIT_LEAD_FORM", 4), conv("11", "PURCHASE", 9)],
    campaigns,
    adGroups: { a1: { campaign_id: "11", name: "Bootcamp" }, a2: { campaign_id: "11", name: "Apply" } },
    isLead: makeLeadActionMatcher([]),
  });

  it("keeps landing-page spend and adds a remainder so campaign totals reconcile", () => {
    const c11 = out.rows.filter((r) => r.campaign_id === "11");
    expect(c11.reduce((s, r) => s + r.spend, 0)).toBeCloseTo(100);
    expect(c11.reduce((s, r) => s + r.clicks, 0)).toBe(80);
    const rem = c11.find((r) => r.landing_url == null)!;
    expect(rem).toMatchObject({ spend: 10, clicks: 10, destination: "unknown" });
  });

  it("spreads lead conversions by clicks and ignores non-lead categories", () => {
    const c11 = out.rows.filter((r) => r.campaign_id === "11");
    expect(c11.reduce((s, r) => s + r.lead_conversions, 0)).toBeCloseTo(7);
    expect(c11.find((r) => r.ad_group_id === "a1")!.lead_conversions).toBeCloseTo((7 * 50) / 80, 2);
  });

  it("names destinations for spend with no landing page", () => {
    expect(out.rows.find((r) => r.campaign_id === "22")).toMatchObject({ destination: "video_views", spend: 50 });
    expect(out.rows.find((r) => r.campaign_id === "33")).toMatchObject({ destination: "google_lead_form", spend: 30, lead_conversions: 4 });
  });

  it("splits spend by network", () => {
    const nets = out.networkRows.filter((r) => r.campaign_id === "11").map((r) => [r.network, r.spend]);
    expect(nets).toEqual(expect.arrayContaining([["search", 80], ["search_partners", 20]]));
    expect(out.networkRows.find((r) => r.campaign_id === "22")?.network).toBe("youtube");
  });
});

describe("planGoogleDates", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");
  it("reads the whole 90-day window on the first load", () => {
    const p = planGoogleDates({ dataThrough: "2026-09-28", firstDate: "2026-01-01", historyLoaded: false, cachedAt: () => null, loads: new Map(), now });
    expect(p.full).toHaveLength(90);
    expect(p.full.at(-1)).toBe("2026-09-28");
  });

  it("re-reads 10 days of spend, 30 of conversions, missing days and reloaded partitions", () => {
    const cached = "2026-09-29T00:00:00.000Z";
    const p = planGoogleDates({
      dataThrough: "2026-09-28",
      firstDate: "2026-01-01",
      historyLoaded: true,
      cachedAt: (d) => (d === "2026-08-01" ? null : cached),
      loads: new Map([["2026-07-15", "2026-09-29T06:00:00.000Z"], ["2026-07-16", "2026-09-01T00:00:00.000Z"]]),
      now,
    });
    expect(p.full).toContain("2026-09-19");
    expect(p.full).not.toContain("2026-09-18");
    expect(p.full).toContain("2026-08-01");
    expect(p.full).toContain("2026-07-15");
    expect(p.full).not.toContain("2026-07-16");
    expect(p.conversionsOnly[0]).toBe("2026-08-30");
    expect(p.conversionsOnly.at(-1)).toBe("2026-09-18");
  });

  it("reads nothing before the transfer loaded any day", () => {
    expect(planGoogleDates({ dataThrough: null, firstDate: null, historyLoaded: false, cachedAt: () => null, loads: new Map(), now })).toEqual({ full: [], conversionsOnly: [] });
  });
});
