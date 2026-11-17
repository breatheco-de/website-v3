import { describe, expect, it } from "vitest";
import { emptyAdsSetup, type AdsSetupCatalog } from "./ads/ads-setup";
import {
  ADS_ACCOUNT_MULTI_LIVE_CODE,
  catalogToDeliverableRefs,
  runAdsAccountLocationGate,
} from "./ads-account-location-gate";

function catalogWithAds(
  platform: "meta" | "google",
  ads: Array<{ id: string; account_id: string; status: string; url: string }>,
): AdsSetupCatalog {
  const cat = emptyAdsSetup(platform);
  const now = "2026-11-17T00:00:00.000Z";
  for (const a of ads) {
    cat.accounts[a.account_id] = {
      id: a.account_id,
      name: a.account_id === "es" ? "España" : a.account_id === "latam" ? "LATAM" : a.account_id,
      currency: "USD",
      timezone: null,
      last_seen_at: now,
    };
    cat.ads[a.id] = {
      id: a.id,
      account_id: a.account_id,
      campaign_id: "c1",
      adset_id: "s1",
      name: a.id,
      status: a.status,
      landing_urls: [a.url],
      url_tags: null,
      destination: "website",
      last_seen_at: now,
    };
  }
  return cat;
}

describe("runAdsAccountLocationGate", () => {
  it("no-ops when no account is restricted", () => {
    const result = runAdsAccountLocationGate({
      landingPath: "/landing/ai",
      contentType: "landing",
      restricted: false,
      catalogs: {
        meta: catalogWithAds("meta", [
          { id: "1", account_id: "es", status: "ACTIVE", url: "https://x.com/landing/ai" },
          { id: "2", account_id: "latam", status: "ACTIVE", url: "https://x.com/landing/ai" },
        ]),
      },
    });
    expect(result.errors).toEqual([]);
  });

  it("blocks when two accounts have deliverable ads on the landing", () => {
    const result = runAdsAccountLocationGate({
      landingPath: "/landing/ai",
      contentType: "landing",
      restricted: true,
      catalogs: {
        meta: catalogWithAds("meta", [
          { id: "1", account_id: "es", status: "ACTIVE", url: "https://x.com/landing/ai" },
          { id: "2", account_id: "latam", status: "ACTIVE", url: "https://x.com/landing/ai" },
        ]),
      },
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe(ADS_ACCOUNT_MULTI_LIVE_CODE);
    expect(result.errors[0]!.account_names).toEqual(["España", "LATAM"]);
    expect(result.errors[0]!.message).toMatch(/Live ads from more than one ad account/);
  });

  it("does not block when one account's ads are paused", () => {
    const result = runAdsAccountLocationGate({
      landingPath: "/landing/ai",
      contentType: "landing",
      restricted: true,
      catalogs: {
        meta: catalogWithAds("meta", [
          { id: "1", account_id: "es", status: "ACTIVE", url: "https://x.com/landing/ai" },
          { id: "2", account_id: "latam", status: "PAUSED", url: "https://x.com/landing/ai" },
        ]),
      },
    });
    expect(result.errors).toEqual([]);
  });
});

describe("catalogToDeliverableRefs", () => {
  it("flattens landing urls and campaign status", () => {
    const cat = catalogWithAds("meta", [
      { id: "1", account_id: "es", status: "ACTIVE", url: "https://x.com/landing/ai" },
    ]);
    cat.campaigns.c1 = {
      id: "c1",
      account_id: "es",
      name: "Camp",
      status: "ACTIVE",
      last_seen_at: "2026-11-17T00:00:00.000Z",
    };
    const refs = catalogToDeliverableRefs(cat);
    expect(refs[0]).toMatchObject({ account_id: "es", status: "ACTIVE", campaign_status: "ACTIVE" });
  });
});
