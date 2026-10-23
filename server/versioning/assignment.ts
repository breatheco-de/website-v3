import crypto from "crypto";

/** Reserved slug for visitors in the live (Default) share of an active test. */
export const DEFAULT_VARIANT_SLUG = "default";

/** Variant slugs staff/agents cannot create: the Default group label. */
export function isReservedExperimentSlug(slug: string): boolean {
  return slug === DEFAULT_VARIANT_SLUG;
}

export interface AllocatedVariant {
  slug: string;
  allocation: number;
}

/** Experiment key used for bucketing and reporting: `contentType:slug:locale` (+ `@run`). */
export function experimentBaseId(contentType: string, slug: string, locale: string): string {
  return `${contentType}:${slug}:${locale}`;
}

export function experimentId(contentType: string, slug: string, locale: string, run?: string | null): string {
  const base = experimentBaseId(contentType, slug, locale);
  return run ? `${base}@${run}` : base;
}

/** Stable 0–99 bucket from sha256, independent per experiment key. */
export function bucketFor(userId: string, experimentKey: string): number {
  const digest = crypto.createHash("sha256").update(`${userId}:${experimentKey}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/** Sum of traffic on real variants; Default gets the remainder. */
export function allocatedTotal(variants: AllocatedVariant[]): number {
  return variants.reduce((n, v) => n + (v.allocation > 0 ? v.allocation : 0), 0);
}

export function hasActiveTraffic(variants: AllocatedVariant[] | undefined): boolean {
  return !!variants?.some((v) => v.allocation > 0);
}

/**
 * Pick the variant for a visitor. Returns the variant slug, `"default"` when the
 * bucket lands in Default's share, or null when no variant has traffic.
 */
export function pickVariant(
  userId: string,
  experimentKey: string,
  variants: AllocatedVariant[],
): string | null {
  const eligible = variants.filter((v) => v.allocation > 0);
  if (eligible.length === 0) return null;

  const bucket = bucketFor(userId, experimentKey);
  let cumulative = 0;
  for (const variant of eligible) {
    cumulative += variant.allocation;
    if (bucket < cumulative) return variant.slug;
  }
  return DEFAULT_VARIANT_SLUG;
}
