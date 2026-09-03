/**
 * Thin registry of per-validator issue code catalogs (no validator run() imports).
 */

import type { IssueCodeDefinition } from "./types";
import { BACKGROUNDS_ISSUE_CODES, BACKGROUNDS_VALIDATOR_NAME } from "../validators/backgrounds.issueCodes";
import { BINDING_INTEGRITY_ISSUE_CODES, BINDING_INTEGRITY_VALIDATOR_NAME } from "../validators/binding-integrity.issueCodes";
import { BROKEN_ANCHORS_ISSUE_CODES, BROKEN_ANCHORS_VALIDATOR_NAME } from "../validators/broken-anchors.issueCodes";
import { COMPONENTS_ISSUE_CODES, COMPONENTS_VALIDATOR_NAME } from "../validators/components.issueCodes";
import { COMPONENT_BEHAVIORS_ISSUE_CODES, COMPONENT_BEHAVIORS_VALIDATOR_NAME } from "../validators/component-behaviors.issueCodes";
import { CONSENT_LEGACY_KEYS_ISSUE_CODES, CONSENT_LEGACY_KEYS_VALIDATOR_NAME } from "../validators/consent-legacy-keys.issueCodes";
import { CONTENT_QUALITY_ISSUE_CODES, CONTENT_QUALITY_VALIDATOR_NAME } from "../validators/content-quality.issueCodes";
import { CTA_TRACKING_ISSUE_CODES, CTA_TRACKING_VALIDATOR_NAME } from "../validators/cta-tracking.issueCodes";
import { DATABASE_HEALTH_ISSUE_CODES, DATABASE_HEALTH_VALIDATOR_NAME } from "../validators/database-health.issueCodes";
import { DATABASE_SINGLES_ISSUE_CODES, DATABASE_SINGLES_VALIDATOR_NAME } from "../validators/database-singles.issueCodes";
import { EDITOR_FIELD_TYPES_ISSUE_CODES, EDITOR_FIELD_TYPES_VALIDATOR_NAME } from "../validators/editor-field-types.issueCodes";
import { FAQS_ISSUE_CODES, FAQS_VALIDATOR_NAME } from "../validators/faqs.issueCodes";
import { FIELD_MAPPINGS_ISSUE_CODES, FIELD_MAPPINGS_VALIDATOR_NAME } from "../validators/field-mappings.issueCodes";
import { FORMS_ISSUE_CODES, FORMS_VALIDATOR_NAME } from "../validators/forms.issueCodes";
import { HERO_IMAGE_TAGS_ISSUE_CODES, HERO_IMAGE_TAGS_VALIDATOR_NAME } from "../validators/hero-image-tags.issueCodes";
import { IMAGES_ISSUE_CODES, IMAGES_VALIDATOR_NAME } from "../validators/images.issueCodes";
import { IMAGE_OPTIMIZATION_ISSUE_CODES, IMAGE_OPTIMIZATION_VALIDATOR_NAME } from "../validators/image-optimization.issueCodes";
import { IMAGE_TAGS_ISSUE_CODES, IMAGE_TAGS_VALIDATOR_NAME } from "../validators/image-tags.issueCodes";
import { LOCALE_SLUG_UNIQUENESS_ISSUE_CODES, LOCALE_SLUG_UNIQUENESS_VALIDATOR_NAME } from "../validators/locale-slug-uniqueness.issueCodes";
import { META_ISSUE_CODES, META_VALIDATOR_NAME } from "../validators/meta.issueCodes";
import { ORPHANED_FILES_ISSUE_CODES, ORPHANED_FILES_VALIDATOR_NAME } from "../validators/orphaned-files.issueCodes";
import { REDIRECTS_ISSUE_CODES, REDIRECTS_VALIDATOR_NAME } from "../validators/redirects.issueCodes";
import { RELATION_TARGETS_ISSUE_CODES, RELATION_TARGETS_VALIDATOR_NAME } from "../validators/relation-targets.issueCodes";
import { REQUIRED_FIELDS_ISSUE_CODES, REQUIRED_FIELDS_VALIDATOR_NAME } from "../validators/required-fields.issueCodes";
import { SCHEMA_COMPLETENESS_ISSUE_CODES, SCHEMA_COMPLETENESS_VALIDATOR_NAME } from "../validators/schema-completeness.issueCodes";
import { SCHEMA_ISSUE_CODES, SCHEMA_VALIDATOR_NAME } from "../validators/schema.issueCodes";
import { SCHEMA_ORG_COMPANIONS_ISSUE_CODES, SCHEMA_ORG_COMPANIONS_VALIDATOR_NAME } from "../validators/schema-org-companions.issueCodes";
import { SECTION_VARIANTS_ISSUE_CODES, SECTION_VARIANTS_VALIDATOR_NAME } from "../validators/section-variants.issueCodes";
import { SEO_CLUSTER_ISSUE_CODES, SEO_CLUSTER_VALIDATOR_NAME } from "../validators/seo-cluster.issueCodes";
import { SEO_CLUSTER_LINKS_ISSUE_CODES, SEO_CLUSTER_LINKS_VALIDATOR_NAME } from "../validators/seo-cluster-links.issueCodes";
import { SEO_DEPTH_ISSUE_CODES, SEO_DEPTH_VALIDATOR_NAME } from "../validators/seo-depth.issueCodes";
import { SEO_DUPLICATES_ISSUE_CODES, SEO_DUPLICATES_VALIDATOR_NAME } from "../validators/seo-duplicates.issueCodes";
import { SEO_INTENT_ISSUE_CODES, SEO_INTENT_VALIDATOR_NAME } from "../validators/seo-intent.issueCodes";
import { SITEMAP_ISSUE_CODES, SITEMAP_VALIDATOR_NAME } from "../validators/sitemap.issueCodes";
import { SLUG_CONFLICTS_ISSUE_CODES, SLUG_CONFLICTS_VALIDATOR_NAME } from "../validators/slug-conflicts.issueCodes";
import { SOURCE_NAME_COLLISIONS_ISSUE_CODES, SOURCE_NAME_COLLISIONS_VALIDATOR_NAME } from "../validators/source-name-collisions.issueCodes";
import { STATIC_FIELD_OVERRIDES_ISSUE_CODES, STATIC_FIELD_OVERRIDES_VALIDATOR_NAME } from "../validators/static-field-overrides.issueCodes";
import { UNASSIGNED_VARIABLES_ISSUE_CODES, UNASSIGNED_VARIABLES_VALIDATOR_NAME } from "../validators/unassigned-variables.issueCodes";
import { UNKNOWN_KEYS_ISSUE_CODES, UNKNOWN_KEYS_VALIDATOR_NAME } from "../validators/unknown-keys.issueCodes";
import { UPDATED_AT_ISSUE_CODES, UPDATED_AT_VALIDATOR_NAME } from "../validators/updated-at.issueCodes";
import { URL_PARAM_LOCALE_ISSUE_CODES, URL_PARAM_LOCALE_VALIDATOR_NAME } from "../validators/url-param-locale.issueCodes";

