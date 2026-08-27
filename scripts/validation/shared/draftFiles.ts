/**
 * Draft / variant-layer helpers for validators.
 *
 * Variant files (`draft.en.yml`, `v2.en.yml`) overlay a live locale.
 * Unpublished draft-only entries have no live locale — they ARE the page and
 * should be validated (except redirects).
 *
 * Published variants (allocation > 0) are loaded as separate ContentFiles with
 * `file.variant` set — entry-local validators run on them; cross-entry and
 * redirects skip them.
 */

import type { ContentFile } from "./types";

export function isVariantLayerFile(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() || "";
  // Entry mode: draft.es.yml, v2.en.yml (not template/single live shells)
  if (
    /^[a-z0-9-]+\.[a-z]{2}(-[a-z]{2})?\.ya?ml$/i.test(base) &&
    !/^(?:template|single)\./i.test(base)
  ) {
    return true;
  }
  // Template mode: template|single.{variant}.{locale}.yml (not live template|single.{locale}.yml)
  if (/^(?:template|single)\.[a-z0-9-]+\.[a-z]{2}(-[a-z]{2})?\.ya?ml$/i.test(base)) {
    return true;
  }
  return false;
}

/** Skip A/B overlays of published pages when they appear as path-based layers without file.variant. */
export function skipLiveVariantOverlay(file: ContentFile): boolean {
  if (file.isDraft) return false;
  if (file.variant) return false; // published variant rows are intentional ContentFiles
  return isVariantLayerFile(file.filePath);
}

/** Published-variant ContentFile (allocation > 0), keyed as type/slug/locale@variant. */
export function isPublishedVariantFile(file: ContentFile): boolean {
  return Boolean(file.variant && !file.isDraft);
}

/** Live locale file eligible for cross-entry / redirect validation. */
export function isLiveRedirectSource(file: ContentFile): boolean {
  if (file.isDraft) return false;
  if (file.variant) return false;
  if (isVariantLayerFile(file.filePath)) return false;
  return true;
}

/** Cross-entry validators should skip published-variant rows (shared public URL). */
export function skipCrossEntryVariantRow(file: ContentFile): boolean {
  return Boolean(file.variant);
}
