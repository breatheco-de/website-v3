/**
 * Locales of one YAML entry sharing an effective public URL slug.
 * - Per-language URL patterns (/en/x, /es/x): warning (SEO), both pages still reachable.
 * - One address for every language (/landing/:slug): error, only one language can ever be
 *   shown there. Also warns when such an entry still sets `locale` in _common.yml (ignored legacy).
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { contentIndex as defaultContentIndex } from "../../../server/content-index";
import { getAllConfigs } from "../../../server/content-types";
import { isSingleAddressPattern, localeUrlSlugFromPageData } from "../../../server/locale-url-slug";
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

/** True when the entry's _common.yml sets `locale` (ignored legacy). */
function commonSetsLocale(context: ValidationContext, contentType: string, folderSlug: string): boolean {
  const index = context.contentIndex ?? defaultContentIndex;
  try {
    const common = index.loadCommonData(contentType as never, folderSlug) as Record<string, unknown> | null;
    return typeof common?.locale === "string" && common.locale.trim() !== "";
  } catch {
    return false;
  }
}

export const localeSlugUniquenessValidator: Validator = {
  name: "locale-slug-uniqueness",
  issueCodes: LOCALE_SLUG_UNIQUENESS_ISSUE_CODES,
  description:
    "Same public URL slug reused across locales of one entry (error on one-address types like /landing/:slug); ignored _common.yml locale",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "seo",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const warnings: ValidationIssue[] = [];
    const errors: ValidationIssue[] = [];
    const configs = getAllConfigs(context.contentRoot);

    const entryKeys = new Set<string>();
    const singleAddressTypes = new Set<string>();
    for (const file of context.contentFiles) {
      if (file.variant || !isLiveLocale(file.locale)) continue;
      const config = configs[file.type];
      if (config?.database) continue;
      if (hasPerLocaleUrlPattern(config?.url_pattern)) {
        entryKeys.add(`${file.type}/${file.slug}`);
      } else if (isSingleAddressPattern(config?.url_pattern)) {
        entryKeys.add(`${file.type}/${file.slug}`);
        singleAddressTypes.add(file.type);
      }
    }

    let entriesChecked = 0;
    let conflictsFound = 0;

    for (const entryKey of entryKeys) {
      const slash = entryKey.indexOf("/");
      if (slash <= 0) continue;
      const contentType = entryKey.slice(0, slash);
      const folderSlug = entryKey.slice(slash + 1);
      const singleAddress = singleAddressTypes.has(contentType);

      const locales = getLocalesForEntry(context, contentType, folderSlug);

      if (singleAddress && commonSetsLocale(context, contentType, folderSlug)) {
        for (const locale of locales) {
          const info = resolveLocaleSlugInfo(context, contentType, folderSlug, locale);
          if (!info) continue;
          warnings.push({
            type: "warning",
            code: "COMMON_LOCALE_IGNORED",
            message:
              `${contentType}/${folderSlug}: \`locale\` in _common.yml is ignored legacy and a bad practice. ` +
              "The language comes from the language file whose slug matches the address.",
            file: info.filePath,
            suggestion: "Remove the `locale:` line from _common.yml.",
            category: "seo",
            validator: this.name,
          });
        }
      }

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
          if (singleAddress) {
            errors.push({
              type: "error",
              code: "SLUG_SHARED_SINGLE_ADDRESS",
              message:
                `${contentType}/${folderSlug}: ${localeList} share the address slug "${effectiveSlug}". ` +
                "This page uses one address for every language, so only one of them can ever be shown.",
              file: info.filePath,
              suggestion:
                "Give one language its own slug (a word in that language). Deploys stop until this is fixed. " +
                "For new translations, use translate_entry with url_slug.",
              category: "seo",
              validator: this.name,
            });
            continue;
          }
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
      status: errors.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration: Date.now() - startTime,
      artifacts: {
        entriesChecked,
        conflictsFound,
      },
    };
  },
};
