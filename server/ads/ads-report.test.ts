import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LedgerRow } from "./lead-ledger";
import type { MetaAdDayRow, MetaAdPlatformDayRow } from "./meta-client";
import type { PaidLandingCandidateRow, PaidLandingDayFile } from "./paid-detection";
import { DEFAULT_ADS_SETTINGS } from "@shared/ads-settings";
import type { ContentIndex } from "../content-index";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const DAY = "2026-09-15";
const HOST = "example.com";

const metaRows: MetaAdDayRow[] = [
  {
    date: DAY,
    account_id: "111111",
    currency: "USD",
    campaign_id: "c1",
    campaign_name: "Bootcamp prospecting",
    adset_id: "s1",
    adset_name: "US",
    ad_id: "ad1",
    ad_name: "Ad 1",
    spend: 100,
    impressions: 5000,
    reach: 4000,
    frequency: 1.25,
    link_clicks: 80,
    landing_page_views: 60,
    pixel_leads: 5,
    pixel_leads_click: 3,
    pixel_leads_view: 2,
    instant_form_leads: 0,
  },
  {
    date: DAY,
    account_id: "111111",
    currency: "USD",
    campaign_id: "c2",
    campaign_name: "Lead form",
    adset_id: "s2",
    adset_name: "US",
    ad_id: "ad2",
    ad_name: "Ad 2",
    spend: 40,
    impressions: 2000,
    reach: 1800,
    frequency: 1.1,
    link_clicks: 0,
    landing_page_views: 0,
    pixel_leads: 0,
    instant_form_leads: 3,
  },
];

function candidate(over: Partial<PaidLandingCandidateRow>): PaidLandingCandidateRow {
  return {
    host: HOST,
    path: "/en/coding-bootcamp",
    source: "facebook",
    medium: "paid_social",
    campaign: "Bootcamp prospecting",
    click_id_type: "fbclid",
    utm_id: "c1",
    utm_term: "s1",
    utm_content: "ad1",
    experiment_id: null,
    variant: null,
    sessions: 50,
    engaged_sessions: 30,
    engagement_ms: 50 * 20_000,
    lead_events: 4,
    sessions_with_lead: 4,
    ...over,
  };
}

const paidDay: PaidLandingDayFile = {
  date: DAY,
  fetched_at: NOW.toISOString(),
  complete: true,
  candidates: [
    candidate({}),
    candidate({ source: "facebook", medium: "referral", utm_id: null, utm_term: null, utm_content: null, sessions: 7, engaged_sessions: 2, sessions_with_lead: 0 }),
  ],
  organic: [{ host: HOST, path: "/en/coding-bootcamp", sessions: 200, engaged_sessions: 120, sessions_with_lead: 6 } as never],
  cookieless: [],
};

const t0 = Date.parse(`${DAY}T10:00:00.000Z`);
function lead(over: Partial<LedgerRow>): LedgerRow {
  return {
    submission_id: `s-${Math.random()}`,
    created_at: t0 + 60_000,
    form: "apply",
    browser_hash: "b1",
    host: HOST,
    locale: "en",
    utm_source: "facebook",
    utm_medium: "paid_social",
    utm_campaign: "Bootcamp prospecting",
    utm_content: "ad1",
    utm_term: "s1",
    platform: "meta",
    campaign_id: "c1",
    adset_id: "s1",
    ad_id: "ad1",
    click_id_type: "fbclid",
    landing_path: "/en/coding-bootcamp",
    conversion_path: "/en/apply",
    first_paid_host: HOST,
    first_paid_path: "/en/coding-bootcamp",
    first_paid_at: t0,
    last_paid_host: HOST,
    last_paid_path: "/en/coding-bootcamp",
    last_paid_at: t0,
    experiment_id: null,
    variant: null,
    is_test: 0,
    test_reason: null,
    is_repeat: 0,
    repeat_of: null,
    ...over,
  } as LedgerRow;
}

type TestCreative = { links: string[]; url_tags?: string; instant_form: boolean; ad_id?: string; campaign_id?: string; adset_id?: string };
const BASE_CREATIVES: Record<string, TestCreative> = {
  ad1: { links: [`https://${HOST}/en/coding-bootcamp?utm_source=facebook`], instant_form: false },
  ad2: { links: [], instant_form: true },
};

const ledgerRows: LedgerRow[] = [
  lead({ submission_id: "a" }),
  lead({ submission_id: "b", browser_hash: "b2" }),
  lead({ submission_id: "c", is_repeat: 1, repeat_of: "a" }),
  lead({ submission_id: "t", is_test: 1, test_reason: "staff_session" }),
];

vi.mock("../site-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../site-config")>()),
  getSiteConfigs: () => [{ domain: HOST, contentFolder: "site_test", aliases: [] }],
}));
vi.mock("../content-index", () => ({ contentIndex: {} }));
vi.mock("../settings", () => ({
  getAdsSettings: () => ({
    ...DEFAULT_ADS_SETTINGS,
    meta: { ...DEFAULT_ADS_SETTINGS.meta, enabled: true, ad_account_ids: ["111111"], ...fixture.metaSettings },
  }),
  getHomePage: () => ({ type: "page", slug: "home" }),
  getSupportedLocales: () => ["en", "es"],
  getDefaultLocale: () => "en",
}));
vi.mock("../site-manager", () => ({ getSiteContextMap: () => new Map() }));

/** Content redirects (path → target), as Redirects → Test a URL would answer them. */
const REDIRECTS: Record<string, string> = {
  "/old-a": "/old-b",
  "/old-b": "/landing/ai-engineering-salaries",
  "/go": "https://elsewhere.org/offer",
  "/loop-a": "/loop-b",
  "/loop-b": "/loop-a",
};
vi.mock("../redirects", () => ({
  createPublicUrlResolver: () => ({
    test: (p: string) => (REDIRECTS[p] ? { match: true, resolvedTo: REDIRECTS[p] } : { match: false }),
  }),
}));

