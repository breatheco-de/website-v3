/**
 * Ad account → content location maps (ads-config.yml → meta|google.account_locations).
 * Missing/empty list for an account = unrestricted (all locations allowed).
 * Pure helpers shared by settings parse, publish gate, diagnostics, and save preview.
 */

/** Account id → location slugs. Empty array or missing id = unrestricted. */
export type AccountLocationsMap = Record<string, string[]>;

const PAUSED_STATUSES = new Set(["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "DISAPPROVED"]);
const IGNORED_STATUSES = new Set(["ARCHIVED", "DELETED", "REMOVED"]);

/** Normalize a raw account_locations object; only keep ids in `allowedIds`. */
export function parseAccountLocationsMap(raw: unknown, allowedIds: readonly string[]): AccountLocationsMap {
  const allowed = new Set(allowedIds);
  const out: AccountLocationsMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(id)) continue;
    if (!Array.isArray(list)) continue;
    const slugs = Array.from(
      new Set(
        list
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.length <= 120),
      ),
    );
    if (slugs.length > 0) out[id] = slugs;
  }
  return out;
}

/** Drop unknown location slugs; remove accounts that end up empty (→ unrestricted). */
export function filterAccountLocationsToKnown(
  map: AccountLocationsMap,
  known: ReadonlySet<string>,
): AccountLocationsMap {
  const out: AccountLocationsMap = {};
  for (const [id, slugs] of Object.entries(map)) {
    const kept = slugs.filter((s) => known.has(s));
    if (kept.length > 0) out[id] = kept;
  }
  return out;
}

/**
 * Locations this account may serve.
 * `null` = unrestricted (no map / empty list).
 */
export function accountLocationSet(map: AccountLocationsMap | null | undefined, accountId: string): Set<string> | null {
  if (!map) return null;
  const list = map[accountId];
  if (!list || list.length === 0) return null;
  return new Set(list);
}

export function anyAccountRestricted(map: AccountLocationsMap | null | undefined): boolean {
  if (!map) return false;
  return Object.values(map).some((list) => list.length > 0);
}

/** True when the page has no locations, or at least one page location is in the account set. */
export function landingLocationsCompatibleWithAccount(
  pageLocations: readonly string[],
  accountSet: Set<string> | null,
): boolean {
  if (accountSet === null) return true;
  if (pageLocations.length === 0) return true; // empty → diagnostics warning, not incompatibility
  return pageLocations.some((s) => accountSet.has(s));
}

/** True when page locations are set and none intersect the restricted account set. */
export function landingLocationsMismatchAccount(
  pageLocations: readonly string[],
  accountSet: Set<string> | null,
): boolean {
  if (accountSet === null) return false;
  if (pageLocations.length === 0) return false;
  return !pageLocations.some((s) => accountSet.has(s));
}

export type DeliverableAdRef = {
  account_id: string;
  status: string | null;
  campaign_status?: string | null;
  landing_urls: string[];
  gone_at?: string | null;
  destination?: string | null;
};

/** Same rules as ads-by-landing-page classifyAdStatus for "active" (deliverable). */
export function isDeliverableAd(ad: DeliverableAdRef): boolean {
  if (ad.gone_at) return false;
  if (ad.destination === "instant_form") return false;
  const s = (ad.status ?? "").toUpperCase();
  if (IGNORED_STATUSES.has(s)) return false;
  if (PAUSED_STATUSES.has(s)) return false;
  const c = (ad.campaign_status ?? "").toUpperCase();
  if (c === "PAUSED" || c === "REMOVED") return false;
  return true;
}

export function normalizeLandingPathForMatch(pathname: string): string {
  let p = pathname.trim() || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p.toLowerCase();
}

/** Extract `/landing/<slug>` path from a full URL or path. */
export function landingSlugFromUrl(url: string): string | null {
  try {
    const path = url.includes("://") ? new URL(url).pathname : url;
    const m = normalizeLandingPathForMatch(path).match(/\/landing\/([a-z0-9-]+)\/?$/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Account ids with at least one deliverable ad whose landing_urls match `landingPath`
 * (path only, e.g. `/landing/ai-engineering`).
 */
export function deliverableAccountsForLanding(
  ads: readonly DeliverableAdRef[],
  landingPath: string,
): string[] {
  const want = normalizeLandingPathForMatch(landingPath);
  const accounts = new Set<string>();
  for (const ad of ads) {
    if (!isDeliverableAd(ad)) continue;
    for (const u of ad.landing_urls) {
      try {
        const path = u.includes("://") ? new URL(u).pathname : u;
        if (normalizeLandingPathForMatch(path) === want) {
          accounts.add(ad.account_id);
          break;
        }
      } catch {
        /* skip bad url */
      }
    }
  }
  return Array.from(accounts);
}
