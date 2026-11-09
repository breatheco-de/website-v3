/**
 * Shared shapes for the "this URL is going away" check (slug rename, delete, unpublish,
 * redirect removal): which ads send people to the URL, plus page-level gates.
 */

export type AdOnUrl = {
  platform: string;
  /** Site whose ad caches hold this ad (content folder name). */
  site: string;
  ad_id: string;
  ad_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  status: string | null;
  /** The ad's own link (may differ from the page when matched by visits). */
  url: string | null;
  /** `link` = the ad links to this URL; `visits` = its tagged visitors landed here in the last 14 days. */
  matched_by: "link" | "visits";
};

export type AdsOnUrlSource = {
  site: string;
  platform: string;
  /** Last full ad setup read; null = never read. */
  fetched_at: string | null;
  connected: boolean;
  /** Newest day of spend data used to decide "live". */
  spend_until: string | null;
};

export type AdsOnUrlResult = {
  live: AdOnUrl[];
  paused: AdOnUrl[];
  /** False when no ad data was ever read for any site (the check could not run). */
  checked: boolean;
  sources: AdsOnUrlSource[];
};

export type UrlRemovalAction = "rename" | "delete" | "unpublish";

export type UrlRemovalLocale = {
  locale: string;
  /** Public path of this locale before the change; null when it could not be built. */
  url: string | null;
  ads: AdsOnUrlResult;
  age_hours: number | null;
  /** Agents must redirect (rename) or name a destination / reason (delete) for pages live 24h or more. */
  redirect_required_for_agents: boolean;
};

export type UrlRemovalCheck = {
  action: UrlRemovalAction;
  contentType: string;
  slug: string;
  locales: UrlRemovalLocale[];
  ab_lock: { code: string; error: string } | null;
  live_ads: number;
  paused_ads: number;
  /** False when ad data was never read: show "couldn't check ads". */
  ads_checked: boolean;
};

export const AGENT_REDIRECT_AGE_HOURS = 24;

export function emptyAdsOnUrl(): AdsOnUrlResult {
  return { live: [], paused: [], checked: false, sources: [] };
}

/** Newest setup read across sources, for "data last read on …". */
export function adsDataReadAt(sources: AdsOnUrlSource[]): string | null {
  let best: string | null = null;
  for (const s of sources) if (s.fetched_at && (!best || s.fetched_at > best)) best = s.fetched_at;
  return best;
}

export function platformLabel(platform: string): string {
  if (platform === "meta") return "Meta";
  if (platform === "google") return "Google";
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

/** "Meta 3, Google 1" */
export function adsByPlatformLabel(ads: AdOnUrl[]): string {
  const counts = new Map<string, number>();
  for (const a of ads) counts.set(a.platform, (counts.get(a.platform) ?? 0) + 1);
  return Array.from(counts.entries()).map(([p, n]) => `${platformLabel(p)} ${n}`).join(", ");
}

/** Dense per-ad facts for MCP payloads / error details. */
export function adFacts(ads: AdOnUrl[], max = 20): Array<Record<string, string | null>> {
  return ads.slice(0, max).map((a) => ({
    platform: a.platform,
    site: a.site,
    campaign_name: a.campaign_name,
    ad_name: a.ad_name,
    ad_id: a.ad_id,
    status: a.status,
    matched_by: a.matched_by,
    url: a.url,
  }));
}
