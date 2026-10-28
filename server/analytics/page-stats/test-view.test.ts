import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerRow } from "../../ads/lead-ledger";

vi.mock("../../settings", async (orig) => ({
  ...(await orig<typeof import("../../settings")>()),
  getAdsSettings: () => ({ meta: { enabled: false, ad_account_ids: [], alert_thresholds: {} }, test_email_patterns: [] }),
}));
vi.mock("../../staff-session-resolve", () => ({ resolveOwnedStaffSession: async () => null }));

import { clearSiteSqliteCacheForTests } from "../../db";
import { resetPipelineDbCache } from "../../pipeline-db/runner";
import { insertLedgerRow } from "../../ads/lead-ledger";
import { queryTestLeads } from "./leads";
import { buildCompareRows, firstPartyNotices, testWindow, TEST_VIEW_CAP_DAYS } from "./test-view";
import { pageStatsSchema } from "../../routes/analytics";
import type { TrafficTotals, VersionFacts } from "@shared/page-stats";

const SITE = `site_test-view-test-${process.pid}`;
const EXP = "landing:promo:en@2026-10-01";
const AT = Date.parse("2026-10-05T12:00:00.000Z");

let seq = 0;
function lead(over: Partial<LedgerRow>): LedgerRow {
  seq += 1;
  return {
    submission_id: `tv-${String(seq).padStart(4, "0")}`,
    created_at: AT,
    form: "apply",
    browser_hash: "hash",
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
    landing_path: "/en/landing/promo",
    conversion_path: "/en/landing/promo",
    first_paid_host: null,
    first_paid_path: null,
    first_paid_at: null,
    last_paid_host: null,
    last_paid_path: null,
    last_paid_at: null,
    experiment_id: EXP,
    variant: "b",
    is_test: 0,
    test_reason: null,
    is_repeat: 0,
    repeat_of: null,
    consent_state: "granted",
    ...over,
  };
}

describe("queryTestLeads", () => {
  const rm = () => fs.rmSync(path.join("data", SITE), { recursive: true, force: true });
  beforeEach(() => {
    seq = 0;
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rm();
  });
  afterEach(() => {
    clearSiteSqliteCacheForTests();
    rm();
  });

  it("counts leads sent here and all leads carrying the test, per version", () => {
    insertLedgerRow(SITE, lead({}));
    insertLedgerRow(SITE, lead({ conversion_path: "/en/apply" }));
    insertLedgerRow(SITE, lead({ variant: "default" }));
    insertLedgerRow(SITE, lead({ experiment_id: "landing:promo:en@2026-08-01" }));
    insertLedgerRow(SITE, lead({ is_test: 1, test_reason: "staff_session" }));
    insertLedgerRow(SITE, lead({ created_at: Date.parse("2026-09-20T12:00:00.000Z") }));
    const out = queryTestLeads({
      site: SITE,
      paths: ["/en/landing/promo"],
      experimentId: EXP,
      versions: ["default", "b"],
      window: { start: "2026-10-01", end: "2026-10-10" },
    });
    const b = out.get("b")!.data!;
    expect(b.converted_here.count).toBe(1);
    expect(b.converted_here.prior_count).toBe(0);
    expect(b.all_from_test).toBe(2);
    expect(b.excluded_test).toBe(1);
    expect(out.get("default")!.data!.converted_here.count).toBe(1);
  });
});

function totals(p: Partial<TrafficTotals>): TrafficTotals {
  return {
    sessions: 0, page_views: 0, entrances: 0, engaged_sessions: 0, bounces: 0, exits: 0, returning_sessions: 0,
    moved_forward: 0, moved_back: 0, reached_decision: 0, lead_later: 0, form_or_cta: 0, cta_sessions: 0,
    task_clicks: 0, lost: 0, form_starts: 0, video_starts: 0, video_completes: 0, intent_events: 0,
    median_engaged_seconds: null, median_session_seconds: null, ...p,
  };
}

