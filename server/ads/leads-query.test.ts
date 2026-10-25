import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerRow } from "./lead-ledger";
import type { TrackingKeyIndex } from "@shared/tracking-keys";

vi.mock("../settings", () => ({
  getAdsSettings: () => ({ meta: { enabled: false, ad_account_ids: [], alert_thresholds: {} }, test_email_patterns: [] }),
}));
vi.mock("../staff-session-resolve", () => ({ resolveOwnedStaffSession: async () => null }));

import { clearSiteSqliteCacheForTests } from "../db";
import { resetPipelineDbCache } from "../pipeline-db/runner";
import { insertLedgerRow } from "./lead-ledger";
import { buildLeadsWhere, experimentLabel, getLeadDetail, getLeadsStats, isOffConvention, listLeadsPage, offConventionValues } from "./leads-query";
import { NO_UTM_GRACE, utmExpectedSources, type UtmGrace } from "@shared/ads-diagnostics-rules";
import { DEFAULT_UTM_CONVENTION } from "@shared/ads-settings";
import {
  LEADS_DAY_MS,
  LEADS_NONE,
  leadsDeltaPct,
  leadsQueryToSearchParams,
  leadsRangeBounds,
  parseLeadsQuery,
  ttlBucketFor,
  type LeadsQuery,
} from "@shared/leads-query";

const SITE = `site_leads-query-test-${process.pid}`;
/** Thursday 2026-10-08 15:00 UTC. */
const NOW = Date.parse("2026-10-08T15:00:00.000Z");
const DAY = LEADS_DAY_MS;

function rmSite(): void {
  fs.rmSync(path.join("data", SITE), { recursive: true, force: true });
}

let seq = 0;
function row(over: Partial<LedgerRow>): LedgerRow {
  seq += 1;
  return {
    submission_id: `lead-${String(seq).padStart(4, "0")}`,
    created_at: NOW - DAY,
    form: "apply",
    browser_hash: "hash-secret",
    host: "4geeks.com",
    locale: "en",
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    platform: null,
    campaign_id: null,
    adset_id: null,
    ad_id: null,
    click_id_type: null,
    landing_path: null,
    conversion_path: null,
    first_paid_host: null,
    first_paid_path: null,
    first_paid_at: null,
    last_paid_host: null,
    last_paid_path: null,
    last_paid_at: null,
    experiment_id: null,
    variant: null,
    is_test: 0,
    test_reason: null,
    is_repeat: 0,
    repeat_of: null,
    consent_state: "granted",
    ...over,
  };
}

function q(over: Partial<LeadsQuery> = {}): LeadsQuery {
  return { range: "30d", include_test: false, page: 1, filters: {}, ...over };
}