type FakePage = { contentType: string; slug: string; locale: string; fromDatabase?: boolean; patternLocale?: string };
/** Real public URLs of the fake site — landings and pages, not just SEO hubs. */
const PAGES: Record<string, FakePage> = {
  "/en/coding-bootcamp": { contentType: "landing", slug: "coding-bootcamp", locale: "en" },
  "/en/apply": { contentType: "landing", slug: "apply", locale: "en" },
  "/landing/ai-engineering-salaries": { contentType: "landing", slug: "ai-engineering-salaries", locale: "en", patternLocale: "default" },
  "/landing/aprende-ia": { contentType: "landing", slug: "aprende-ia", locale: "es", patternLocale: "default" },
  "/en/home": { contentType: "page", slug: "home", locale: "en" },
  "/en/how-to/deploy": { contentType: "how-to", slug: "deploy", locale: "en", fromDatabase: true, patternLocale: "en" },
};
const fakeContentIndex = {
  resolveUrl: (url: string) => {
    const p = PAGES[url];
    return p ? { contentType: p.contentType, slug: p.slug, entry: {}, fromDatabase: p.fromDatabase, patternLocale: p.patternLocale } : null;
  },
  loadCommonData: (contentType: string, slug: string) => {
    const hit = Object.values(PAGES).find((p) => p.contentType === contentType && p.slug === slug);
    return hit ? { locale: hit.locale } : null;
  },
  servedLocale: (contentType: string, slug: string, patternLocale?: string) => {
    if (patternLocale && patternLocale !== "default") return patternLocale;
    return Object.values(PAGES).find((p) => p.contentType === contentType && p.slug === slug)?.locale ?? "en";
  },
  getLocaleUrls: (slug: string, contentType: string) => {
    const hit = Object.entries(PAGES).find(([, p]) => p.contentType === contentType && p.slug === slug);
    return hit ? { [hit[1].locale]: hit[0] } : {};
  },
} as unknown as ContentIndex;
vi.mock("./meta-ads-days", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    loadMetaRows: (_site: string, start: string) => (start === "0000-01-01" ? [...fixture.metaRows, ...(fixture.olderMetaRows ?? [])] : fixture.metaRows),
    listMetaDayDates: () => fixture.metaDates ?? ALL_META_DATES,
    loadMetaState: () => fixture.metaState ?? { accounts: {}, consecutive_failures: 0, last_success_at: NOW.toISOString() },
    loadMetaCreatives: () => ({ ads: fixture.creatives }),
    loadMetaPlatformRows: () => fixture.platformRows ?? [],
    metaConversionNames: () => new Map([["1086440567304045", "request_more_info"]]),
    loadMetaSplitCoverage: () => fixture.metaSplitDays ?? { covered: 28, total: 28 },
  };
});
const ALL_META_DATES: string[] = [];
for (let d = new Date("2025-06-01T00:00:00.000Z"); d <= NOW; d.setUTCDate(d.getUTCDate() + 1)) ALL_META_DATES.push(d.toISOString().slice(0, 10));
const fixture: {
  metaRows: MetaAdDayRow[];
  /** Rows only returned for the all-history read (older than the report window). */
  olderMetaRows?: MetaAdDayRow[];
  metaDates?: string[];
  creatives: Record<string, TestCreative>;
  paidDays: PaidLandingDayFile[];
  ledgerRows: LedgerRow[];
  collectingSince: number | null;
  platformRows?: MetaAdPlatformDayRow[];
  metaState?: Record<string, unknown>;
  /** False = no local Meta token (with a downloaded snapshot, the report is in production_snapshot mode). */
  metaConnected?: boolean;
  metaSettings?: Partial<typeof DEFAULT_ADS_SETTINGS.meta>;
  metaSplitDays?: { covered: number; total: number };
  /** Meta setup catalog (URL history); unset = empty catalog, ads fall back to their creative link. */
  metaSetup?: import("./ads-setup").AdsSetupCatalog;
} = {
  metaRows,
  creatives: BASE_CREATIVES,
  paidDays: [paidDay],
  ledgerRows,
  collectingSince: Date.parse("2026-08-01T00:00:00.000Z"),
};
vi.mock("./ads-setup", async (orig) => {
  const actual = (await orig()) as typeof import("./ads-setup");
  return {
    ...actual,
    loadAdsSetup: (_site: string, platform: "meta" | "google") => (platform === "meta" && fixture.metaSetup ? fixture.metaSetup : actual.emptyAdsSetup(platform)),
  };
});
vi.mock("./paid-detection", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  isGa4Configured: () => true,
  loadPaidLandingState: () => ({ last_success_at: NOW.toISOString(), last_export_date: DAY }),
  loadPaidLandingDays: () => fixture.paidDays,
  lastCompleteGa4Date: () => "2026-09-18",
}));
vi.mock("./lead-ledger", () => ({
  listLedgerRows: () => fixture.ledgerRows,
  ledgerCollectingSince: () => fixture.collectingSince,
}));
vi.mock("./consent-store", () => ({
  listConsentDaily: () => [],
  summarizeConsentRates: () => [],
}));
vi.mock("./ads-refresh", () => ({
  isMetaConnected: () => fixture.metaConnected ?? true,
  hasMetaData: () => true,
  hasGa4Data: () => true,
  isProductionSnapshot: () => !!fixture.metaState?.pulled_from_production_at,
  getAdsRefreshStatus: () => ({ state: "idle", requested_at: null, started_at: null, finished_at: null, error: null, retry_after: null, progress: null }),
  triggerAdsRefreshIfStale: async () => false,
}));

const { buildAdsReport, makeDestinationResolver, resolveReportWindow, compressDateRanges, AdsReportRangeError } = await import("./ads-report");

describe("makeDestinationResolver", () => {
  const resolve = makeDestinationResolver("site_test", fakeContentIndex);

  it("matches any public page, not only SEO hubs", () => {
    expect(resolve(HOST, "/landing/ai-engineering-salaries")).toMatchObject({
      kind: "entry",
      key: "entry:landing/ai-engineering-salaries/en",
      path: "/landing/ai-engineering-salaries",
      redirect_chain: [],
    });
  });

  it("resolves the homepage and reads a landing's language from its common file", () => {
    expect(resolve(HOST, "/")).toMatchObject({ kind: "entry", key: "entry:page/home/en", path: "/en/home", redirect_chain: [] });
    expect(resolve(HOST, "/landing/aprende-ia")).toMatchObject({ kind: "entry", locale: "es" });
  });

  it("falls back to the content index for database-backed pages", () => {
    expect(resolve(HOST, "/en/how-to/deploy")).toMatchObject({ kind: "entry", content_type: "how-to", locale: "en" });
  });

  it("flags URLs the site does not serve as missing", () => {
    expect(resolve(HOST, "/en/deleted-page")).toMatchObject({ kind: "missing_page", key: `dest:${HOST}|/en/deleted-page` });
  });

  it("follows a redirect chain to the final page and records every hop", () => {
    expect(resolve(HOST, "/old-a")).toMatchObject({
      kind: "entry",
      key: "entry:landing/ai-engineering-salaries/en",
      redirected_from: "/old-a",
      redirect_chain: ["/old-a", "/old-b"],
    });
  });

  it("treats a redirect to another host as off-site and stops on loops", () => {
    expect(resolve(HOST, "/go")).toMatchObject({ kind: "off_site", host: "elsewhere.org", redirect_chain: ["/go"] });
    expect(resolve(HOST, "/loop-a")).toMatchObject({ kind: "missing_page", redirect_chain: ["/loop-a", "/loop-b"] });
  });
});

describe("buildAdsReport join", () => {
  const report = buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex });
  const page = report.pages.find((p) => p.slug === "coding-bootcamp")!;

  it("joins Meta spend, GA4 paid visits, and credited ledger leads on the landing page", () => {
    expect(page).toBeTruthy();
    expect(page.spend).toEqual({ USD: 100 });
    expect(page.paid_visits).toBe(50);
    expect(page.unclear_visits).toBe(7);
    expect(page.unique_leads).toBe(2);
    expect(page.submissions).toBe(3);
    expect(page.repeat_submissions).toBe(1);
    expect(page.cost_per_lead).toEqual({ USD: 50 });
    expect(page.meta_leads).toBe(5);
    expect(page.organic?.sessions).toBe(200);
  });

  it("never credits the form page and excludes test leads", () => {
    expect(report.pages.find((p) => p.slug === "apply")).toBeUndefined();
    expect(report.totals.test_submissions).toBe(1);
    expect(report.totals.unique_leads).toBe(2);
    expect(page.started_here).toBe(2);
  });

  it("puts instant-form spend in destinations so totals reconcile with Meta", () => {
    const form = report.destinations.find((d) => d.kind === "instant_form")!;
    expect(form.spend).toEqual({ USD: 40 });
    expect(form.instant_form_leads).toBe(3);
    expect(report.totals.spend).toEqual({ USD: 140 });
    expect(report.totals.tracked_spend).toEqual({ USD: 100 });
  });

  it("keeps Meta leads and site leads separate and flags low sample", () => {
    expect(report.totals.meta_leads).toBe(5);
    expect(report.totals.unique_leads).toBe(2);
    expect(page.low_sample).toBe(false);
    expect(report.warnings.map((w) => w.code)).not.toContain("mixed_currency");
  });

  it("omits GA4 tag groups unless asked", () => {
    expect(page).not.toHaveProperty("ga4_ads");
  });
});

