/**
 * Validators Registry
 * 
 * Exports all available validators and provides discovery utilities.
 */

import type { Validator, ValidatorMetadata } from "../shared/types";
import { getValidatorRunClass } from "../shared/runClass";
import { redirectValidator } from "./redirects";
import { metaValidator } from "./meta";
import { schemaValidator } from "./schema";
import { sitemapValidator } from "./sitemap";
import { componentsValidator } from "./components";
import { backgroundsValidator } from "./backgrounds";
import { faqsValidator } from "./faqs";
import { seoDepthValidator } from "./seo-depth";
import { schemaCompletenessValidator } from "./schema-completeness";
import { imagesValidator } from "./images";
import { contentQualityValidator } from "./content-quality";
import { databaseSinglesValidator } from "./database-singles";
import { databaseHealthValidator } from "./database-health";
import { slugConflictsValidator } from "./slug-conflicts";
import { seoIntentValidator } from "./seo-intent";
import { seoClusterValidator } from "./seo-cluster";
import { seoClusterLinksValidator } from "./seo-cluster-links";
import { imageOptimizationValidator } from "./image-optimization";
import { heroImageTagsValidator } from "./hero-image-tags";
import { imageTagsValidator } from "./image-tags";
import { fieldMappingsValidator } from "./field-mappings";
import { orphanedFilesValidator } from "./orphaned-files";
import { formsValidator } from "./forms";
import { consentLegacyKeysValidator } from "./consent-legacy-keys";
import { bindingIntegrityValidator } from "./binding-integrity";
import { brokenAnchorsValidator } from "./broken-anchors";
import { sectionVariantsValidator } from "./section-variants";
import { componentBehaviorsValidator } from "./component-behaviors";
import { ctaTrackingValidator } from "./cta-tracking";
import { requiredFieldsValidator } from "./required-fields";
import { schemaOrgCompanionsValidator } from "./schema-org-companions";
import { staticFieldOverridesValidator } from "./static-field-overrides";
import { sourceNameCollisionsValidator } from "./source-name-collisions";
import { editorFieldTypesValidator } from "./editor-field-types";
import { unknownKeysValidator } from "./unknown-keys";
import { relationTargetsValidator } from "./relation-targets";
import { updatedAtValidator } from "./updated-at";
import { urlParamLocaleValidator } from "./url-param-locale";

export const validators: Validator[] = [
  redirectValidator,
  metaValidator,
  requiredFieldsValidator,
  schemaValidator,
  sitemapValidator,
  componentsValidator,
  sectionVariantsValidator,
  backgroundsValidator,
  faqsValidator,
  seoDepthValidator,
  schemaCompletenessValidator,
  schemaOrgCompanionsValidator,
  imagesValidator,
  contentQualityValidator,
  databaseSinglesValidator,
  databaseHealthValidator,
  slugConflictsValidator,
  sourceNameCollisionsValidator,
  seoIntentValidator,
  seoClusterValidator,
  seoClusterLinksValidator,
  imageOptimizationValidator,
  heroImageTagsValidator,
  imageTagsValidator,
  fieldMappingsValidator,
  editorFieldTypesValidator,
  unknownKeysValidator,
  relationTargetsValidator,
  staticFieldOverridesValidator,
  urlParamLocaleValidator,
  orphanedFilesValidator,
  formsValidator,
  consentLegacyKeysValidator,
  bindingIntegrityValidator,
  brokenAnchorsValidator,
  componentBehaviorsValidator,
  ctaTrackingValidator,
  updatedAtValidator,
];

/** @deprecated Lighthouse removed from platform diagnostics — use external tools. */
export const slowValidators: Validator[] = [];

export const allValidators = [...validators, ...slowValidators];

export const validatorMap = new Map<string, Validator>(
  validators.map((v) => [v.name, v])
);

/** Ensures a validator is in the registry (e.g. after hot reload with a stale validators array). */
export function ensureValidatorRegistered(validator: Validator | undefined): void {
  if (!validator || validatorMap.has(validator.name)) return;
  validators.push(validator);
  validatorMap.set(validator.name, validator);
  if (!allValidators.some((v) => v.name === validator.name)) {
    allValidators.push(validator);
  }
}

export function getValidator(name: string): Validator | undefined {
  return validatorMap.get(name);
}

export function listValidators(): ValidatorMetadata[] {
  return allValidators.map((v) => ({
    name: v.name,
    description: v.description,
    apiExposed: v.apiExposed,
    estimatedDuration: v.estimatedDuration,
    category: v.category,
    runClass: v.runClass ?? getValidatorRunClass(v.name),
  }));
}

export function getApiExposedValidators(): Validator[] {
  return validators.filter((v) => v.apiExposed);
}

export {
  redirectValidator,
  metaValidator,
  schemaValidator,
  sitemapValidator,
  componentsValidator,
  backgroundsValidator,
  faqsValidator,
  seoDepthValidator,
  schemaCompletenessValidator,
  imagesValidator,
  contentQualityValidator,
  databaseSinglesValidator,
  databaseHealthValidator,
  slugConflictsValidator,
  seoIntentValidator,
  seoClusterValidator,
  seoClusterLinksValidator,
  imageOptimizationValidator,
  heroImageTagsValidator,
  imageTagsValidator,
  fieldMappingsValidator,
  staticFieldOverridesValidator,
  orphanedFilesValidator,
  formsValidator,
  consentLegacyKeysValidator,
  bindingIntegrityValidator,
  brokenAnchorsValidator,
  requiredFieldsValidator,
  schemaOrgCompanionsValidator,
  editorFieldTypesValidator,
  unknownKeysValidator,
  relationTargetsValidator,
  updatedAtValidator,
};
