/**
 * Campus catalog helpers. Data comes from GET /api/session/location-catalog
 * (settings.yml → session.location.database). No hardcoded campuses.
 */

import type { Location } from "@shared/session";

export type RegionSlug = "usa-canada" | "europe" | "latam";

const REGION_LABELS: Record<RegionSlug, { en: string; es: string }> = {
  "usa-canada": { en: "US & Canada", es: "EE.UU. y Canadá" },
  europe: { en: "Europe", es: "Europa" },
  latam: { en: "Latin America", es: "Latinoamérica" },
};

export const REGION_SLUGS: RegionSlug[] = ["usa-canada", "europe", "latam"];

/** Module cache filled by SessionProvider / useLocationCatalog / worker. */
let catalogCache: Location[] = [];

export function setLocationCatalog(locations: Location[]): void {
  catalogCache = Array.isArray(locations) ? locations : [];
}

export function getLocationCatalog(): Location[] {
  return catalogCache;
}

/** @deprecated Prefer getLocationCatalog() — kept for gradual migration. */
export const locations: Location[] = new Proxy([] as Location[], {
  get(_target, prop, receiver) {
    const list = catalogCache;
    if (prop === "length") return list.length;
    if (prop === Symbol.iterator) return list[Symbol.iterator].bind(list);
    if (typeof prop === "string" && /^\d+$/.test(prop)) return list[Number(prop)];
    const value = Reflect.get(list, prop, receiver);
    return typeof value === "function" ? value.bind(list) : value;
  },
});

export const getListedLocations = (list: Location[] = catalogCache): Location[] =>
  list.filter((loc) => loc.visibility === "listed");

export const getLocationBySlug = (
  slug: string,
  list: Location[] = catalogCache,
): Location | undefined => list.find((loc) => loc.slug === slug);

export const getLocationsByRegion = (
  region: Location["region"],
  list: Location[] = catalogCache,
): Location[] => list.filter((loc) => loc.region === region && loc.visibility === "listed");

export const getLocationsByLanguage = (
  language: "en" | "es",
  list: Location[] = catalogCache,
): Location[] =>
  list.filter((loc) => loc.default_language === language && loc.visibility === "listed");

export function getRegionLabel(slug: string, locale: string = "en"): string {
  const entry = REGION_LABELS[slug as RegionSlug];
  if (!entry) return slug;
  return locale === "es" ? entry.es : entry.en;
}

export function getRegionForLocation(
  locationSlug: string,
  list: Location[] = catalogCache,
): RegionSlug | null {
  const loc = list.find((l) => l.slug === locationSlug);
  return (loc?.region as RegionSlug) || null;
}

export const LOCATION_CATALOG_URL = "/api/session/location-catalog";
export const LOCATION_CATALOG_CACHE_KEY = "session.location-catalog.v1";

export async function fetchLocationCatalog(origin?: string): Promise<Location[]> {
  const base =
    origin ||
    (typeof self !== "undefined" && (self as unknown as { location?: { origin?: string } }).location?.origin) ||
    "";
  const url = `${base}${LOCATION_CATALOG_URL}`;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return [];
    const data = (await response.json()) as { locations?: Location[] };
    const list = Array.isArray(data.locations) ? data.locations : [];
    setLocationCatalog(list);
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(LOCATION_CATALOG_CACHE_KEY, JSON.stringify(list));
      }
    } catch {
      /* ignore */
    }
    return list;
  } catch {
    return [];
  }
}

/** Sync read of last sessionStorage catalog (worker / early UI). */
export function readCachedLocationCatalog(): Location[] {
  try {
    if (typeof sessionStorage === "undefined") return catalogCache;
    const raw = sessionStorage.getItem(LOCATION_CATALOG_CACHE_KEY);
    if (!raw) return catalogCache;
    const parsed = JSON.parse(raw) as Location[];
    if (Array.isArray(parsed)) {
      setLocationCatalog(parsed);
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return catalogCache;
}