describe("buildAdsReport Meta metrics", () => {
  const TEMPLATE = "utm_source=facebook&utm_medium=paid_social&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";

  afterAll(() => {
    fixture.metaRows = metaRows;
    fixture.creatives = BASE_CREATIVES;
    fixture.metaSplitDays = undefined;
  });

  it("derives CTR, CPC, CPM, Meta conversion rate, Meta CPL, landing rate and lpv_to_visits", () => {
    fixture.creatives = {
      ad1: { links: [`https://${HOST}/en/coding-bootcamp`], url_tags: TEMPLATE, instant_form: false },
      ad2: { links: [], instant_form: true },
    };
    const report = buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex });
    const page = report.pages.find((p) => p.slug === "coding-bootcamp")!;
    expect(page.impressions).toBe(5000);
    expect(page.pixel_leads_click).toBe(3);
    expect(page.ctr).toBeCloseTo(80 / 5000);
    expect(page.cpc).toEqual({ USD: 1.25 });
    expect(page.cpm).toEqual({ USD: 20 });
    expect(page.landing_rate).toBeCloseTo(60 / 80);
    expect(page.meta_conversion_rate).toBeCloseTo(5 / 60);
    expect(page.meta_cost_per_lead).toEqual({ USD: 20 });
    expect(page.lpv_to_visits).toBeCloseTo(50 / 60);
    expect(page.meta_low_sample).toBe(false);
    expect(report.totals.impressions).toBe(7000);
    expect(report.totals.pixel_leads_click).toBe(3);
    expect(report.meta_split_days).toEqual({ covered: 28, total: 28 });
  });

  it("leaves Meta conversion rate null when Meta reports no landing page views", () => {
    fixture.metaRows = [
      {
        ...metaRows[0]!,
        ad_id: "ad-no-lpv",
        landing_page_views: 0,
        pixel_leads: 2,
        pixel_leads_click: 2,
        link_clicks: 40,
      },
    ];
    fixture.creatives = {
      ...BASE_CREATIVES,
      "ad-no-lpv": { links: [`https://${HOST}/en/coding-bootcamp`], url_tags: TEMPLATE, instant_form: false },
    };
    const report = buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex });
    const page = report.pages.find((p) => p.slug === "coding-bootcamp")!;
    expect(page.landing_page_views).toBe(0);
    expect(page.clicks).toBe(40);
    expect(page.meta_conversion_rate).toBeNull();
  });

  it("passes through partial meta_split_days coverage", () => {
    fixture.metaRows = metaRows;
    fixture.creatives = BASE_CREATIVES;
    fixture.metaSplitDays = { covered: 10, total: 28 };
    const report = buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex });
    expect(report.meta_split_days).toEqual({ covered: 10, total: 28 });
  });
});

describe("buildAdsReport lead_gap_compare", () => {
  const at = (date: string) => Date.parse(`${date}T10:00:00.000Z`);
  const leadOn = (date: string, over: Partial<LedgerRow> = {}) =>
    lead({ created_at: at(date), first_paid_at: at(date) - 60_000, last_paid_at: at(date) - 60_000, browser_hash: `b-${date}-${Math.random()}`, ...over });
  const dayFile = (date: string): PaidLandingDayFile => ({ ...paidDay, date });
  const build = () => buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex });

  it("counts only GA4-exported days from the ledger's first full day, excluding test leads", () => {
    // Ledger started mid-day on Sep 10 → shared days start Sep 11; GA4 exported through Sep 17.
    fixture.collectingSince = Date.parse("2026-09-10T15:00:00.000Z");
    fixture.paidDays = ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"].map(dayFile);
    fixture.ledgerRows = [
      leadOn("2026-09-10"), // before the first full day
      leadOn("2026-09-12"),
      leadOn("2026-09-12", { is_test: 1, test_reason: "staff_session" }),
      leadOn("2026-09-14"),
      leadOn("2026-09-19"), // GA4 hasn't exported this day
    ];
    try {
      const report = build();
      expect(report.lead_gap_compare).toEqual({ days: 7, ga4_leads: 7 * 4, submissions: 2 });
      expect(report.totals.ga4_leads).toBe(8 * 4);
      expect(report.totals.submissions).toBe(4);
    } finally {
      fixture.collectingSince = Date.parse("2026-08-01T00:00:00.000Z");
      fixture.paidDays = [paidDay];
      fixture.ledgerRows = ledgerRows;
    }
  });

  it("is empty when the ledger never recorded anything", () => {
    fixture.collectingSince = null;
    fixture.ledgerRows = [];
    try {
      const report = build();
      expect(report.lead_gap_compare).toEqual({ days: 0, ga4_leads: 0, submissions: 0 });
      expect(report.totals.ga4_leads).toBe(4);
    } finally {
      fixture.collectingSince = Date.parse("2026-08-01T00:00:00.000Z");
      fixture.ledgerRows = ledgerRows;
    }
  });
});

describe("buildAdsReport includeGa4Ads", () => {
  it("keeps paid GA4 visits per tag group with ids and first/last seen", () => {
    const report = buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex, includeGa4Ads: true });
    const page = report.pages.find((p) => p.slug === "coding-bootcamp")!;
    expect(page.ga4_ads).toEqual([
      {
        platform: "meta",
        source: "facebook",
        medium: "paid_social",
        campaign: "Bootcamp prospecting",
        campaign_id: "c1",
        adset_id: "s1",
        ad_id: "ad1",
        visits: 50,
        leads: 4,
        first_seen: DAY,
        last_seen: DAY,
      },
    ]);
    expect(page.ga4_untagged_visits).toBe(0);
  });
});

describe("buildAdsReport unrecognized campaigns", () => {
  const EXT = "120249995075650344";
  const ext = (over: Partial<PaidLandingCandidateRow>) =>
    candidate({ campaign: "AI Fluency", utm_id: EXT, utm_term: "120249995075650001", utm_content: "120249995075650002", sessions: 30, sessions_with_lead: 2, ...over });
  const build = () => buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex, includeGa4Ads: true });

  it("groups own-page visits from campaigns outside every connected account", () => {
    fixture.paidDays = [
      {
        ...paidDay,
        candidates: [
          candidate({}),
          ext({ path: "/landing/aprende-ia" }),
          ext({ path: "/en/deleted-page", sessions: 10, sessions_with_lead: 0, utm_content: null }),
          ext({ host: "learn.example.org", path: "/cohort/x", sessions: 4 }),
          candidate({ campaign: "Old promo", utm_id: "555000111", utm_term: null, utm_content: null, sessions: 5 }),
          candidate({ campaign: "From setup", utm_id: "777000222", utm_term: null, utm_content: null, sessions: 6 }),
          candidate({ campaign: " lead FORM ", utm_id: null, utm_term: null, utm_content: null, sessions: 3 }),
          candidate({ campaign: "Partner push", utm_id: null, utm_term: null, utm_content: null, sessions: 8 }),
        ],
      },
    ];
    fixture.olderMetaRows = [{ ...metaRows[0]!, date: "2026-06-01", campaign_id: "555000111", campaign_name: "Old promo 2025", adset_id: "s9", ad_id: "ad9" }];
    fixture.creatives = { ...BASE_CREATIVES, ad7: { links: [], instant_form: false, ad_id: "ad7", campaign_id: "777000222", adset_id: "s7" } };
    try {
      const u = build().unrecognized_campaigns!;
      expect(u.paid_meta_visits).toBe(50 + 30 + 10 + 5 + 6 + 3 + 8);
      expect(u.campaigns.map((c) => [c.key, c.visits])).toEqual([
        [EXT, 40],
        ["Partner push", 8],
      ]);
      const c = u.campaigns[0]!;
      expect(c).toMatchObject({ campaign_id: EXT, campaign_name: "AI Fluency", leads: 2, untagged_visits: 10, first_seen: DAY, last_seen: DAY });
      expect(c.pages.map((p) => [p.key, p.visits])).toEqual([
        ["entry:landing/aprende-ia/es", 30],
        [`dest:${HOST}|/en/deleted-page`, 10],
      ]);
      expect(c.ga4_seen).toHaveLength(2);
      expect(u.campaigns[1]).toMatchObject({ campaign_id: null, campaign_name: "Partner push" });
    } finally {
      fixture.paidDays = [paidDay];
      fixture.olderMetaRows = undefined;
      fixture.creatives = BASE_CREATIVES;
    }
  });

  it("is only computed for includeGa4Ads", () => {
    expect(buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex })).not.toHaveProperty("unrecognized_campaigns");
    expect(build().unrecognized_campaigns).toEqual({ paid_meta_visits: 50, campaigns: [] });
  });
});

