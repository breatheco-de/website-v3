/**
 * Staff campaign detail for Runtime issues: resolve a Meta/Google campaign from
 * the ads-setup catalog and summarize landing URLs + path match.
 */

import { normalizeLandingPath } from "@shared/paid-traffic";
import {
  loadAdsSetup,
  type AdsSetupAd,
  type AdsSetupCampaign,
  type AdsSetupCatalog,
  type AdsSetupPlatform,
} from "./ads-setup";
import { adLinks, classifyAdStatus } from "./ads-by-landing-page";
import { parseFinalUrls } from "./final-urls";

/** Matches the BigQuery Ad entity LIMIT in google-ads-bq.ts (not raised in this change). */
export const GOOGLE_ADS_CATALOG_CAP = 5000;

export type CampaignLandingUrlRow = {
  url: string;
  path: string;
  active: number;
  paused: number;
  ignored: number;
  matches_issue_path: boolean;
};

export type CampaignDetailWarning = { code: string; message: string };

export type CampaignDetailCandidate = {
  id: string;
  name: string;
  status: string | null;
  account_id: string;
  platform: AdsSetupPlatform;
};

export type CampaignDetail = {
  platform: AdsSetupPlatform;
  fetched_at: string;
  campaign: {
    id: string;
    name: string;
    status: string | null;
    account_id: string;
    effective_status: string | null;
    objective: string | null;
  };
  ads_total: number;
  ads_active: number;
  ads_paused: number;
  ads_ignored: number;
  landing_urls: CampaignLandingUrlRow[];
  path_in_campaign: boolean | null;
  issue_path: string | null;
  url_history: Array<{ ad_id: string; url: string; first_seen_at: string | null; last_seen_at: string }>;
  warnings: CampaignDetailWarning[];
};

export type ResolveCampaignResult =
  | { ok: true; campaign: AdsSetupCampaign; catalog: AdsSetupCatalog }
  | { ok: false; code: "not_found"; message: string }
  | { ok: false; code: "ambiguous"; message: string; candidates: CampaignDetailCandidate[] };

function pathFromUrl(url: string): string {
  try {
    if (/^https?:\/\//i.test(url)) return normalizeLandingPath(new URL(url).pathname);
  } catch {
    /* fall through */
  }
  return normalizeLandingPath(url);
}

function pathsMatch(issuePath: string | null | undefined, landingUrl: string): boolean {
  if (!issuePath) return false;
  return pathFromUrl(landingUrl) === normalizeLandingPath(issuePath);
}

function campaignNameMatches(c: AdsSetupCampaign, name: string): boolean {
  const needle = name.trim().toLowerCase();
  if (!needle) return false;
  if (c.name.trim().toLowerCase() === needle) return true;
  return (c.names ?? []).some((n) => n.name.trim().toLowerCase() === needle);
}

export function resolveCampaignInCatalog(
  catalog: AdsSetupCatalog,
  opts: { id?: string; name?: string },
): ResolveCampaignResult {
  const id = opts.id?.trim();
  if (id) {
    const campaign = catalog.campaigns[id];
    if (!campaign) {
      return { ok: false, code: "not_found", message: `No ${catalog.platform} campaign with id ${id} in the last ads sync.` };
    }
    return { ok: true, campaign, catalog };
  }
  const name = opts.name?.trim();
  if (!name) {
    return { ok: false, code: "not_found", message: "Pass id or name." };
  }
  const matches = Object.values(catalog.campaigns).filter((c) => campaignNameMatches(c, name));
  if (matches.length === 0) {
    return { ok: false, code: "not_found", message: `No ${catalog.platform} campaign named “${name}” in the last ads sync.` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      code: "ambiguous",
      message: `Several ${catalog.platform} campaigns match “${name}”. Pick one.`,
      candidates: matches.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        account_id: c.account_id,
        platform: catalog.platform,
      })),
    };
  }
  return { ok: true, campaign: matches[0]!, catalog };
}

