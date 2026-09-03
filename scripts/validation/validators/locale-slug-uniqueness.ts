/**
 * Warns when two or more locales of the same YAML entry share the same effective public URL slug.
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { getAllConfigs } from "../../../server/content-types";
import { localeUrlSlugFromPageData } from "../../../server/locale-url-slug";
import { LOCALE_SLUG_UNIQUENESS_ISSUE_CODES } from "./locale-slug-uniqueness.issueCodes";

function hasPerLocaleUrlPattern(urlPattern?: Record<string, string>): boolean {
  if (!urlPattern) return false;
  const localeKeys = Object.keys(urlPattern).filter((k) => k !== "default");
  return localeKeys.length >= 2;
}

function isLiveLocale(locale: string): boolean {
  return locale !== "_common" && !locale.startsWith("_") && !locale.includes(".");
}

type LocaleSlugInfo = { locale: string; filePath: string; effectiveSlug: string };

function getLocalesForEntry(
  context: ValidationContext,
  contentType: string,
  folderSlug: string,
): string[] {
  if (context.contentIndex) {
    const available = context.contentIndex.getAvailableLocalesOrVariants(contentType, folderSlug);
    return available.filter(isLiveLocale);
  }

  const locales = new Set<string>();
  for (const file of context.contentFiles) {
    if (file.type !== contentType || file.slug !== folderSlug || file.variant) continue;
    if (!isLiveLocale(file.locale)) continue;
    locales.add(file.locale);
  }
  return [...locales];
}

function resolveLocaleSlugInfo(
  context: ValidationContext,
  contentType: string,
  folderSlug: string,
  locale: string,
): LocaleSlugInfo | null {
  if (context.contentIndex) {
    const { data, filePath } = context.contentIndex.loadMergedContent(
      contentType,
      folderSlug,
      locale,
    );
    if (!data || typeof data !== "object") return null;
    const effectiveSlug = localeUrlSlugFromPageData(
      data as Record<string, unknown>,
      folderSlug,
    );
    return { locale, filePath, effectiveSlug };
  }

  const file = context.contentFiles.find(
    (f) =>
      f.type === contentType &&
      f.slug === folderSlug &&
      f.locale === locale &&
      !f.variant,
  );
  if (!file) return null;

  const effectiveSlug = localeUrlSlugFromPageData(
    (file.entryFields ?? {}) as Record<string, unknown>,
    folderSlug,
  );
  return { locale, filePath: file.filePath, effectiveSlug };
}

export const localeSlugUniquenessValidator: Validator = {
  name: "locale-slug-uniqueness",
  issueCodes: LOCALE_SLUG_UNIQUENESS_ISSUE_CODES,
  description:
    "Warns when the same public URL slug is reused across locales of one YAML entry",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "seo",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const warnings: ValidationIssue[] = [];
    const configs = getAllConfigs(context.contentRoot);

    const entryKeys = new Set<string>();
    for (const file of context.contentFiles) {
      if (file.variant || !isLiveLocale(file.locale)) continue;
      const config = configs[file.type];
      if (!config?.database && hasPerLocaleUrlPattern(config?.url_pattern)) {
        entryKeys.add(`${file.type}/${file.slug}`);
      }
    }

    let entriesChecked = 0;
    let conflictsFound = 0;

    for (const entryKey of entryKeys) {
      const slash = entryKey.indexOf("/");
      if (slash <= 0) continue;
      const contentType = entryKey.slice(0, slash);
      const folderSlug = entryKey.slice(slash + 1);

      const locales = getLocalesForEntry(context, contentType, folderSlug);
      if (locales.length < 2) continue;

      entriesChecked++;

      const byEffectiveSlug = new Map<string, LocaleSlugInfo[]>();
      for (const locale of locales) {
        const info = resolveLocaleSlugInfo(context, contentType, folderSlug, locale);
        if (!info) continue;
        const group = byEffectiveSlug.get(info.effectiveSlug) || [];
        group.push(info);
        byEffectiveSlug.set(info.effectiveSlug, group);
      }

      for (const [effectiveSlug, localeInfos] of byEffectiveSlug) {
        if (localeInfos.length < 2) continue;
        conflictsFound++;
        const localeList = localeInfos
          .map((info) => info.locale)
          .sort()
          .join(", ");

        for (const info of localeInfos) {
          warnings.push({
            type: "warning",
            code: "SLUG_SHARED_ACROSS_LOCALES",
            message:
              `${contentType}/${folderSlug} uses URL slug "${effectiveSlug}" for ${localeList}. ` +
              "Use a language-specific slug on each locale file.",
            file: info.filePath,
            suggestion:
              "Set different slug values on each locale YAML. The folder name stays the entry identity. " +
              "For new translations, use translate_entry with url_slug.",
            category: "seo",
            validator: this.name,
          });
        }
      }
    }

    return {
      name: this.name,
      description: this.description,
      status: warnings.length > 0 ? "warning" : "passed",
      errors: [],
      warnings,
      duration: Date.now() - startTime,
      artifacts: {
        entriesChecked,
        conflictsFound,
      },
    };
  },
};
