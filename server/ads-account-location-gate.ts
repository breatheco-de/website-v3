/**
 * Publish/promote gate: block when live deliverable ads from two or more ad accounts
 * point at the same landing URL (edge 2c). Draft saves get warnings only.
 * Feature is off until at least one account has a restricted location map.
 */

import path from "path";
import {
  anyAccountRestricted,
  deliverableAccountsForLanding,
  type AccountLocationsMap,
  type DeliverableAdRef,
} from "@shared/adsAccountLocations";
import { getAdsSettings } from "./settings";
import { loadAdsSetup, type AdsSetupCatalog, type AdsSetupPlatform } from "./ads/ads-setup";
import { getContentTypeConfig } from "./content-types";
import { pageLocationValues } from "@shared/formLocationPolicy";

export const ADS_ACCOUNT_MULTI_LIVE_CODE = "ads_account_multi_live_on_landing";

export interface AdsAccountLocationIssue {
  code: string;
  message: string;
  property_path: string;
  fix_field_path: string;
  account_ids: string[];
  account_names: string[];
}

export interface AdsAccountLocationGateResult {
  errors: AdsAccountLocationIssue[];
  warnings: AdsAccountLocationIssue[];
}

function siteKeyFromContentRoot(contentRoot?: string): string | null {
  if (!contentRoot) return null;
  return path.basename(contentRoot);
}

function accountName(catalog: AdsSetupCatalog, id: string): string {
  return catalog.accounts[id]?.name?.trim() || id;
}

/** Flatten catalog ads into DeliverableAdRef with campaign status for Google. */
export function catalogToDeliverableRefs(catalog: AdsSetupCatalog): DeliverableAdRef[] {
  return Object.values(catalog.ads).map((ad) => ({
    account_id: ad.account_id,
    status: ad.status,
    campaign_status: catalog.campaigns[ad.campaign_id]?.status ?? null,
    landing_urls: ad.landing_urls,
    gone_at: ad.gone_at ?? null,
    destination: ad.destination,
  }));
}

export function mergedAccountLocations(contentRoot?: string): {
  meta: AccountLocationsMap;
  google: AccountLocationsMap;
  restricted: boolean;
} {
  const settings = getAdsSettings(contentRoot);
  const meta = settings.meta.account_locations;
  const google = settings.google.account_locations;
  return { meta, google, restricted: anyAccountRestricted(meta) || anyAccountRestricted(google) };
}

export function runAdsAccountLocationGate(opts: {
  /** Public path for this entry, e.g. `/landing/ai-engineering`. */
  landingPath: string;
  contentType: string;
  contentRoot?: string;
  /** Injected in tests. */
  catalogs?: { meta?: AdsSetupCatalog; google?: AdsSetupCatalog };
  restricted?: boolean;
  accountNames?: Record<string, string>;
}): AdsAccountLocationGateResult {
  const errors: AdsAccountLocationIssue[] = [];
  const warnings: AdsAccountLocationIssue[] = [];

  const maps = opts.restricted !== undefined
    ? { restricted: opts.restricted, meta: {}, google: {} }
    : mergedAccountLocations(opts.contentRoot);
  if (!maps.restricted) return { errors, warnings };

  const site = siteKeyFromContentRoot(opts.contentRoot);
  const metaCat = opts.catalogs?.meta ?? (site ? loadAdsSetup(site, "meta") : null);
  const googleCat = opts.catalogs?.google ?? (site ? loadAdsSetup(site, "google") : null);

  const refs: DeliverableAdRef[] = [];
  const names: Record<string, string> = { ...(opts.accountNames ?? {}) };
  if (metaCat) {
    refs.push(...catalogToDeliverableRefs(metaCat));
    for (const [id, a] of Object.entries(metaCat.accounts)) names[id] = a.name || id;
  }
  if (googleCat) {
    refs.push(...catalogToDeliverableRefs(googleCat));
    for (const [id, a] of Object.entries(googleCat.accounts)) names[id] = a.name || id;
  }

  const accountIds = deliverableAccountsForLanding(refs, opts.landingPath);
  if (accountIds.length < 2) return { errors, warnings };

  const account_names = accountIds.map((id) => names[id] || id);
  const label = account_names.join(" and ");
  const message =
    `Live ads from more than one ad account (${label}) point at this page. ` +
    `Narrow the page's Locations, change which locations each account covers in Settings → Ads, ` +
    `or pause ads from one of those accounts. Mixed-account landings cannot be published until this is fixed.`;

  errors.push({
    code: ADS_ACCOUNT_MULTI_LIVE_CODE,
    message,
    property_path: "locations",
    fix_field_path: "locations",
    account_ids: accountIds,
    account_names,
  });

  return { errors, warnings };
}

export function adsAccountLocationBlockMessage(issues: AdsAccountLocationIssue[]): string {
  return issues.map((i) => i.message).join(" ");
}

/** Resolve landing public path for gate (url_pattern default `/landing/:slug`). */
export function landingPathForEntry(contentType: string, slug: string, contentRoot?: string): string | null {
  const cfg = getContentTypeConfig(contentType, contentRoot) as { url_pattern?: Record<string, string> | string; directory?: string } | null;
  if (!cfg) return null;
  const pattern =
    typeof cfg.url_pattern === "string"
      ? cfg.url_pattern
      : cfg.url_pattern?.default || cfg.url_pattern?.en || Object.values(cfg.url_pattern || {})[0];
  if (typeof pattern === "string" && pattern.includes(":slug")) {
    return pattern.replace(":slug", slug).replace(/\/+/g, "/");
  }
  if (cfg.directory === "landings" || contentType === "landing") return `/landing/${slug}`;
  return null;
}

/** Page locations from entry data (relation field `locations` when present). */
export function entryLocationSlugs(pageData: Record<string, unknown>): string[] {
  return pageLocationValues(pageData, "locations");
}

export type { AdsSetupPlatform };
