import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { DatabaseManager } from "../../../server/database";
import { getAllJobStates } from "../../../server/db-job-state";
import { evaluateDatabaseHealth } from "../shared/databaseHealthChecks";
import { DATABASE_HEALTH_ISSUE_CODES } from "./database-health.issueCodes";

export const databaseHealthValidator: Validator = {
  name: "database-health",
  issueCodes: DATABASE_HEALTH_ISSUE_CODES,
  description:
    "Checks operational health of content databases (auth, fetch/index jobs, cache, transforms)",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const start = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    if (!context.contentRoot) {
      return {
        name: this.name,
        description: this.description,
        status: "failed",
        errors: [{
          type: "error",
          code: "MISSING_CONTENT_ROOT",
          message: "contentRoot is required for database-health validation",
        }],
        warnings: [],
        duration: Date.now() - start,
        category: this.category,
      };
    }

    const dbm = new DatabaseManager(context.contentRoot);
    const jobStates = getAllJobStates(context.contentRoot);
    const scopeDb = context.scope?.database;
    const databases = dbm.list().filter((db) => !scopeDb || db.name === scopeDb);

    if (scopeDb && databases.length === 0) {
      return {
        name: this.name,
        description: this.description,
        status: "failed",
        errors: [{
          type: "error",
          code: "DATABASE_NOT_FOUND",
          message: `Database "${scopeDb}" not found`,
        }],
        warnings: [],
        duration: Date.now() - start,
        category: this.category,
      };
    }

    const artifacts: Record<string, { errorCount: number; warningCount: number }> = {};

    for (const { name, config } of databases) {
      const { errors: dbErrors, warnings: dbWarnings } = evaluateDatabaseHealth(
        name,
        config,
        context.contentRoot,
        jobStates[name],
        dbm.getCacheInfo(name),
        dbm.countTransformErrors(name),
      );
      errors.push(...dbErrors);
      warnings.push(...dbWarnings);
      artifacts[name] = {
        errorCount: dbErrors.length,
        warningCount: dbWarnings.length,
      };
    }

    const status =
      errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed";

    return {
      name: this.name,
      description: this.description,
      status,
      errors,
      warnings,
      duration: Date.now() - start,
      category: this.category,
      artifacts: { databases: artifacts },
    };
  },
};
