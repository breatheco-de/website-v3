/**
 * Validator run-class taxonomy for the unified issue store.
 */

export type ValidatorRunClass = "entry-local" | "cross-entry" | "media" | "database";

export type ValidationScope =
  | "site"
  | "entry"
  | "redirects"
  | "media"
  | "database"
  | "sitemap"
  | "forms"
  | "bindings";

/** Default runClass when a validator omits metadata (conservative: entry-local). */
const RUN_CLASS_BY_NAME: Record<string, ValidatorRunClass> = {
  redirects: "cross-entry",
  "slug-conflicts": "cross-entry",
  "broken-anchors": "cross-entry",
  sitemap: "cross-entry",
  "orphaned-files": "cross-entry",
  "source-name-collisions": "cross-entry",
  "relation-targets": "cross-entry",
  "site-link-index": "cross-entry",
  "seo-duplicates": "cross-entry",
  "unassigned-variables": "cross-entry",
  images: "media",
  "image-tags": "media",
  "image-optimization": "media",
  "hero-image-tags": "media",
  "database-health": "database",
  "database-singles": "database",
  // everything else defaults to entry-local
};

export function getValidatorRunClass(name: string): ValidatorRunClass {
  return RUN_CLASS_BY_NAME[name] ?? "entry-local";
}

export function isEntryLocalValidator(name: string): boolean {
  return getValidatorRunClass(name) === "entry-local";
}

export function isCrossEntryValidator(name: string): boolean {
  return getValidatorRunClass(name) === "cross-entry";
}

/** Cross-entry validators that must not run in per-page / slug-filtered diagnostics. */
export const CROSS_ENTRY_VALIDATOR_NAMES = Object.keys(RUN_CLASS_BY_NAME).filter(
  (name) => RUN_CLASS_BY_NAME[name] === "cross-entry",
);

export function isMediaValidator(name: string): boolean {
  return getValidatorRunClass(name) === "media";
}

export function isDatabaseValidator(name: string): boolean {
  return getValidatorRunClass(name) === "database";
}

/** Scopes typically associated with a validator for indexing. */
export function scopesForValidator(name: string): ValidationScope[] {
  const runClass = getValidatorRunClass(name);
  switch (runClass) {
    case "cross-entry":
      if (name === "redirects") return ["site", "entry", "redirects"];
      if (name === "sitemap") return ["site", "sitemap"];
      return ["site", "entry"];
    case "media":
      return ["site", "media", "entry"];
    case "database":
      return ["site", "database"];
    default:
      return ["entry"];
  }
}

/** Entry-local validators safe to run on save / run-page / slug-filtered jobs. */
export const ENTRY_LOCAL_VALIDATOR_NAMES = [
  "meta",
  "required-fields",
  "editor-field-types",
  "unknown-keys",
  "seo-depth",
  "seo-intent",
  "seo-cluster",
  "seo-cluster-links",
  "schema-completeness",
  "schema-org-companions",
  "content-quality",
  "section-variants",
  "backgrounds",
  "faqs",
  "schema",
  "forms",
  "consent-legacy-keys",
  "binding-integrity",
  "component-behaviors",
  "cta-tracking",
  "static-field-overrides",
  "url-param-locale",
  "locale-slug-uniqueness",
  "updated-at",
] as const;
