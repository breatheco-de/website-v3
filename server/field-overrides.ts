/**
 * Content-type mapped field writes.
 *
 * - DB-backed CT level → YAML `field_overrides` bag on the layer file
 * - Static (no database) → top-level keys on the layer file (live or variant)
 * Precedence at render: field_overrides > DB overrides.json > original DB / entry YAML.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { escapeObjectVars, unescapeYamlDump } from "@shared/templateVars";
import { getLegacySingleVarWriteError } from "@shared/entryTemplateVars";
import { coerceEditorSelectScalar } from "@shared/editor-field-values";
import {
  getFolder,
  getContentTypeConfig,
  getFieldMapping,
  getFullFieldMapping,
  getLocaleKey,
  getLookupKey,
  RESERVED_IMAGE_FIELD,
  IMAGE_ALIAS_FIELD,
  RESERVED_SLUG_FIELD,
  SLUG_ALIAS_FIELD,
  KNOWN_SPECIAL_FIELDS,
  RESERVED_PUBLISHED_AT_FIELD,
  KNOWN_SEO_FIELDS,
  isKnownSeoFieldPath,
  isSeoDbMappingKey,
  seoFieldFromPath,
  type ContentTypeEditorHint,
} from "./content-types";
import { getDefaultContentRoot } from "./site-config";
import { contentIndex } from "./content-index";
import { markFileAsModified } from "./sync-state";
import { resolveFieldValue } from "./transform";
import type { DatabaseManager } from "./database";
import { ecommerceManager, PURCHASABLE_FIELD } from "./ecommerce/ecommerce-manager";
import { isPublishedAtEmpty, setPublishedAt } from "./published-at";
import { applyEditorialStampToPendingUpdates } from "./editorial-updated-at";
import { assertLiveEntrySeoAndRequiredFields } from "./live-entry-seo-gate";
import { writeSeoFields } from "./seo-index";
import { readSeoBlockFromYamlText } from "./seo-fields";
import { resolveEffectiveSeo, seoBaselineFromDbItem } from "./seo-effective-seo";
import {
  DEFAULT_DRAFT_VARIANT,
  getEntryContentDir,
  hasLiveLocaleFile,
} from "./draft-entry";

export const FIELD_OVERRIDES_KEY = "field_overrides";

/** Editor types that must persist as plain string scalars on disk. */
const STRING_EDITOR_TYPES = new Set([
  "select",
  "text",
  "textarea",
  "markdown",
  "image",
  "pdf",
]);

function isStringEditorType(type: unknown): boolean {
  return typeof type === "string" && STRING_EDITOR_TYPES.has(type);
}

/**
 * Coerce a mapped-field value for string-shaped editor types to a scalar string.
 * Unwraps `{ slug }` (legacy URL category shape). Empty → empty string.
 */
export function normalizeStringSelectForRoot(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const scalar = coerceEditorSelectScalar(value);
  if (typeof value === "string" && !value.trim()) return value;
  return scalar;
}

/** @deprecated Use {@link normalizeStringSelectForRoot} — kept for older imports. */
export const normalizeCategoryForRoot = normalizeStringSelectForRoot;

function coerceUpdatesForStringEditorFields(
  updates: Record<string, unknown | null>,
  editor: Record<string, ContentTypeEditorHint> | undefined,
): void {
  if (!editor) return;
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined) continue;
    const hint = editor[key];
    if (!isStringEditorType(hint?.type)) continue;
    updates[key] = normalizeStringSelectForRoot(value) as string;
  }
}

export type MappedFieldStorage = "root_key" | "field_overrides";

export type WriteMappedFieldsResult = {
  success: boolean;
  error?: string;
  statusCode?: number;
  storage?: MappedFieldStorage;
  /** Repo-relative path written (when successful). */
  relativePath?: string;
  /** Absolute path written (when successful). */
  filePath?: string;
  /** True when writing a non-live variant/draft layer. */
  isVariantLayer?: boolean;
  noop?: boolean;
};

function safeYamlDump(obj: unknown, opts?: yaml.DumpOptions): string {
  const { escaped, map } = escapeObjectVars(obj);
  return unescapeYamlDump(yaml.dump(escaped, opts), map);
}

export type FieldOverrideSource =
  | "original"
  | "db_override"
  | "ct_override"
  | "entry_default"
  | "system";

export type FieldProvenance = {
  field: string;
  effective: unknown;
  source: FieldOverrideSource;
  baseline?: unknown;
  db_value?: unknown;
  ct_value?: unknown;
      calculated?: boolean;
  /** False for computed system fields (e.g. purchasable). */
  writable?: boolean;
  /** True when the field key exists as a root key (or leftover FO) on the layer file. */
  layer_has_key?: boolean;
  /** Platform SEO fields (locale `seo:`), not field_mapping. */
  group?: "seo";
};

