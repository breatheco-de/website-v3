import * as fs from "fs";
import { getDefaultContentRoot } from "./site-config";
import * as path from "path";
import { contentIndex } from "./content-index";
import { deepMerge } from "./utils/deepMerge";
import {
  getFolder,
  getLookupKey,
  getFieldMapping,
  getFullFieldMapping,
  getRowsFilterFields,
  getLocaleKey,
  getLocaleSource,
  RESERVED_IMAGE_FIELD,
  RESERVED_SLUG_FIELD,
  RESERVED_LOCALE_FIELD,
  RESERVED_UPDATED_AT_FIELD,
  applyImageAliasToEntry,
  applySlugAliasToEntry,
  applyLocaleAliasToEntry,
  applyUpdatedAtAliasToEntry,
  resolveEntryUpdatedAt,
} from "./content-types";
import { resolveFieldValue, applyTransformIfNeeded } from "./transform";
import { ROWS_FILTER_MAX, type RowsFilter } from "@shared/validateEditorFieldTypes";
import { readSectionAnchors, writeSectionAnchors } from "./utils/sectionAnchors";
import { canonicalSectionId, sectionIdCandidates } from "./utils/sectionIdentity";
import { applyPerEntryLayer, type PerEntryAccum } from "./section-merge";
import { applySectionLayoutDefaults } from "./section-layout-defaults";
import { isEntryDetached } from "./shared-layout-entry";
import { stripDraftMeta } from "./versioning/draft-meta";
import {
  resolveCommonTemplatePath,
  resolveTemplateLocalePath,
} from "./shared-layout-paths";
import { ENTRY_OR_SINGLE_KEY_RE } from "@shared/entryTemplateVars";
import { child } from "./logger";
const log = child({ module: "database-single-loader" });

export type { PerEntryAccum } from "./section-merge";

export const TEMPLATE_EXPR_RE = /\{\{[\s\S]*?\}\}/;

/**
 * Editorial clocks on `template.{locale}.yml` describe the shared shell, not an entry.
 * When merging an attached entry, drop them so missing entry dates fall through to
 * the entry's own `published_at` / locale `updated_at` instead of the shell seed.
 */
const SHELL_EDITORIAL_DATE_KEYS = [
  "updated_at",
  RESERVED_UPDATED_AT_FIELD,
  "published_at",
] as const;

export function stripShellEditorialDates(data: Record<string, unknown>): void {
  for (const key of SHELL_EDITORIAL_DATE_KEYS) {
    delete data[key];
  }
}

export function extractVariableFields(
  obj: unknown,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof obj !== "object" || obj === null) return result;
  const entries: Array<[string, unknown]> = Array.isArray(obj)
    ? obj.map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(obj as Record<string, unknown>).filter(([k]) => !k.startsWith("_"));
  for (const [key, value] of entries) {
    const dotPath = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" && TEMPLATE_EXPR_RE.test(value)) {
      result[dotPath] = value.trim();
    } else if (typeof value === "object" && value !== null) {
      Object.assign(result, extractVariableFields(value, dotPath));
    }
  }
  return result;
}

/**
 * Attach `_variableFields` / `_variableKeys` on sections that still contain
 * `{{ entry.* }}` / legacy `{{ single.* }}` expressions (before delivery-time resolution).
 * Needed for static single_template types as well as DB-backed singles.
 */
export function attachVariableFieldsToSections(sections: unknown[]): void {
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const variableFields = extractVariableFields(section);
    if (Object.keys(variableFields).length === 0) continue;
    (section as Record<string, unknown>)._variableFields = variableFields;
    const variableKeys: Record<string, string> = {};
    for (const [dotPath, expr] of Object.entries(variableFields)) {
      const m = ENTRY_OR_SINGLE_KEY_RE.exec(expr);
      if (m) variableKeys[dotPath] = m[1].trim();
      ENTRY_OR_SINGLE_KEY_RE.lastIndex = 0;
    }
    if (Object.keys(variableKeys).length > 0) {
      (section as Record<string, unknown>)._variableKeys = variableKeys;
    }
  }
}

