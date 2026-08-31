/**
 * Shared-layout + detach helpers used by versioning, loaders, and editors.
 * DB-backed and single_template types share the same rules.
 */

import fs from "fs";
import path from "path";
import {
  TEMPLATE_VERSIONING_SLUG,
  isTemplateVersioningSlug,
  isReservedTemplateVariantSlug,
} from "@shared/sharedLayoutPaths";
import { getContentTypeConfig, getFolder } from "./content-types";
import { contentIndex } from "./content-index";
import { getDefaultContentRoot } from "./site-config";

export {
  TEMPLATE_VERSIONING_SLUG,
  LEGACY_TEMPLATE_VERSIONING_SLUG,
  isTemplateVersioningSlug,
} from "@shared/sharedLayoutPaths";

export function isSharedLayoutType(
  contentType: string,
  contentRoot?: string,
): boolean {
  const config = getContentTypeConfig(contentType, contentRoot);
  if (!config) return false;
  // DB always implies shared layout even if single_template flag is missing
  return !!(config.database?.slug || config.single_template);
}

export function getEntryCommonPath(
  contentType: string,
  slug: string,
  contentRoot?: string,
): string {
  const root = contentRoot ?? getDefaultContentRoot();
  const folder = getFolder(contentType, root);
  return path.join(root, folder, slug, "_common.yml");
}

/**
 * True when `{slug}/_common.yml` has `detached: true`.
 * Detached entries own full structure and use entry-level Page Versions.
 */
export function isEntryDetached(
  contentType: string,
  slug: string,
  contentRoot?: string,
): boolean {
  if (!slug || isTemplateVersioningSlug(slug)) return false;
  if (!isSharedLayoutType(contentType, contentRoot)) return false;

  const commonPath = getEntryCommonPath(contentType, slug, contentRoot);
  if (!fs.existsSync(commonPath)) return false;

  try {
    const raw = fs.readFileSync(commonPath, "utf-8");
    const parsed = contentIndex.safeYamlLoad(raw) as Record<string, unknown> | null;
    return parsed?.detached === true;
  } catch {
    return false;
  }
}

/**
 * True when the entry folder owns its own drafts/versioning.yml
 * (e.g. translate_entry wrote `draft.{locale}.yml` while still attached).
 * Used to prefer entry-level Page Versions over type-root Template Versions.
 */
