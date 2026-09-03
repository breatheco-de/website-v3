/**
 * Validates schema_org companion requirements:
 * A) Hero course → Course schema_org section
 * B) Content-type schema_org_requirements (e.g. location → LocalBusiness)
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import {
  getSchemaOrgRequirementGaps,
  validateHeroCourseCompanions,
} from "../../../server/schema-org-requirements";
import { liveFilesForSeo } from "../shared/seoValidationScope";
import { SCHEMA_ORG_COMPANIONS_ISSUE_CODES } from "./schema-org-companions.issueCodes";

export const schemaOrgCompanionsValidator: Validator = {
  name: "schema-org-companions",
  issueCodes: SCHEMA_ORG_COMPANIONS_ISSUE_CODES,
  description:
    "Validates hero course companions and content-type schema_org_requirements (e.g. location LocalBusiness)",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "seo",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    let heroChecked = 0;
    let ctChecked = 0;

    for (const file of liveFilesForSeo(context)) {
      const contentType = file.type;
      if (!contentType) continue;

      const data = (file.entryFields || {}) as Record<string, unknown>;
      const sections = data.sections;

      const heroGaps = validateHeroCourseCompanions(sections, {
        contentType,
        slug: file.slug,
        locale: file.locale,
      });
      for (const gap of heroGaps) {
        heroChecked++;
        errors.push({
          type: "error",
          code: "SCHEMA_ORG_HERO_COURSE_COMPANION",
          message: gap.message,
          file: file.filePath,
          suggestion:
            "Add a leading schema_org section with schema_type: Course (hero variant course requires companion schema_org Course section)",
        });
      }

      const ctGaps = getSchemaOrgRequirementGaps(sections, contentType, context.contentRoot, {
        slug: file.slug,
      });
      for (const gap of ctGaps) {
        ctChecked++;
        errors.push({
          type: "error",
          code: "SCHEMA_ORG_CONTENT_TYPE_REQUIREMENT",
          message: gap.message,
          file: file.filePath,
          suggestion: `Add a leading schema_org section with schema_type: ${gap.schema_type} (or run ensure_content_type_schema_org / CT Attach)`,
        });
      }
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        heroCompanionErrors: heroChecked,
        contentTypeRequirementErrors: ctChecked,
      },
    };
  },
};
