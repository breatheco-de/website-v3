/** Client helpers mirroring server shared-layout / versioning slug rules. */

import {
  TEMPLATE_VERSIONING_SLUG,
  LEGACY_TEMPLATE_VERSIONING_SLUG,
  isTemplateVersioningSlug,
  COMMON_TEMPLATE_RAW_SLUG,
  LEGACY_COMMON_SINGLE_RAW_SLUG,
  isCommonTemplateRawSlug,
  LAYOUT_TARGET_TYPE_TEMPLATE,
  LAYOUT_TARGET_TYPE_SINGLE,
  isTypeLayoutTarget,
} from "@shared/sharedLayoutPaths";

export {
  TEMPLATE_VERSIONING_SLUG,
  LEGACY_TEMPLATE_VERSIONING_SLUG,
  isTemplateVersioningSlug,
  COMMON_TEMPLATE_RAW_SLUG,
  LEGACY_COMMON_SINGLE_RAW_SLUG,
  isCommonTemplateRawSlug,
  LAYOUT_TARGET_TYPE_TEMPLATE,
  LAYOUT_TARGET_TYPE_SINGLE,
  isTypeLayoutTarget,
};

export function isSharedLayoutType(info: {
  has_database?: boolean;
  single_template?: boolean;
} | null | undefined): boolean {
  return !!(info?.has_database || info?.single_template);
}

/**
 * Versioning API slug for an entry:
 * - attached shared-layout → `template`
 * - detached or non-shared → entry slug
 */
export function versioningContentSlug(
  entrySlug: string,
  opts: { isSharedLayout: boolean; isDetached: boolean },
): string {
  if (opts.isSharedLayout && !opts.isDetached) {
    return TEMPLATE_VERSIONING_SLUG;
  }
  return entrySlug;
}

/** True when entry may receive per-entry section overlays / layout overrides. */
export function allowEntryStructuralOverrides(opts: {
  isSharedLayout: boolean;
  isDetached: boolean;
}): boolean {
  if (!opts.isSharedLayout) return true;
  return opts.isDetached;
}

/** PrivatePreview 404 picker is listing the type shell (`template`), not this entry. */
export function isPreviewListingSharedTemplate(info: {
  isSharedLayout?: boolean;
  detached?: boolean;
  versioningSlug?: string;
} | null | undefined): boolean {
  return (
    !!info?.isSharedLayout &&
    !info.detached &&
    !!info.versioningSlug &&
    isTemplateVersioningSlug(info.versioningSlug)
  );
}