export function hasEntryLevelVersioning(
  contentType: string,
  entrySlug: string,
  contentRoot?: string,
): boolean {
  if (!entrySlug || isTemplateVersioningSlug(entrySlug)) return false;
  const root = contentRoot ?? getDefaultContentRoot();
  const folder = getFolder(contentType, root);
  const entryDir = path.join(root, folder, entrySlug);
  if (!fs.existsSync(entryDir)) return false;
  if (fs.existsSync(path.join(entryDir, "versioning.yml"))) return true;
  try {
    for (const name of fs.readdirSync(entryDir)) {
      // {variant}.{locale}.yml — not plain `{locale}.yml` or `_common.yml`
      const m = /^([a-z0-9-]+)\.([a-z]{2}(?:-[a-zA-Z]+)?)\.ya?ml$/i.exec(name);
      if (!m) continue;
      const variantSlug = m[1];
      if (isReservedTemplateVariantSlug(variantSlug) || variantSlug.startsWith("_")) continue;
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Versioning identity for live traffic / HTML assignment:
 * - attached shared-layout → template (`template`, alias `single`) — shell A/B
 * - detached or non-shared → entry slug
 *
 * Does **not** consider entry-level translation drafts; those use
 * {@link resolveVersioningReadSlug} / writable entry slug paths.
 */
export function versioningContentSlug(
  contentType: string,
  entrySlug: string,
  contentRoot?: string,
): string {
  if (
    isSharedLayoutType(contentType, contentRoot) &&
    !isEntryDetached(contentType, entrySlug, contentRoot)
  ) {
    return TEMPLATE_VERSIONING_SLUG;
  }
  return entrySlug;
}

/**
 * Slug for reading versioning.yml / listing variants in admin + MCP.
 * Prefer entry-level drafts when present; otherwise template for attached shared-layout.
 */
export function resolveVersioningReadSlug(
  contentType: string,
  contentSlug: string,
  contentRoot?: string,
): string {
  if (isTemplateVersioningSlug(contentSlug)) return contentSlug;
  if (!isSharedLayoutType(contentType, contentRoot)) return contentSlug;
  if (isEntryDetached(contentType, contentSlug, contentRoot)) return contentSlug;
  if (hasEntryLevelVersioning(contentType, contentSlug, contentRoot)) {
    return contentSlug;
  }
  return TEMPLATE_VERSIONING_SLUG;
}

/**
 * Writable versioning target (promote / publish / create / delete / allocate).
 * Entry slugs are allowed while attached so translate_entry drafts can go live.
 * Pass content slug `template` (or legacy `single`) for type-root template variants.
 */
export function resolveWritableVersioningTarget(
  contentType: string,
  contentSlug: string,
  contentRoot?: string,
): { ok: true; slug: string; templateMode: boolean } | { ok: false; error: string; status: number } {
  if (isTemplateVersioningSlug(contentSlug)) {
    if (!isSharedLayoutType(contentType, contentRoot)) {
      return {
        ok: false,
        status: 400,
        error:
          'Template versioning (slug "template") is only valid for shared-layout content types',
      };
    }
    // Normalize legacy "single" to canonical "template" for writers
    return { ok: true, slug: TEMPLATE_VERSIONING_SLUG, templateMode: true };
  }
  return { ok: true, slug: contentSlug, templateMode: false };
}

/**
 * Folder slug for preview/read APIs. Locale/URL slugs map via ContentIndex;
 * the template shell (`template`) is left unchanged.
 */
export function resolvePreviewBaseSlug(
  slug: string,
  contentType: string,
  ci: { resolveBaseSlug(slug: string, contentType: string): string },
): string {
  if (isTemplateVersioningSlug(slug)) return slug;
  return ci.resolveBaseSlug(slug, contentType);
}

/**
 * Attached shared-layout entries must not carry structural overlays.
 * Returns an error message if `sections` or `layout` are present.
 */
export function attachedOverlayStructureError(
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.sections) && data.sections.length > 0) {
    return "Attached shared-layout entries cannot include sections; detach the entry or edit the shared template.";
  }
  if (data.layout !== undefined && data.layout !== null) {
    return "Attached shared-layout entries cannot override layout/menu; detach the entry or edit the content-type default.";
  }
  return null;
}

/** Strip sections + layout for hard re-attach / compliance. */
export function stripStructuralOverlayKeys<T extends Record<string, unknown>>(
  data: T,
): T {
  const { sections: _s, layout: _l, ...rest } = data;
  return rest as T;
}

const ATTACHED_STRUCTURAL_MSG =
  "Attached shared-layout entries cannot change structure or layout; detach the entry or edit the shared template.";

/**
 * When attached (shared-layout and not detached), returns an error message
 * for structural overlay ops. Otherwise null.
 */
export function rejectAttachedStructuralEdit(
  contentType: string,
  slug: string,
  contentRoot?: string,
): string | null {
  if (!slug || isTemplateVersioningSlug(slug)) return null;
  if (!isSharedLayoutType(contentType, contentRoot)) return null;
  if (isEntryDetached(contentType, slug, contentRoot)) return null;
  return ATTACHED_STRUCTURAL_MSG;
}

/** True when entry may receive per-entry section overlays / layout overrides. */
export function allowEntryStructuralOverrides(
  contentType: string,
  slug: string,
  contentRoot?: string,
): boolean {
  return rejectAttachedStructuralEdit(contentType, slug, contentRoot) == null;
}
