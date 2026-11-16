import { describe, expect, it } from "vitest";
import {
  buildCampaignDetail,
  GOOGLE_ADS_CATALOG_CAP,
  resolveCampaignInCatalog,
} from "./campaign-detail";
import type { AdsSetupCatalog } from "./ads-setup";
import { emptyAdsSetup } from "./ads-setup";

function metaCatalog(overrides?: Partial<AdsSetupCatalog>): AdsSetupCatalog {
  const base = emptyAdsSetup("meta");
  base.fetched_at = "2026-10-08T16:34:18.065Z";
  base.campaigns["120223213229370144"] = {
    id: "120223213229370144",
    account_id: "1",
    name: "4GEEKS-EEUU-ORLANDO-TAMPA",
    status: "PAUSED",
    last_seen_at: base.fetched_at,
    extras: { effective_status: "PAUSED", objective: "OUTCOME_LEADS" },
    names: [{ name: "4GEEKS-EEUU-ORLANDO-TAMPA", first_seen: "2026-01-01", last_seen: "2026-10-08" }],
  };
  base.ads["a1"] = {
    id: "a1",
    account_id: "1",
    campaign_id: "120223213229370144",
    adset_id: "s1",
    name: "ad1",
    status: "PAUSED",
    landing_urls: ["https://4geeksacademy.com/us/landing/orlando-scholarship"],
    url_tags: null,
    destination: "website",
    last_seen_at: base.fetched_at,
  };
  base.ads["a2"] = {
    id: "a2",
    account_id: "1",
    campaign_id: "120223213229370144",
    adset_id: "s1",
    name: "ad2",
    status: "ACTIVE",
    landing_urls: ["https://4geeksacademy.com/us/landing/tech-career-4geeks"],
    url_tags: null,
    destination: "website",
    last_seen_at: base.fetched_at,
  };
  return { ...base, ...overrides };
}

describe("resolveCampaignInCatalog", () => {
  it("resolves by id", () => {
    const catalog = metaCatalog();
    const r = resolveCampaignInCatalog(catalog, { id: "120223213229370144" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.campaign.name).toBe("4GEEKS-EEUU-ORLANDO-TAMPA");
  });

  it("resolves by name and returns ambiguous when several match", () => {
    const catalog = metaCatalog();
    catalog.campaigns["999"] = {
      id: "999",
      account_id: "1",
      name: "4GEEKS-EEUU-ORLANDO-TAMPA",
      status: "ACTIVE",
      last_seen_at: catalog.fetched_at,
    };
    const r = resolveCampaignInCatalog(catalog, { name: "4GEEKS-EEUU-ORLANDO-TAMPA" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ambiguous");
  });

  it("returns not_found for unknown id", () => {
    const r = resolveCampaignInCatalog(metaCatalog(), { id: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_found");
  });
});

describe("buildCampaignDetail", () => {
  it("marks path_in_campaign and groups landing urls", () => {
    const catalog = metaCatalog();
    const campaign = catalog.campaigns["120223213229370144"]!;
    const detail = buildCampaignDetail(catalog, campaign, "/us/landing/orlando-scholarship");
    expect(detail.path_in_campaign).toBe(true);
    expect(detail.landing_urls.some((u) => u.matches_issue_path)).toBe(true);
    expect(detail.fetched_at).toBe(catalog.fetched_at);
    expect(detail.ads_total).toBe(2);
  });

  it("sets mismatch when path is absent", () => {
    const catalog = metaCatalog();
    const campaign = catalog.campaigns["120223213229370144"]!;
    const detail = buildCampaignDetail(catalog, campaign, "/us/landing/missing");
    expect(detail.path_in_campaign).toBe(false);
  });

  it("warns when Google catalog is at the ad cap with zero campaign ads", () => {
    const catalog = emptyAdsSetup("google");
    catalog.fetched_at = "2026-10-02T04:13:53.737Z";
    catalog.campaigns["19562356553"] = {
      id: "19562356553",
      account_id: "1",
      name: "ES-Search-Branded",
      status: "ENABLED",
      last_seen_at: catalog.fetched_at,
    };
    for (let i = 0; i < GOOGLE_ADS_CATALOG_CAP; i++) {
      catalog.ads[`g${i}`] = {
        id: `g${i}`,
        account_id: "1",
        campaign_id: "other",
        adset_id: "ag",
        name: "",
        status: "ENABLED",
        landing_urls: ["https://4geeks.com/x"],
        url_tags: null,
        destination: "website",
        last_seen_at: catalog.fetched_at,
      };
    }
    const detail = buildCampaignDetail(catalog, catalog.campaigns["19562356553"]!, "/landing/x");
    expect(detail.ads_total).toBe(0);
    expect(detail.warnings.some((w) => w.code === "google_ads_catalog_may_be_truncated")).toBe(true);
  });
});
