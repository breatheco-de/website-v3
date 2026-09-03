/**
 * Merge DB field_mapping SEO baseline with locale YAML overlay.
 */

import fs from "fs";
import path from "path";
import {
  getFieldMapping,
  getFolder,
  getLocaleKey,
  SEO_FIELD_MAPPING_KEYS,
} from "./content-types";
import { resolveFieldValue } from "./transform";
import {
  isPillarPathExplicitlyNull,
  normalizeSeoBlock,
  readSeoBlockFromYamlText,
  type SeoBlock,
} from "./seo-fields";

export { SEO_FIELD_MAPPING_KEYS };

function readYamlOverlaySeo(absPath: string): SeoBlock {
  if (!fs.existsSync(absPath)) return {};
  try {
    return readSeoBlockFromYamlText(fs.readFileSync(absPath, "utf-8"));
  } catch {
    return {};
  }
}

function valueFromMapping(
  item: Record<string, unknown>,
  mappingKey: string,
  fieldMapping: Record<string, string | { source: string; default: string | null }>,
): unknown {
  const spec = fieldMapping[mappingKey];
  if (!spec) return undefined;
  if (typeof spec === "string") {
    if (spec.startsWith("function:")) return undefined;
    return resolveFieldValue(spec, item, mappingKey);
  }
  if (spec && typeof spec === "object" && "source" in spec) {
    const val = resolveFieldValue(spec.source, item, mappingKey);
    return val === undefined || val === null || val === "" ? spec.default : val;
  }
  return undefined;
}

function seoFromDbItem(
  item: Record<string, unknown>,
  fieldMapping: Record<string, string | { source: string; default: string | null }>,
): SeoBlock {
  const seo: SeoBlock = {};
  const kw = valueFromMapping(item, SEO_FIELD_MAPPING_KEYS.main_keyword, fieldMapping);
  if (typeof kw === "string" && kw.trim()) seo.main_keyword = kw.trim();

  const pp = valueFromMapping(item, SEO_FIELD_MAPPING_KEYS.pillar_path, fieldMapping);
  if (pp === null) seo.pillar_path = null;
  else if (typeof pp === "string") seo.pillar_path = pp;

  const hub = valueFromMapping(item, SEO_FIELD_MAPPING_KEYS.is_pillar, fieldMapping);
  if (hub === true || hub === "true") seo.is_pillar = true;
  else if (hub === false || hub === "false") seo.is_pillar = false;

  return seo;
}

/** DB-mapped seo: baseline only (no locale YAML). Used by field provenance. */
export function seoBaselineFromDbItem(
  item: Record<string, unknown>,
  contentType: string,
  contentRoot: string,
): SeoBlock {
  const fieldMapping = getFieldMapping(contentType, contentRoot) || {};
  return seoFromDbItem(item, fieldMapping);
}

function mergeSeoBlocks(base: SeoBlock, overlay: SeoBlock): SeoBlock {
  const out: SeoBlock = { ...base };
  for (const key of [
    "main_keyword",
    "kw_monthly_volume",
    "kw_difficulty",
    "pillar_path",
    "is_pillar",
  ] as const) {
    if (!Object.prototype.hasOwnProperty.call(overlay, key)) continue;
    const val = overlay[key];
    if (val === undefined) continue;
    if (key === "is_pillar") {
      out.is_pillar = val === true;
      continue;
    }
    if (key === "pillar_path") {
      out.pillar_path = val === null ? null : typeof val === "string" ? val : null;
      continue;
    }
    if (key === "kw_monthly_volume" || key === "kw_difficulty") {
      out[key] = typeof val === "number" && Number.isInteger(val) ? val : val === null ? null : out[key];
      continue;
    }
    out.main_keyword = val === null ? null : typeof val === "string" ? val : null;
  }
  return out;
}

export function resolveEffectiveSeo(opts: {
  contentType: string;
  slug: string;
  locale: string;
  contentRoot: string;
  dbItem?: Record<string, unknown> | null;
}): SeoBlock {
  const fieldMapping = getFieldMapping(opts.contentType, opts.contentRoot) || {};
  const base = opts.dbItem ? seoFromDbItem(opts.dbItem, fieldMapping) : {};
  const dir = getFolder(opts.contentType, opts.contentRoot);
  const absPath = path.join(opts.contentRoot, dir, opts.slug, `${opts.locale}.yml`);
  const overlay = readYamlOverlaySeo(absPath);
  return normalizeSeoBlock(mergeSeoBlocks(base, overlay));
}

export function localeYamlRelPath(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot: string,
): string {
  const dir = getFolder(contentType, contentRoot);
  return path.join(dir, slug, `${locale}.yml`).split(path.sep).join("/");
}

export function itemLocale(
  item: Record<string, unknown>,
  contentType: string,
  contentRoot: string,
): string {
  const localeKey = getLocaleKey(contentType, contentRoot) || "locale";
  const fromItem = item[localeKey] ?? item.locale ?? item.lang;
  return typeof fromItem === "string" && fromItem.trim()
    ? fromItem.trim().toLowerCase()
    : "en";
}

export function hasEffectiveSeoSignal(seo: SeoBlock): boolean {
  if (seo.is_pillar === true) return true;
  if (isPillarPathExplicitlyNull(seo)) {
    const kw = typeof seo.main_keyword === "string" && seo.main_keyword.trim();
    return Boolean(kw);
  }
  const kw = typeof seo.main_keyword === "string" && seo.main_keyword.trim();
  const pathVal = typeof seo.pillar_path === "string" && seo.pillar_path.trim();
  return Boolean(kw || pathVal);
}

export { isPillarPathExplicitlyNull };
