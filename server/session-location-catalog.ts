/**
 * Slim campus catalog for session IP matching — reads the configured locations database.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { Location } from "@shared/session";
import { getSessionSettings } from "./settings";
import { getDefaultContentRoot } from "./site-config";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function absContentRoot(contentRoot?: string): string {
  const root = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(root) ? root : path.join(process.cwd(), root);
}

/** Local private-database slugs under db/ (for Session settings picker). */
export function listLocalDatabaseSlugs(contentRoot?: string): string[] {
  const abs = absContentRoot(contentRoot);
  const dbDir = path.join(abs, "db");
  if (!fs.existsSync(dbDir)) return [];
  const out: string[] = [];
  for (const name of fs.readdirSync(dbDir)) {
    const configPath = path.join(dbDir, name, "config.yml");
    if (!fs.existsSync(configPath)) continue;
    try {
      const cfg = yaml.load(fs.readFileSync(configPath, "utf8")) as {
        source?: { type?: string };
      } | null;
      if (cfg?.source?.type === "local") out.push(name);
    } catch {
      /* skip */
    }
  }
  return out.sort();
}

/** Load rows from a local DB file regardless of session settings (forms / CT catalogs). */
export function loadLocationsFromDatabase(
  dbSlug: string,
  contentRoot?: string,
): Location[] {
  const abs = absContentRoot(contentRoot);
  const configPath = path.join(abs, "db", dbSlug, "config.yml");
  let filePath = path.join(abs, "db", dbSlug, `${dbSlug}.yml`);
  if (fs.existsSync(configPath)) {
    try {
      const cfg = yaml.load(fs.readFileSync(configPath, "utf8")) as {
        source?: { local?: { filename?: string } };
      } | null;
      const filename = cfg?.source?.local?.filename;
      if (filename) filePath = path.join(abs, "db", dbSlug, filename);
    } catch {
      /* use default */
    }
  }
  if (!fs.existsSync(filePath)) return [];

  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : [];
  const out: Location[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const slug = typeof r.slug === "string" ? r.slug.trim() : "";
    const lat = asNumber(r.latitude);
    const lon = asNumber(r.longitude);
    if (!slug || lat == null || lon == null) continue;
    const regionRaw = typeof r.region === "string" ? r.region : "other";
    const region =
      regionRaw === "usa-canada" ||
      regionRaw === "latam" ||
      regionRaw === "europe" ||
      regionRaw === "online"
        ? regionRaw
        : ("usa-canada" as const);
    out.push({
      slug,
      name: typeof r.name === "string" ? r.name : slug,
      city: typeof r.city === "string" ? r.city : "",
      country: typeof r.country === "string" ? r.country : "",
      country_code: typeof r.country_code === "string" ? r.country_code : "",
      latitude: lat,
      longitude: lon,
      region,
      default_language: r.default_language === "es" ? "es" : "en",
      timezone: typeof r.timezone === "string" ? r.timezone : "",
      visibility: r.visibility === "unlisted" ? "unlisted" : "listed",
      phone: typeof r.phone === "string" ? r.phone : undefined,
      address: typeof r.address === "string" ? r.address : undefined,
    });
  }
  return out;
}

export function loadSessionLocationCatalog(contentRoot?: string): Location[] {
  const root = contentRoot ?? getDefaultContentRoot();
  const settings = getSessionSettings(root);
  const dbSlug = settings.location.database;
  if (!dbSlug || !settings.location.fill_from_ip) return [];
  return loadLocationsFromDatabase(dbSlug, root);
}
