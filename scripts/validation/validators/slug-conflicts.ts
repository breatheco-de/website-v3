import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { getAllConfigs } from "../../../server/content-types";
import { SLUG_CONFLICTS_ISSUE_CODES } from "./slug-conflicts.issueCodes";

function buildUrlFromPattern(
  urlPattern: Record<string, string>,
  locale: string,
  slug: string,
): string | null {
  const pattern = urlPattern[locale] || urlPattern["default"];
  if (!pattern) return null;
  return pattern
    .replace(/:locale/g, locale)
    .replace(/:slug/g, slug);
}

export const slugConflictsValidator: Validator = {
  name: "slug-conflicts",
  issueCodes: SLUG_CONFLICTS_ISSUE_CODES,
  description: "Detects URL collisions across all non-database content types",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "integrity",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const configs = getAllConfigs();
    const nonDbTypes = new Set<string>();
    const configEntries = Object.entries(configs);
    configEntries.forEach(([type, config]) => {
      if (!config.database) {
        nonDbTypes.add(type);
      }
    });

    const urlMap = new Map<string, { type: string; slug: string; locale: string; filePath?: string }[]>();
    let totalChecked = 0;
    let conflictsFound = 0;

    for (const file of context.contentFiles) {
      if (!nonDbTypes.has(file.type)) continue;
      if (file.locale === "_common") continue;
      if (file.variant) continue;

      const config = configs[file.type];
      if (!config?.url_pattern) continue;

      const url = buildUrlFromPattern(config.url_pattern, file.locale, file.slug);
      if (!url) continue;

      totalChecked++;

      const normalizedUrl = url.toLowerCase().replace(/\/+$/, "") || "/";
      const existing = urlMap.get(normalizedUrl) || [];
      existing.push({
        type: file.type,
        slug: file.slug,
        locale: file.locale,
        filePath: file.filePath,
      });
      urlMap.set(normalizedUrl, existing);
    }

    Array.from(urlMap.entries()).forEach(([url, entries]) => {
      if (entries.length <= 1) return;

      const uniqueEntries = new Map<string, typeof entries[0]>();
      for (const entry of entries) {
        const key = `${entry.type}:${entry.slug}:${entry.locale}`;
        if (!uniqueEntries.has(key)) {
          uniqueEntries.set(key, entry);
        }
      }

      if (uniqueEntries.size <= 1) return;

      conflictsFound++;
      const descriptions = Array.from(uniqueEntries.values())
        .map(e => `${e.type}/${e.slug} (${e.locale})`)
        .join(", ");

      errors.push({
        type: "error",
        code: "URL_CONFLICT",
        message: `URL "${url}" resolves to multiple entries: ${descriptions}`,
        suggestion: "Rename one of the conflicting slugs or adjust their URL patterns to avoid collision",
      });
    });

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        totalChecked,
        conflictsFound,
      },
    };
  },
};
