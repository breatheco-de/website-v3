import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { bindingManager } from "../../../server/bindings";
import { BINDING_INTEGRITY_ISSUE_CODES } from "./binding-integrity.issueCodes";

export const bindingIntegrityValidator: Validator = {
  name: "binding-integrity",
  issueCodes: BINDING_INTEGRITY_ISSUE_CODES,
  description: "Checks for orphaned section-binding references that point to deleted or moved sections",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "bindings",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    let staleCount = 0;
    try {
      staleCount = bindingManager.cleanupStaleReferences(true);
    } catch (err) {
      errors.push({
        type: "error",
        code: "BINDING_CHECK_FAILED",
        message: `Failed to inspect section bindings: ${err instanceof Error ? err.message : String(err)}`,
      });
      const duration = Date.now() - startTime;
      return {
        name: this.name,
        description: this.description,
        status: "failed",
        errors,
        warnings,
        duration,
      };
    }

    if (staleCount > 0) {
      warnings.push({
        type: "warning",
        code: "STALE_BINDING_REFERENCES",
        message: `${staleCount} stale binding reference${staleCount !== 1 ? "s" : ""} found in section-bindings.json`,
        suggestion: "Use the Clean up action to remove orphaned entries and prevent silent content sync issues.",
        fix: {
          type: "api",
          label: "Clean up",
          fixerName: "binding-cleanup",
        },
      });
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: staleCount > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        staleCount,
      },
    };
  },
};