function contentRootPath(contentRoot?: string): string {
  const raw = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function toRelativePath(absPath: string, contentRoot?: string): string {
  const root = contentRootPath(contentRoot);
  const rel = path.relative(process.cwd(), absPath);
  if (!rel.startsWith("..")) return rel.split(path.sep).join("/");
  return path.relative(root, absPath).split(path.sep).join("/");
}

export function liveLocaleOverlayPath(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
): string {
  const root = contentRootPath(contentRoot);
  const folder = getFolder(contentType, contentRoot);
  return path.join(root, folder, slug, `${locale}.yml`);
}

/**
 * Resolve which YAML file Fields should read/write.
 * - variant set → `{variant}.{locale}.yml` (must exist when writing with explicit variant)
 * - no variant + live file → `{locale}.yml`
 * - no variant + no live (all-draft) → existing draft/variant file for locale
 */
export function resolveMappedFieldsLayerPath(opts: {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  contentRoot?: string;
  /** When true, missing explicit variant file is an error (write path). */
  requireExists?: boolean;
}): {
  filePath: string;
  fileName: string;
  isVariantLayer: boolean;
  resolvedVariant: string | null;
  error?: string;
  statusCode?: number;
} {
  const { contentType, slug, locale, contentRoot } = opts;
  const variant =
    typeof opts.variant === "string" && opts.variant.trim() && opts.variant.trim() !== "default"
      ? opts.variant.trim()
      : null;

  if (slug.includes("/") || contentType.includes("/") || /[^a-z0-9_-]/i.test(locale)) {
    return {
      filePath: "",
      fileName: "",
      isVariantLayer: false,
      resolvedVariant: null,
      error: "Invalid path segment",
      statusCode: 400,
    };
  }
  if (variant && /[^a-z0-9_-]/i.test(variant)) {
    return {
      filePath: "",
      fileName: "",
      isVariantLayer: true,
      resolvedVariant: variant,
      error: "Invalid variant segment",
      statusCode: 400,
    };
  }

  const entryDir = getEntryContentDir(contentType, slug, contentRoot);

  if (variant) {
    const fileName = `${variant}.${locale}.yml`;
    const filePath = path.join(entryDir, fileName);
    if (opts.requireExists !== false && !fs.existsSync(filePath)) {
      return {
        filePath,
        fileName,
        isVariantLayer: true,
        resolvedVariant: variant,
        error: `Variant file not found: ${fileName}`,
        statusCode: 404,
      };
    }
    return { filePath, fileName, isVariantLayer: true, resolvedVariant: variant };
  }

  const liveName = `${locale}.yml`;
  const livePath = path.join(entryDir, liveName);
  if (fs.existsSync(livePath) || hasLiveLocaleFile(entryDir, locale)) {
    return {
      filePath: livePath,
      fileName: liveName,
      isVariantLayer: false,
      resolvedVariant: null,
    };
  }

  // All-draft auto-resolve: prefer draft.{locale}.yml, else any {variant}.{locale}.yml
  const draftName = `${DEFAULT_DRAFT_VARIANT}.${locale}.yml`;
  const draftPath = path.join(entryDir, draftName);
  if (fs.existsSync(draftPath)) {
    return {
      filePath: draftPath,
      fileName: draftName,
      isVariantLayer: true,
      resolvedVariant: DEFAULT_DRAFT_VARIANT,
    };
  }

  if (fs.existsSync(entryDir)) {
    try {
      const match = fs
        .readdirSync(entryDir)
        .find((f) => {
          const m = f.match(new RegExp(`^([a-z0-9-]+)\\.${locale}\\.ya?ml$`, "i"));
          return m && m[1].toLowerCase() !== "single";
        });
      if (match) {
        const m = match.match(new RegExp(`^([a-z0-9-]+)\\.${locale}\\.ya?ml$`, "i"));
        const v = m?.[1] || DEFAULT_DRAFT_VARIANT;
        return {
          filePath: path.join(entryDir, match),
          fileName: match,
          isVariantLayer: true,
          resolvedVariant: v,
        };
      }
    } catch {
      /* ignore */
    }
  }

  if (opts.requireExists !== false) {
    return {
      filePath: livePath,
      fileName: liveName,
      isVariantLayer: false,
      resolvedVariant: null,
      error: `Locale file not found: ${liveName}`,
      statusCode: 404,
    };
  }

  return {
    filePath: livePath,
    fileName: liveName,
    isVariantLayer: false,
    resolvedVariant: null,
  };
}

function readFoBagFromData(entryData: Record<string, unknown>): Record<string, unknown> {
  const fo = entryData[FIELD_OVERRIDES_KEY];
  if (!fo || typeof fo !== "object" || Array.isArray(fo)) return {};
  return { ...(fo as Record<string, unknown>) };
}

export function readFieldOverrides(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
  variant?: string | null,
): Record<string, unknown> {
  const resolved = resolveMappedFieldsLayerPath({
    contentType,
    slug,
    locale,
    variant,
    contentRoot,
    requireExists: false,
  });
  if (!resolved.filePath || !fs.existsSync(resolved.filePath)) return {};
  try {
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(resolved.filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object") return {};
    return readFoBagFromData(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

/** Root keys present on the layer file (excluding structural keys). */
export function readLayerRootKeys(
  contentType: string,
  slug: string,
  locale: string,
  contentRoot?: string,
  variant?: string | null,
): Set<string> {
  const resolved = resolveMappedFieldsLayerPath({
    contentType,
    slug,
    locale,
    variant,
    contentRoot,
    requireExists: false,
  });
  const keys = new Set<string>();
  if (!resolved.filePath || !fs.existsSync(resolved.filePath)) return keys;
  try {
    const parsed = contentIndex.safeYamlLoad(fs.readFileSync(resolved.filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return keys;
    for (const k of Object.keys(parsed as Record<string, unknown>)) {
      if (k === FIELD_OVERRIDES_KEY || k === "sections" || k === "meta" || k === "settings") continue;
      keys.add(k);
    }
    const fo = readFoBagFromData(parsed as Record<string, unknown>);
    for (const k of Object.keys(fo)) keys.add(k);
  } catch {
    /* ignore */
  }
  return keys;
}

export function applyFieldOverridesToItem(
  item: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  if (!overrides || Object.keys(overrides).length === 0) return item;
  return { ...item, ...overrides };
}

function writeDbFieldOverridesBag(
  filePath: string,
  entryData: Record<string, unknown>,
  pendingUpdates: Record<string, unknown | null>,
  author?: string,
  contentRoot?: string,
): WriteMappedFieldsResult {
  const existing = readFoBagFromData(entryData);

  for (const [key, value] of Object.entries(pendingUpdates)) {
    if (value === null || value === undefined) {
      delete existing[key];
    } else {
      existing[key] = value;
    }
  }

  if (Object.keys(existing).length === 0) {
    delete entryData[FIELD_OVERRIDES_KEY];
  } else {
    entryData[FIELD_OVERRIDES_KEY] = existing;
  }

  fs.writeFileSync(filePath, safeYamlDump(entryData, { lineWidth: -1, noRefs: true }), "utf-8");
  markFileAsModified(filePath, author, undefined, contentRoot);
  return {
    success: true,
    storage: "field_overrides",
    relativePath: toRelativePath(filePath, contentRoot),
    filePath,
  };
}

function writeStaticRootKeysBag(
  filePath: string,
  entryData: Record<string, unknown>,
  pendingUpdates: Record<string, unknown | null>,
  author?: string,
  contentRoot?: string,
): WriteMappedFieldsResult {
  const fo = readFoBagFromData(entryData);

  for (const [key, value] of Object.entries(pendingUpdates)) {
    if (value === null || value === undefined) {
      delete entryData[key];
    } else {
      entryData[key] = value;
    }
    // Clear matching leftover FO so it cannot shadow root
    delete fo[key];
  }

  if (Object.keys(fo).length === 0) {
    delete entryData[FIELD_OVERRIDES_KEY];
  } else {
    entryData[FIELD_OVERRIDES_KEY] = fo;
  }

  fs.writeFileSync(filePath, safeYamlDump(entryData, { lineWidth: -1, noRefs: true }), "utf-8");
  markFileAsModified(filePath, author, undefined, contentRoot);
  return {
    success: true,
    storage: "root_key",
    relativePath: toRelativePath(filePath, contentRoot),
    filePath,
  };
}

/**
 * Unified CT-level field writer (static root keys vs DB field_overrides bag).
 */
export function writeMappedFields(
  contentType: string,
  slug: string,
  locale: string,
  updates: Record<string, unknown | null>,
  opts?: {
    author?: string;
    contentRoot?: string;
    variant?: string | null;
  },
): WriteMappedFieldsResult {
  const author = opts?.author;
  const contentRoot = opts?.contentRoot;
  const config = getContentTypeConfig(contentType, contentRoot);
  if (!config) {
    return { success: false, error: `Content type "${contentType}" not found`, statusCode: 404 };
  }
  if (Object.prototype.hasOwnProperty.call(updates, PURCHASABLE_FIELD)) {
    return {
      success: false,
      error:
        "purchasable is a computed system field (from _ecommerce.yml). Do not write it on the entry. Edit programs/{slug}/_ecommerce.yml or use get_product_funnel / update_product_funnel.",
      statusCode: 400,
    };
  }
  const isStatic = !config.database?.slug;

  const pendingUpdates: Record<string, unknown | null> = { ...updates };
  coerceUpdatesForStringEditorFields(
    pendingUpdates,
    config.editor as Record<string, ContentTypeEditorHint> | undefined,
  );

  const legacySingleErr = getLegacySingleVarWriteError(pendingUpdates);
  if (legacySingleErr) {
    return { success: false, error: legacySingleErr, statusCode: 400 };
  }

  const layer = resolveMappedFieldsLayerPath({
    contentType,
    slug,
    locale,
    variant: opts?.variant,
    contentRoot,
    requireExists: true,
  });
  if (layer.error) {
    return {
      success: false,
      error: layer.error,
      statusCode: layer.statusCode || 404,
      isVariantLayer: layer.isVariantLayer,
    };
  }

  const filePath = layer.filePath;

  const seoUpdates: Record<string, unknown> = {};
  for (const key of Object.keys(pendingUpdates)) {
    if (!isKnownSeoFieldPath(key) && key !== "seo.pillar") continue;
    const field = key === "seo.pillar" ? "pillar_path" : seoFieldFromPath(key);
    if (field) seoUpdates[field] = pendingUpdates[key];
    delete pendingUpdates[key];
  }
  if (Object.keys(seoUpdates).length > 0) {
    const seoResult = writeSeoFields({
      contentType,
      slug,
      locale,
      updates: seoUpdates,
      author,
      contentRoot,
      variant: opts?.variant,
    });
    if (!seoResult.success) {
      return {
        success: false,
        error: seoResult.error,
        statusCode: seoResult.statusCode || 400,
        isVariantLayer: seoResult.statusCode === 404 ? undefined : layer.isVariantLayer,
      };
    }
    if (Object.keys(pendingUpdates).length === 0) {
      return {
        success: true,
        storage: "root_key",
        relativePath: seoResult.relativePath,
        filePath: seoResult.filePath,
        isVariantLayer: seoResult.isVariantLayer,
      };
    }
  }

  // Relation fields (and other common-only keys) always land on `_common.yml` for static types.
  const commonOnlyUpdates: Record<string, unknown | null> = {};
  if (isStatic && config.editor) {
    for (const [key, hint] of Object.entries(config.editor)) {
      if (hint?.type !== "relation") continue;
      if (!Object.prototype.hasOwnProperty.call(pendingUpdates, key)) continue;
      commonOnlyUpdates[key] = pendingUpdates[key] ?? null;
      // Clear from locale layer so it cannot shadow common
      pendingUpdates[key] = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(pendingUpdates, RESERVED_PUBLISHED_AT_FIELD)) {
    const pubVal = pendingUpdates[RESERVED_PUBLISHED_AT_FIELD];
    if (pubVal === null || pubVal === undefined || isPublishedAtEmpty(pubVal)) {
      return {
        success: false,
        error: "published_at cannot be cleared; set a non-empty datetime to backdate.",
        statusCode: 400,
      };
    }
    if (isStatic) {
      const written = setPublishedAt(contentType, slug, String(pubVal), author, contentRoot);
      if (!written.success) {
        return {
          success: false,
          error: written.error || "Failed to write published_at",
          statusCode: 400,
        };
      }
      pendingUpdates[RESERVED_PUBLISHED_AT_FIELD] = null;
    }
  }

  try {
    const entryDir = path.dirname(filePath);
    if (!fs.existsSync(entryDir)) {
      return {
        success: false,
        error: `Entry directory not found`,
        statusCode: 404,
        isVariantLayer: layer.isVariantLayer,
      };
    }

    let entryData: Record<string, unknown> = {};
    if (fs.existsSync(filePath)) {
      entryData = (contentIndex.safeYamlLoad(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>) || {};
    }

    const foForGate = isStatic
      ? (() => {
          const next = { ...entryData };
          for (const [k, v] of Object.entries(pendingUpdates)) {
            if (v === null || v === undefined) delete next[k];
            else next[k] = v;
          }
          const leftover = readFoBagFromData(entryData);
          for (const k of Object.keys(pendingUpdates)) delete leftover[k];
          return applyFieldOverridesToItem(next, leftover);
        })()
      : (() => {
          const existing = readFoBagFromData(entryData);
          for (const [k, v] of Object.entries(pendingUpdates)) {
            if (v === null || v === undefined) delete existing[k];
            else existing[k] = v;
          }
          return applyFieldOverridesToItem(
            { ...(contentIndex.loadCommonData(contentType, slug) || {}), ...entryData },
            existing,
          );
        })();

    const commonPath = path.join(path.dirname(filePath), "_common.yml");
    let commonForGate: Record<string, unknown> = {};
    if (fs.existsSync(commonPath)) {
      try {
        commonForGate =
          (contentIndex.safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown>) ||
          {};
      } catch {
        commonForGate = {};
      }
    } else {
      commonForGate = contentIndex.loadCommonData(contentType, slug) || {};
    }
    for (const [k, v] of Object.entries(commonOnlyUpdates)) {
      if (v === null || v === undefined) delete commonForGate[k];
      else commonForGate[k] = v;
    }
    const pageForGate = isStatic
      ? { ...commonForGate, ...foForGate }
      : foForGate;

    const touchedPaths = [
      ...Object.keys(pendingUpdates),
      ...Object.keys(commonOnlyUpdates),
    ];
    const seoGateErr = assertLiveEntrySeoAndRequiredFields({
      contentType,
      slug,
      locale,
      pageData: pageForGate,
      contentRoot,
      mode: "live_update",
      intent: "micro",
      touchedPaths,
      isDraftWrite: layer.isVariantLayer,
    });
    if (seoGateErr) {
      return { success: false, error: seoGateErr, statusCode: 400, isVariantLayer: layer.isVariantLayer };
    }

    if (isStatic && Object.keys(commonOnlyUpdates).length > 0) {
      const commonPath = path.join(path.dirname(filePath), "_common.yml");
      try {
        let commonData: Record<string, unknown> = {};
        if (fs.existsSync(commonPath)) {
          commonData =
            (contentIndex.safeYamlLoad(fs.readFileSync(commonPath, "utf-8")) as Record<
              string,
              unknown
            >) || {};
        }
        for (const [k, v] of Object.entries(commonOnlyUpdates)) {
          if (v === null || v === undefined) delete commonData[k];
          else commonData[k] = v;
        }
        fs.mkdirSync(path.dirname(commonPath), { recursive: true });
        fs.writeFileSync(commonPath, safeYamlDump(commonData, { lineWidth: -1, noRefs: true }), "utf-8");
        markFileAsModified(commonPath, author, undefined, contentRoot);
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          statusCode: 500,
          isVariantLayer: layer.isVariantLayer,
        };
      }
    }

    applyEditorialStampToPendingUpdates({
      pendingUpdates,
      entryData,
      contentType,
      slug,
      contentRoot,
    });

    const written = isStatic
      ? writeStaticRootKeysBag(filePath, entryData, pendingUpdates, author, contentRoot)
      : writeDbFieldOverridesBag(filePath, entryData, pendingUpdates, author, contentRoot);

    return { ...written, isVariantLayer: layer.isVariantLayer };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      statusCode: 500,
      isVariantLayer: layer.isVariantLayer,
    };
  }
}

/**
 * @deprecated Prefer writeMappedFields — kept for callers that always mean the FO bag / live path.
 */
export function writeFieldOverrides(
  contentType: string,
  slug: string,
  locale: string,
  updates: Record<string, unknown | null>,
  author?: string,
  contentRoot?: string,
): { success: boolean; error?: string } {
  const r = writeMappedFields(contentType, slug, locale, updates, { author, contentRoot });
  return { success: r.success, error: r.error };
}

export function clearFieldOverride(
  contentType: string,
  slug: string,
  locale: string,
  field: string,
  author?: string,
  contentRoot?: string,
  variant?: string | null,
): WriteMappedFieldsResult {
  return writeMappedFields(contentType, slug, locale, { [field]: null }, { author, contentRoot, variant });
}

/**
 * Static reset: delete root key on layer file only if present; no-op if only on _common.
 */
export function resetStaticMappedField(opts: {
  contentType: string;
  slug: string;
  locale: string;
  field: string;
  author?: string;
  contentRoot?: string;
  variant?: string | null;
}): WriteMappedFieldsResult {
  const { contentType, slug, locale, field, author, contentRoot, variant } = opts;
  if (field === RESERVED_PUBLISHED_AT_FIELD) {
    return {
      success: false,
      error: "published_at cannot be reset or cleared; set a non-empty datetime to backdate.",
      statusCode: 400,
    };
  }

  const layer = resolveMappedFieldsLayerPath({
    contentType,
    slug,
    locale,
    variant,
    contentRoot,
    requireExists: true,
  });
  if (layer.error) {
    return { success: false, error: layer.error, statusCode: layer.statusCode || 404 };
  }

  if (!fs.existsSync(layer.filePath)) {
    return {
      success: false,
      error: `Locale file not found: ${layer.fileName}`,
      statusCode: 404,
    };
  }

  const entryData =
    (contentIndex.safeYamlLoad(fs.readFileSync(layer.filePath, "utf-8")) as Record<string, unknown>) ||
    {};
  const fo = readFoBagFromData(entryData);
  const hasRoot = Object.prototype.hasOwnProperty.call(entryData, field);
  const hasFo = Object.prototype.hasOwnProperty.call(fo, field);

  if (!hasRoot && !hasFo) {
    return {
      success: true,
      noop: true,
      storage: "root_key",
      relativePath: toRelativePath(layer.filePath, contentRoot),
      filePath: layer.filePath,
      isVariantLayer: layer.isVariantLayer,
      error: `Nothing to reset on ${layer.fileName} — "${field}" is not set on this layer (may come from _common.yml).`,
    };
  }

  return writeMappedFields(contentType, slug, locale, { [field]: null }, { author, contentRoot, variant });
}

/**
 * Flatten field_overrides bag into root keys on a locale/variant YAML file.
 * String-shaped editor fields (select/text/…) are stored as scalar strings.
 */
export function flattenFieldOverridesInFile(
  absPath: string,
  author?: string,
  contentRoot?: string,
  contentType?: string,
): { success: boolean; error?: string; changed: boolean } {
  if (!fs.existsSync(absPath)) {
    return { success: false, error: "File not found", changed: false };
  }
  try {
    const entryData =
      (contentIndex.safeYamlLoad(fs.readFileSync(absPath, "utf-8")) as Record<string, unknown>) || {};
    const fo = readFoBagFromData(entryData);
    if (Object.keys(fo).length === 0) {
      return { success: true, changed: false };
    }

    let editor: Record<string, ContentTypeEditorHint> | undefined;
    const resolvedType =
      contentType ||
      (() => {
        if (!contentRoot) return undefined;
        const rootAbs = path.isAbsolute(contentRoot)
          ? contentRoot
          : path.join(process.cwd(), contentRoot);
        const rel = path.relative(rootAbs, absPath);
        const folder = rel.split(/[/\\]/)[0];
        if (!folder) return undefined;
        if (getContentTypeConfig(folder, contentRoot)) return folder;
        return undefined;
      })();
    if (resolvedType) {
      editor = getContentTypeConfig(resolvedType, contentRoot)?.editor as
        | Record<string, ContentTypeEditorHint>
        | undefined;
    }

    for (const [key, value] of Object.entries(fo)) {
      const hint = editor?.[key];
      entryData[key] = isStringEditorType(hint?.type)
        ? normalizeStringSelectForRoot(value)
        : value;
    }
    delete entryData[FIELD_OVERRIDES_KEY];
    fs.writeFileSync(absPath, safeYamlDump(entryData, { lineWidth: -1, noRefs: true }), "utf-8");
    markFileAsModified(absPath, author, undefined, contentRoot);
    return { success: true, changed: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      changed: false,
    };
  }
}

function isFunctionMapping(source: unknown): boolean {
  return typeof source === "string" && source.startsWith("function:");
}

function mappingSourceString(
  source: string | { source: string; default: string } | undefined,
): string | undefined {
  if (!source) return undefined;
  if (typeof source === "string") return source;
  return source.source;
}

/**
 * Build provenance rows for the SEO Fields tab.
 */
export async function buildFieldProvenance(opts: {
  contentType: string;
  slug: string;
  locale: string;
  contentRoot?: string;
  db: DatabaseManager;
  variant?: string | null;
}): Promise<{
  hasDatabase: boolean;
  fields: FieldProvenance[];
  layerFileName?: string;
  isVariantLayer?: boolean;
  resolvedVariant?: string | null;
  canonicalPath?: string | null;
  indexRebuilt?: boolean;
  seoFileMissing?: boolean;
}> {
  const { contentType, slug, locale, contentRoot, db, variant } = opts;
  const config = getContentTypeConfig(contentType, contentRoot);
  if (!config) {
    throw new Error(`Content type "${contentType}" not found`);
  }

  const layer = resolveMappedFieldsLayerPath({
    contentType,
    slug,
    locale,
    variant,
    contentRoot,
    requireExists: false,
  });

  const fmRegular = getFieldMapping(contentType, contentRoot) || {};
  const fmFull = getFullFieldMapping(contentType, contentRoot) || {};
  const editorKeys = Object.keys(config.editor || {}).filter(
    (k) => k !== IMAGE_ALIAS_FIELD && k !== SLUG_ALIAS_FIELD && !k.startsWith("_"),
  );
  const mappingKeys = Object.keys(fmRegular).filter(
    (k) =>
      !k.startsWith("_") &&
      k !== IMAGE_ALIAS_FIELD &&
      k !== SLUG_ALIAS_FIELD &&
      !isSeoDbMappingKey(k),
  );
  const specialKeys = KNOWN_SPECIAL_FIELDS.filter((k) => k in fmFull || true);
  const fieldKeys = Array.from(new Set([...specialKeys, ...mappingKeys, ...editorKeys]));

  const ctOverrides = readFieldOverrides(contentType, slug, locale, contentRoot, variant);
  const layerKeys = readLayerRootKeys(contentType, slug, locale, contentRoot, variant);
  const hasDatabase = !!config.database?.slug;
  const dbName = config.database?.slug;

  let dbOverrides: Record<string, unknown> = {};
  let originalItem: Record<string, unknown> | null = null;
  let mappedItem: Record<string, unknown> | null = null;
  let staticPageData: Record<string, unknown> | null = null;

  if (hasDatabase && dbName && db.exists(dbName)) {
    const lookupKey = getLookupKey(contentType, contentRoot) || "slug";
    const rawDbOvr = db.getDbOverridesForEntry(dbName, slug) || {};
    const reverseMap: Record<string, string> = {};
    for (const [templateKey, dbPath] of Object.entries(fmRegular)) {
      if (typeof dbPath === "string" && !dbPath.startsWith("function:") && !templateKey.startsWith("_")) {
        const clean = dbPath.startsWith("?") ? dbPath.slice(1) : dbPath;
        reverseMap[clean] = templateKey;
      }
    }
    for (const [dbKey, value] of Object.entries(rawDbOvr)) {
      const templateKey = reverseMap[dbKey] || dbKey;
      dbOverrides[templateKey] = value;
    }

    originalItem = db.getOriginalMappedItem(dbName, slug, lookupKey);

    const cached = await db.fetchItems(dbName);
    const items = cached.items as Record<string, unknown>[];
    mappedItem = items.find((i) => String(i[lookupKey] ?? "") === slug) ?? null;
  } else if (!hasDatabase) {
    const { data } = contentIndex.loadMergedContent(
      contentType,
      slug,
      locale,
      layer.resolvedVariant || undefined,
    );
    if (data && typeof data === "object" && !Array.isArray(data)) {
      staticPageData = data as Record<string, unknown>;
    }
  }

  const fields: FieldProvenance[] = [];

  for (const field of fieldKeys) {
    const sourceRaw = mappingSourceString(fmFull[field] ?? fmRegular[field]);
    const calculated = isFunctionMapping(sourceRaw);
    const isSpecial = field.startsWith("_");

    const ctValue = Object.prototype.hasOwnProperty.call(ctOverrides, field)
      ? ctOverrides[field]
      : undefined;
    const hasCt = ctValue !== undefined && !isSpecial;

    const dbValue = Object.prototype.hasOwnProperty.call(dbOverrides, field)
      ? dbOverrides[field]
      : undefined;
    const hasDb = dbValue !== undefined && !isSpecial;

    let baseline: unknown;
    if (hasDatabase && originalItem) {
      const dbPath = sourceRaw?.startsWith("?") ? sourceRaw.slice(1) : sourceRaw;
      baseline =
        (dbPath && !isFunctionMapping(dbPath) ? originalItem[dbPath] : undefined) ??
        originalItem[field];
      if (field === RESERVED_IMAGE_FIELD && baseline === undefined) {
        baseline = originalItem[IMAGE_ALIAS_FIELD];
      }
      if (field === RESERVED_SLUG_FIELD && baseline === undefined) {
        baseline = originalItem[SLUG_ALIAS_FIELD];
      }
    } else if (!hasDatabase && staticPageData && sourceRaw && !calculated) {
      baseline = resolveFieldValue(sourceRaw, staticPageData, field);
    } else if (!hasDatabase && staticPageData && field === RESERVED_IMAGE_FIELD && !sourceRaw) {
      baseline = staticPageData[IMAGE_ALIAS_FIELD];
    } else if (!hasDatabase && staticPageData && field === RESERVED_SLUG_FIELD && !sourceRaw) {
      baseline = staticPageData[SLUG_ALIAS_FIELD];
    }

    let effective: unknown;
    let source: FieldOverrideSource;

    if (hasCt) {
      effective = ctValue;
      source = "ct_override";
    } else if (hasDb) {
      effective = dbValue;
      source = "db_override";
    } else if (hasDatabase) {
      effective =
        (field === RESERVED_IMAGE_FIELD
          ? mappedItem?.[IMAGE_ALIAS_FIELD] ?? mappedItem?.[field]
          : field === RESERVED_SLUG_FIELD
            ? mappedItem?.[SLUG_ALIAS_FIELD] ?? mappedItem?.[field]
            : mappedItem?.[field]) ?? baseline;
      source = "original";
    } else {
      effective = baseline;
      source = "entry_default";
    }

    const row: FieldProvenance = {
      field,
      effective,
      source,
      calculated: calculated || undefined,
      layer_has_key: layerKeys.has(field) || undefined,
    };
    if (hasDatabase || baseline !== undefined) row.baseline = baseline;
    if (hasDb) row.db_value = dbValue;
    if (hasCt) row.ct_value = ctValue;
    fields.push(row);
  }

  if (ecommerceManager.contentTypeHasEcommerce(contentType)) {
    fields.push({
      field: PURCHASABLE_FIELD,
      effective: ecommerceManager.isEntryPurchasable(contentType, slug),
      source: "system",
      calculated: true,
      writable: false,
    });
  }

  const localeAbs = layer.filePath;
  const seoFileMissing = !localeAbs || !fs.existsSync(localeAbs);
  let seoBlock: Record<string, unknown> = {};
  if (!seoFileMissing && localeAbs) {
    try {
      seoBlock = readSeoBlockFromYamlText(fs.readFileSync(localeAbs, "utf-8")) as Record<string, unknown>;
    } catch {
      seoBlock = {};
    }
  }
  const canonicalPath =
    contentIndex.getAlternateUrls(slug, contentType)[locale] ||
    contentIndex.getAlternateUrls(slug, contentType).en ||
    null;

  let seoDbItem: Record<string, unknown> | null = null;
  if (hasDatabase && dbName && db.exists(dbName)) {
    const localeKey = getLocaleKey(contentType, contentRoot) || "locale";
    const loc = locale.toLowerCase();
    const matchLocale = (item: Record<string, unknown>) => {
      const fromItem = item[localeKey] ?? item.locale ?? item.lang;
      return typeof fromItem === "string" && fromItem.trim().toLowerCase() === loc;
    };
    if (mappedItem && matchLocale(mappedItem)) {
      seoDbItem = mappedItem;
    } else if (originalItem && matchLocale(originalItem)) {
      seoDbItem = originalItem;
    } else {
      seoDbItem = mappedItem ?? originalItem;
    }
  }

  const effectiveSeo = resolveEffectiveSeo({
    contentType,
    slug,
    locale,
    contentRoot: contentRoot ?? getDefaultContentRoot(),
    dbItem: seoDbItem,
  });
  const seoBaseline =
    seoDbItem && hasDatabase
      ? seoBaselineFromDbItem(seoDbItem, contentType, contentRoot ?? getDefaultContentRoot())
      : {};

  for (const key of KNOWN_SEO_FIELDS) {
    const fieldPath = `seo.${key}`;
    const hasOverlayKey =
      !seoFileMissing && Object.prototype.hasOwnProperty.call(seoBlock, key);
    const effectiveVal =
      key === "is_pillar"
        ? effectiveSeo.is_pillar === true
        : effectiveSeo[key] === undefined
          ? null
          : effectiveSeo[key];
    const baselineVal =
      key === "is_pillar"
        ? seoBaseline.is_pillar === true
          ? true
          : seoBaseline.is_pillar === false
            ? false
            : undefined
        : seoBaseline[key];
    const source: FieldOverrideSource = hasOverlayKey
      ? "ct_override"
      : hasDatabase
        ? "original"
        : "entry_default";
    const row: FieldProvenance = {
      field: fieldPath,
      effective: effectiveVal,
      source,
      group: "seo",
      writable: !seoFileMissing,
      layer_has_key: hasOverlayKey || undefined,
    };
    if (hasDatabase && baselineVal !== undefined) {
      row.baseline = baselineVal;
    }
    fields.push(row);
  }

  let indexRebuilt = false;
  try {
    const { loadSeoIndex } = await import("./seo-index");
    indexRebuilt = !!loadSeoIndex(contentRoot).rebuilt;
  } catch {
    indexRebuilt = false;
  }

  return {
    hasDatabase,
    fields,
    layerFileName: layer.fileName || undefined,
    isVariantLayer: layer.isVariantLayer,
    resolvedVariant: layer.resolvedVariant,
    canonicalPath: canonicalPath ? String(canonicalPath) : null,
    indexRebuilt,
    seoFileMissing,
  };
}
