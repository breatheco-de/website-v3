/**
 * Pure helpers for MCP translate_entry modes (attached fields vs detached/classic sections).
 */

import type { ContentTypeConfig } from "./content.js";
import { missingRequiredFields, safeTopLevelFieldsForConfig } from "./entry-helpers.js";
import { isEmptyLocaleContent } from "../../shared/isEmptyLocaleContent.js";

export type TranslateMode = "attached_fields" | "detached_sections";

/** Default layer when `variant` is omitted on translate_entry (same as DEFAULT_DRAFT_VARIANT). */
export const TRANSLATE_DEFAULT_VARIANT = "draft";

const VARIANT_SLUG_RE = /^[a-z0-9-]+$/;

/** Reserved / confusing variant names for translate_entry (mirror versioning + live layer). */
const TRANSLATE_FORBIDDEN_VARIANTS = new Set(["live", "template", "single"]);

/**
 * Validate translate_entry variant name. Rejects reserved template/single, confusing `live`,
 * and non kebab-case slugs (versioning API).
 */
export function validateTranslateVariantSlug(
  raw: string,
): { ok: true; variant: string } | { ok: false; code: string; message: string } {
  const variant = raw.trim();
  if (!variant) {
    return {
      ok: false,
      code: "invalid_variant",
      message: "variant must be a non-empty kebab-case slug (e.g. draft, es-copy).",
    };
  }
  if (TRANSLATE_FORBIDDEN_VARIANTS.has(variant)) {
    return {
      ok: false,
      code: "invalid_variant",
      message:
        variant === "live"
          ? 'variant "live" is not allowed (live content is the bare {locale}.yml file, not a variant). Pick draft or another kebab-case name.'
          : `variant "${variant}" is reserved. Pick draft or another kebab-case name.`,
    };
  }
  if (!VARIANT_SLUG_RE.test(variant)) {
    return {
      ok: false,
      code: "invalid_variant",
      message: `variant must match ${VARIANT_SLUG_RE} (lowercase letters, digits, hyphens). Got "${variant}".`,
    };
  }
  return { ok: true, variant };
}

export type VersioningLocaleBlock = {
  variants?: Array<{ slug: string; allocation: number }>;
};

/**
 * Allocation for a locale+variant from versioning.yml data.
 * `null` = unregistered (treat as 0% for merge allowance).
 */
export function readVariantAllocation(
  versioning: Record<string, VersioningLocaleBlock> | null | undefined,
  locale: string,
  variantSlug: string,
): number | null {
  if (!versioning || typeof versioning !== "object") return null;
  const block = versioning[locale];
  const variants = Array.isArray(block?.variants) ? block.variants : [];
  const row = variants.find((v) => v && typeof v.slug === "string" && v.slug === variantSlug);
  if (!row) return null;
  const n = typeof row.allocation === "number" ? row.allocation : Number(row.allocation);
  return Number.isFinite(n) ? n : 0;
}

/** True when merge into an existing variant file is allowed (0% or unregistered). */
export function variantAllowsTranslateMerge(allocation: number | null): boolean {
  return allocation === null || allocation === 0;
}

export function resolveTranslateMode(opts: {
  sharedLayout: boolean;
  detached: boolean;
}): TranslateMode {
  if (opts.sharedLayout && !opts.detached) return "attached_fields";
  return "detached_sections";
}

/** Strip reserved keys; keep meta/sections/fields. slug/url in content are rejected at handler. */
export function splitTranslateContent(raw: Record<string, unknown>): {
  meta?: Record<string, unknown>;
  sections: Record<string, unknown>[] | undefined;
  fields: Record<string, unknown>;
  reservedUrlKeys: string[];
} {
  const reservedUrlKeys: string[] = [];
  if ("slug" in raw && raw.slug !== undefined) reservedUrlKeys.push("content.slug");
  if ("url" in raw && raw.url !== undefined) reservedUrlKeys.push("content.url");

  const { meta, sections, slug: _slug, url: _url, locale: _locale, ...rest } = raw;
  const sectionArr = Array.isArray(sections)
    ? (sections as Record<string, unknown>[])
    : undefined;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (k === "meta" || k === "sections") continue;
    fields[k] = v;
  }
  return {
    meta: meta && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : undefined,
    sections: sectionArr,
    fields,
    reservedUrlKeys,
  };
}

