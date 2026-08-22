/**
 * Static content types must not store Fields values in a field_overrides bag.
 * Values belong as top-level keys on the locale/variant YAML layer.
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { getContentTypeConfig } from "../../../server/content-types";

const FIELD_OVERRIDES_KEY = "field_overrides";

export const staticFieldOverridesValidator: Validator = {
  name: "static-field-overrides",
  description:
    "Errors when static (no-database) entry YAML still contains a field_overrides bag — migrate to root keys",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    let checked = 0;

    for (const file of context.contentFiles) {
      const contentType = file.type;
      if (!contentType) continue;

      const config = getContentTypeConfig(contentType, context.contentRoot);
      if (!config || config.database?.slug) continue;

      checked++;
      const data = (file.entryFields || {}) as Record<string, unknown>;
      const bag = data[FIELD_OVERRIDES_KEY];
      if (bag && typeof bag === "object" && !Array.isArray(bag) && Object.keys(bag as object).length > 0) {
        const keys = Object.keys(bag as object).join(", ");
        errors.push({
          type: "error",
          code: "STATIC_FIELD_OVERRIDES_BAG",
          message: `Static entry still has field_overrides (${keys}); promote keys to the YAML root on this layer file`,
          file: file.filePath,
          suggestion:
            "Flatten field_overrides into top-level keys (string editor fields as plain scalars), then remove the bag. Writer: server/field-overrides.ts flattenFieldOverridesInFile / writeMappedFields.",
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
        checked,
        bagsFound: errors.length,
      },
    };
  },
};
