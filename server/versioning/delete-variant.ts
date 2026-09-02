import type { VersioningFile } from "./VersioningManager.js";

export type VariantTrafficBlock =
  | { blocked: false }
  | { blocked: true; allocation: number };

/** Block delete when the variant slug is registered with traffic > 0%. */
export function variantTrafficBlock(
  existing: VersioningFile | null | undefined,
  locale: string,
  variantSlug: string,
): VariantTrafficBlock {
  const localeData = existing?.[locale];
  const entry = localeData?.variants?.find((v) => v.slug === variantSlug);
  if (entry && entry.allocation > 0) {
    return { blocked: true, allocation: entry.allocation };
  }
  return { blocked: false };
}

export function isVariantRegisteredInVersioning(
  existing: VersioningFile | null | undefined,
  locale: string,
  variantSlug: string,
): boolean {
  return Boolean(existing?.[locale]?.variants?.some((v) => v.slug === variantSlug));
}

/** Remove one variant slug for a locale; prune empty locale keys. */
export function pruneVersioningAfterVariantRemove(
  existing: VersioningFile,
  locale: string,
  variantSlug: string,
): { data: VersioningFile; isEmpty: boolean } {
  const next: VersioningFile = { ...existing };
  const localeData = next[locale];
  if (localeData) {
    const updatedVariants = (localeData.variants || []).filter((v) => v.slug !== variantSlug);
    if (updatedVariants.length === 0) {
      delete next[locale];
    } else {
      next[locale] = { variants: updatedVariants };
    }
  }
  const isEmpty = !Object.values(next).some((loc) => (loc?.variants?.length ?? 0) > 0);
  return { data: next, isEmpty };
}

export function variantTrafficErrorMessage(allocation: number): string {
  return (
    `This variant has ${allocation}% traffic allocated and cannot be deleted. ` +
    "A staff member must remove the allocation first."
  );
}

export function parseCleanupOrphanFlag(
  queryValue: unknown,
  bodyValue: unknown,
): boolean {
  if (bodyValue === true) return true;
  if (typeof queryValue === "string" && queryValue.toLowerCase() === "true") return true;
  return false;
}