export function mergeSingleTemplate(
  contentType: string,
  locale: string,
  slug?: string,
  accum?: PerEntryAccum,
  contentRoot?: string,
  /** When set, load `template.{variant}.{locale}.yml` (legacy `single.*`) instead of live shell. */
  templateVariant?: string,
  /**
   * When set, overlay `{variant}.{locale}.yml` from the entry folder (e.g. draft preview)
   * instead of live `{locale}.yml`. Attached entries still apply data-only (ignore sections).
   */
  entryVariant?: string,
): Record<string, unknown> | null {
  const resolvedRoot = contentRoot ?? getDefaultContentRoot();
  const folder = getFolder(contentType, resolvedRoot);
  const templateDir = path.join(resolvedRoot, folder);
  const singleCommonPath = resolveCommonTemplatePath(templateDir);
  const commonPath = path.join(templateDir, "_common.yml");
  const localePath = resolveTemplateLocalePath(templateDir, locale, {
    variant: templateVariant,
    fallbackLocale: "en",
  });
  if (!fs.existsSync(localePath)) return null;

  let baseData: Record<string, unknown> = {};
  if (fs.existsSync(singleCommonPath)) {
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(singleCommonPath, "utf-8"));
    if (parsed) {
      // Shared-layout: _common.template.yml is layout defaults only — never carry sections
      const { sections: _ignoredSections, ...rest } = parsed;
      if (_ignoredSections !== undefined) {
        log.warn(
          `[mergeSingleTemplate] Ignoring sections in layout defaults for ${contentType} (structure lives in template.{locale}.yml)`,
        );
      }
      baseData = rest;
    }
  }
  if (fs.existsSync(commonPath)) {
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(commonPath, "utf-8"));
    if (parsed) {
      const { sections: _ignoredSections, ...rest } = parsed;
      if (_ignoredSections !== undefined) {
        log.warn(
          `[mergeSingleTemplate] Ignoring sections in type _common.yml for ${contentType}`,
        );
      }
      baseData = Object.keys(baseData).length > 0 ? deepMerge(baseData, rest) : rest;
    }
  }
  const localeData = contentIndex.safeYamlLoad(fs.readFileSync(localePath, "utf-8"));
  if (!localeData) return null;
  let merged: Record<string, unknown> = Object.keys(baseData).length > 0
    ? deepMerge(baseData, localeData)
    : { ...localeData };

  // Entry merge: shell dates must not masquerade as the entry's editorial clock.
  if (slug) {
    stripShellEditorialDates(merged);
  }

  // Capture stable base-template section-id → index map BEFORE any per-entry layers
  // so that originalIndex values in accum.removedSections are always relative to the
  // immutable shared template, regardless of how many per-entry layers fire.
  if (slug && accum) {
    const baseSectionsSnapshot = Array.isArray(merged.sections)
      ? (merged.sections as Record<string, unknown>[])
      : [];
    const baseIndexById = new Map<string, number>();
    baseSectionsSnapshot.forEach((s, idx) => {
      const id = canonicalSectionId(s);
      if (id) baseIndexById.set(id, idx);
    });
    accum.baseIndexById = baseIndexById;
  }

  // Layer 4 & 5: per-entry YML overrides (only when slug is provided).
  // Each layer is applied sequentially so section directives from layer 4
  // (_common.yml) are not lost when layer 5 ({locale}.yml) also has sections.
  if (slug) {
    // Load alias map once (silently skipped if file doesn't exist)
    let aliases: Record<string, string | null> | undefined;
    try {
      const anchors = readSectionAnchors(contentType);
      if (Object.keys(anchors.aliases).length > 0) {
        // Step 5: clear stale aliases whose original section ID is now back in the template.
        // This handles the case where a section was deleted and then re-created with the same ID.
        const baseSectionIds = new Set<string>(
          Array.isArray(merged.sections)
            ? (merged.sections as Record<string, unknown>[]).flatMap((s) =>
                sectionIdCandidates(s),
              )
            : [],
        );
        // Read-only: stale aliases are ignored here and pruned on template edits (pruneStaleSectionAliases).
        for (const k of Object.keys(anchors.aliases)) {
          if (baseSectionIds.has(k)) delete anchors.aliases[k];
        }
        if (Object.keys(anchors.aliases).length > 0) {
          aliases = anchors.aliases;
        }
      }
    } catch { /* non-fatal — alias resolution is best-effort */ }

    const entryDir = path.join(templateDir, slug);
    if (fs.existsSync(entryDir) && fs.statSync(entryDir).isDirectory()) {
      // Attached entries: data-only overlays (ignore sections/layout).
      // Detached entries should not use mergeSingleTemplate for render.
      const dataOnly = !isEntryDetached(contentType, slug, resolvedRoot);
      const entryCommonPath = path.join(entryDir, "_common.yml");
      if (fs.existsSync(entryCommonPath)) {
        const parsed = contentIndex.safeYamlLoad(fs.readFileSync(entryCommonPath, "utf-8"));
        if (parsed) merged = applyPerEntryLayer(merged, parsed, accum, aliases, dataOnly);
      }
      // Explicit entry variant (e.g. draft preview): use only that file — do not
      // fall back to live `{locale}.yml`, so a missing draft cannot leak the shell alone.
      let entryLocalePath: string | null = null;
      if (entryVariant) {
        const variantPath = path.join(entryDir, `${entryVariant}.${locale}.yml`);
        if (fs.existsSync(variantPath)) entryLocalePath = variantPath;
      } else {
        const livePath = path.join(entryDir, `${locale}.yml`);
        if (fs.existsSync(livePath)) entryLocalePath = livePath;
      }
      if (entryLocalePath) {
        const parsed = contentIndex.safeYamlLoad(fs.readFileSync(entryLocalePath, "utf-8"));
        if (parsed) merged = applyPerEntryLayer(merged, stripDraftMeta(parsed), accum, aliases, dataOnly);
      } else if (entryVariant) {
        // Caller asked for a variant that is not on disk — refuse the shell-only merge.
        return null;
      }
    }
  }

  return applySectionLayoutDefaults(merged);
}

