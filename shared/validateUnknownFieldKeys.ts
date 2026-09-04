/**
 * Unexpected top-level Field keys on merged entry bags.
 * Does not walk sections.*.data (component registry, not Fields).
 */

import { FUNNEL_YAML_KEY } from "./funnel";

const STRUCTURAL_KEYS = new Set([
  "meta",
  "sections",
  "schema",
  "seo",
  FUNNEL_YAML_KEY,
  "layout",
  "settings",
  "field_overrides",
  "status",
  "detached",
  // Legacy + page-root layout defaults (server/section-layout-defaults.ts)
  "section_defaults",
  "maxWidth",
  "paddingX",
  "paddingY",
  "marginX",
  "marginY",
  "background",
]);

const ALIAS_KEYS = new Set([
  "slug",
  "locale",
  "image",
  "updated_at",
  "published_at",
  "translations",
  "hreflangs",
]);

export const FIELD_OVERRIDES_KEY = "field_overrides";

export function mappingAllowlist(
  fieldMapping: Record<string, unknown> | null | undefined,
): Set<string> {
  const allowed = new Set<string>();
  if (!fieldMapping) return allowed;
  for (const key of Object.keys(fieldMapping)) {
    allowed.add(key);
    const first = key.split(".")[0];
    if (first) allowed.add(first);
  }
  return allowed;
}

export function isAllowedUnknownKey(key: string, mappingKeys: Set<string>): boolean {
  if (STRUCTURAL_KEYS.has(key)) return true;
  if (ALIAS_KEYS.has(key)) return true;
  if (mappingKeys.has(key)) return true;
  return false;
}

export type UnknownKeyHit = {
  key: string;
  inOverrides: boolean;
};

export function collectUnknownFieldKeys(
  entryFields: Record<string, unknown> | null | undefined,
  fieldMapping: Record<string, unknown> | null | undefined,
): UnknownKeyHit[] {
  if (!entryFields || typeof entryFields !== "object") return [];
  const mappingKeys = mappingAllowlist(fieldMapping);
  const hits: UnknownKeyHit[] = [];

  for (const key of Object.keys(entryFields)) {
    if (key === FIELD_OVERRIDES_KEY) continue;
    if (!isAllowedUnknownKey(key, mappingKeys)) {
      hits.push({ key, inOverrides: false });
    }
  }

  const bag = entryFields[FIELD_OVERRIDES_KEY];
  if (bag && typeof bag === "object" && !Array.isArray(bag)) {
    for (const key of Object.keys(bag as Record<string, unknown>)) {
      if (!mappingKeys.has(key) && !ALIAS_KEYS.has(key)) {
        hits.push({ key, inOverrides: true });
      }
    }
  }

  return hits;
}
