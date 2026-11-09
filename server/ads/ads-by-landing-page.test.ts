import fs from "fs";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const nodeFs = require("fs") as typeof import("fs");
  const nodeOs = require("os") as typeof import("os");
  const nodePath = require("path") as typeof import("path");
  return { cacheDir: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "ads-by-landing-page-")) };
});

vi.mock("../db-cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("../db-cache")>()), CACHE_DIR: h.cacheDir }));
vi.mock("../site-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../site-config")>()),
  getSiteConfigs: () => [
    { domain: "4geeks.com", contentFolder: "site_a" },
    { domain: "fl.4geeksacademy.com", contentFolder: "site_fl" },
  ],
}));

import { adsOnUrl, classifyAdStatus, resetAdsByLandingPageCache } from "./ads-by-landing-page";
import type { AdsSetupAd } from "./ads-setup";

const NOW = "2026-11-01T00:00:00.000Z";

function ad(id: string, over: Partial<AdsSetupAd> = {}): AdsSetupAd {
  return {
    id,
    account_id: "act",
    campaign_id: "c1",
    adset_id: "g1",
    name: `Ad ${id}`,
    status: "ACTIVE",
    landing_urls: ["https://4geeks.com/es/blog/foo"],
    url_tags: null,
    destination: "website",
    last_seen_at: NOW,
    versions: [{ v: 1, landing_urls: [], url_tags: null, destination: "website", first_seen_at: null, last_seen_at: NOW, seeded_at: "2026-01-01T00:00:00.000Z" }],
    ...over,
  };
}

function writeJson(rel: string, value: unknown): void {
  const f = path.join(h.cacheDir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(value));
}

function catalog(site: string, platform: "meta" | "google", ads: AdsSetupAd[], campaignStatus = "ACTIVE"): void {
  writeJson(`${site}/ads-setup/${platform}.json`, {
    version: 2,
    platform,
    fetched_at: NOW,
    accounts: { act: { id: "act", name: "A", currency: "USD", timezone: null, last_seen_at: NOW } },
    campaigns: { c1: { id: "c1", account_id: "act", name: "Campaign One", status: campaignStatus, last_seen_at: NOW } },
    adsets: {},
    ads: Object.fromEntries(ads.map((a) => [a.id, a])),
    extras: {},
  });
}

function metaSpend(site: string, date: string, adIds: string[]): void {
  writeJson(`${site}/meta-ads-days/${date}.json`, {
    date,
    rows: adIds.map((id) => ({ date, account_id: "act", ad_id: id, adset_id: "g1", campaign_id: "c1", spend: 10 })),
  });
}

function visits(site: string, date: string, rows: Array<{ host: string; path: string; utm_content?: string; gads_ad_group_id?: string }>): void {
  writeJson(`${site}/paid-landing-days/${date}.json`, {
    date,
    fetched_at: NOW,
    complete: true,
    candidates: rows.map((r) => ({ sessions: 3, utm_content: null, ...r })),
    organic: [],
    cookieless: [],
  });
}

beforeEach(() => {
  fs.rmSync(h.cacheDir, { recursive: true, force: true });
  fs.mkdirSync(h.cacheDir, { recursive: true });
  resetAdsByLandingPageCache();
});

afterAll(() => fs.rmSync(h.cacheDir, { recursive: true, force: true }));

describe("classifyAdStatus", () => {
  it("separates active, paused and ignored ads", () => {
    expect(classifyAdStatus(ad("1"), null)).toBe("active");
    expect(classifyAdStatus(ad("1", { status: "WITH_ISSUES" }), null)).toBe("active");
    expect(classifyAdStatus(ad("1", { status: "CAMPAIGN_PAUSED" }), null)).toBe("paused");
    expect(classifyAdStatus(ad("1", { status: "ENABLED" }), "PAUSED")).toBe("paused");
    expect(classifyAdStatus(ad("1", { status: "ARCHIVED" }), null)).toBe("ignored");
    expect(classifyAdStatus(ad("1", { gone_at: NOW }), null)).toBe("ignored");
    expect(classifyAdStatus(ad("1", { destination: "instant_form" }), null)).toBe("ignored");
  });
});