/**
 * Drop `_section_anchors.json` aliases whose section id is back in the shared template.
 * Called after template section edits; delivery merges never write.
 */
export function pruneStaleSectionAliases(contentType: string, locale: string, contentRoot?: string): void {
  const anchors = readSectionAnchors(contentType);
  if (Object.keys(anchors.aliases).length === 0) return;
  const template = mergeSingleTemplate(contentType, locale, undefined, undefined, contentRoot);
  const ids = new Set<string>(
    Array.isArray(template?.sections)
      ? (template!.sections as Record<string, unknown>[]).flatMap((s) => sectionIdCandidates(s))
      : [],
  );
  const stale = Object.keys(anchors.aliases).filter((k) => ids.has(k));
  if (stale.length === 0) return;
  for (const k of stale) delete anchors.aliases[k];
  writeSectionAnchors(contentType, anchors);
}

/**
 * Whole page for an entry that owns its layout (no shared template, or detached):
 * type layout defaults + entry `_common.yml` + `{locale}.yml`, or `{variant}.{locale}.yml`
 * when a variant is requested (the variant is the whole page; missing → null, never live).
 */
export function mergeEntryOwnedPage(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
  entryVariant?: string,
): Record<string, unknown> | null {
  const resolvedRoot = contentRoot ?? getDefaultContentRoot();
  const typeDir = path.join(resolvedRoot, getFolder(contentType, resolvedRoot));
  const entryDir = path.join(typeDir, slug);
  const localePath = path.join(entryDir, entryVariant ? `${entryVariant}.${locale}.yml` : `${locale}.yml`);
  if (!fs.existsSync(localePath)) return null;
  const localeData = contentIndex.safeYamlLoad(fs.readFileSync(localePath, "utf-8"));
  if (!localeData) return null;

  let base: Record<string, unknown> = {};
  for (const layerPath of [resolveCommonTemplatePath(typeDir), path.join(entryDir, "_common.yml")]) {
    if (!fs.existsSync(layerPath)) continue;
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(layerPath, "utf-8"));
    if (parsed) base = Object.keys(base).length > 0 ? deepMerge(base, parsed) : parsed;
  }
  const merged: Record<string, unknown> =
    Object.keys(base).length > 0 ? deepMerge(base, stripDraftMeta(localeData)) : { ...stripDraftMeta(localeData) };
  delete merged.detached;
  return applySectionLayoutDefaults(merged);
}

