/**
 * Shared-layout shell filenames: prefer `template.*`, dual-load legacy `single.*`.
 *
 * Pure helpers (no fs) — safe for client + server. Disk resolve helpers live in
 * `server/shared-layout-paths.ts`.
 *
 * New writes always use the template.* names. Reads prefer template.* when present,
 * otherwise fall back to single.*.
 */

/** Canonical versioning API slug for type-level (template) shells. */
export const TEMPLATE_VERSIONING_SLUG = "template";

/** Legacy versioning slug (pre–Phase 2). Still accepted on read/write gates. */
export const LEGACY_TEMPLATE_VERSIONING_SLUG = "single";

/** Layout write target for the type-level shell. Prefer this in new emitters. */
export const LAYOUT_TARGET_TYPE_TEMPLATE = "type_template" as const;

/** Legacy layout write target (alias of type_template). */
export const LAYOUT_TARGET_TYPE_SINGLE = "type_single" as const;

export type TypeLayoutTarget =
  | typeof LAYOUT_TARGET_TYPE_TEMPLATE
  | typeof LAYOUT_TARGET_TYPE_SINGLE;

export type LayoutTarget = "auto" | "entry" | TypeLayoutTarget;

/** Canonical layout-defaults basename. */
export const COMMON_TEMPLATE_BASENAME = "_common.template.yml";

/** Legacy layout-defaults basename. */
export const LEGACY_COMMON_SINGLE_BASENAME = "_common.single.yml";

/** Raw-file slug for layout defaults (UI / API). Prefer this. */
export const COMMON_TEMPLATE_RAW_SLUG = "_common.template";

/** Legacy raw-file slug. */
export const LEGACY_COMMON_SINGLE_RAW_SLUG = "_common.single";

const LOCALE_RE = "[a-z]{2}(?:-[a-zA-Z]+)?";
const VARIANT_RE = "[a-z0-9-]+";

/** Live shell: `template.{locale}.yml` */
export function liveTemplateBasename(locale: string): string {
  return `template.${locale}.yml`;
}

/** Legacy live shell: `single.{locale}.yml` */
export function legacyLiveSingleBasename(locale: string): string {
  return `single.${locale}.yml`;
}

/** Variant shell: `template.{variant}.{locale}.yml` */
export function variantTemplateBasename(variant: string, locale: string): string {
  return `template.${variant}.${locale}.yml`;
}

/** Legacy variant shell: `single.{variant}.{locale}.yml` */
export function legacyVariantSingleBasename(variant: string, locale: string): string {
  return `single.${variant}.${locale}.yml`;
}

export function commonTemplateBasename(): string {
  return COMMON_TEMPLATE_BASENAME;
}

export function legacyCommonSingleBasename(): string {
  return LEGACY_COMMON_SINGLE_BASENAME;
}

/** True for versioning slug `template` or legacy `single`. */
export function isTemplateVersioningSlug(contentSlug: string): boolean {
  return (
    contentSlug === TEMPLATE_VERSIONING_SLUG ||
    contentSlug === LEGACY_TEMPLATE_VERSIONING_SLUG
  );
}

/** True when basename is a reserved versioning/variant identity (template or single). */
export function isReservedTemplateVariantSlug(slug: string): boolean {
  return isTemplateVersioningSlug(slug);
}

/** Normalize layout target aliases to the type-shell bucket. */
export function isTypeLayoutTarget(
  target: string | null | undefined,
): target is TypeLayoutTarget {
  return target === LAYOUT_TARGET_TYPE_TEMPLATE || target === LAYOUT_TARGET_TYPE_SINGLE;
}

/** Prefer type_template; accept type_single as alias. */
export function normalizeTypeLayoutTarget(
  target: string | null | undefined,
): TypeLayoutTarget | null {
  if (isTypeLayoutTarget(target)) return target;
  return null;
}

/** True when basename is a type-level shared shell (live or variant, either naming). */
export function isSharedTemplateBasename(name: string): boolean {
  if (!name) return false;
  const base = name.replace(/\.ya?ml$/i, "");
  if (base === "_common.template" || base === "_common.single") return true;
  if (/^template\./i.test(base) || /^single\./i.test(base)) return true;
  return false;
}

/** True for raw-file slug `_common.template` or `_common.single`. */
export function isCommonTemplateRawSlug(slug: string): boolean {
  return slug === COMMON_TEMPLATE_RAW_SLUG || slug === LEGACY_COMMON_SINGLE_RAW_SLUG;
}

/** Live shell regex — matches template.{locale}.yml or single.{locale}.yml (group 1 = locale). */
export const LIVE_SHELL_BASENAME_RE = new RegExp(
  `^(?:template|single)\\.(${LOCALE_RE})\\.ya?ml$`,
  "i",
);

/** Variant shell regex — group 1 = variant, group 2 = locale. */
export const VARIANT_SHELL_BASENAME_RE = new RegExp(
  `^(?:template|single)\\.(${VARIANT_RE})\\.(${LOCALE_RE})\\.ya?ml$`,
  "i",
);

/**
 * Map a legacy `single.*` / `_common.single.yml` basename to the canonical `template.*` name.
 * Returns null if the name is not a migratable shell basename.
 */
export function migrateShellBasename(name: string): string | null {
  if (name === LEGACY_COMMON_SINGLE_BASENAME || name === "_common.single.yaml") {
    return COMMON_TEMPLATE_BASENAME;
  }
  const liveM = /^single\.([a-z]{2}(?:-[a-zA-Z]+)?)\.ya?ml$/i.exec(name);
  if (liveM) return liveTemplateBasename(liveM[1]);
  const varM = /^single\.([a-z0-9-]+)\.([a-z]{2}(?:-[a-zA-Z]+)?)\.ya?ml$/i.exec(name);
  if (varM) return variantTemplateBasename(varM[1], varM[2]);
  return null;
}

/** Candidate basenames for a live (or variant) shell, preferred first. */
export function shellBasenameCandidates(
  locale: string,
  variant?: string,
): string[] {
  if (variant) {
    return [
      variantTemplateBasename(variant, locale),
      legacyVariantSingleBasename(variant, locale),
    ];
  }
  return [liveTemplateBasename(locale), legacyLiveSingleBasename(locale)];
}

/** Candidate basenames for layout defaults, preferred first. */
export function commonTemplateBasenameCandidates(): string[] {
  return [COMMON_TEMPLATE_BASENAME, LEGACY_COMMON_SINGLE_BASENAME];
}
