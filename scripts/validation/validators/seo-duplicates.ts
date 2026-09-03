import type { Validator, ValidatorResult, ValidationContext } from "../shared/types";
import { liveFilesForSeo } from "../shared/seoValidationScope";
import { SEO_DUPLICATES_ISSUE_CODES } from "./seo-duplicates.issueCodes";

/**
 * Cross-entry SEO duplicate title/description checks.
 * Must not run in entry-scoped / on-save slices (false clear or false all-clear).
 */

export const seoDuplicatesValidator: Validator = {
  name: "seo-duplicates",
  issueCodes: SEO_DUPLICATES_ISSUE_CODES,
  description: "Detects duplicate page_title and meta description across live pages",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "seo",
  runClass: "cross-entry",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidatorResult["errors"] = [];
    const warnings: ValidatorResult["warnings"] = [];

    const titleMap = new Map<string, string[]>();
    const descriptionMap = new Map<string, string[]>();

    for (const file of liveFilesForSeo(context)) {
      const pageTitle = file.meta?.page_title;
      if (pageTitle) {
        const existing = titleMap.get(pageTitle) || [];
        existing.push(file.filePath);
        titleMap.set(pageTitle, existing);
      }

      const description = file.meta?.description;
      if (description) {
        const existing = descriptionMap.get(description) || [];
        existing.push(file.filePath);
        descriptionMap.set(description, existing);
      }
    }

    let duplicateTitles = 0;
    titleMap.forEach((files, title) => {
      if (files.length > 1) {
        duplicateTitles++;
        errors.push({
          type: "error",
          code: "DUPLICATE_TITLE",
          message: `Duplicate page_title "${title}" used by ${files.length} files`,
          file: files[0],
          suggestion: `Also used in: ${files.slice(1).join(", ")}`,
        });
      }
    });

    let duplicateDescriptions = 0;
    descriptionMap.forEach((files, desc) => {
      if (files.length > 1) {
        duplicateDescriptions++;
        errors.push({
          type: "error",
          code: "DUPLICATE_DESCRIPTION",
          message: `Duplicate description used by ${files.length} files: "${desc.substring(0, 60)}..."`,
          file: files[0],
          suggestion: `Also used in: ${files.slice(1).join(", ")}`,
        });
      }
    });

    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration: Date.now() - startTime,
      artifacts: {
        pagesChecked: liveFilesForSeo(context).length,
        duplicateTitles,
        duplicateDescriptions,
      },
    };
  },
};
