import type { ValidationRunResult, ValidationContext } from "../../scripts/validation/shared/types";
import type { ValidationCacheService } from "./validationCacheService";
import { entryKeyFromContentFile } from "../../scripts/validation/shared/entryKey";
import { isDatabaseValidator } from "../../scripts/validation/shared/runClass";

/** Extract db slug from issue file path like `4geeks-com/db/blog_posts/config.yml`. */
function dbNameFromIssueFile(file: string): string | null {
  const match = file.match(/\/db\/([^/]+)\/config\.yml$/);
  return match ? match[1] : null;
}

export type ApplyValidationRunOptions = {
  /** When true, only merge ran validators (always true for v5 replace-by-validator). */
  partial?: boolean;
  /** Limit entry-local clear/write to these entry keys. */
  entryKeys?: string[];
  markSiteWide?: boolean;
};

/**
 * Persists validation results into the unified issue store.
 */
export async function applyValidationRunToCache(
  cache: ValidationCacheService,
  result: ValidationRunResult,
  context: ValidationContext,
  options: ApplyValidationRunOptions = {},
): Promise<void> {
  const nowIso = new Date().toISOString();
  const entryKeys =
    options.entryKeys ??
    (options.partial
      ? undefined
      : context.contentFiles.map((f) => entryKeyFromContentFile(f)));

  const pageValidators = result.validators.filter((v) => !isDatabaseValidator(v.name));
  const dbValidators = result.validators.filter((v) => isDatabaseValidator(v.name));

  if (pageValidators.length > 0) {
    cache.applyValidatorResults(pageValidators, {
      contentFiles: context.contentFiles,
      entryKeys: options.entryKeys,
      markSiteWide: options.markSiteWide ?? !options.partial,
      skippedContentTypes: context.skippedContentTypes,
    });
  }

  for (const dbHealth of dbValidators) {
    if (dbHealth.name !== "database-health" && dbHealth.name !== "database-singles") {
      cache.applyValidatorResults([dbHealth], {
        contentFiles: context.contentFiles,
        markSiteWide: false,
      });
      continue;
    }

    cache.applyValidatorResults([dbHealth], {
      contentFiles: context.contentFiles,
      markSiteWide: false,
    });

    if (dbHealth.name === "database-health") {
      const byDb = new Map<
        string,
        { errors: typeof dbHealth.errors; warnings: typeof dbHealth.warnings }
      >();

      for (const issue of dbHealth.errors) {
        if (!issue.file) continue;
        const dbName = dbNameFromIssueFile(issue.file);
        if (!dbName) continue;
        if (!byDb.has(dbName)) byDb.set(dbName, { errors: [], warnings: [] });
        byDb.get(dbName)!.errors.push({ ...issue, validator: "database-health" });
      }
      for (const issue of dbHealth.warnings) {
        if (!issue.file) continue;
        const dbName = dbNameFromIssueFile(issue.file);
        if (!dbName) continue;
        if (!byDb.has(dbName)) byDb.set(dbName, { errors: [], warnings: [] });
        byDb.get(dbName)!.warnings.push({ ...issue, validator: "database-health" });
      }

      const artifacts = dbHealth.artifacts?.databases as
        | Record<string, { errorCount: number; warningCount: number }>
        | undefined;
      const dbNames = artifacts ? Object.keys(artifacts) : [...byDb.keys()];

      for (const dbName of dbNames) {
        const issues = byDb.get(dbName) ?? { errors: [], warnings: [] };
        cache.setByDatabase(dbName, {
          lastRunAt: nowIso,
          errors: issues.errors,
          warnings: issues.warnings,
        });
      }
    }
  }

  if (!options.partial) {
    cache.markFullRunAt(nowIso);
  }
  await cache.flush();
}
