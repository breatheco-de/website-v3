import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADS_ALERT_THRESHOLDS,
  MAX_KNOWN_EXTERNAL_CAMPAIGNS,
  META_STANDARD_LEAD_KEY,
  effectiveMetaLeadKeys,
  isExpectedEventPair,
  isKnownExternalCampaign,
  normalizeMetaLeadConversionKey,
  parseAdsAlertThresholds,
  parseAdsSettings,
  parseKnownExternalCampaigns,
} from "./ads-settings";

describe("parseKnownExternalCampaigns", () => {
  it("accepts objects and plain strings, trims, and drops blanks", () => {
    expect(parseKnownExternalCampaigns([{ key: " 120249995075650344 ", note: " Agency " }, "Spring promo", 42, { key: "  " }, null])).toEqual([
      { key: "120249995075650344", note: "Agency" },
      { key: "Spring promo" },
      { key: "42" },
    ]);
  });

  it("dedupes case-insensitively and caps length and count", () => {
    const long = "x".repeat(300);
    const parsed = parseKnownExternalCampaigns(["Promo", "promo", long]);
    expect(parsed.map((c) => c.key)).toEqual(["Promo", "x".repeat(200)]);
    const many = Array.from({ length: MAX_KNOWN_EXTERNAL_CAMPAIGNS + 20 }, (_, i) => `c${i}`);
    expect(parseKnownExternalCampaigns(many)).toHaveLength(MAX_KNOWN_EXTERNAL_CAMPAIGNS);
  });

  it("returns [] for non-arrays", () => {
    expect(parseKnownExternalCampaigns(undefined)).toEqual([]);
    expect(parseKnownExternalCampaigns("abc")).toEqual([]);
  });
});

describe("isKnownExternalCampaign", () => {
  it("matches ignoring case and surrounding spaces", () => {
    const list = [{ key: "Spring Promo" }];
    expect(isKnownExternalCampaign(list, " spring promo ")).toBe(true);
    expect(isKnownExternalCampaign(list, "summer")).toBe(false);
  });
});