/** Explicit map: add new `*.issueCodes.ts` modules here as catalogs grow. */
export const ISSUE_CODE_CATALOGS: Record<string, Record<string, IssueCodeDefinition>> = {
  [BACKGROUNDS_VALIDATOR_NAME]: BACKGROUNDS_ISSUE_CODES,
  [BINDING_INTEGRITY_VALIDATOR_NAME]: BINDING_INTEGRITY_ISSUE_CODES,
  [BROKEN_ANCHORS_VALIDATOR_NAME]: BROKEN_ANCHORS_ISSUE_CODES,
  [COMPONENTS_VALIDATOR_NAME]: COMPONENTS_ISSUE_CODES,
  [COMPONENT_BEHAVIORS_VALIDATOR_NAME]: COMPONENT_BEHAVIORS_ISSUE_CODES,
  [CONSENT_LEGACY_KEYS_VALIDATOR_NAME]: CONSENT_LEGACY_KEYS_ISSUE_CODES,
  [CONTENT_QUALITY_VALIDATOR_NAME]: CONTENT_QUALITY_ISSUE_CODES,
  [CTA_TRACKING_VALIDATOR_NAME]: CTA_TRACKING_ISSUE_CODES,
  [DATABASE_HEALTH_VALIDATOR_NAME]: DATABASE_HEALTH_ISSUE_CODES,
  [DATABASE_SINGLES_VALIDATOR_NAME]: DATABASE_SINGLES_ISSUE_CODES,
  [EDITOR_FIELD_TYPES_VALIDATOR_NAME]: EDITOR_FIELD_TYPES_ISSUE_CODES,
  [FAQS_VALIDATOR_NAME]: FAQS_ISSUE_CODES,
  [FIELD_MAPPINGS_VALIDATOR_NAME]: FIELD_MAPPINGS_ISSUE_CODES,
  [FORMS_VALIDATOR_NAME]: FORMS_ISSUE_CODES,
  [HERO_IMAGE_TAGS_VALIDATOR_NAME]: HERO_IMAGE_TAGS_ISSUE_CODES,
  [IMAGES_VALIDATOR_NAME]: IMAGES_ISSUE_CODES,
  [IMAGE_OPTIMIZATION_VALIDATOR_NAME]: IMAGE_OPTIMIZATION_ISSUE_CODES,
  [IMAGE_TAGS_VALIDATOR_NAME]: IMAGE_TAGS_ISSUE_CODES,
  [LOCALE_SLUG_UNIQUENESS_VALIDATOR_NAME]: LOCALE_SLUG_UNIQUENESS_ISSUE_CODES,
  [META_VALIDATOR_NAME]: META_ISSUE_CODES,
  [ORPHANED_FILES_VALIDATOR_NAME]: ORPHANED_FILES_ISSUE_CODES,
  [REDIRECTS_VALIDATOR_NAME]: REDIRECTS_ISSUE_CODES,
  [RELATION_TARGETS_VALIDATOR_NAME]: RELATION_TARGETS_ISSUE_CODES,
  [REQUIRED_FIELDS_VALIDATOR_NAME]: REQUIRED_FIELDS_ISSUE_CODES,
  [SCHEMA_COMPLETENESS_VALIDATOR_NAME]: SCHEMA_COMPLETENESS_ISSUE_CODES,
  [SCHEMA_ORG_COMPANIONS_VALIDATOR_NAME]: SCHEMA_ORG_COMPANIONS_ISSUE_CODES,
  [SCHEMA_VALIDATOR_NAME]: SCHEMA_ISSUE_CODES,
  [SECTION_VARIANTS_VALIDATOR_NAME]: SECTION_VARIANTS_ISSUE_CODES,
  [SEO_CLUSTER_VALIDATOR_NAME]: SEO_CLUSTER_ISSUE_CODES,
  [SEO_CLUSTER_LINKS_VALIDATOR_NAME]: SEO_CLUSTER_LINKS_ISSUE_CODES,
  [SEO_DEPTH_VALIDATOR_NAME]: SEO_DEPTH_ISSUE_CODES,
  [SEO_DUPLICATES_VALIDATOR_NAME]: SEO_DUPLICATES_ISSUE_CODES,
  [SEO_INTENT_VALIDATOR_NAME]: SEO_INTENT_ISSUE_CODES,
  [SITEMAP_VALIDATOR_NAME]: SITEMAP_ISSUE_CODES,
  [SLUG_CONFLICTS_VALIDATOR_NAME]: SLUG_CONFLICTS_ISSUE_CODES,
  [SOURCE_NAME_COLLISIONS_VALIDATOR_NAME]: SOURCE_NAME_COLLISIONS_ISSUE_CODES,
  [STATIC_FIELD_OVERRIDES_VALIDATOR_NAME]: STATIC_FIELD_OVERRIDES_ISSUE_CODES,
  [UNASSIGNED_VARIABLES_VALIDATOR_NAME]: UNASSIGNED_VARIABLES_ISSUE_CODES,
  [UNKNOWN_KEYS_VALIDATOR_NAME]: UNKNOWN_KEYS_ISSUE_CODES,
  [UPDATED_AT_VALIDATOR_NAME]: UPDATED_AT_ISSUE_CODES,
  [URL_PARAM_LOCALE_VALIDATOR_NAME]: URL_PARAM_LOCALE_ISSUE_CODES,
};

