/**
 * Content-type layout defaults from `_common.template.yml` (legacy `_common.single.yml`).
 * Top-level keys match section layout fields; applied onto every section
 * with fill-missing deep merge (section values win).
 */

import { deepMerge } from "./utils/deepMerge";

export const SECTION_LAYOUT_DEFAULT_KEYS = [
  "maxWidth",
  "paddingX",
  "paddingY",
  "marginX",
  "marginY",
  "background",
] as const;

export type SectionLayoutDefaultKey = (typeof SECTION_LAYOUT_DEFAULT_KEYS)[number];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Collect layout defaults from page root keys, then fill from legacy
 * `section_defaults` for the same keys.
 */
export function extractLayoutDefaults(
  page: Record<string, unknown>,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};

  for (const key of SECTION_LAYOUT_DEFAULT_KEYS) {
    const value = page[key];
    if (value !== undefined && value !== null) {
      defaults[key] = value;
    }
  }

  const legacy = page.section_defaults;
  if (isPlainObject(legacy)) {
    for (const key of SECTION_LAYOUT_DEFAULT_KEYS) {
      if (defaults[key] !== undefined) continue;
      const value = legacy[key];
      if (value !== undefined && value !== null) {
        defaults[key] = value;
      }
    }
  }

  return defaults;
}

function applyDefaultsToSection(
  section: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  let result = { ...section };
  for (const key of SECTION_LAYOUT_DEFAULT_KEYS) {
    const defaultVal = defaults[key];
    if (defaultVal === undefined) continue;
    const sectionVal = result[key];
    if (sectionVal === undefined || sectionVal === null) {
      result[key] = defaultVal;
    } else if (isPlainObject(defaultVal) && isPlainObject(sectionVal)) {
      result[key] = deepMerge(defaultVal, sectionVal);
    }
    // else: section already has a non-object value — keep it
  }
  return result;
}

/**
 * Fill-merge layout defaults onto each section, then strip those keys
 * (and nested layout keys under legacy `section_defaults`) from the page root.
 */
export function applySectionLayoutDefaults(
  page: Record<string, unknown>,
): Record<string, unknown> {
  const defaults = extractLayoutDefaults(page);
  const result: Record<string, unknown> = { ...page };

  for (const key of SECTION_LAYOUT_DEFAULT_KEYS) {
    delete result[key];
  }

  if (isPlainObject(result.section_defaults)) {
    const sd = { ...(result.section_defaults as Record<string, unknown>) };
    let removedAny = false;
    for (const key of SECTION_LAYOUT_DEFAULT_KEYS) {
      if (key in sd) {
        delete sd[key];
        removedAny = true;
      }
    }
    if (removedAny) {
      if (Object.keys(sd).length === 0) {
        delete result.section_defaults;
      } else {
        result.section_defaults = sd;
      }
    }
  }

  if (Object.keys(defaults).length === 0) {
    return result;
  }

  if (Array.isArray(result.sections)) {
    result.sections = (result.sections as unknown[]).map((s) => {
      if (!isPlainObject(s)) return s;
      return applyDefaultsToSection(s, defaults);
    });
  }

  return result;
}