function adsForCampaign(catalog: AdsSetupCatalog, campaignId: string): AdsSetupAd[] {
  return Object.values(catalog.ads).filter((a) => a.campaign_id === campaignId);
}

export function buildCampaignDetail(
  catalog: AdsSetupCatalog,
  campaign: AdsSetupCampaign,
  issuePath?: string | null,
): CampaignDetail {
  const ads = adsForCampaign(catalog, campaign.id);
  const byUrl = new Map<string, CampaignLandingUrlRow>();
  let ads_active = 0;
  let ads_paused = 0;
  let ads_ignored = 0;
  const issueNorm = issuePath ? normalizeLandingPath(issuePath) : null;
  let path_in_campaign: boolean | null = issueNorm ? false : null;

  for (const ad of ads) {
    const klass = classifyAdStatus(ad, campaign.status);
    if (klass === "active") ads_active += 1;
    else if (klass === "paused") ads_paused += 1;
    else ads_ignored += 1;

    for (const url of adLinks(ad)) {
      const path = pathFromUrl(url);
      const key = url.split(/[?#]/)[0] || url;
      let row = byUrl.get(key);
      if (!row) {
        row = { url: key, path, active: 0, paused: 0, ignored: 0, matches_issue_path: false };
        byUrl.set(key, row);
      }
      if (klass === "active") row.active += 1;
      else if (klass === "paused") row.paused += 1;
      else row.ignored += 1;
      if (issueNorm && path === issueNorm) {
        row.matches_issue_path = true;
        path_in_campaign = true;
      }
    }
  }

  const landing_urls = [...byUrl.values()].sort((a, b) => {
    if (a.matches_issue_path !== b.matches_issue_path) return a.matches_issue_path ? -1 : 1;
    return b.active + b.paused - (a.active + a.paused);
  });

  const url_history: CampaignDetail["url_history"] = [];
  for (const ad of ads) {
    for (const v of ad.versions ?? []) {
      for (const raw of v.landing_urls) {
        for (const url of parseFinalUrls(raw)) {
          url_history.push({
            ad_id: ad.id,
            url: url.split(/[?#]/)[0] || url,
            first_seen_at: v.first_seen_at,
            last_seen_at: v.last_seen_at,
          });
        }
      }
    }
  }
  url_history.sort((a, b) => (b.last_seen_at || "").localeCompare(a.last_seen_at || ""));

  const warnings: CampaignDetailWarning[] = [];
  if (catalog.platform === "google") {
    const catalogAdCount = Object.keys(catalog.ads).length;
    if (ads.length === 0 && catalogAdCount >= GOOGLE_ADS_CATALOG_CAP) {
      warnings.push({
        code: "google_ads_catalog_may_be_truncated",
        message:
          "Google’s saved ad list may be incomplete (catalog cap). Landing URLs for this campaign may be missing even when the campaign exists.",
      });
    }
  }

  return {
    platform: catalog.platform,
    fetched_at: catalog.fetched_at || "",
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      account_id: campaign.account_id,
      effective_status: campaign.extras?.effective_status ?? null,
      objective: campaign.extras?.objective ?? null,
    },
    ads_total: ads.length,
    ads_active,
    ads_paused,
    ads_ignored,
    landing_urls,
    path_in_campaign,
    issue_path: issueNorm,
    url_history: url_history.slice(0, 40),
    warnings,
  };
}

export function getCampaignDetail(
  site: string,
  platform: AdsSetupPlatform,
  opts: { id?: string; name?: string; issue_path?: string | null },
): ResolveCampaignResult & { detail?: CampaignDetail } {
  const catalog = loadAdsSetup(site, platform);
  const resolved = resolveCampaignInCatalog(catalog, opts);
  if (!resolved.ok) return resolved;
  return {
    ...resolved,
    detail: buildCampaignDetail(resolved.catalog, resolved.campaign, opts.issue_path),
  };
}