describe("parseAdsSettings", () => {
  it("defaults the unrecognized-campaign thresholds and known list", () => {
    const s = parseAdsSettings({ meta: { enabled: true } });
    expect(s.meta.known_external_campaigns).toEqual([]);
    expect(s.meta.alert_thresholds).toMatchObject({
      unrecognized_campaign_min_visits: 3,
      unrecognized_campaign_error_visits: 20,
      unrecognized_campaign_error_share_pct: 5,
      unrecognized_campaign_share_min_visits: 100,
    });
    expect(parseAdsSettings(null).meta.known_external_campaigns).toEqual([]);
  });

  it("reads overrides and the known list from YAML", () => {
    const s = parseAdsSettings({
      meta: {
        alert_thresholds: { unrecognized_campaign_min_visits: 10, unrecognized_campaign_error_share_pct: 2 },
        known_external_campaigns: [{ key: "123456789", note: "Partner" }],
      },
    });
    expect(s.meta.alert_thresholds.unrecognized_campaign_min_visits).toBe(10);
    expect(s.meta.alert_thresholds.unrecognized_campaign_error_share_pct).toBe(2);
    expect(s.meta.alert_thresholds.unrecognized_campaign_error_visits).toBe(DEFAULT_ADS_ALERT_THRESHOLDS.unrecognized_campaign_error_visits);
    expect(s.meta.known_external_campaigns).toEqual([{ key: "123456789", note: "Partner" }]);
  });

  it("reads thresholds from ads.alert_thresholds first, falling back to the legacy meta block", () => {
    const legacy = parseAdsSettings({ meta: { alert_thresholds: { ratio_min_clicks: 42 } } });
    expect(legacy.alert_thresholds.ratio_min_clicks).toBe(42);
    expect(legacy.meta.alert_thresholds.ratio_min_clicks).toBe(42);
    const top = parseAdsSettings({ alert_thresholds: { ratio_min_clicks: 7 }, meta: { alert_thresholds: { ratio_min_clicks: 42 } } });
    expect(top.alert_thresholds.ratio_min_clicks).toBe(7);
    expect(top.meta.alert_thresholds.ratio_min_clicks).toBe(7);
  });

  it("parses the Google block: dashed customer ids, BigQuery ids, lead actions", () => {
    const s = parseAdsSettings({
      google: {
        enabled: true,
        customer_ids: ["123-456-7890", "1234567890", "12345", "abc"],
        bigquery: { project: "my-project-1", dataset: "google_ads" },
        lead_conversion_actions: ["Apply form", "apply form", " ", 987654321],
      },
    });
    expect(s.google).toEqual({
      enabled: true,
      customer_ids: ["1234567890"],
      account_locations: {},
      bigquery: { project: "my-project-1", dataset: "google_ads" },
      lead_conversion_actions: ["Apply form", "987654321"],
      known_external_campaigns: [],
    });
    expect(parseAdsSettings({ google: { bigquery: { project: "Bad Project!", dataset: "x-y" } } }).google.bigquery).toEqual({ project: null, dataset: null });
    expect(parseAdsSettings(null).google.enabled).toBe(false);
  });

  it("parses account_locations for Meta and Google (only connected ids)", () => {
    const s = parseAdsSettings({
      meta: {
        ad_account_ids: ["1111122222", "3333344444"],
        account_locations: { "1111122222": ["madrid-spain"], "99999": ["ghost"], "3333344444": [] },
      },
      google: {
        customer_ids: ["1234567890"],
        account_locations: { "1234567890": ["mexicocity-mexico"], "0000000000": ["x"] },
      },
    });
    expect(s.meta.account_locations).toEqual({ "1111122222": ["madrid-spain"] });
    expect(s.google.account_locations).toEqual({ "1234567890": ["mexicocity-mexico"] });
  });

  it("parses Meta lead conversions, change date and expected event pairs", () => {
    const s = parseAdsSettings({
      meta: {
        lead_conversions: ["fb_pixel_lead", "offsite_conversion.custom.1086440567304045", 1634685814697001, "abc", "FB_PIXEL_LEAD"],
        lead_conversions_changed_at: "2026-09-30T16:00:00.000Z",
        expected_event_pairs: [
          { pixel_id: "414048075447471", events: ["sign_up", "join_event"], note: "Same form" },
          { pixel_id: "414048075447471", events: ["join_event", "sign_up"] },
          { pixel_id: "bad", events: ["a", "b"] },
          { pixel_id: "414048075447471", events: ["a", "a"] },
        ],
      },
    });
    expect(s.meta.lead_conversions).toEqual(["fb_pixel_lead", "1086440567304045", "1634685814697001"]);
    expect(s.meta.lead_conversions_changed_at).toBe("2026-09-30T16:00:00.000Z");
    expect(s.meta.expected_event_pairs).toEqual([{ pixel_id: "414048075447471", events: ["join_event", "sign_up"], note: "Same form" }]);
    expect(isExpectedEventPair(s.meta.expected_event_pairs, "414048075447471", "sign_up", "join_event")).toBe(true);
    expect(isExpectedEventPair(s.meta.expected_event_pairs, "414048075447471", "sign_up", "purchase")).toBe(false);
  });

  it("defaults the new Meta fields and overlap / lockstep thresholds", () => {
    const s = parseAdsSettings({ meta: { enabled: true, lead_conversions_changed_at: "not a date" } });
    expect(s.meta.lead_conversions).toEqual([]);
    expect(s.meta.lead_conversions_changed_at).toBeNull();
    expect(s.meta.expected_event_pairs).toEqual([]);
    expect(s.alert_thresholds).toMatchObject({
      conversion_overlap_days_pct: 80,
      conversion_overlap_count_pct: 20,
      lockstep_min_events: 20,
      lockstep_count_pct: 2,
      tracking_tagged_min_sessions: 3,
      tracking_missing_min_clicks: 20,
      tracking_missing_max_visit_pct: 10,
      tracking_check_days: 7,
    });
  });

  it("clamps tracking_check_days to 3–28 and keeps other tracking thresholds", () => {
    expect(
      parseAdsAlertThresholds({
        tracking_check_days: 1,
        tracking_tagged_min_sessions: 0,
        tracking_missing_min_clicks: 99,
        tracking_missing_max_visit_pct: 150,
      }),
    ).toMatchObject({
      tracking_check_days: 3,
      tracking_tagged_min_sessions: 1,
      tracking_missing_min_clicks: 99,
      tracking_missing_max_visit_pct: 100,
    });
    expect(parseAdsAlertThresholds({ tracking_check_days: 90 }).tracking_check_days).toBe(28);
  });

  it("keeps tracking thresholds through a Save-shaped partial payload (routes thresholdsSchema keys)", () => {
    const saved = parseAdsAlertThresholds({
      tracking_tagged_min_sessions: 5,
      tracking_missing_min_clicks: 30,
      tracking_missing_max_visit_pct: 15,
      tracking_check_days: 14,
    });
    expect(saved).toMatchObject({
      tracking_tagged_min_sessions: 5,
      tracking_missing_min_clicks: 30,
      tracking_missing_max_visit_pct: 15,
      tracking_check_days: 14,
    });
  });
});

describe("normalizeMetaLeadConversionKey / effectiveMetaLeadKeys", () => {
  it("accepts the standard Lead key and numeric ids only", () => {
    expect(normalizeMetaLeadConversionKey("offsite_conversion.fb_pixel_lead")).toBe(META_STANDARD_LEAD_KEY);
    expect(normalizeMetaLeadConversionKey(" 1086440567304045 ")).toBe("1086440567304045");
    expect(normalizeMetaLeadConversionKey("lead")).toBeNull();
  });

  it("falls back to the standard Lead event when nothing is picked", () => {
    expect(effectiveMetaLeadKeys([])).toEqual([META_STANDARD_LEAD_KEY]);
    expect(effectiveMetaLeadKeys(["123456789"])).toEqual(["123456789"]);
  });
});