describe("buildAdsReport clicks → visits", () => {
  const TEMPLATE = "utm_source=facebook&utm_medium=paid_social&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";
  const NO_GA4_DAY = "2026-09-16";
  const base = metaRows[0]!;

  afterAll(() => {
    fixture.metaRows = metaRows;
    fixture.paidDays = [paidDay];
    fixture.creatives = BASE_CREATIVES;
  });

  function build() {
    fixture.creatives = {
      ad1: { links: [`https://${HOST}/en/coding-bootcamp`], url_tags: TEMPLATE, instant_form: false },
      ad2: { links: [], instant_form: true },
      ad3: { links: [`https://${HOST}/en/coding-bootcamp?utm_source=facebook`], instant_form: false },
      ad4: { links: ["https://elsewhere.org/offer"], url_tags: TEMPLATE, instant_form: false },
    };
    fixture.metaRows = [
      ...metaRows,
      { ...base, date: NO_GA4_DAY, link_clicks: 30 },
      { ...base, ad_id: "ad3", link_clicks: 20 },
      { ...base, ad_id: "ad4", link_clicks: 15 },
    ];
    fixture.paidDays = [
      {
        ...paidDay,
        candidates: [
          ...paidDay.candidates,
          candidate({ utm_id: "other-campaign", utm_term: null, utm_content: "other-ad", sessions: 9, engaged_sessions: 0, sessions_with_lead: 0 }),
        ],
      },
    ];
    return buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex });
  }

  it("divides matched visits by tagged on-site clicks on days GA4 exported", () => {
    const report = build();
    const page = report.pages.find((p) => p.slug === "coding-bootcamp")!;
    expect(page.paid_visits).toBe(59);
    expect(page.matched_visits).toBe(50);
    expect(page.clicks).toBe(130);
    expect(page.untagged_clicks).toBe(20);
    expect(page.clicks_to_visits).toBeCloseTo(50 / 80);
    expect(report.totals).toMatchObject({ matched_visits: 50, unmatched_meta_visits: 9, ratio_clicks: 80, untagged_clicks: 20 });
  });

  it("leaves instant-form and off-site clicks out of the ratio", () => {
    const report = build();
    const off = report.destinations.find((d) => d.kind === "off_site")!;
    expect(off.clicks).toBe(15);
    expect(off.clicks_to_visits).toBeNull();
    expect(report.totals.clicks).toBe(145);
    expect(report.totals.ratio_clicks).toBe(80);
  });

  it("does not count visits from ads outside the account filter", () => {
    build();
    const report = buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex, account: "999" });
    expect(report.totals.matched_visits).toBe(0);
    expect(report.totals.ratio_clicks).toBe(0);
    expect(report.totals.paid_visits).toBe(0);
    expect(report.totals.unsynced_account_visits).toBe(9);
    expect(report.totals.unassigned_visits).toBe(0);
  });

  it("counts Meta-auto-tagged ads as tagged for untagged_clicks when GA4 confirms utm_content", () => {
    const dates = ["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15"];
    fixture.creatives = {
      ad1: { links: [`https://${HOST}/en/coding-bootcamp`], url_tags: TEMPLATE, instant_form: false },
      ad3: { links: [`https://${HOST}/en/coding-bootcamp?utm_source=facebook`], instant_form: false },
    };
    fixture.metaRows = dates.flatMap((date) => [
      { ...base, date, link_clicks: 20 },
      { ...base, date, ad_id: "ad3", link_clicks: 25 },
    ]);
    fixture.paidDays = dates.map((date, i) => ({
      ...paidDay,
      date,
      complete: true,
      candidates: [
        candidate({}),
        ...(i === 0 ? [candidate({ utm_content: "ad3", utm_id: null, utm_term: null, sessions: 20, engaged_sessions: 10, sessions_with_lead: 0 })] : []),
      ],
    }));
    const report = buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex });
    // ad3: 100 clicks, 20 sessions (≥3 and ≥10%) → meta_auto; no longer untagged
    expect(report.totals.untagged_clicks).toBe(0);
    expect(report.totals.ratio_clicks).toBeGreaterThan(0);
  });
});

describe("buildAdsReport account / currency filter narrows visits and leads", () => {
  const B_ROW: MetaAdDayRow = {
    ...metaRows[0]!,
    account_id: "222222",
    currency: "EUR",
    campaign_id: "c9",
    campaign_name: "Spanish launch",
    adset_id: "s9",
    ad_id: "ad9",
    spend: 30,
    link_clicks: 25,
    pixel_leads: 1,
  };
  const ES = "/landing/aprende-ia";

  afterAll(() => {
    fixture.metaRows = metaRows;
    fixture.paidDays = [paidDay];
    fixture.creatives = BASE_CREATIVES;
    fixture.ledgerRows = ledgerRows;
  });

  function build(over: Partial<Parameters<typeof buildAdsReport>[0]> = {}) {
    fixture.metaRows = [...metaRows, B_ROW];
    fixture.creatives = { ...BASE_CREATIVES, ad9: { links: [`https://${HOST}${ES}`], instant_form: false } };
    fixture.paidDays = [
      {
        ...paidDay,
        candidates: [
          candidate({}),
          candidate({ path: ES, campaign: "Spanish launch", utm_id: "c9", utm_term: "s9", utm_content: "ad9", sessions: 20, sessions_with_lead: 1 }),
          candidate({ path: ES, campaign: "(not set)", utm_id: null, utm_term: null, utm_content: null, sessions: 5, sessions_with_lead: 0 }),
          candidate({ path: ES, campaign: "Other team", utm_id: "c-x", utm_term: null, utm_content: "ad-x", sessions: 4, sessions_with_lead: 0 }),
        ],
      },
    ];
    fixture.ledgerRows = [
      lead({ submission_id: "a" }),
      lead({
        submission_id: "b",
        browser_hash: "b9",
        campaign_id: "c9",
        adset_id: "s9",
        ad_id: "ad9",
        landing_path: ES,
        first_paid_path: ES,
        last_paid_path: ES,
      }),
    ];
    return buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex, ...over });
  }

  it("keeps only the selected account's visits, spend and leads", () => {
    const report = build({ account: "222222" });
    expect(report.pages.map((p) => p.path)).toEqual([ES]);
    const es = report.pages[0]!;
    expect(es.paid_visits).toBe(20);
    expect(es.spend).toEqual({ EUR: 30 });
    expect(es.unique_leads).toBe(1);
    expect(es.cost_per_visit).toEqual({ EUR: 1.5 });
    expect(es.unassigned_visits).toBe(5);
    expect(report.totals).toMatchObject({ paid_visits: 20, unassigned_visits: 5, unsynced_account_visits: 4, unique_leads: 1 });
    const w = report.warnings.find((x) => x.code === "visits_not_tied_to_account");
    expect(w?.message).toMatch(/5 paid Meta visit\(s\) had no ad tags/);
    expect(w?.message).toMatch(/4 more carried ad ids/);
  });

  it("narrows the same way under a currency filter", () => {
    const report = build({ currency: "EUR" });
    expect(report.totals).toMatchObject({ paid_visits: 20, unassigned_visits: 5, unsynced_account_visits: 4, unique_leads: 1 });
    expect(report.warnings.find((x) => x.code === "visits_not_tied_to_account")?.message).toMatch(/EUR accounts/);
  });

  it("counts every paid visit when no account or currency is selected", () => {
    const report = build();
    const es = report.pages.find((p) => p.path === ES)!;
    expect(es.paid_visits).toBe(29);
    expect(es.unassigned_visits).toBe(0);
    expect(report.totals).toMatchObject({ paid_visits: 79, unassigned_visits: 0, unsynced_account_visits: 0, unique_leads: 2 });
    expect(report.warnings.map((x) => x.code)).not.toContain("visits_not_tied_to_account");
  });
});

