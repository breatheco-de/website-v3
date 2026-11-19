/**
 * Every location entry on a site (listed and hidden). Prefer the locations
 * database when present; fall back to the location content type folder.
 */

import fs from "fs";
import path from "path";
import { getDefaultContentRoot } from "./site-config";
import { getFolder } from "./content-types";
import { loadYamlWithTemplateVars as safeYamlLoad } from "./yaml-parse-cache";
import type { LocationNameIndex } from "@shared/formLocationPolicy";
import { loadLocationsFromDatabase, loadSessionLocationCatalog } from "./session-location-catalog";

export interface SiteLocation {
  slug: string;
  name: string;
  city: string;
  country: string;
  country_code?: string;
  region: string;
  /** `visibility: unlisted` (kept valid, not offered in pickers). */
  hidden: boolean;
}

function fromDbRows(
  rows: ReturnType<typeof loadLocationsFromDatabase>,
): SiteLocation[] {
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    city: r.city,
    country: r.country,
    ...(r.country_code ? { country_code: r.country_code } : {}),
    region: r.region || "other",
    hidden: r.visibility === "unlisted",
  }));
}

export function listSiteLocations(contentRoot?: string): SiteLocation[] {
  const root = contentRoot ?? getDefaultContentRoot();

  const fromSession = loadSessionLocationCatalog(root);
  if (fromSession.length > 0) return fromDbRows(fromSession);

  const fromLocationsDb = loadLocationsFromDatabase("locations", root);
  if (fromLocationsDb.length > 0) return fromDbRows(fromLocationsDb);

  const absRoot = path.isAbsolute(root) ? root : path.join(process.cwd(), root);
  let dir: string;
  try {
    dir = path.join(absRoot, getFolder("location", root));
  } catch {
    dir = path.join(absRoot, "locations");
  }
  if (!fs.existsSync(dir)) return [];
  const out: SiteLocation[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const commonPath = path.join(dir, entry, "_common.yml");
    if (!fs.existsSync(commonPath)) continue;
    let data: Record<string, unknown> | null = null;
    try {
      data = safeYamlLoad(fs.readFileSync(commonPath, "utf8")) as Record<string, unknown> | null;
    } catch {
      continue;
    }
    if (!data) continue;
    const slug = typeof data.slug === "string" && data.slug.trim() ? data.slug.trim() : entry;
    out.push({
      slug,
      name: typeof data.name === "string" ? data.name : slug,
      city: typeof data.city === "string" ? data.city : "",
      country: typeof data.country === "string" ? data.country : "",
      ...(typeof data.country_code === "string" ? { country_code: data.country_code } : {}),
      region: typeof data.region === "string" && data.region ? data.region : "other",
      hidden: data.visibility === "unlisted",
    });
  }
  return out;
}

export function locationNameIndex(contentRoot?: string): LocationNameIndex {
  const locations = listSiteLocations(contentRoot);
  return {
    known: new Set(locations.map((l) => l.slug)),
    hidden: new Set(locations.filter((l) => l.hidden).map((l) => l.slug)),
  };
}
