/**
 * Which ads send people to a page URL, for checks that run before a URL goes away (slug rename,
 * delete, unpublish, redirect removal).
 *
 * An ad points at a URL when its link is that URL (host without `www.` + normalized path) or when
 * its tagged visitors landed there in the last 14 days of GA4 paid-landing data (Meta: ad id in
 * `utm_content`; Google: ad group from the GA4 link / gclid join). The visit match catches short
 * links, old domains and earlier redirects.
 *
 * Live = active status and (spend in the last 7 days of spend data, or first seen in that window).
 * Google spend is per ad group × landing page, so Google "spent" is judged per ad group.
 * Windows end at the newest day each cache holds, so a stalled sync errs toward "live".
 *
 * Every site's caches are read and matched by host, because one ad account can serve several sites.
 * The table is rebuilt only when a catalog, the newest day file, or the day list changes.
 */

import fs from "fs";
import path from "path";
import { CACHE_DIR } from "../db-cache";
import { child } from "../logger";
import { getSiteConfigs } from "../site-config";
import { normalizeLandingPath } from "@shared/paid-traffic";
import type { AdOnUrl, AdsOnUrlResult, AdsOnUrlSource } from "@shared/url-removal";
import { adVersions, adsSetupRelPath, loadAdsSetup, type AdsSetupAd, type AdsSetupCatalog, type AdsSetupPlatform } from "./ads-setup";
import { parseFinalUrls } from "./final-urls";
import { listGoogleDayDates, loadGoogleRows } from "./google-ads-days";
import { listMetaDayDates, loadMetaRows } from "./meta-ads-days";
import { listPaidLandingDates, loadPaidLandingDays, PAID_LANDING_DAYS_DIR } from "./paid-detection";

const log = child({ module: "ads/ads-by-landing-page" });

export const LIVE_SPEND_WINDOW_DAYS = 7;
export const VISIT_WINDOW_DAYS = 14;
/** How long a signature check is reused before the cache files are stat'ed again. */
const SIGNATURE_TTL_MS = 30_000;

const PLATFORMS: Record<AdsSetupPlatform, true> = { meta: true, google: true };
const ALL_PLATFORMS = Object.keys(PLATFORMS) as AdsSetupPlatform[];