describe("resolveReportWindow", () => {
  it("keeps days ending yesterday when no range is given", () => {
    expect(resolveReportWindow({ days: 7, now: NOW })).toEqual({ start: "2026-09-13", end: "2026-09-19", days: 7, clamped: [] });
  });

  it("uses since / until as an inclusive window", () => {
    expect(resolveReportWindow({ since: "2026-06-01", until: "2026-06-30", days: 7, now: NOW })).toEqual({
      start: "2026-06-01",
      end: "2026-06-30",
      days: 30,
      clamped: [],
    });
  });

  it("runs days forward from since (default 90) and backward from until (default 28)", () => {
    expect(resolveReportWindow({ since: "2026-05-01", now: NOW })).toMatchObject({ start: "2026-05-01", end: "2026-07-29", days: 90 });
    expect(resolveReportWindow({ since: "2026-09-10", now: NOW })).toMatchObject({ end: "2026-09-19", days: 10, clamped: [] });
    expect(resolveReportWindow({ until: "2026-06-30", now: NOW })).toMatchObject({ start: "2026-06-03", end: "2026-06-30", days: 28 });
  });

  it("clamps until to yesterday and since to the retention floor", () => {
    expect(resolveReportWindow({ since: "2026-09-01", until: "2026-09-25", now: NOW })).toMatchObject({ end: "2026-09-19", clamped: ["until"] });
    expect(resolveReportWindow({ since: "2025-08-01", until: "2025-08-31", now: NOW })).toMatchObject({ start: "2025-08-21", clamped: ["since"] });
  });

  it("rejects spans over 90 days, reversed ranges and invalid dates", () => {
    expect(() => resolveReportWindow({ since: "2026-01-01", until: "2026-06-30", now: NOW })).toThrow(AdsReportRangeError);
    expect(() => resolveReportWindow({ since: "2026-06-30", until: "2026-06-01", now: NOW })).toThrow(/after until/);
    expect(() => resolveReportWindow({ since: "2026-02-30", until: "2026-03-10", now: NOW })).toThrow(/real date/);
    expect(() => resolveReportWindow({ since: "2024-01-01", until: "2024-02-01", now: NOW })).toThrow(/No days left/);
  });
});

describe("compressDateRanges", () => {
  it("collapses consecutive days and caps the list", () => {
    expect(compressDateRanges(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-05"])).toBe("2026-01-01..2026-01-03, 2026-01-05");
    expect(compressDateRanges(["2026-01-01", "2026-01-03", "2026-01-05"], 2)).toBe("2026-01-01, 2026-01-03 and 1 more");
  });
});

describe("buildAdsReport id filters", () => {
  const build = (over: Partial<Parameters<typeof buildAdsReport>[0]> = {}) =>
    buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex, ...over });
  const codes = (r: ReturnType<typeof build>) => r.warnings.map((w) => w.code);

  afterAll(() => {
    fixture.paidDays = [paidDay];
    fixture.ledgerRows = ledgerRows;
  });

  it("leaves the report unchanged and echoes empty filters when none are set", () => {
    const r = build();
    expect(r.totals.spend).toEqual({ USD: 140 });
    expect(r.filters).toEqual({ campaign_ids: [], adset_ids: [], ad_ids: [] });
    expect(codes(r)).not.toContain("filter_no_match");
    expect(codes(r)).not.toContain("untagged_visits_excluded");
  });

  it("narrows spend, visits and leads to one campaign", () => {
    const r = build({ campaign_ids: ["c1"] });
    expect(r.totals.spend).toEqual({ USD: 100 });
    expect(r.totals.paid_visits).toBe(50);
    expect(r.totals.unique_leads).toBe(2);
    expect(r.destinations.find((d) => d.kind === "instant_form")).toBeUndefined();
    expect(r.filters.campaign_ids).toEqual(["c1"]);
    expect(r.campaigns.map((c) => c.campaign_id)).toEqual(["c1"]);
  });

  it("keeps only the other campaign's spend and none of the c1 visits or leads", () => {
    const r = build({ campaign_ids: ["c2"] });
    expect(r.totals.spend).toEqual({ USD: 40 });
    expect(r.totals.paid_visits).toBe(0);
    expect(r.totals.unique_leads).toBe(0);
  });

  it("ANDs across levels and reports ids that matched nothing", () => {
    const r = build({ campaign_ids: ["c1"], ad_ids: ["ad2"] });
    expect(r.totals.spend).toEqual({});
    const w = r.warnings.find((x) => x.code === "filter_no_match")!;
    expect(w.message).toContain("campaign_ids [c1]");
    expect(w.message).toContain("ad_ids [ad2]");
  });

  it("fills a visit's campaign from its ad id and leaves untagged visits out with a warning", () => {
    fixture.paidDays = [
      {
        ...paidDay,
        candidates: [
          ...paidDay.candidates,
          candidate({ utm_id: null, utm_term: null, utm_content: "ad1", sessions: 5, sessions_with_lead: 0 }),
          candidate({ utm_id: null, utm_term: null, utm_content: null, click_id_type: null, sessions: 12, sessions_with_lead: 0 }),
        ],
      },
    ];
    try {
      const r = build({ campaign_ids: ["c1"] });
      expect(r.totals.paid_visits).toBe(55);
      const w = r.warnings.find((x) => x.code === "untagged_visits_excluded")!;
      expect(w.message).toMatch(/^12 paid Meta visit/);
      expect(w.message).toContain("/en/coding-bootcamp");
      expect(w.message).toContain("campaign id");
      expect(codes(build({ ad_ids: ["ad1"] }))).toContain("untagged_visits_excluded");
    } finally {
      fixture.paidDays = [paidDay];
    }
  });

  it("matches leads by the last-clicked ad and says so under first_paid", () => {
    fixture.ledgerRows = [...ledgerRows, lead({ submission_id: "other", browser_hash: "b9", campaign_id: "c2", adset_id: "s2", ad_id: "ad2" })];
    try {
      expect(build({ campaign_ids: ["c1"] }).totals.unique_leads).toBe(2);
      expect(build({ ad_ids: ["ad2"] }).totals.unique_leads).toBe(1);
      expect(codes(build({ campaign_ids: ["c1"], model: "first_paid" }))).toContain("leads_matched_by_last_click");
      expect(codes(build({ campaign_ids: ["c1"] }))).not.toContain("leads_matched_by_last_click");
    } finally {
      fixture.ledgerRows = ledgerRows;
    }
  });
});

describe("buildAdsReport date range + data gaps", () => {
  afterAll(() => {
    fixture.metaDates = undefined;
  });

  it("reports the requested window and a range_clamped warning", () => {
    const r = buildAdsReport({ site: "site_test", since: "2026-09-01", until: "2026-09-30", now: NOW, noRefresh: true, contentIndex: fakeContentIndex });
    expect(r.window).toEqual({ start: "2026-09-01", end: "2026-09-19", days: 19 });
    expect(r.warnings.map((w) => w.code)).toContain("range_clamped");
  });

  it("flags Meta and GA4 days with no cached file (GA4 only through its last complete day)", () => {
    fixture.metaDates = ALL_META_DATES.filter((d) => d !== "2026-09-10" && d !== "2026-09-11");
    const r = buildAdsReport({ site: "site_test", since: "2026-09-10", until: "2026-09-19", now: NOW, noRefresh: true, contentIndex: fakeContentIndex });
    expect(r.data_gaps).toEqual({ meta_missing_days: 2, ga4_missing_days: 8, google_missing_days: 0 });
    const w = r.warnings.find((x) => x.code === "data_gaps")!;
    expect(w.message).toContain("Meta (2 day(s): 2026-09-10..2026-09-11)");
    expect(w.message).toContain("GA4 (8 day(s): 2026-09-10..2026-09-14, 2026-09-16..2026-09-18)");
  });
});