describe("leads query (shared helpers)", () => {
  it("parses URL params, normalizes UTM filters and drops defaults when serializing", () => {
    const parsed = parseLeadsQuery(new URLSearchParams("range=7d&include_test=1&page=3&source= Google &medium=CPC"));
    expect(parsed).toEqual({
      ok: true,
      query: { range: "7d", include_test: true, page: 3, filters: { source: "google", medium: "cpc" } },
    });
    expect(parseLeadsQuery({ range: "1y" }).ok).toBe(false);
    expect(parseLeadsQuery({ ttl: "nope" }).ok).toBe(false);
    expect(leadsQueryToSearchParams(q()).toString()).toBe("");
    expect(leadsQueryToSearchParams(q({ range: "all", page: 2, filters: { ttl: "1_3d" } })).toString()).toBe("range=all&page=2&ttl=1_3d");
  });

  it("starts rolling ranges at UTC midnight and sizes the previous period to match", () => {
    const b = leadsRangeBounds("7d", NOW, null);
    expect(new Date(b.startMs).toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(b.previous).toEqual({ startMs: b.startMs - 7 * DAY, endMs: b.startMs });
    const all = leadsRangeBounds("all", NOW, Date.parse("2026-09-20T18:00:00.000Z"));
    expect(new Date(all.startMs).toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(all.previous).toBeNull();
  });

  it("hides the change % when recording started after the previous period began", () => {
    expect(leadsDeltaPct(12, 10, 1000, 500)).toBe(20);
    expect(leadsDeltaPct(12, 10, 1000, 2000)).toBeNull();
    expect(leadsDeltaPct(12, null, null, 500)).toBeNull();
    expect(leadsDeltaPct(12, 0, 1000, 500)).toBeNull();
  });

  it("buckets time from first ad click", () => {
    expect(ttlBucketFor(-5)).toBe("under_1d");
    expect(ttlBucketFor(DAY - 1)).toBe("under_1d");
    expect(ttlBucketFor(DAY)).toBe("1_3d");
    expect(ttlBucketFor(7.5 * DAY)).toBe("4_7d");
    expect(ttlBucketFor(30 * DAY)).toBe("8_30d");
    expect(ttlBucketFor(31 * DAY)).toBe("31d_plus");
  });

  it("flags known wrong spellings and capitals, not canonical values", () => {
    expect(isOffConvention("fb", "paid_social", "meta")).toBe(false);
    expect(isOffConvention("facebook", "paid_social", "meta")).toBe(true);
    expect(isOffConvention("Google", "cpc", "google")).toBe(true);
    expect(isOffConvention("google", "cpc", "google")).toBe(false);
    expect(isOffConvention("newsletter", "email", null)).toBe(false);
  });

  it("names the expected value, preferring the platform rule over lowercase", () => {
    expect(offConventionValues("Facebook", "paid_social", "meta")).toEqual([
      {
        param: "utm_source",
        value: "Facebook",
        expected: utmExpectedSources(DEFAULT_UTM_CONVENTION, "meta"),
        platform: "meta",
        codes: ["utm_case_mixed", "utm_source_alias"],
      },
    ]);
    expect(offConventionValues("fb", "cpc", "meta")).toEqual([
      { param: "utm_medium", value: "cpc", expected: "paid_social", platform: "meta", codes: ["utm_medium_off_convention"] },
    ]);
  });

  it("leaves out values the grace period still accepts", () => {
    const grace: UtmGrace = { ...NO_UTM_GRACE, active: true, ends_at: "2026-11-01T00:00:00.000Z", accepted: { meta: { sources: ["facebook"], mediums: [] } } };
    expect(offConventionValues("facebook", "paid_social", "meta", DEFAULT_UTM_CONVENTION, grace)).toEqual([]);
    expect(isOffConvention("facebook", "paid_social", "meta", DEFAULT_UTM_CONVENTION, grace)).toBe(false);
  });

  it("labels experiments by page and variant", () => {
    expect(experimentLabel("landing:coding-bootcamp:en", "b")).toBe("coding-bootcamp (en) · b");
    expect(experimentLabel("odd-id", null)).toBe("odd-id · (no variant)");
    expect(experimentLabel("landing:coding-bootcamp:en@2026-10-23", "default")).toBe(
      "coding-bootcamp (en, from Oct 23) · default",
    );
  });

  it("builds parameterized SQL (values never interpolated)", () => {
    const w = buildLeadsWhere({ include_test: false, filters: { source: "x'; DROP TABLE lead_submissions; --", conversion_path: LEADS_NONE } });
    expect(w.sql).not.toContain("DROP");
    expect(w.params).toEqual(["x'; drop table lead_submissions; --"]);
    expect(w.sql).toContain("conversion_path IS NULL");
  });
});

describe("leads query (database)", () => {
  beforeEach(() => {
    seq = 0;
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
  });
  afterEach(() => {
    clearSiteSqliteCacheForTests();
    rmSite();
  });

  it("lists newest first, 20 per page, without browser_hash", () => {
    for (let i = 0; i < 25; i++) insertLedgerRow(SITE, row({ created_at: NOW - (i + 1) * 60_000 }));
    const p1 = listLeadsPage(SITE, q(), NOW);
    expect(p1.total).toBe(25);
    expect(p1.total_pages).toBe(2);
    expect(p1.rows).toHaveLength(20);
    expect(p1.rows[0].submission_id).toBe("lead-0001");
    expect(p1.rows.every((r, i, a) => i === 0 || a[i - 1].created_at >= r.created_at)).toBe(true);
    expect(p1.rows[0]).not.toHaveProperty("browser_hash");
    const p2 = listLeadsPage(SITE, q({ page: 2 }), NOW);
    expect(p2.rows.map((r) => r.submission_id)).toEqual(["lead-0021", "lead-0022", "lead-0023", "lead-0024", "lead-0025"]);
    expect(listLeadsPage(SITE, q({ page: 99 }), NOW).page).toBe(2);
  });

  it("returns one lead's full row without browser_hash, or null when unknown", () => {
    insertLedgerRow(SITE, row({ submission_id: "lead-detail-1", utm_content: "hero", ad_id: "123", consent_state: "denied" }));
    const lead = getLeadDetail(SITE, "lead-detail-1");
    expect(lead).toMatchObject({ submission_id: "lead-detail-1", utm_content: "hero", ad_id: "123", consent_state: "denied" });
    expect(lead).not.toHaveProperty("browser_hash");
    expect(getLeadDetail(SITE, "missing-lead")).toBeNull();
  });

  it("hides test and repeat leads unless the toggle is on", () => {
    insertLedgerRow(SITE, row({}));
    insertLedgerRow(SITE, row({ is_test: 1, test_reason: "staff_session" }));
    insertLedgerRow(SITE, row({ is_repeat: 1, repeat_of: "lead-0001" }));
    expect(listLeadsPage(SITE, q(), NOW).total).toBe(1);
    expect(listLeadsPage(SITE, q({ include_test: true }), NOW).total).toBe(3);
    const s = getLeadsStats(SITE, q(), { nowMs: NOW });
    expect(s.kpis.total_all_time).toBe(1);
    expect(getLeadsStats(SITE, q({ include_test: true }), { nowMs: NOW }).kpis.total_all_time).toBe(3);
  });

  it("uses UTC day edges for ranges and the timeline", () => {
    const start7 = leadsRangeBounds("7d", NOW, null).startMs;
    insertLedgerRow(SITE, row({ submission_id: "before", created_at: start7 - 30 * 60_000 }));
    insertLedgerRow(SITE, row({ submission_id: "after", created_at: start7 + 30 * 60_000 }));
    const list = listLeadsPage(SITE, q({ range: "7d" }), NOW);
    expect(list.rows.map((r) => r.submission_id)).toEqual(["after"]);
    const s = getLeadsStats(SITE, q({ range: "7d" }), { nowMs: NOW });
    expect(s.timeline.bucket).toBe("day");
    expect(s.timeline.points).toHaveLength(7);
    expect(s.timeline.points[0]).toEqual({
      date: "2026-10-02",
      paid: 0,
      meta_unclear: 0,
      organic_search: 0,
      ai_assistant: 0,
      other_organic: 0,
      not_tracked: 1,
    });
    expect(s.timeline.points[6].date).toBe("2026-10-08");
  });

  it("charts long ranges by week", () => {
    insertLedgerRow(SITE, row({ created_at: NOW - 200 * DAY }));
    insertLedgerRow(SITE, row({ created_at: NOW - DAY }));
    const s = getLeadsStats(SITE, q({ range: "all" }), { nowMs: NOW });
    expect(s.timeline.bucket).toBe("week");
    expect(s.timeline.points.every((p) => new Date(`${p.date}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
    expect(
      s.timeline.points.reduce(
        (n, p) => n + p.paid + p.meta_unclear + p.organic_search + p.ai_assistant + p.other_organic + p.not_tracked,
        0,
      ),
    ).toBe(2);
  });

  it("computes KPIs, total ignoring range and filters, and the delta", () => {
    insertLedgerRow(SITE, row({ created_at: NOW - 60 * DAY }));
    insertLedgerRow(SITE, row({ created_at: NOW - 40 * DAY, utm_source: "newsletter", utm_medium: "email" }));
    insertLedgerRow(SITE, row({ created_at: NOW - 2 * DAY, platform: "meta", utm_source: "fb", utm_medium: "paid_social" }));
    insertLedgerRow(SITE, row({ created_at: NOW - 3 * DAY, utm_source: "newsletter", utm_medium: "email" }));
    insertLedgerRow(SITE, row({ created_at: NOW - 4 * DAY }));
    const s = getLeadsStats(SITE, q({ range: "30d" }), { nowMs: NOW });
    expect(s.kpis.total_all_time).toBe(5);
    expect(s.kpis.in_range).toBe(3);
    expect(s.kpis.previous).toBe(1);
    expect(s.kpis.delta_pct).toBe(200);
    expect(s.kpis.paid).toBe(1);
    expect(s.kpis.paid_share).toBe(33.3);
    expect(s.kpis.tagged).toBe(2);
    const filtered = getLeadsStats(SITE, q({ range: "30d", filters: { source: "newsletter", medium: "email" } }), { nowMs: NOW });
    expect(filtered.kpis.total_all_time).toBe(5);
    expect(filtered.kpis.in_range).toBe(1);
  });

  it("returns no delta when the previous period predates recording", () => {
    insertLedgerRow(SITE, row({ created_at: NOW - 35 * DAY }));
    insertLedgerRow(SITE, row({ created_at: NOW - 2 * DAY }));
    const s = getLeadsStats(SITE, q({ range: "30d" }), { nowMs: NOW });
    expect(s.kpis.previous).toBe(1);
    expect(s.kpis.delta_pct).toBeNull();
    expect(s.collecting_since).toBe(NOW - 35 * DAY);
  });

  it("groups source/medium ignoring capitals, labels by the common spelling and flags off-convention", () => {
    insertLedgerRow(SITE, row({ utm_source: "google", utm_medium: "cpc", platform: "google" }));
    insertLedgerRow(SITE, row({ utm_source: "google", utm_medium: "cpc", platform: "google" }));
    insertLedgerRow(SITE, row({ utm_source: "Google", utm_medium: "CPC", platform: "google" }));
    insertLedgerRow(SITE, row({ utm_source: "facebook", utm_medium: "paid_social", platform: "meta" }));
    insertLedgerRow(SITE, row({ utm_source: "fb", utm_medium: "paid_social", platform: "meta" }));
    insertLedgerRow(SITE, row({}));
    const s = getLeadsStats(SITE, q(), { nowMs: NOW });
    const sm = s.breakdowns.source_medium;
    const google = sm.find((r) => r.label === "google / cpc")!;
    expect(google.count).toBe(3);
    expect(google.off_convention).toEqual([
      { param: "utm_medium", value: "CPC", expected: "cpc", platform: "google", codes: ["utm_case_mixed"], leads: 1 },
      { param: "utm_source", value: "Google", expected: "google", platform: "google", codes: ["utm_case_mixed"], leads: 1 },
    ]);
    expect(google.filter).toEqual({ source: "google", medium: "cpc" });
    expect(sm.find((r) => r.label === "facebook / paid_social")?.off_convention).toEqual([
      {
        param: "utm_source",
        value: "facebook",
        expected: utmExpectedSources(DEFAULT_UTM_CONVENTION, "meta"),
        platform: "meta",
        codes: ["utm_source_alias"],
        leads: 1,
      },
    ]);
    expect(sm.find((r) => r.label === "fb / paid_social")?.off_convention).toEqual([]);
    const direct = sm.find((r) => r.label === "Direct / untagged")!;
    expect(direct.filter).toEqual({ source: LEADS_NONE, medium: LEADS_NONE });

    expect(listLeadsPage(SITE, q({ filters: { source: "google", medium: "cpc" } }), NOW).total).toBe(3);
    expect(listLeadsPage(SITE, q({ filters: { source: LEADS_NONE, medium: LEADS_NONE } }), NOW).total).toBe(1);
  });

  it("rolls breakdowns past the top 10 into Other", () => {
    for (let i = 0; i < 12; i++) insertLedgerRow(SITE, row({ conversion_path: `/page-${i}` }));
    insertLedgerRow(SITE, row({ conversion_path: "/page-0" }));
    const rows = getLeadsStats(SITE, q(), { nowMs: NOW }).breakdowns.conversion_paths;
    expect(rows).toHaveLength(11);
    expect(rows[0]).toMatchObject({ label: "/page-0", count: 2 });
    expect(rows[10]).toMatchObject({ key: "__other__", count: 2, filter: null });
  });

  it("tags pages with their most common language and filters by page", () => {
    insertLedgerRow(SITE, row({ conversion_path: "/es/bootcamp", locale: "es" }));
    insertLedgerRow(SITE, row({ conversion_path: "/es/bootcamp", locale: "es" }));
    insertLedgerRow(SITE, row({ conversion_path: "/es/bootcamp", locale: "en" }));
    insertLedgerRow(SITE, row({ landing_path: "/en/coding", locale: "en" }));
    const s = getLeadsStats(SITE, q(), { nowMs: NOW });
    expect(s.breakdowns.conversion_paths.find((r) => r.label === "/es/bootcamp")).toMatchObject({ count: 3, locale: "es" });
    expect(s.breakdowns.conversion_paths.find((r) => r.label === "(unknown page)")).toMatchObject({ filter: { conversion_path: LEADS_NONE } });
    expect(listLeadsPage(SITE, q({ filters: { conversion_path: "/es/bootcamp" } }), NOW).total).toBe(3);
    expect(listLeadsPage(SITE, q({ filters: { landing_path: "/en/coding" } }), NOW).total).toBe(1);
  });

  it("breaks down experiments within the experiment and filters by variant", () => {
    insertLedgerRow(SITE, row({ experiment_id: "landing:home:en", variant: "a" }));
    insertLedgerRow(SITE, row({ experiment_id: "landing:home:en", variant: "b" }));
    insertLedgerRow(SITE, row({ experiment_id: "landing:home:en", variant: "b" }));
    insertLedgerRow(SITE, row({}));
    const exp = getLeadsStats(SITE, q(), { nowMs: NOW }).breakdowns.experiments;
    expect(exp[0]).toMatchObject({ label: "home (en) · b", count: 2, pct: 66.7 });
    expect(listLeadsPage(SITE, q({ filters: { experiment: "landing:home:en", variant: "b" } }), NOW).total).toBe(2);
  });

  it("buckets time from first ad click with a median, and filters by bucket", () => {
    insertLedgerRow(SITE, row({ created_at: NOW - DAY, first_paid_at: NOW - DAY - 3_600_000 }));
    insertLedgerRow(SITE, row({ created_at: NOW - DAY, first_paid_at: NOW - 3 * DAY }));
    insertLedgerRow(SITE, row({ created_at: NOW - DAY, first_paid_at: NOW - 11 * DAY }));
    insertLedgerRow(SITE, row({}));
    const ttl = getLeadsStats(SITE, q(), { nowMs: NOW }).breakdowns.time_to_lead;
    expect(ttl.paid_with_click).toBe(3);
    expect(ttl.median_days).toBe(2);
    expect(ttl.buckets.map((b) => [b.key, b.count])).toEqual([
      ["under_1d", 1],
      ["1_3d", 1],
      ["4_7d", 0],
      ["8_30d", 1],
      ["31d_plus", 0],
    ]);
    expect(listLeadsPage(SITE, q({ filters: { ttl: "8_30d" } }), NOW).total).toBe(1);
  });

  it("splits Meta-unclear out of paid, including older rows without a status", () => {
    insertLedgerRow(SITE, row({ platform: "meta", click_id_type: "fbclid" }));
    insertLedgerRow(SITE, row({ platform: "meta", click_id_type: "fbclid", utm_source: "fb", utm_medium: "paid_social" }));
    insertLedgerRow(SITE, row({ platform: "meta", click_id_type: "fbclid", traffic_status: "unclear", channel: "meta_unclear" }));
    insertLedgerRow(SITE, row({ platform: "google", click_id_type: "gclid" }));
    const s = getLeadsStats(SITE, q(), { nowMs: NOW });
    expect(s.kpis.paid).toBe(2);
    expect(s.kpis.meta_unclear).toBe(2);
    const day = s.timeline.points.find((p) => p.date === "2026-10-07")!;
    expect(day.paid).toBe(2);
    expect(day.meta_unclear).toBe(2);
  });

  it("applies the 30-day paid rule only to rows recorded after channel tracking", () => {
    const lastPaid = NOW - DAY - 7 * DAY;
    insertLedgerRow(SITE, row({ last_paid_at: lastPaid }));
    insertLedgerRow(SITE, row({ last_paid_at: lastPaid, traffic_status: "organic", channel: "paid", last_organic_channel: "email" }));
    insertLedgerRow(SITE, row({ last_paid_at: NOW - DAY - 40 * DAY, traffic_status: "organic", channel: "organic_search" }));
    const s = getLeadsStats(SITE, q(), { nowMs: NOW });
    expect(s.kpis.paid).toBe(1);
  });

  it("reports organic search over tracked leads only, the no-consent count and the channel breakdown", () => {
    insertLedgerRow(SITE, row({}));
    insertLedgerRow(SITE, row({}));
    insertLedgerRow(SITE, row({ traffic_status: "organic", channel: "organic_search", channel_landing_path: "/en/blog/x" }));
    insertLedgerRow(SITE, row({ traffic_status: "organic", channel: "direct", consent_state: "denied" }));
    insertLedgerRow(SITE, row({ traffic_status: "organic", channel: "referral", consent_state: "unset" }));
    insertLedgerRow(SITE, row({ traffic_status: "organic", channel: "ai_assistant", utm_source: "chatgpt.com" }));
    insertLedgerRow(SITE, row({ traffic_status: "paid", channel: "paid", platform: "google", is_test: 1, created_at: NOW - 3 * DAY }));
    const s = getLeadsStats(SITE, q(), { nowMs: NOW });
    expect(s.kpis.tracked).toBe(4);
    expect(s.kpis.organic_search).toBe(1);
    expect(s.kpis.organic_share).toBe(25);
    expect(s.kpis.no_consent).toBe(2);
    expect(s.tracking_since).toBe(NOW - DAY);
    const day = s.timeline.points.find((p) => p.date === "2026-10-07")!;
    expect(day).toMatchObject({ organic_search: 1, ai_assistant: 1, other_organic: 2, not_tracked: 2 });
    const channels = s.breakdowns.channels;
    expect(channels.find((r) => r.key === LEADS_NONE)).toMatchObject({ label: "Not tracked yet", count: 2 });
    expect(channels.find((r) => r.key === "organic_search")).toMatchObject({ label: "Organic search", count: 1 });
    expect(listLeadsPage(SITE, q({ filters: { channel: "organic_search" } }), NOW).rows[0]?.channel).toBe("organic_search");
    expect(listLeadsPage(SITE, q({ filters: { channel: LEADS_NONE } }), NOW).total).toBe(2);
    expect(parseLeadsQuery({ channel: "organic_search" })).toMatchObject({ ok: true, query: { filters: { channel: "organic_search" } } });
    expect(parseLeadsQuery({ channel: "bogus" }).ok).toBe(false);
  });

  it("filters by product id or slug and reports when product recording started", () => {
    expect(getLeadsStats(SITE, q(), { nowMs: NOW }).product_since).toBeNull();
    insertLedgerRow(SITE, row({}));
    insertLedgerRow(SITE, row({ created_at: NOW - 2 * DAY, product_id: "program-ai-fluency", product_slug: "ai-fluency" }));
    insertLedgerRow(SITE, row({ product_id: "program-ai-fluency", product_slug: "ai-fluency" }));
    insertLedgerRow(SITE, row({ product_id: "program-other", product_slug: "other" }));
    insertLedgerRow(SITE, row({ created_at: NOW - 3 * DAY, product_id: "program-other", is_test: 1 }));
    expect(listLeadsPage(SITE, q({ filters: { product: "program-ai-fluency" } }), NOW).total).toBe(2);
    expect(listLeadsPage(SITE, q({ filters: { product: "ai-fluency" } }), NOW).total).toBe(2);
    expect(listLeadsPage(SITE, q({ filters: { product: LEADS_NONE } }), NOW).total).toBe(1);
    expect(getLeadsStats(SITE, q(), { nowMs: NOW }).product_since).toBe(NOW - 2 * DAY);
    expect(parseLeadsQuery({ product: "ai-fluency" })).toMatchObject({ ok: true, query: { filters: { product: "ai-fluency" } } });
    expect(leadsQueryToSearchParams({ filters: { product: "program-ai-fluency" } }).toString()).toBe("product=program-ai-fluency");
  });

  describe("page funnel product / persona", () => {
    const trackingIndex: TrackingKeyIndex = {
      products: [
        {
          slug: "ai_engineering",
          content_type: "program",
          product_id: "program-ai_engineering",
          name: "AI Engineering",
          key: "aie",
          active: true,
          personas: [
            { id: "the-career-changer", name: "The Career Changer", key: "cc" },
            { id: "the-developer", name: "The Developer", key: "dev" },
          ],
          retired: [],
        },
        {
          slug: "ai-flex",
          content_type: "program",
          product_id: "program-ai-flex",
          name: "AI Flex",
          key: "afx",
          active: true,
          personas: [{ id: "the-developer", name: "The Developer (Flex)", key: "fdev" }],
          retired: [],
        },
      ],
    };

    function seedFunnelLeads(): void {
      insertLedgerRow(SITE, row({}));
      insertLedgerRow(SITE, row({ product: "all", persona: "all", product_persona: "all" }));
      insertLedgerRow(SITE, row({ product: "none", persona: "none", product_persona: "none" }));
      insertLedgerRow(
        SITE,
        row({
          product: "ai-flex,ai_engineering",
          persona: "the-career-changer,the-developer",
          product_persona: "ai-flex:the-developer,ai_engineering:the-career-changer",
        }),
      );
      insertLedgerRow(SITE, row({ product: "ai_engineering", persona: "the-career-changer" }));
      insertLedgerRow(SITE, row({ product: "ai-flex,ai_engineering", persona: "the-developer" }));
      insertLedgerRow(SITE, row({ product: "ai-flex", product_persona: "ai-flex:" }));
    }

    it("counts a lead once per product and labels sentinels", () => {
      seedFunnelLeads();
      const s = getLeadsStats(SITE, q(), { nowMs: NOW, trackingIndex });
      const products = s.breakdowns.funnel_products;
      expect(products.find((r) => r.key === "ai_engineering")).toMatchObject({ label: "AI Engineering", count: 3 });
      expect(products.find((r) => r.key === "ai-flex")).toMatchObject({ label: "AI Flex", count: 3 });
      expect(products.find((r) => r.key === "all")).toMatchObject({ label: "All products (site-wide page)", count: 1 });
      expect(products.find((r) => r.key === "none")).toMatchObject({ label: "No product on page", count: 1 });
      expect(products.find((r) => r.key === LEADS_NONE)).toMatchObject({ label: "Not recorded yet", count: 1 });
      expect(s.funnel_since).toBe(NOW - DAY);
    });

    it("uses pairs when stored and never guesses a shared persona's product", () => {
      seedFunnelLeads();
      const s = getLeadsStats(SITE, q(), { nowMs: NOW, trackingIndex });
      const personas = s.breakdowns.funnel_personas;
      expect(personas.find((r) => r.key === "ai_engineering:the-career-changer")).toMatchObject({
        label: "The Career Changer · AI Engineering",
        count: 2,
      });
      expect(personas.find((r) => r.key === "ai-flex:the-developer")).toMatchObject({
        label: "The Developer (Flex) · AI Flex",
        count: 1,
      });
      expect(personas.find((r) => r.key === ":the-developer")).toMatchObject({
        label: "The Developer (product unknown)",
        count: 1,
      });
      expect(personas.find((r) => r.key === "__no_persona__")).toMatchObject({ count: 1, filter: null });
      expect(personas.find((r) => r.key === LEADS_NONE)).toMatchObject({ count: 1 });
      expect(s.funnel_persona_product_unknown).toBe(1);
    });

    it("filters whole list items (ids with _ do not act as wildcards)", () => {
      seedFunnelLeads();
      insertLedgerRow(SITE, row({ product: "aiXengineering" }));
      const total = (filters: LeadsQuery["filters"]) => listLeadsPage(SITE, q({ filters }), NOW, trackingIndex).total;
      expect(total({ funnel_product: "ai_engineering" })).toBe(3);
      expect(total({ funnel_product: "all" })).toBe(1);
      expect(total({ funnel_product: LEADS_NONE })).toBe(1);
      expect(total({ funnel_persona: "ai_engineering:the-career-changer" })).toBe(2);
      expect(total({ funnel_persona: "ai-flex:the-developer" })).toBe(1);
      expect(total({ funnel_persona: ":the-developer" })).toBe(1);
      expect(total({ funnel_persona: LEADS_NONE })).toBe(1);
    });

    it("filter counts match the breakdown rows", () => {
      seedFunnelLeads();
      const s = getLeadsStats(SITE, q(), { nowMs: NOW, trackingIndex });
      for (const r of [...s.breakdowns.funnel_products, ...s.breakdowns.funnel_personas]) {
        if (!r.filter) continue;
        expect(listLeadsPage(SITE, q({ filters: r.filter }), NOW, trackingIndex).total, r.key).toBe(r.count);
      }
    });

    it("names the active funnel filters", () => {
      seedFunnelLeads();
      const s = getLeadsStats(SITE, q({ filters: { funnel_product: "ai-flex", funnel_persona: "ai-flex:the-developer" } }), {
        nowMs: NOW,
        trackingIndex,
      });
      expect(s.funnel_filter_labels).toEqual({ funnel_product: "AI Flex", funnel_persona: "The Developer (Flex) · AI Flex" });
      expect(getLeadsStats(SITE, q(), { nowMs: NOW, trackingIndex })).not.toHaveProperty("funnel_filter_labels");
      expect(parseLeadsQuery({ funnel_persona: ":the-developer" })).toMatchObject({
        ok: true,
        query: { filters: { funnel_persona: ":the-developer" } },
      });
    });
  });

  it("only includes local_copy when passed (dev)", () => {
    expect(getLeadsStats(SITE, q(), { nowMs: NOW })).not.toHaveProperty("local_copy");
    const s = getLeadsStats(SITE, q(), { nowMs: NOW, localCopy: { pulled_at: 1, since: 2, origin: "https://prod.test" } });
    expect(s.local_copy).toEqual({ pulled_at: 1, since: 2, origin: "https://prod.test" });
  });
});