export function filterAllowedFields(
  fields: Record<string, unknown>,
  config: ContentTypeConfig,
): { allowed: Record<string, unknown>; rejected: string[] } {
  const safe = safeTopLevelFieldsForConfig(config);
  const allowed: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (safe.has(k)) allowed[k] = v;
    else rejected.push(k);
  }
  return { allowed, rejected };
}

export type BuildLocaleResult =
  | { ok: true; localeData: Record<string, unknown>; merge: boolean }
  | { ok: false; code: string; message: string };

/**
 * Build target locale YAML for translate_entry (always a non-public variant file).
 * - New variant file: construct from payload (sections [] for attached).
 * - Existing variant: merge fields/meta; preserve unrelated keys and sections unless detached sections replace.
 */
export function buildTranslateLocaleData(opts: {
  mode: TranslateMode;
  /** Resolved locale URL slug (public URL segment). */
  localeUrlSlug: string;
  targetLocale: string;
  meta?: Record<string, unknown>;
  sections?: Record<string, unknown>[];
  allowedFields: Record<string, unknown>;
  /** Existing variant file contents when merging. */
  existing: Record<string, unknown> | null;
  /** True when writing a brand-new variant file (no prior layer, or after empty→draft convert). */
  writeAsDraft: boolean;
  /** True when target path already exists and we should merge rather than replace. */
  mergeIntoExisting: boolean;
}): BuildLocaleResult {
  const {
    mode,
    localeUrlSlug,
    targetLocale,
    meta,
    sections,
    allowedFields,
    existing,
    writeAsDraft,
    mergeIntoExisting,
  } = opts;

  const hasSectionsPayload = Array.isArray(sections);
  const sectionsNonEmpty = hasSectionsPayload && sections!.length > 0;

  if (mode === "attached_fields") {
    if (sectionsNonEmpty) {
      return {
        ok: false,
        code: "shared_layout_sections_must_be_empty",
        message:
          "Attached shared-layout translate must use sections: [] (or omit sections). " +
          "Put translated body in locale fields. For a custom per-entry shell, call set_entry_attachment " +
          'with action: "detach" and confirm: true, then retry translate_entry with sections.',
      };
    }

    if (mergeIntoExisting && existing) {
      const next: Record<string, unknown> = { ...existing, ...allowedFields, slug: localeUrlSlug };
      if (meta && Object.keys(meta).length > 0) {
        const prevMeta =
          existing.meta && typeof existing.meta === "object" && !Array.isArray(existing.meta)
            ? (existing.meta as Record<string, unknown>)
            : {};
        next.meta = { ...prevMeta, ...meta };
      }
      // Preserve legacy sections on attached entries; force [] only when missing
      if (!Array.isArray(next.sections)) next.sections = [];
      if (next.locale === undefined) next.locale = targetLocale;
      return { ok: true, localeData: next, merge: true };
    }

    const localeData: Record<string, unknown> = {
      slug: localeUrlSlug,
      locale: targetLocale,
      ...allowedFields,
      sections: [],
    };
    if (meta && Object.keys(meta).length > 0) localeData.meta = meta;
    return { ok: true, localeData, merge: false };
  }

  // detached_sections / classic
  // Explicit sections: [] on existing non-empty shell — refuse wipe
  if (
    mergeIntoExisting &&
    existing &&
    hasSectionsPayload &&
    !sectionsNonEmpty &&
    Array.isArray(existing.sections) &&
    existing.sections.length > 0
  ) {
    return {
      ok: false,
      code: "detached_sections_clear_rejected",
      message:
        "Refusing to clear sections on a non-empty detached/classic locale. " +
        "Omit sections to merge fields only, or supply a full non-empty sections array.",
    };
  }

  const fieldsOnly =
    !sectionsNonEmpty && Object.keys(allowedFields).length > 0;


  if (mergeIntoExisting && existing && fieldsOnly) {
    const existingSections = existing.sections;
    const hasExistingSections = Array.isArray(existingSections) && existingSections.length > 0;
    if (!hasExistingSections && isEmptyLocaleContent({ ...existing, ...allowedFields })) {
      // Would stay empty — treat like needing sections for new shell
      return {
        ok: false,
        code: "detached_sections_required",
        message:
          "Detached/classic entry has no sections to preserve. Supply a non-empty sections array " +
          "(or non-empty content) for translate_entry.",
      };
    }
    const next: Record<string, unknown> = { ...existing, ...allowedFields, slug: localeUrlSlug };
    // Preserve sections — do not clear
    if (Array.isArray(existing.sections)) next.sections = existing.sections;
    if (meta && Object.keys(meta).length > 0) {
      const prevMeta =
        existing.meta && typeof existing.meta === "object" && !Array.isArray(existing.meta)
          ? (existing.meta as Record<string, unknown>)
          : {};
      next.meta = { ...prevMeta, ...meta };
    }
    return { ok: true, localeData: next, merge: true };
  }

  // Full replace / new draft with sections
  if (!sectionsNonEmpty) {
    const hasContent =
      typeof allowedFields.content === "string" &&
      (allowedFields.content as string).trim().length > 0;
    if (!hasContent && !sectionsNonEmpty) {
      return {
        ok: false,
        code: "detached_sections_required",
        message:
          "Detached/classic translate requires a non-empty sections array " +
          "(or non-empty content field). For tiny field tweaks on an existing detached locale, " +
          "omit sections and supply fields only (merge preserves sections), or use update_fields.",
      };
    }
    // content-only new draft is allowed when content is non-empty (blog body)
    if (hasContent && !sectionsNonEmpty) {
      if (mergeIntoExisting && existing) {
        const next: Record<string, unknown> = { ...existing, ...allowedFields, slug: localeUrlSlug };
        if (Array.isArray(existing.sections) && existing.sections.length > 0) {
          next.sections = existing.sections;
        } else if (hasSectionsPayload) {
          next.sections = sections;
        } else {
          next.sections = Array.isArray(existing.sections) ? existing.sections : [];
        }
        if (meta && Object.keys(meta).length > 0) {
          const prevMeta =
            existing.meta && typeof existing.meta === "object" && !Array.isArray(existing.meta)
              ? (existing.meta as Record<string, unknown>)
              : {};
          next.meta = { ...prevMeta, ...meta };
        }
        return { ok: true, localeData: next, merge: true };
      }
      const localeData: Record<string, unknown> = {
        slug: localeUrlSlug,
        locale: targetLocale,
        ...allowedFields,
        sections: hasSectionsPayload ? sections! : [],
      };
      if (meta && Object.keys(meta).length > 0) localeData.meta = meta;
      if (writeAsDraft && isEmptyLocaleContent(localeData)) {
        return {
          ok: false,
          code: "detached_sections_required",
          message:
            "New detached/classic draft would be EMPTY_LOCALE (no sections and no content). Supply sections or content.",
        };
      }
      return { ok: true, localeData, merge: false };
    }
  }

  // Explicit sections replace (non-empty)
  if (sectionsNonEmpty) {
    if (mergeIntoExisting && existing && Object.keys(allowedFields).length === 0 && !meta) {
      // pure sections replace
      const next: Record<string, unknown> = { ...existing, slug: localeUrlSlug, sections: sections! };
      return { ok: true, localeData: next, merge: true };
    }
    if (mergeIntoExisting && existing) {
      const next: Record<string, unknown> = {
        ...existing,
        ...allowedFields,
        slug: localeUrlSlug,
        sections: sections!,
      };
      if (meta && Object.keys(meta).length > 0) {
        const prevMeta =
          existing.meta && typeof existing.meta === "object" && !Array.isArray(existing.meta)
            ? (existing.meta as Record<string, unknown>)
            : {};
        next.meta = { ...prevMeta, ...meta };
      }
      return { ok: true, localeData: next, merge: true };
    }
    const localeData: Record<string, unknown> = {
      slug: localeUrlSlug,
      locale: targetLocale,
      ...allowedFields,
      sections: sections!,
    };
    if (meta && Object.keys(meta).length > 0) localeData.meta = meta;
    return { ok: true, localeData, merge: false };
  }

  return {
    ok: false,
    code: "detached_sections_required",
    message:
      "Detached/classic translate requires a non-empty sections array or field merge into an existing locale with sections/content.",
  };
}

export function draftMissingRequiredWarnings(
  config: ContentTypeConfig,
  common: Record<string, unknown>,
  localePayload: Record<string, unknown>,
): string[] {
  return missingRequiredFields(config, common, localePayload);
}

/** List live locale stems (en.yml → en) under an entry dir. */
export function listLiveLocaleFiles(entryDir: string, readdirSync: (p: string) => string[]): string[] {
  const existing: string[] = [];
  try {
    for (const f of readdirSync(entryDir)) {
      if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
      const stem = f.replace(/\.ya?ml$/, "");
      if (/^[a-z]{2}(-[a-z]{2})?$/i.test(stem)) existing.push(stem);
    }
  } catch {
    /* missing dir */
  }
  return existing;
}