describe("buildAdsReport meta_platforms", () => {
  const SPLIT_TAGS = "utm_source={{site_source_name}}&utm_medium=paid_social&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";
  function platformRow(ad_id: string, campaign_id: string, platform: MetaAdPlatformDayRow["platform"], spend: number): MetaAdPlatformDayRow {
    return { date: DAY, account_id: "111111", currency: "USD", campaign_id, adset_id: `s-${campaign_id}`, ad_id, platform, spend, impressions: 100, link_clicks: 5, pixel_leads: 0 };
  }
  const build = (over: Partial<Parameters<typeof buildAdsReport>[0]> = {}) =>
    buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex, ...over });
  const row = (r: ReturnType<typeof build>, p: string) => r.meta_platforms?.rows.find((x) => x.platform === p);

  beforeAll(() => {
    fixture.creatives = {
      ...BASE_CREATIVES,
      ad3: { links: [`https://${HOST}/en/coding-bootcamp`], url_tags: SPLIT_TAGS, instant_form: false },
    };
    fixture.platformRows = [
      platformRow("ad3", "c3", "facebook", 30),
      platformRow("ad3", "c3", "instagram", 20),
      platformRow("ad1", "c1", "facebook", 60),
      platformRow("ad1", "c1", "instagram", 40),
      platformRow("ad2", "c2", "instagram", 40),
    ];
    fixture.paidDays = [
      {
        ...paidDay,
        candidates: [
          candidate({ source: "fb", utm_id: "c3", utm_term: "s-c3", utm_content: "ad3", sessions: 20 }),
          candidate({ source: "ig", utm_id: "c3", utm_term: "s-c3", utm_content: "ad3", sessions: 10 }),
          candidate({}),
        ],
      },
    ];
    const c3 = { campaign_id: "c3", adset_id: "s-c3", ad_id: "ad3" };
    fixture.ledgerRows = [
      lead({ submission_id: "a" }),
      lead({ submission_id: "b", browser_hash: "b2" }),
      lead({ submission_id: "c", is_repeat: 1, repeat_of: "a" }),
      lead({ submission_id: "f", browser_hash: "b3", utm_source: "fb", ...c3 }),
      lead({ submission_id: "i", browser_hash: "b4", utm_source: "ig", ...c3 }),
    ];
    fixture.metaState = {
      consecutive_failures: 0,
      last_success_at: NOW.toISOString(),
      accounts: { "111111": { name: "A", currency: "USD", account_status: 1, platform_history_loaded_at: NOW.toISOString(), platform_history_since: "2026-07-01" } },
    };
  });

  afterAll(() => {
    fixture.creatives = BASE_CREATIVES;
    fixture.platformRows = undefined;
    fixture.paidDays = [paidDay];
    fixture.ledgerRows = ledgerRows;
    fixture.metaState = undefined;
  });

  it("splits site-ad spend, visits and leads by placement; older-tag ads go to not_split", () => {
    const r = build();
    expect(r.meta_platforms?.rows.map((x) => x.platform)).toEqual(["facebook", "instagram", "not_split"]);
    expect(row(r, "facebook")).toMatchObject({ spend: { USD: 30 }, paid_visits: 20, unique_leads: 1, cost_per_lead: { USD: 30 } });
    expect(row(r, "instagram")).toMatchObject({ spend: { USD: 20 }, paid_visits: 10, unique_leads: 1, cost_per_lead: { USD: 20 } });
    expect(row(r, "not_split")).toMatchObject({ spend: { USD: 100 }, paid_visits: 50, unique_leads: 2, cost_per_lead: { USD: 50 } });
    expect(r.meta_platforms?.excluded_spend).toEqual({ instant_form: { USD: 40 }, off_site: {}, unknown: {} });
    expect(r.meta_platforms?.not_split_share).toBe(0.625);
    expect(r.meta_platforms?.spend_partial).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain("meta_platform_not_split");
    expect(r.totals.spend).toEqual({ USD: 140 });
  });

  it("narrows placement spend with campaign filters", () => {
    const r = build({ campaign_ids: ["c3"] });
    expect(r.meta_platforms?.rows.map((x) => x.platform)).toEqual(["facebook", "instagram"]);
    expect(row(r, "facebook")?.spend).toEqual({ USD: 30 });
    expect(r.meta_platforms?.excluded_spend.instant_form).toEqual({});
  });

  it("flags partial placement spend while history is still loading", () => {
    const saved = fixture.metaState;
    fixture.metaState = { consecutive_failures: 0, accounts: { "111111": { name: "A", currency: "USD", account_status: 1 } } };
    try {
      const r = build();
      expect(r.meta_platforms?.spend_since).toBeNull();
      expect(r.meta_platforms?.spend_partial).toBe(true);
      expect(r.warnings.map((w) => w.code)).toContain("meta_platform_spend_partial");
    } finally {
      fixture.metaState = saved;
    }
  });

  it("is omitted when turned off", () => {
    expect(build({ includeMetaPlatforms: false }).meta_platforms).toBeUndefined();
  });
});

describe("buildAdsReport with a production download", () => {
  const SNAPSHOT_STATE = {
    consecutive_failures: 0,
    accounts: {},
    last_success_at: NOW.toISOString(),
    pulled_from_production_at: "2026-09-20T10:00:00.000Z",
    production_origin: "https://4geeks.com",
    snapshot_last_date: "2026-09-19",
  };
  const build = () => buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex });

  afterAll(() => {
    fixture.metaRows = metaRows;
    fixture.metaState = undefined;
    fixture.metaConnected = undefined;
  });

  it("without a local token: labels the copy, names its last day and warns about hidden accounts", () => {
    fixture.metaConnected = false;
    fixture.metaState = SNAPSHOT_STATE;
    fixture.metaRows = [...metaRows, { ...metaRows[0]!, account_id: "999999", ad_id: "ad-hidden", spend: 12.5 }];
    const r = build();
    expect(r.meta).toMatchObject({
      connected: true,
      source: "production_snapshot",
      pulled_at: "2026-09-20T10:00:00.000Z",
      last_date: "2026-09-19",
      production_origin: "https://4geeks.com",
    });
    const snap = r.warnings.find((w) => w.code === "meta_production_snapshot");
    expect(snap?.message).toContain("https://4geeks.com");
    expect(snap?.message).toContain("Last day: Sep 19. Newer days are missing.");
    const hidden = r.warnings.find((w) => w.code === "meta_snapshot_hidden_accounts");
    expect(hidden?.message).toContain("999999");
    expect(hidden?.message).toContain("12.5 USD");
    expect(r.warnings.map((w) => w.code)).not.toContain("meta_not_connected");
  });

  it("with a local token the same files read as a normal sync", () => {
    fixture.metaConnected = true;
    fixture.metaState = SNAPSHOT_STATE;
    fixture.metaRows = metaRows;
    const r = build();
    expect(r.meta.source).toBe("sync");
    expect(r.meta).not.toHaveProperty("pulled_at");
    expect(r.warnings.map((w) => w.code)).not.toContain("meta_production_snapshot");
  });
});

describe("buildAdsReport lead_conversions", () => {
  const RMI = "1086440567304045";
  const APP = "1634685814697001";
  const build = () => buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex });
  const withConversions = (conversions: Record<string, number>, date = DAY): MetaAdDayRow => ({ ...metaRows[0]!, date, conversions });

  afterAll(() => {
    fixture.metaRows = metaRows;
    fixture.metaSettings = undefined;
    fixture.metaState = undefined;
    fixture.metaConnected = undefined;
    fixture.ledgerRows = ledgerRows;
  });

  it("with nothing picked counts the standard Lead event (older rows use pixel_leads)", () => {
    fixture.metaSettings = { lead_conversions: [] };
    fixture.metaRows = metaRows;
    const r = build();
    expect(r.totals.meta_leads).toBe(5);
    expect(r.lead_conversions.meta_picked).toEqual([]);
    expect(r.lead_conversions.meta).toEqual([{ key: "fb_pixel_lead", name: "Standard Lead event", count: 5 }]);
    expect(r.lead_conversions.meta_incomplete_days).toBe(0);
  });

  it("sums only the picked conversions, named from the cache (unknown ids keep their id)", () => {
    fixture.metaSettings = { lead_conversions: [RMI, APP] };
    fixture.metaRows = [withConversions({ fb_pixel_lead: 9, [RMI]: 3, [APP]: 1 }), metaRows[1]!];
    const r = build();
    expect(r.totals.meta_leads).toBe(4);
    expect(r.pages.find((p) => p.slug === "coding-bootcamp")?.meta_leads).toBe(4);
    expect(r.lead_conversions.meta).toEqual([
      { key: RMI, name: "request_more_info", count: 3 },
      { key: APP, name: APP, count: 1 },
    ]);
  });

  it("counts days cached before per-conversion counts as incomplete (and flags an old production copy)", () => {
    fixture.metaSettings = { lead_conversions: [RMI] };
    fixture.metaRows = [withConversions({ [RMI]: 2 }), { ...metaRows[0]!, date: "2026-09-10" }];
    let r = build();
    expect(r.totals.meta_leads).toBe(2);
    expect(r.lead_conversions.meta_incomplete_days).toBe(1);
    expect(r.lead_conversions.snapshot_lacks_conversions).toBe(false);
    fixture.metaConnected = false;
    fixture.metaState = { consecutive_failures: 0, accounts: {}, pulled_from_production_at: "2026-09-20T10:00:00.000Z" };
    r = build();
    expect(r.lead_conversions.snapshot_lacks_conversions).toBe(true);
    fixture.metaConnected = undefined;
    fixture.metaState = undefined;
  });

  it("groups site leads by conversion name (credited, non-repeat, non-test)", () => {
    fixture.metaSettings = undefined;
    fixture.metaRows = metaRows;
    fixture.ledgerRows = [
      ...ledgerRows,
      lead({ submission_id: "d", browser_hash: "b5", form: "request_more_info" }),
      lead({ submission_id: "e", browser_hash: "b6", form: null }),
    ];
    const r = build();
    expect(r.lead_conversions.site).toEqual([
      { name: "apply", count: 2 },
      { name: "(no conversion name)", count: 1 },
      { name: "request_more_info", count: 1 },
    ]);
    expect(r.lead_conversions.site.reduce((s, c) => s + c.count, 0)).toBe(r.totals.unique_leads);
  });
});