/**
 * True when a static shared-layout entry has a live `{slug}/{locale}.yml`.
 * Used by public delivery so missing slugs 404 instead of serving the empty
 * `template.*.yml` shell.
 */
export function hasStaticSharedLayoutEntryLocale(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
): boolean {
  const resolvedRoot = contentRoot ?? getDefaultContentRoot();
  const folder = getFolder(contentType, resolvedRoot);
  const entryLocalePath = path.join(resolvedRoot, folder, slug, `${locale}.yml`);
  return fs.existsSync(entryLocalePath);
}

type RowsFilterField = {
  field: string;
  filters: RowsFilter[];
};

const EMPTY_ROWS_BUCKET: readonly Record<string, unknown>[] = Object.freeze([]);

function rowsFilterCell(item: Record<string, unknown>, key: string): string {
  const value = item[key];
  if (value == null || typeof value === "object") return "";
  return String(value).trim();
}

function rowsFilterBucketKey(
  item: Record<string, unknown>,
  filters: RowsFilter[],
  side: "rows" | "current",
): string | null {
  const parts: string[] = [];
  for (const filter of filters) {
    const slug = side === "rows" ? filter.rows_property_slug : filter.value_from_current_row;
    const text = rowsFilterCell(item, slug);
    if (!text) return null;
    parts.push(text);
  }
  return parts.join("\0");
}

function attachRowsFilterField(
  items: Record<string, unknown>[],
  spec: RowsFilterField,
  contentType?: string,
): { field: string; values: unknown[] } {
  const values: unknown[] = new Array(items.length);
  if (spec.filters.length === 0) {
    values.fill(EMPTY_ROWS_BUCKET);
    return { field: spec.field, values };
  }

  const buckets = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const key = rowsFilterBucketKey(item, spec.filters, "rows");
    if (!key) continue;
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }

  const frozen = new Map<string, readonly Record<string, unknown>[]>();
  for (const [key, list] of buckets) {
    if (list.length > ROWS_FILTER_MAX) {
      log.warn(
        `[rows_filters] ${contentType ? contentType + "." : ""}${spec.field} matched ${list.length} rows (max ${ROWS_FILTER_MAX}); field left empty`,
      );
      frozen.set(key, EMPTY_ROWS_BUCKET);
    } else {
      frozen.set(key, Object.freeze(list.slice()));
    }
  }

  for (let i = 0; i < items.length; i++) {
    const key = rowsFilterBucketKey(items[i]!, spec.filters, "current");
    values[i] = key ? (frozen.get(key) ?? EMPTY_ROWS_BUCKET) : EMPTY_ROWS_BUCKET;
  }
  return { field: spec.field, values };
}

/**
 * Fill rows_filters fields from the full cache, before content-type functions.
 * One group shares one frozen array. More than 50 rows, or an empty current-row
 * column, stores `[]`. Cache rows are not mutated.
 */
export function applyRowsFilterFields(
  items: Record<string, unknown>[],
  fields: RowsFilterField[],
  context?: { contentType?: string },
): Record<string, unknown>[] {
  if (fields.length === 0) return items;
  const attached = fields.map((spec) => attachRowsFilterField(items, spec, context?.contentType));
  return items.map((item, index) => {
    const next: Record<string, unknown> = { ...item };
    for (const field of attached) next[field.field] = field.values[index];
    return next;
  });
}

/**
 * Apply the content type's field mapping and reserved aliases (slug, locale,
 * image, updated_at) to database items that already went through the
 * database-level mapping. Pure: no network, no writes.
 */