function facts(sessions: number, engaged: number, leadsHere: number, primary: number | null): VersionFacts {
  return {
    traffic: {
      status: "ok",
      as_of: null,
      data: {
        current: totals({ sessions, engaged_sessions: engaged }), prior: totals({}), series: [], previous_pages: [], next_pages: [],
        referrers: [], channels: [], campaigns: [], devices: [], countries: [], cta: [], scroll: [],
        tracking_since: { cta_click: null, scroll_depth: null }, prior_channels: [], peers: [],
      },
    },
    leads: {
      status: "ok",
      as_of: null,
      data: {
        converted_here: { count: leadsHere, prior_count: 0, paid_count: 0, by_form: [], by_channel: [], by_campaign: [], by_country: [], by_version: [], series: [] },
        started_here: { count: 0, prior_count: 0, paid_count: 0, by_form: [], by_channel: [], by_campaign: [], by_country: [], by_version: [], series: [] },
        both: 0, excluded_test: 0, excluded_repeat: 0, collecting_since: null, all_from_test: leadsHere + 1,
      },
    },
    paid_summary: { paid_visits: 0, paid_leads: 0, conversion_rate: null, low_sample: true },
    objective: primary === null ? null : ({ primary: { value: primary } } as VersionFacts["objective"]),
    advice: { verdict: { tone: "info", text: "" }, findings: [] },
  };
}

describe("buildCompareRows", () => {
  it("marks nothing while any version is under the minimum visits", () => {
    const rows = buildCompareRows({
      versions: ["default", "b"],
      byVersion: { default: facts(150, 60, 3, 0.1), b: facts(80, 50, 4, 0.2) },
      primary: { label: "Reached a decision page", target: 0.15 },
      minVisits: 100,
    });
    expect(rows.every((r) => r.best === null)).toBe(true);
    expect(rows.find((r) => r.id === "primary")).toMatchObject({ target: 0.15, values: { default: 0.1, b: 0.2 } });
  });

  it("marks the better rate once every version has enough visits, never a count", () => {
    const rows = buildCompareRows({
      versions: ["default", "b"],
      byVersion: { default: facts(200, 60, 4, 0.1), b: facts(300, 210, 3, 0.2) },
      primary: { label: "Reached a decision page", target: null },
      minVisits: 100,
    });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.primary!.best).toBe("b");
    expect(by.engaged_rate!.best).toBe("b");
    expect(by.leads_here_rate!.best).toBe("default");
    expect(by.visits!.best).toBeNull();
    expect(by.leads_here!.best).toBeNull();
    expect(by.leads_all!.values).toEqual({ default: 5, b: 4 });
  });
});

describe("testWindow", () => {
  it("runs from the start to the last complete day, or the end day when the test ended", () => {
    expect(testWindow({ started_at: "2026-10-01", ended_at: null }, "2026-10-20")).toEqual({ start: "2026-10-01", end: "2026-10-20", capped: false });
    expect(testWindow({ started_at: "2026-10-01", ended_at: "2026-10-12" }, "2026-10-20")).toEqual({ start: "2026-10-01", end: "2026-10-12", capped: false });
  });

  it(`caps long tests at the last ${TEST_VIEW_CAP_DAYS} days`, () => {
    expect(testWindow({ started_at: "2026-01-01", ended_at: null }, "2026-10-20")).toEqual({ start: "2026-07-23", end: "2026-10-20", capped: true });
  });

  it("never starts after it ends (test started inside the GA4 lag)", () => {
    expect(testWindow({ started_at: "2026-10-21", ended_at: null }, "2026-10-20")).toEqual({ start: "2026-10-20", end: "2026-10-20", capped: false });
  });
});

describe("firstPartyNotices", () => {
  it("reports a late counting start and gaps clipped to the test dates", () => {
    const notices = firstPartyNotices(
      [
        { content_type: "landing", enabled_at: Date.parse("2026-10-03T00:00:00Z"), disabled_at: Date.parse("2026-10-05T00:00:00Z") },
        { content_type: "landing", enabled_at: Date.parse("2026-10-08T00:00:00Z"), disabled_at: null },
      ],
      { start: "2026-10-01", end: "2026-10-20" },
      Date.parse("2026-10-21T00:00:00Z"),
    );
    expect(notices).toEqual([
      { kind: "first_party_started", day: "2026-10-03" },
      { kind: "first_party_gap", start: "2026-10-05", end: "2026-10-08" },
    ]);
  });
});

describe("page stats route query", () => {
  it("rejects view=test with All languages", () => {
    expect(pageStatsSchema.safeParse({ path: "/en/x", scope: "entry", view: "test" }).success).toBe(false);
    expect(pageStatsSchema.safeParse({ path: "/en/x", view: "test" }).success).toBe(true);
  });
});