describe("buildAdsReport campaign breakdown per page", () => {
  const build = (model?: "last_paid" | "first_paid") =>
    buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex, ...(model ? { model } : {}) });
  const pageOf = (r: ReturnType<typeof build>) => r.pages.find((p) => p.slug === "coding-bootcamp")!;
  const metaRow = (over: Partial<MetaAdDayRow>): MetaAdDayRow => ({ ...metaRows[0]!, ...over });

  afterAll(() => {
    fixture.metaRows = metaRows;
    fixture.creatives = BASE_CREATIVES;
    fixture.paidDays = [paidDay];
    fixture.ledgerRows = ledgerRows;
  });

  it("splits spend, Meta numbers, visits and site leads per campaign and adds up to the page", () => {
    const page = pageOf(build());
    const c1 = page.campaigns.find((c) => c.campaign_id === "c1")!;
    expect(c1).toMatchObject({
      platform: "meta",
      campaign_name: "Bootcamp prospecting",
      spend: { USD: 100 },
      clicks: 80,
      impressions: 5000,
      landing_page_views: 60,
      meta_leads: 5,
      pixel_leads_click: 3,
      paid_visits: 50,
      engaged_sessions: 30,
      unique_leads: 2,
      cost_per_visit: { USD: 2 },
      cost_per_lead: { USD: 50 },
      cpc: { USD: 1.25 },
      low_sample: false,
    });
    expect(c1.conversion_rate).toBeCloseTo(2 / 50);
    expect(c1.bounce_rate).toBeCloseTo(1 - 30 / 50);
    expect(c1.ctr).toBeCloseTo(80 / 5000);
    const sum = (k: "paid_visits" | "unique_leads" | "clicks" | "meta_leads") => page.campaigns.reduce((s, c) => s + c[k], 0);
    expect(sum("paid_visits")).toBe(page.paid_visits);
    expect(sum("unique_leads")).toBe(page.unique_leads);
    expect(sum("clicks")).toBe(page.clicks);
    expect(sum("meta_leads")).toBe(page.meta_leads);
    for (const c of page.campaigns) expect(c.pixel_leads_click).toBeLessThanOrEqual(c.meta_leads);
    expect(page.comparable_campaigns).toBe(1);
  });

  it("puts visits and leads without a known campaign id in one untagged row with no spend", () => {
    fixture.paidDays = [
      {
        ...paidDay,
        candidates: [
          ...paidDay.candidates,
          candidate({ utm_id: "999", utm_term: null, utm_content: null, campaign: "Partner push", sessions: 12, engaged_sessions: 3, sessions_with_lead: 0 }),
          candidate({ utm_id: null, utm_term: null, utm_content: null, campaign: "old_naming", sessions: 4, engaged_sessions: 1, sessions_with_lead: 0 }),
        ],
      },
    ];
    fixture.ledgerRows = [...ledgerRows, lead({ submission_id: "u", browser_hash: "b9", campaign_id: null, adset_id: null, ad_id: null })];
    try {
      const page = pageOf(build());
      const untagged = page.campaigns.at(-1)!;
      expect(untagged).toMatchObject({ untagged: true, campaign_id: null, spend: {}, paid_visits: 16, engaged_sessions: 4, unique_leads: 1 });
      expect(untagged.tag_texts).toEqual([
        { text: "Partner push", visits: 12 },
        { text: "old_naming", visits: 4 },
      ]);
      expect(untagged.visits_by_platform).toEqual({ meta: 16 });
      expect(page.campaigns.reduce((s, c) => s + c.paid_visits, 0)).toBe(page.paid_visits);
      expect(page.campaigns.reduce((s, c) => s + c.unique_leads, 0)).toBe(page.unique_leads);
      expect(page.comparable_campaigns).toBe(1);
    } finally {
      fixture.paidDays = [paidDay];
      fixture.ledgerRows = ledgerRows;
    }
  });

  it("keeps a campaign with spend but no visits, with empty rates, sorted by spend", () => {
    fixture.metaRows = [...metaRows, metaRow({ campaign_id: "c3", campaign_name: "Retargeting", adset_id: "s3", ad_id: "ad3", spend: 30, link_clicks: 10, landing_page_views: 8, pixel_leads: 1, pixel_leads_click: 1 })];
    fixture.creatives = { ...BASE_CREATIVES, ad3: { links: [`https://${HOST}/en/coding-bootcamp`], instant_form: false } };
    try {
      const page = pageOf(build());
      expect(page.campaigns.map((c) => c.campaign_id)).toEqual(["c1", "c3"]);
      const c3 = page.campaigns[1]!;
      expect(c3).toMatchObject({ spend: { USD: 30 }, paid_visits: 0, cost_per_visit: {}, conversion_rate: null, bounce_rate: null, low_sample: true });
      expect(page.comparable_campaigns).toBe(1);
    } finally {
      fixture.metaRows = metaRows;
      fixture.creatives = BASE_CREATIVES;
    }
  });

  it("credits a site lead to the campaign of the first or last paid click, following the model", () => {
    fixture.metaRows = [...metaRows, metaRow({ campaign_id: "c3", campaign_name: "Retargeting", adset_id: "s3", ad_id: "ad3", spend: 30 })];
    fixture.creatives = { ...BASE_CREATIVES, ad3: { links: [`https://${HOST}/en/coding-bootcamp`], instant_form: false } };
    fixture.ledgerRows = [
      lead({
        submission_id: "m",
        first_paid_platform: "meta",
        first_paid_campaign_id: "c3",
        last_paid_platform: "meta",
        last_paid_campaign_id: "c1",
      } as Partial<LedgerRow>),
    ];
    try {
      const last = pageOf(build("last_paid"));
      expect(last.campaigns.find((c) => c.campaign_id === "c1")!.unique_leads).toBe(1);
      expect(last.campaigns.find((c) => c.campaign_id === "c3")!.unique_leads).toBe(0);
      const first = pageOf(build("first_paid"));
      expect(first.campaigns.find((c) => c.campaign_id === "c3")!.unique_leads).toBe(1);
      expect(first.campaigns.find((c) => c.campaign_id === "c1")!.unique_leads).toBe(0);
    } finally {
      fixture.metaRows = metaRows;
      fixture.creatives = BASE_CREATIVES;
      fixture.ledgerRows = ledgerRows;
    }
  });

  it("returns every campaign on a page (no cap at 10)", () => {
    const extra = Array.from({ length: 12 }, (_, i) =>
      metaRow({ campaign_id: `cx${i}`, campaign_name: `Campaign ${i}`, adset_id: `sx${i}`, ad_id: `adx${i}`, spend: 5 + i }),
    );
    fixture.metaRows = [...metaRows, ...extra];
    fixture.creatives = {
      ...BASE_CREATIVES,
      ...Object.fromEntries(extra.map((m) => [m.ad_id, { links: [`https://${HOST}/en/coding-bootcamp`], instant_form: false }])),
    };
    try {
      const page = pageOf(build());
      expect(page.campaigns).toHaveLength(13);
      expect(page.campaigns[0]!.campaign_id).toBe("c1");
    } finally {
      fixture.metaRows = metaRows;
      fixture.creatives = BASE_CREATIVES;
    }
  });
});