export function getIssueCodeDefinition(
  validator: string | undefined | null,
  code: string | undefined | null,
): IssueCodeDefinition | undefined {
  if (!validator || !code) return undefined;
  return ISSUE_CODE_CATALOGS[validator]?.[code];
}

/** Instance suggestion wins when non-empty; otherwise catalog default. */
export function resolveIssueSuggestion(
  validator: string | undefined | null,
  code: string | undefined | null,
  instanceSuggestion?: string | null,
): string | undefined {
  const trimmed = typeof instanceSuggestion === "string" ? instanceSuggestion.trim() : "";
  if (trimmed) return trimmed;
  const fromCatalog = getIssueCodeDefinition(validator, code)?.suggestion?.trim();
  return fromCatalog || undefined;
}

/** Lookup is by validator + code, so the same code may appear on multiple validators. */
export function assertUniqueIssueCodes(
  catalogs: Record<string, Record<string, IssueCodeDefinition>> = ISSUE_CODE_CATALOGS,
): void {
  for (const [validator, codes] of Object.entries(catalogs)) {
    for (const [code, def] of Object.entries(codes)) {
      if (!def?.title?.trim()) {
        throw new Error(`Missing title for issue code ${validator}/${code}`);
      }
    }
  }
}

export function hasIssueCodeInRegistry(validator: string, code: string): boolean {
  return Boolean(ISSUE_CODE_CATALOGS[validator]?.[code]);
}

/** Agent guidance is complete when next_actions is present and non-empty. */
export function isIssueCodeAgentGuidanceComplete(
  def: IssueCodeDefinition | undefined | null,
): boolean {
  return Boolean(def?.next_actions && def.next_actions.length > 0);
}
