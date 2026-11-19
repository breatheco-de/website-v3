/**
 * Seed `db/locations/locations.yml` from each campus `_common.yml`.
 * Latitude/longitude are required — rows without pins are reported and fail the run.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { dumpContentYaml } from "./content-yaml";

export type LocationDbRow = {
  slug: string;
  name: string;
  city: string;
  country: string;
  country_code: string;
  latitude: number;
  longitude: number;
  region: string;
  default_language: "en" | "es";
  timezone: string;
  visibility: "listed" | "unlisted";
  phone: string;
  address: string;
};

export function collectLocationRowsFromCommon(contentRoot: string): {
  rows: LocationDbRow[];
  missingCoords: string[];
} {
  const locDir = path.join(contentRoot, "locations");
  const rows: LocationDbRow[] = [];
  const missingCoords: string[] = [];
  if (!fs.existsSync(locDir)) return { rows, missingCoords };

  for (const entry of fs.readdirSync(locDir)) {
    if (entry.startsWith("_") || entry.startsWith(".")) continue;
    const commonPath = path.join(locDir, entry, "_common.yml");
    if (!fs.existsSync(commonPath)) continue;
    let data: Record<string, unknown> = {};
    try {
      data = (yaml.load(fs.readFileSync(commonPath, "utf8")) as Record<string, unknown>) || {};
    } catch {
      missingCoords.push(entry);
      continue;
    }
    const slug =
      typeof data.slug === "string" && data.slug.trim() ? data.slug.trim() : entry;
    const lat = data.latitude;
    const lon = data.longitude;
    if (
      typeof lat !== "number" ||
      typeof lon !== "number" ||
      Number.isNaN(lat) ||
      Number.isNaN(lon)
    ) {
      missingCoords.push(slug);
      continue;
    }
    rows.push({
      slug,
      name: typeof data.name === "string" ? data.name : slug,
      city: typeof data.city === "string" ? data.city : "",
      country: typeof data.country === "string" ? data.country : "",
      country_code: typeof data.country_code === "string" ? data.country_code : "",
      latitude: lat,
      longitude: lon,
      region: typeof data.region === "string" && data.region ? data.region : "other",
      default_language: data.default_language === "es" ? "es" : "en",
      timezone: typeof data.timezone === "string" ? data.timezone : "",
      visibility: data.visibility === "unlisted" ? "unlisted" : "listed",
      phone: typeof data.phone === "string" ? data.phone : "",
      address: typeof data.address === "string" ? data.address : "",
    });
  }
  rows.sort((a, b) => a.slug.localeCompare(b.slug));
  return { rows, missingCoords };
}

export function writeLocationsDbItems(
  contentRoot: string,
  rows: LocationDbRow[],
): string {
  const dir = path.join(contentRoot, "db", "locations");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "locations.yml");
  const body = dumpContentYaml(rows, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
  fs.writeFileSync(filePath, body.endsWith("\n") ? body : `${body}\n`, "utf8");
  return filePath;
}

export function ensureLocationsDbConfig(contentRoot: string, templateConfigPath: string): string {
  const dir = path.join(contentRoot, "db", "locations");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, "config.yml");
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(templateConfigPath, dest);
  }
  return dest;
}