describe("buildAdsReport URL history (Meta)", () => {
  const OLD = `https://${HOST}/en/coding-bootcamp`;
  const NEW = `https://${HOST}/landing/ai-engineering-salaries`;
  const NEXT_DAY = "2026-09-16";
  const build = () => buildAdsReport({ site: "site_test", days: 28, now: NOW, noRefresh: true, contentIndex: fakeContentIndex });
  const byKey = (r: ReturnType<typeof build>, key: string) => r.pages.find((p) => p.key === key);
  const OLD_KEY = "entry:landing/coding-bootcamp/en";
  const NEW_KEY = "entry:landing/ai-engineering-salaries/en";

  function catalog(): import("./ads-setup").AdsSetupCatalog {
    const v1 = { v: 1, landing_urls: [OLD], url_tags: null, destination: "website" as const, first_seen_at: null, seeded_at: "2026-08-01T00:00:00.000Z", last_seen_at: `${DAY}T08:00:00.000Z` };
    const v2 = { v: 2, landing_urls: [NEW], url_tags: null, destination: "website" as const, first_seen_at: `${DAY}T12:00:00.000Z`, last_seen_at: "2026-09-19T08:00:00.000Z" };
    return {
      version: 2,
      platform: "meta",
      fetched_at: NOW.toISOString(),
      accounts: { "111111": { id: "111111", name: null, currency: "USD", timezone: "UTC", last_seen_at: NOW.toISOString() } },
      campaigns: {},
      adsets: {},
      ads: {
        ad1: { id: "ad1", account_id: "111111", campaign_id: "c1", adset_id: "s1", name: "Ad 1", status: "ACTIVE", landing_urls: [NEW], url_tags: null, destination: "website", last_seen_at: v2.last_seen_at, versions: [v1, v2] },
      },
      extras: {},
    };
  }

  afterAll(() => {
    fixture.metaSetup = undefined;
    fixture.metaRows = metaRows;
    fixture.creatives = BASE_CREATIVES;
    fixture.paidDays = [paidDay];
  });

  it("splits the changeover day by where that day's tagged visits landed and tags both pages", () => {
    fixture.metaSetup = catalog();
    fixture.creatives = { ...BASE_CREATIVES, ad1: { links: [NEW], instant_form: false } };
    fixture.paidDays = [{ ...paidDay, candidates: [...paidDay.candidates, candidate({ path: "/landing/ai-engineering-salaries", sessions: 50 })] }];
    const r = build();
    const oldPage = byKey(r, OLD_KEY)!;
    const newPage = byKey(r, NEW_KEY)!;
    expect(oldPage.spend).toEqual({ USD: 50 });
    expect(newPage.spend).toEqual({ USD: 50 });
    expect(oldPage.clicks + newPage.clicks).toBe(80);
    expect(oldPage.url_change_days).toBe(1);
    expect(newPage.url_change_days).toBe(1);
    expect(r.totals.spend).toEqual({ USD: 140 });
    expect(r.url_changes).toEqual([
      expect.objectContaining({ ad_id: "ad1", date: DAY, from_key: OLD_KEY, to_key: NEW_KEY, basis: "ga4", inferred: false, spend: { USD: 100 } }),
    ]);
    expect(newPage.url_changes?.[0]).toMatchObject({ ad_id: "ad1", date: DAY });
    expect(r.warnings.map((w) => w.code)).toContain("ad_url_changed");
    expect(r.attribution.url_history?.since).toBe("2026-08-01T00:00:00.000Z");
  });

  it("puts days after the change on the new page only, untagged", () => {
    fixture.metaSetup = catalog();
    fixture.creatives = { ...BASE_CREATIVES, ad1: { links: [NEW], instant_form: false } };
    fixture.paidDays = [paidDay];
    fixture.metaRows = [{ ...metaRows[0]!, date: NEXT_DAY, spend: 30, link_clicks: 10 }, metaRows[1]!];
    const r = build();
    expect(byKey(r, NEW_KEY)?.spend).toEqual({ USD: 30 });
    expect(byKey(r, NEW_KEY)?.url_change_days ?? 0).toBe(0);
    expect(byKey(r, OLD_KEY)?.spend ?? {}).toEqual({});
    expect(r.url_changes).toEqual([]);
    fixture.metaRows = metaRows;
  });

  it("without GA4 visits on the changeover day: whole day to the new page", () => {
    fixture.metaSetup = catalog();
    fixture.creatives = { ...BASE_CREATIVES, ad1: { links: [NEW], instant_form: false } };
    fixture.paidDays = [{ ...paidDay, candidates: paidDay.candidates.filter((c) => c.utm_content !== "ad1") }];
    const r = build();
    expect(byKey(r, NEW_KEY)?.spend).toEqual({ USD: 100 });
    expect(r.url_changes?.[0]).toMatchObject({ basis: "whole_day_new" });
  });

  it("ties visits with only a campaign name to the campaign that had that name that day", () => {
    const c = catalog();
    c.campaigns = {
      c1: { id: "c1", account_id: "111111", name: "Bootcamp prospecting", status: null, last_seen_at: NOW.toISOString(), names: [{ name: "Bootcamp prospecting", first_seen: DAY, last_seen: DAY }] },
    };
    fixture.metaSetup = c;
    const nameOnly = candidate({ utm_id: null, utm_term: null, utm_content: null, sessions: 20, sessions_with_lead: 0 });
    fixture.paidDays = [{ ...paidDay, candidates: [...paidDay.candidates, nameOnly] }];
    const base = build();
    expect(base.totals.campaign_name_matched_visits).toBe(20);
    expect(base.campaigns.find((g) => g.campaign_id === "c1")?.paid_visits).toBe(70);

    c.campaigns.c9 = { ...c.campaigns.c1!, id: "c9" };
    fixture.metaSetup = c;
    const ambiguous = build();
    expect(ambiguous.totals.campaign_name_matched_visits ?? 0).toBe(0);
    expect(ambiguous.totals.campaign_name_ambiguous_visits).toBe(20);
    expect(ambiguous.campaigns.find((g) => g.campaign_id === "c1")?.paid_visits).toBe(50);
    fixture.paidDays = [paidDay];
  });

  it("counts older spend from untagged ads before history as unconfirmed (totals unchanged)", () => {
    const c = catalog();
    c.ads.ad1!.versions = [{ v: 1, landing_urls: [NEW], url_tags: null, destination: "website", first_seen_at: null, seeded_at: "2026-09-19T00:00:00.000Z", last_seen_at: "2026-09-19T08:00:00.000Z" }];
    fixture.metaSetup = c;
    fixture.creatives = { ...BASE_CREATIVES, ad1: { links: [NEW], instant_form: false } };
    fixture.paidDays = [{ ...paidDay, candidates: paidDay.candidates.filter((x) => x.utm_content !== "ad1") }];
    const r = build();
    expect(byKey(r, NEW_KEY)?.spend).toEqual({ USD: 100 });
    expect(r.totals.unconfirmed_page_spend).toEqual({ USD: 100 });
    expect(byKey(r, NEW_KEY)?.unconfirmed_page_spend).toEqual({ USD: 100 });
    expect(r.totals.spend).toEqual({ USD: 140 });
    expect(r.warnings.map((w) => w.code)).toContain("ad_page_unconfirmed");
  });
});