describe("adsOnUrl", () => {
  it("reports couldn't-check when no ad data exists", () => {
    const r = adsOnUrl("/es/blog/foo", ["4geeks.com"]);
    expect(r.checked).toBe(false);
    expect(r.live).toEqual([]);
  });

  it("is live only when active and spending (or new); otherwise paused", () => {
    catalog("site_a", "meta", [
      ad("spending"),
      ad("idle"),
      ad("new", { versions: [{ v: 1, landing_urls: [], url_tags: null, destination: "website", first_seen_at: "2026-10-30T00:00:00.000Z", last_seen_at: NOW }] }),
      ad("paused", { status: "PAUSED" }),
      ad("gone", { gone_at: NOW }),
    ]);
    metaSpend("site_a", "2026-10-31", ["spending"]);
    const r = adsOnUrl("/es/blog/foo/", ["www.4geeks.com"]);
    expect(r.checked).toBe(true);
    expect(r.live.map((a) => a.ad_id).sort()).toEqual(["new", "spending"]);
    expect(r.paused.map((a) => a.ad_id).sort()).toEqual(["idle", "paused"]);
    expect(r.live[0]!.campaign_name).toBe("Campaign One");
  });

  it("matches by tagged visits (short links, old domains)", () => {
    catalog("site_a", "meta", [ad("short", { landing_urls: ["https://fb.me/abc"] })]);
    metaSpend("site_a", "2026-10-31", ["short"]);
    visits("site_a", "2026-10-31", [{ host: "www.4geeks.com", path: "/es/blog/foo", utm_content: "short" }]);
    const r = adsOnUrl("/es/blog/foo", ["4geeks.com"]);
    expect(r.live).toHaveLength(1);
    expect(r.live[0]).toMatchObject({ ad_id: "short", matched_by: "visits", url: "https://fb.me/abc" });
  });

  it("judges Google spend per ad group, honors campaign pause and unwraps double-encoded URLs", () => {
    catalog("site_a", "google", [ad("g-ad", { status: "ENABLED", landing_urls: ['["https://4geeks.com/es/blog/foo"]'] })]);
    writeJson("site_a/google-ads-days/2026-10-31.json", {
      date: "2026-10-31",
      customers: { act: { fetched_at: NOW, rows: [{ date: "2026-10-31", customer_id: "act", ad_group_id: "g1", spend: 5 }] } },
    });
    expect(adsOnUrl("/es/blog/foo", ["4geeks.com"]).live.map((a) => a.ad_id)).toEqual(["g-ad"]);

    resetAdsByLandingPageCache();
    catalog("site_a", "google", [ad("g-ad", { status: "ENABLED", landing_urls: ['["https://4geeks.com/es/blog/foo"]'] })], "PAUSED");
    const r = adsOnUrl("/es/blog/foo", ["4geeks.com"]);
    expect(r.live).toEqual([]);
    expect(r.paused.map((a) => a.ad_id)).toEqual(["g-ad"]);
  });

  it("matches across sites by host and ignores other hosts", () => {
    catalog("site_a", "meta", [ad("fl-ad", { landing_urls: ["https://fl.4geeksacademy.com/en/landing/x?utm_source=fb"] })]);
    metaSpend("site_a", "2026-10-31", ["fl-ad"]);
    expect(adsOnUrl("/en/landing/x", ["fl.4geeksacademy.com"]).live.map((a) => a.site)).toEqual(["site_a"]);
    expect(adsOnUrl("/en/landing/x", ["4geeks.com"]).live).toEqual([]);
  });

  it("rebuilds after the catalog file changes", () => {
    catalog("site_a", "meta", [ad("one")]);
    metaSpend("site_a", "2026-10-31", ["one", "two"]);
    expect(adsOnUrl("/es/blog/foo", ["4geeks.com"]).live).toHaveLength(1);
    catalog("site_a", "meta", [ad("one"), ad("two")]);
    const f = path.join(h.cacheDir, "site_a/ads-setup/meta.json");
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(f, later, later);
    const realNow = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(realNow + 31_000);
    try {
      expect(adsOnUrl("/es/blog/foo", ["4geeks.com"]).live).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });
});
