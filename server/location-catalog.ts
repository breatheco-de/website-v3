/**
 * Every location entry on a site (listed and hidden), read from the location
 * content type folder. Lead form options show listed ones; checks accept both.
 */

import fs from "fs";
import path from "path";
import { getDefaultContentRoot } from "./site-config";
import { getFolder } from "./content-types";
import { loadYamlWithTemplateVars as safeYamlLoad } from "./yaml-parse-cache";
import type { LocationNameIndex } from "@shared/formLocationPolicy";

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

export function listSiteLocations(contentRoot?: string): SiteLocation[] {
  const root = contentRoot ?? getDefaultContentRoot();
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
