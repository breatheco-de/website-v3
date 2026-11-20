/**
 * Slim campus catalog for session IP matching — reads the configured locations database.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { Location } from "@shared/session";
import { getSessionSettings } from "./settings";
import { getDefaultContentRoot } from "./site-config";

const LAT_ALIASES = ["latitude", "lat"] as const;
const LON_ALIASES = ["longitude", "lon", "lng"] as const;

export const SESSION_LOCATION_GEO_ERROR =
  "This database cannot be used for location matching — it needs latitude and longitude fields (or lat / lon).";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function absContentRoot(contentRoot?: string): string {
  const root = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(root) ? root : path.join(process.cwd(), root);
}

function firstNumberFromAliases(
  row: Record<string, unknown>,
  aliases: readonly string[],
): number | null {
  for (const key of aliases) {
    if (!(key in row)) continue;
    const n = asNumber(row[key]);
    if (n != null) return n;
  }
  return null;
}

type LocalDbConfig = {
  source?: { type?: string; local?: { filename?: string } };
  editor?: Record<string, unknown>;
  field_mapping?: Record<string, unknown>;
};

function readLocalDbConfig(
  dbSlug: string,
  contentRoot?: string,
): { abs: string; config: LocalDbConfig | null; configPath: string } {
  const abs = absContentRoot(contentRoot);
  const configPath = path.join(abs, "db", dbSlug, "config.yml");
  if (!fs.existsSync(configPath)) return { abs, config: null, configPath };
  try {
    const config = (yaml.load(fs.readFileSync(configPath, "utf8")) as LocalDbConfig | null) ?? null;
    return { abs, config, configPath };
  } catch {
    return { abs, config: null, configPath };
  }
}

function resolveLocalDbFilePath(
  dbSlug: string,
  abs: string,
  config: LocalDbConfig | null,
): string {
  const filename = config?.source?.local?.filename;
  if (filename) return path.join(abs, "db", dbSlug, filename);
  return path.join(abs, "db", dbSlug, `${dbSlug}.yml`);
}

/** Collect field names from editor, field_mapping, and a sample data row. */
export function collectDatabaseFieldNames(
  dbSlug: string,
  contentRoot?: string,
): Set<string> {
  const names = new Set<string>();
  const { abs, config } = readLocalDbConfig(dbSlug, contentRoot);
  if (config?.editor && typeof config.editor === "object") {
    for (const key of Object.keys(config.editor)) names.add(key);
  }
  if (config?.field_mapping && typeof config.field_mapping === "object") {
    for (const key of Object.keys(config.field_mapping)) {
      if (key.startsWith("_")) continue;
      names.add(key);
    }
  }
  const filePath = resolveLocalDbFilePath(dbSlug, abs, config);
  if (fs.existsSync(filePath)) {
    try {
      const raw = yaml.load(fs.readFileSync(filePath, "utf8"));
      const list = Array.isArray(raw) ? raw : [];
      for (const row of list.slice(0, 5)) {
        if (!row || typeof row !== "object") continue;
        for (const key of Object.keys(row as Record<string, unknown>)) names.add(key);
      }
    } catch {
      /* ignore sample read */
    }
  }
  return names;
}

/** True when the DB schema/sample exposes a lat alias and a lon alias. */
export function databaseHasGeoFields(dbSlug: string, contentRoot?: string): boolean {
  const names = collectDatabaseFieldNames(dbSlug, contentRoot);
  const hasLat = LAT_ALIASES.some((k) => names.has(k));
  const hasLon = LON_ALIASES.some((k) => names.has(k));
  return hasLat && hasLon;
}

/** Local DB slugs that expose lat/lon (or aliases) and can be used for session.location. */
export function listLocationGeoOkDatabases(
  contentRoot?: string,
  slugs?: string[],
): string[] {
  const list = slugs ?? listLocalDatabaseSlugs(contentRoot);
  return list.filter((slug) => databaseHasGeoFields(slug, contentRoot));
}

/**
 * For each local DB slug that is missing lat/lon (or aliases), map slug → staff-facing error.
 */
export function listLocationDatabaseGeoErrors(
  contentRoot?: string,
  slugs?: string[],
): Record<string, string> {
  const list = slugs ?? listLocalDatabaseSlugs(contentRoot);
  const ok = new Set(listLocationGeoOkDatabases(contentRoot, list));
  const out: Record<string, string> = {};
  for (const slug of list) {
    if (!ok.has(slug)) out[slug] = SESSION_LOCATION_GEO_ERROR;
  }
  return out;
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
  const { abs, config } = readLocalDbConfig(dbSlug, contentRoot);
  const filePath = resolveLocalDbFilePath(dbSlug, abs, config);
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
    const lat = firstNumberFromAliases(r, LAT_ALIASES);
    const lon = firstNumberFromAliases(r, LON_ALIASES);
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