const IGNORED_STATUSES = new Set(["ARCHIVED", "DELETED", "REMOVED"]);
const PAUSED_STATUSES = new Set(["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "DISAPPROVED"]);

type Entry = AdOnUrl & { live: boolean };

type AdsIndex = {
  byKey: Map<string, Map<string, Entry>>;
  sources: AdsOnUrlSource[];
  checked: boolean;
  builtAt: string;
};

let cached: { signature: string; index: AdsIndex; checkedAt: number } | null = null;

export function resetAdsByLandingPageCache(): void {
  cached = null;
}

export function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function urlKey(host: string, pathname: string): string {
  return `${stripWww(host)}|${normalizeLandingPath(pathname)}`;
}

function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Site keys (content folder names) whose ad caches exist. */
function adSites(): string[] {
  const out = new Set<string>();
  try {
    for (const c of getSiteConfigs()) out.add(path.basename(c.contentFolder));
  } catch {
    /* no sites.yml */
  }
  return Array.from(out).filter((s) => fs.existsSync(path.join(CACHE_DIR, s)));
}

function mtimeOf(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function signature(sites: string[]): string {
  const parts: string[] = [];
  for (const site of sites) {
    for (const p of ALL_PLATFORMS) parts.push(`${site}:${p}:${mtimeOf(path.join(CACHE_DIR, site, adsSetupRelPath(p)))}`);
    const meta = listMetaDayDates(site).at(-1) ?? "";
    const google = listGoogleDayDates(site).at(-1) ?? "";
    const visits = listPaidLandingDates(site).at(-1) ?? "";
    const visitMtime = visits ? mtimeOf(path.join(CACHE_DIR, site, PAID_LANDING_DAYS_DIR, `${visits}.json`)) : 0;
    parts.push(`${site}:days:${meta}:${google}:${visits}:${visitMtime}`);
  }
  return parts.join("|");
}

/** Every link of an ad (Google URLs saved double-encoded are unwrapped). */
export function adLinks(ad: AdsSetupAd): string[] {
  return ad.landing_urls.flatMap((u) => parseFinalUrls(u));
}

export type AdStatusClass = "active" | "paused" | "ignored";

/** Status of an ad on its own (Google also needs its campaign's status). */
export function classifyAdStatus(ad: AdsSetupAd, campaignStatus: string | null | undefined): AdStatusClass {
  if (ad.gone_at || ad.destination === "instant_form") return "ignored";
  const s = (ad.status ?? "").toUpperCase();
  if (IGNORED_STATUSES.has(s)) return "ignored";
  if (PAUSED_STATUSES.has(s)) return "paused";
  const c = (campaignStatus ?? "").toUpperCase();
  if (c === "PAUSED" || c === "REMOVED") return "paused";
  return "active";
}

function firstSeen(ad: AdsSetupAd): string | null {
  const v = adVersions(ad)[0];
  const at = v?.first_seen_at ?? v?.seeded_at ?? null;
  return at ? at.slice(0, 10) : null;
}

type SpendWindow = { ids: Set<string>; since: string | null; until: string | null };

function spendWindow(site: string, platform: AdsSetupPlatform): SpendWindow {
  if (platform === "meta") {
    const until = listMetaDayDates(site).at(-1) ?? null;
    if (!until) return { ids: new Set(), since: null, until: null };
    const since = shiftDay(until, -(LIVE_SPEND_WINDOW_DAYS - 1));
    const ids = new Set(loadMetaRows(site, since, until).filter((r) => r.spend > 0).map((r) => r.ad_id));
    return { ids, since, until };
  }
  const until = listGoogleDayDates(site).at(-1) ?? null;
  if (!until) return { ids: new Set(), since: null, until: null };
  const since = shiftDay(until, -(LIVE_SPEND_WINDOW_DAYS - 1));
  const ids = new Set(loadGoogleRows(site, since, until).filter((r) => r.spend > 0).map((r) => r.ad_group_id));
  return { ids, since, until };
}

function addEntry(byKey: AdsIndex["byKey"], key: string, entry: Entry): void {
  let ads = byKey.get(key);
  if (!ads) byKey.set(key, (ads = new Map()));
  const id = `${entry.site}:${entry.platform}:${entry.ad_id}`;
  const prev = ads.get(id);
  if (!prev) ads.set(id, entry);
  else if (prev.matched_by === "visits" && entry.matched_by === "link") ads.set(id, { ...entry });
}

function buildForCatalog(
  byKey: AdsIndex["byKey"],
  site: string,
  catalog: AdsSetupCatalog,
  visitsByAd: Map<string, Set<string>>,
  visitsByAdGroup: Map<string, Set<string>>,
): AdsOnUrlSource {
  const platform = catalog.platform;
  const spend = spendWindow(site, platform);
  for (const ad of Object.values(catalog.ads)) {
    const campaign = catalog.campaigns[ad.campaign_id];
    const status = classifyAdStatus(ad, platform === "google" ? campaign?.status : null);
    if (status === "ignored") continue;
    const spent = platform === "meta" ? spend.ids.has(ad.id) : spend.ids.has(ad.adset_id);
    const seen = firstSeen(ad);
    const isNew = !!seen && !!spend.since && seen >= spend.since;
    const live = status === "active" && (spent || isNew || !spend.until);
    const links = adLinks(ad);
    const base: Omit<Entry, "matched_by" | "url"> = {
      platform,
      site,
      ad_id: ad.id,
      ad_name: ad.name || null,
      campaign_id: ad.campaign_id || null,
      campaign_name: campaign?.name ?? null,
      status: ad.status,
      live,
    };
    for (const link of links) {
      try {
        const u = new URL(link);
        addEntry(byKey, urlKey(u.hostname, u.pathname), { ...base, url: link, matched_by: "link" });
      } catch {
        /* not a URL */
      }
    }
    const visited = platform === "meta" ? visitsByAd.get(ad.id) : visitsByAdGroup.get(ad.adset_id);
    for (const key of Array.from(visited ?? [])) addEntry(byKey, key, { ...base, url: links[0] ?? null, matched_by: "visits" });
  }
  const accounts = Object.keys(catalog.accounts).length;
  return {
    site,
    platform,
    fetched_at: catalog.fetched_at || null,
    connected: accounts > 0,
    spend_until: spend.until,
  };
}

function buildIndex(sites: string[]): AdsIndex {
  const started = Date.now();
  const byKey: AdsIndex["byKey"] = new Map();
  const sources: AdsOnUrlSource[] = [];
  for (const site of sites) {
    const visitsByAd = new Map<string, Set<string>>();
    const visitsByAdGroup = new Map<string, Set<string>>();
    const lastVisitDay = listPaidLandingDates(site).at(-1);
    if (lastVisitDay) {
      for (const day of loadPaidLandingDays(site, shiftDay(lastVisitDay, -(VISIT_WINDOW_DAYS - 1)), lastVisitDay)) {
        for (const c of day.candidates) {
          if (c.sessions <= 0) continue;
          const key = urlKey(c.host, c.path);
          if (c.utm_content) {
            let s = visitsByAd.get(c.utm_content);
            if (!s) visitsByAd.set(c.utm_content, (s = new Set()));
            s.add(key);
          }
          if (c.gads_ad_group_id) {
            let s = visitsByAdGroup.get(c.gads_ad_group_id);
            if (!s) visitsByAdGroup.set(c.gads_ad_group_id, (s = new Set()));
            s.add(key);
          }
        }
      }
    }
    for (const platform of ALL_PLATFORMS) {
      if (!fs.existsSync(path.join(CACHE_DIR, site, adsSetupRelPath(platform)))) continue;
      sources.push(buildForCatalog(byKey, site, loadAdsSetup(site, platform), visitsByAd, visitsByAdGroup));
    }
  }
  const checked = sources.some((s) => s.connected && !!s.fetched_at);
  log.info({ ms: Date.now() - started, urls: byKey.size, sources: sources.length }, "[ads-by-landing-page] built");
  return { byKey, sources, checked, builtAt: new Date().toISOString() };
}

function getIndex(): AdsIndex {
  const now = Date.now();
  if (cached && now - cached.checkedAt < SIGNATURE_TTL_MS) return cached.index;
  const sites = adSites();
  const sig = signature(sites);
  if (cached && cached.signature === sig) {
    cached.checkedAt = now;
    return cached.index;
  }
  cached = { signature: sig, index: buildIndex(sites), checkedAt: now };
  return cached.index;
}

/**
 * Ads pointing at a URL on any of `hosts` (www. ignored). `pathOrUrl` may be a path (`/es/blog/x`)
 * or an absolute URL; an absolute URL's own host is used instead of `hosts`.
 */
export function adsOnUrl(pathOrUrl: string, hosts: string[]): AdsOnUrlResult {
  const index = getIndex();
  let lookupHosts = hosts;
  let pathname = pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) {
    try {
      const u = new URL(pathOrUrl);
      lookupHosts = [u.hostname];
      pathname = u.pathname;
    } catch {
      /* treat as path */
    }
  }
  const seen = new Set<string>();
  const live: AdOnUrl[] = [];
  const paused: AdOnUrl[] = [];
  for (const host of Array.from(new Set(lookupHosts.map(stripWww)))) {
    const ads = index.byKey.get(urlKey(host, pathname));
    if (!ads) continue;
    for (const [id, e] of Array.from(ads.entries())) {
      if (seen.has(id)) continue;
      seen.add(id);
      const { live: isLive, ...ad } = e;
      (isLive ? live : paused).push(ad);
    }
  }
  return { live, paused, checked: index.checked, sources: index.sources };
}
