/**
 * Build the template `single` bag from merged page/entry data + field_mapping.
 * Includes system specials (`_image` → `image`, `_slug` → `slug`, etc.) that
 * getFieldMapping() excludes.
 */

import {
  getFieldMapping,
  getFullFieldMapping,
  getFieldMappingDefaults,
  RESERVED_IMAGE_FIELD,
  IMAGE_ALIAS_FIELD,
  RESERVED_SLUG_FIELD,
  SLUG_ALIAS_FIELD,
  RESERVED_LOCALE_FIELD,
  RESERVED_UPDATED_AT_FIELD,
  applyImageAliasToEntry,
  applySlugAliasToEntry,
  applyLocaleAliasToEntry,
  applyUpdatedAtAliasToEntry,
  finalizeSingleEntryForTemplates,
  resolveEntryUpdatedAt,
} from "./content-types";
import { applyPurchasableToRecord } from "./ecommerce/ecommerce-manager";
import { resolveFieldValue } from "./transform";
import {
  applyFieldOverridesToItem,
  readFieldOverrides,
  FIELD_OVERRIDES_KEY,
} from "./field-overrides";

export function buildSingleEntryFromContent(
  contentType: string,
  pageData: Record<string, unknown>,
  opts?: { slug?: string; locale?: string; contentRoot?: string },
): Record<string, unknown> | undefined {
  const mapping = getFieldMapping(contentType, opts?.contentRoot);
  const fullMapping = getFullFieldMapping(contentType, opts?.contentRoot);
  const entry: Record<string, unknown> = {};
  if (mapping && Object.keys(mapping).length > 0) {
    for (const [key, source] of Object.entries(mapping)) {
      if (key.startsWith("_")) continue;
      const value = resolveFieldValue(source, pageData);
      if (value !== undefined) {
        entry[key] = value;
      }
    }
  }

  const schemaDefaults = getFieldMappingDefaults(contentType, opts?.contentRoot);
  for (const [key, defVal] of Object.entries(schemaDefaults)) {
    if (!(key in entry)) {
      entry[key] = defVal;
    }
  }

  // System specials → single.* aliases (underscore keys are excluded from getFieldMapping)
  const slugSource = fullMapping?.[RESERVED_SLUG_FIELD];
  if (slugSource) {
    const slugValue = resolveFieldValue(slugSource, pageData, RESERVED_SLUG_FIELD);
    applySlugAliasToEntry(entry, slugValue);
  }
  const localeSource = fullMapping?.[RESERVED_LOCALE_FIELD];
  if (localeSource) {
    const localeValue = resolveFieldValue(localeSource, pageData, RESERVED_LOCALE_FIELD);
    applyLocaleAliasToEntry(entry, localeValue);
  }
  const imageSource = fullMapping?.[RESERVED_IMAGE_FIELD];
  if (imageSource) {
    const imageValue = resolveFieldValue(imageSource, pageData, RESERVED_IMAGE_FIELD);
    applyImageAliasToEntry(entry, imageValue);
  }
  const updatedAtSource = fullMapping?.[RESERVED_UPDATED_AT_FIELD];
  if (updatedAtSource) {
    const updatedAtValue = resolveFieldValue(updatedAtSource, pageData, RESERVED_UPDATED_AT_FIELD);
    applyUpdatedAtAliasToEntry(entry, updatedAtValue);
  }

  let fo: Record<string, unknown> = {};
  if (opts?.slug && opts?.locale) {
    fo = readFieldOverrides(contentType, opts.slug, opts.locale, opts.contentRoot);
  }
  if (Object.keys(fo).length === 0) {
    const fromPage = pageData[FIELD_OVERRIDES_KEY] ?? pageData.field_overrides;
    if (fromPage && typeof fromPage === "object" && !Array.isArray(fromPage)) {
      fo = { ...(fromPage as Record<string, unknown>) };
    }
  }

  // Prefer override of aliases if present
  if (fo[SLUG_ALIAS_FIELD] !== undefined) {
    applySlugAliasToEntry(entry, fo[SLUG_ALIAS_FIELD]);
  } else if (fo[RESERVED_SLUG_FIELD] !== undefined) {
    applySlugAliasToEntry(entry, fo[RESERVED_SLUG_FIELD]);
  }
  if (fo[IMAGE_ALIAS_FIELD] !== undefined) {
    applyImageAliasToEntry(entry, fo[IMAGE_ALIAS_FIELD]);
  } else if (fo[RESERVED_IMAGE_FIELD] !== undefined) {
    applyImageAliasToEntry(entry, fo[RESERVED_IMAGE_FIELD]);
  }
  if (fo[RESERVED_LOCALE_FIELD] !== undefined) {
    applyLocaleAliasToEntry(entry, fo[RESERVED_LOCALE_FIELD]);
  }

  const merged = applyFieldOverridesToItem(entry, fo);

  // Editorial updated_at (YAML/DB value, else published_at — never sync-state)
  {
    const iso = resolveEntryUpdatedAt({
      contentType,
      slug: opts?.slug,
      locale: opts?.locale,
      record: { ...pageData, ...merged },
      contentRoot: opts?.contentRoot,
    });
    applyUpdatedAtAliasToEntry(merged, iso);
  }

  const finalized = finalizeSingleEntryForTemplates(merged, {
    slug: opts?.slug,
    locale: opts?.locale,
  });
  if (finalized) {
    applyPurchasableToRecord(
      finalized,
      contentType,
      opts?.slug || (typeof finalized.slug === "string" ? finalized.slug : undefined),
    );
  }
  return finalized;
}

/**
 * Build template `single` bag then hydrate `editor.type: relation` fields.
 * Use on page/SSR delivery paths — not on listing projections.
 */
export async function buildResolvedSingleEntryFromContent(
  contentType: string,
  pageData: Record<string, unknown>,
  opts?: {
    slug?: string;
    locale?: string;
    contentRoot?: string;
    baseUrl?: string;
    db?: import("./database").DatabaseManager;
    contentIndex?: import("./content-index").ContentIndex;
  },
): Promise<Record<string, unknown> | undefined> {
  const entry = buildSingleEntryFromContent(contentType, pageData, opts);
  if (!entry) return undefined;
  const { hydrateEntryForDelivery } = await import("./hydrate-entry-delivery");
  return hydrateEntryForDelivery(contentType, entry, {
    contentRoot: opts?.contentRoot,
    locale: opts?.locale,
    baseUrl: opts?.baseUrl,
    db: opts?.db,
    contentIndex: opts?.contentIndex,
  });
}
