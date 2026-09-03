/**
 * Schema.org Validator
 * 
 * Validates Schema.org references in content files:
 * - Checks that referenced schemas exist in schema-org.yml
 * - Validates override keys reference valid schemas
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { liveFilesForSeo } from "../shared/seoValidationScope";
import { SCHEMA_ISSUE_CODES } from "./schema.issueCodes";

export const schemaValidator: Validator = {
  name: "schema",
  issueCodes: SCHEMA_ISSUE_CODES,
  description: "Validates Schema.org references exist in schema-org.yml",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "seo",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const availableSchemasList = Array.from(context.availableSchemas).join(", ");

    for (const file of liveFilesForSeo(context)) {
      if (file.schema?.include) {
        for (const schemaRef of file.schema.include) {
          if (!context.availableSchemas.has(schemaRef)) {
            errors.push({
              type: "error",
              code: "INVALID_SCHEMA_REF",
              message: `Invalid schema reference: "${schemaRef}"`,
              file: file.filePath,
              suggestion: `Available schemas: ${availableSchemasList}`,
            });
          }
        }
      }

      if (file.schema?.overrides) {
        for (const overrideKey of Object.keys(file.schema.overrides)) {
          if (!context.availableSchemas.has(overrideKey)) {
            errors.push({
              type: "error",
              code: "INVALID_SCHEMA_OVERRIDE",
              message: `Invalid schema override key: "${overrideKey}"`,
              file: file.filePath,
              suggestion: `Available schemas: ${availableSchemasList}`,
            });
          }
        }
      }

      if (file.schema?.include && file.schema.include.length === 0) {
        warnings.push({
          type: "warning",
          code: "EMPTY_SCHEMA_INCLUDE",
          message: "Schema include array is empty",
          file: file.filePath,
          suggestion: "Either add schema references or remove the empty include array",
        });
      }
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        availableSchemas: Array.from(context.availableSchemas),
        filesWithSchemas: context.contentFiles.filter((f) => f.schema?.include?.length).length,
      },
    };
  },
};