export function mapDatabaseItemsForEntry(
  items: Record<string, unknown>[],
  contentType: string,
  contentRoot: string,
): Record<string, unknown>[] {
  const lookupKey = getLookupKey(contentType, contentRoot) || "slug";
  const fieldMapping = getFieldMapping(contentType, contentRoot);
  const fullMapping = getFullFieldMapping(contentType, contentRoot);
  const rowsFields = getRowsFilterFields(contentType, contentRoot);

  if (
    !fieldMapping &&
    rowsFields.length === 0 &&
    !fullMapping?.[RESERVED_IMAGE_FIELD] &&
    !fullMapping?.[RESERVED_SLUG_FIELD] &&
    !fullMapping?.[RESERVED_UPDATED_AT_FIELD]
  ) {
    return items;
  }

  const enriched = applyRowsFilterFields(items, rowsFields, { contentType });

  return enriched.map((item) => {
    const mapped: Record<string, unknown> = { ...item };
    const itemSlug = String(item[lookupKey] ?? item.slug ?? "unknown");
    if (fieldMapping) {
      for (const [targetField, sourcePath] of Object.entries(fieldMapping)) {
        const value = resolveFieldValue(sourcePath, item, targetField, {
          contentType,
          slug: itemSlug,
          fieldPath: targetField,
        });
        if (value !== undefined) mapped[targetField] = value;
      }
    }
    const slugMapSource = fullMapping?.[RESERVED_SLUG_FIELD];
    if (slugMapSource) {
      const slugValue = resolveFieldValue(slugMapSource, item, RESERVED_SLUG_FIELD, {
        contentType,
        slug: itemSlug,
        fieldPath: RESERVED_SLUG_FIELD,
      });
      applySlugAliasToEntry(mapped, slugValue);
    }
    const localeMapSource = fullMapping?.[RESERVED_LOCALE_FIELD];
    if (localeMapSource) {
      const localeValue = resolveFieldValue(localeMapSource, item, RESERVED_LOCALE_FIELD, {
        contentType,
        slug: itemSlug,
        fieldPath: RESERVED_LOCALE_FIELD,
      });
      applyLocaleAliasToEntry(mapped, localeValue);
    }
    const imageSource = fullMapping?.[RESERVED_IMAGE_FIELD];
    if (imageSource) {
      const imageValue = resolveFieldValue(imageSource, item, RESERVED_IMAGE_FIELD, {
        contentType,
        slug: itemSlug,
        fieldPath: RESERVED_IMAGE_FIELD,
      });
      applyImageAliasToEntry(mapped, imageValue);
    }
    const updatedAtSource = fullMapping?.[RESERVED_UPDATED_AT_FIELD];
    if (updatedAtSource) {
      const updatedAtValue = resolveFieldValue(updatedAtSource, item, RESERVED_UPDATED_AT_FIELD, {
        contentType,
        slug: itemSlug,
        fieldPath: RESERVED_UPDATED_AT_FIELD,
      });
      applyUpdatedAtAliasToEntry(mapped, updatedAtValue);
    }
    const iso = resolveEntryUpdatedAt({
      contentType,
      slug: itemSlug,
      locale: String(mapped.locale || item.locale || ""),
      record: mapped,
      contentRoot,
      isDb: true,
    });
    applyUpdatedAtAliasToEntry(mapped, iso);
    return mapped;
  });
}

/** Item for `slug` in `locale`; falls back to any item with that slug. */
export function findDatabaseItemForEntry(
  items: Record<string, unknown>[],
  contentType: string,
  slug: string,
  locale: string,
  contentRoot: string,
): Record<string, unknown> | undefined {
  const lookupKey = getLookupKey(contentType, contentRoot) || "slug";
  const localeKey = getLocaleKey(contentType, contentRoot);
  const localeSource = getLocaleSource(contentType, contentRoot);

  if (localeKey) {
    const normalizedLocale = localeSource
      ? applyTransformIfNeeded(localeSource, locale)
      : locale;
    const exact = items.find((item) => {
      const itemLocale = String(item[localeKey] || "");
      const normalizedItemLocale = localeSource
        ? applyTransformIfNeeded(localeSource, itemLocale)
        : itemLocale;
      return item[lookupKey] === slug && normalizedItemLocale === normalizedLocale;
    });
    if (exact) return exact;
  }
  return items.find((item) => item[lookupKey] === slug);
}
