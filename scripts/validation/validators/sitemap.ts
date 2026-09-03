/**
 * Sitemap Validator
 * 
 * Validates sitemap integrity:
 * - Checks that all content files have corresponding sitemap entries
 * - Detects orphaned sitemap entries (URLs without content)
 * - Validates sitemap URLs are accessible
 * - Verifies hreflang annotations (xmlns:xhtml namespace + <xhtml:link> tags)
 *   are present in the generated XML for multi-locale page pairs
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue, ContentFile } from "../shared/types";
import { getCanonicalUrl } from "../shared/canonicalUrls";
import { skipCrossEntryVariantRow } from "../shared/draftFiles";
import { isIndexingBlocked } from "../../../server/settings";
import { SITEMAP_ISSUE_CODES } from "./sitemap.issueCodes";

const TEMPLATE_EXPR_RE = /\{\{[\s\S]*?\}\}/;

/** Mirrors server/sitemap.ts inclusion rules for indexable public URLs. */
function shouldExpectSitemapEntry(file: ContentFile, contentRoot?: string): boolean {
  if (file.isDraft) return false;
  if (skipCrossEntryVariantRow(file)) return false;
  if (isIndexingBlocked(contentRoot)) return false;
  const robots = file.meta?.robots;
  if (typeof robots === "string" && robots.toLowerCase().includes("noindex")) return false;
  const url = getCanonicalUrl(file);
  if (!url || TEMPLATE_EXPR_RE.test(url)) return false;
  return true;
}

function deriveNormalizedPath(loc: string): string {
  return loc
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/^\/(en|es)\//, "/");
}

export const sitemapValidator: Validator = {
  name: "sitemap",
  issueCodes: SITEMAP_ISSUE_CODES,
  description: "Validates sitemap entries match actual content files",
  apiExposed: true,
  estimatedDuration: "medium",
  category: "integrity",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    const contentUrls = new Set<string>();
    for (const file of context.contentFiles) {
      if (skipCrossEntryVariantRow(file)) continue;
      contentUrls.add(getCanonicalUrl(file));
    }

    const sitemapUrls = new Set<string>();
    for (const entry of context.sitemapEntries) {
      sitemapUrls.add(entry.loc);
    }

    for (const file of context.contentFiles) {
      if (skipCrossEntryVariantRow(file)) continue;
      if (!shouldExpectSitemapEntry(file, context.contentRoot)) continue;
      const url = getCanonicalUrl(file);
      if (!sitemapUrls.has(url) && context.sitemapEntries.length > 0) {
        warnings.push({
          type: "warning",
          code: "CONTENT_NOT_IN_SITEMAP",
          message: `Content file has no sitemap entry: ${url}`,
          file: file.filePath,
          suggestion: "Regenerate the sitemap or check if the content is excluded intentionally",
        });
      }
    }

    for (const entry of context.sitemapEntries) {
      if (entry.type !== "static" && !contentUrls.has(entry.loc)) {
        const isRedirect = context.redirectMap.has(entry.loc);
        if (!isRedirect) {
          errors.push({
            type: "error",
            code: "ORPHAN_SITEMAP_ENTRY",
            message: `Sitemap contains URL without content: ${entry.loc}`,
            suggestion: "Remove this entry from the sitemap or create the missing content",
          });
        }
      }
    }

    const duplicateCheck = new Map<string, number>();
    for (const entry of context.sitemapEntries) {
      duplicateCheck.set(entry.loc, (duplicateCheck.get(entry.loc) || 0) + 1);
    }
    for (const [url, count] of duplicateCheck) {
      if (count > 1) {
        warnings.push({
          type: "warning",
          code: "DUPLICATE_SITEMAP_ENTRY",
          message: `Duplicate sitemap entry: ${url} (appears ${count} times)`,
          suggestion: "Remove duplicate entries from the sitemap",
        });
      }
    }

    // ── Hreflang XML check ──────────────────────────────────────────────────
    // Verify the serialised sitemap XML:
    //   1. The <urlset> element declares xmlns:xhtml namespace (required by Google)
    //   2. At least one <xhtml:link rel="alternate"> tag exists for language pairs
    //
    // The raw XML is supplied by the validation service via context.sitemapXml so
    // this check works against the actual output rather than inferring from data.

    let hasXhtmlNamespace = false;
    let hasAlternateLinks = false;
    let hreflangPairedGroups = 0;
    let hreflangSingletonGroups = 0;
    const xmlChecked = Boolean(context.sitemapXml);

    if (context.sitemapXml) {
      hasXhtmlNamespace = context.sitemapXml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
      hasAlternateLinks = context.sitemapXml.includes('<xhtml:link rel="alternate"');

      if (!hasXhtmlNamespace) {
        warnings.push({
          type: "warning",
          code: "SITEMAP_MISSING_XHTML_NAMESPACE",
          message:
            'Sitemap <urlset> is missing the xmlns:xhtml="http://www.w3.org/1999/xhtml" namespace required for hreflang annotations',
          suggestion:
            'Add xmlns:xhtml="http://www.w3.org/1999/xhtml" to the <urlset> opening tag in server/sitemap.ts',
        });
      }

      if (!hasAlternateLinks) {
        warnings.push({
          type: "warning",
          code: "SITEMAP_MISSING_HREFLANG",
          message:
            'Sitemap does not contain any <xhtml:link rel="alternate"> hreflang annotations — Google cannot discover language relationships via the sitemap',
          suggestion:
            "Ensure entriesToXml() in server/sitemap.ts emits <xhtml:link> tags for EN/ES page pairs",
        });
      }
    } else {
      // Fallback: infer from entry locale data when context.sitemapXml is unavailable
      // (e.g. running in a stripped CLI environment without server modules).
      const localeGroups = new Map<string, string[]>();
      for (const entry of context.sitemapEntries) {
        if (!entry.locale) continue;
        const normalized = deriveNormalizedPath(entry.loc);
        const group = localeGroups.get(normalized) ?? [];
        group.push(entry.locale);
        localeGroups.set(normalized, group);
      }

      hreflangPairedGroups = [...localeGroups.values()].filter((g) => g.length >= 2).length;
      hreflangSingletonGroups = [...localeGroups.values()].filter((g) => g.length === 1).length;

      if (localeGroups.size > 0 && hreflangPairedGroups === 0 && hreflangSingletonGroups > 0) {
        warnings.push({
          type: "warning",
          code: "SITEMAP_MISSING_HREFLANG",
          message: `Sitemap has ${hreflangSingletonGroups} locale-specific page(s) with no translation partner — no hreflang annotations can be generated`,
          suggestion:
            'Add translations for these pages or verify the sitemap generator emits <xhtml:link rel="alternate"> tags for EN/ES pairs',
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
        contentUrlCount: contentUrls.size,
        sitemapUrlCount: sitemapUrls.size,
        orphanedEntries: errors.filter((e) => e.code === "ORPHAN_SITEMAP_ENTRY").length,
        missingFromSitemap: warnings.filter((w) => w.code === "CONTENT_NOT_IN_SITEMAP").length,
        hreflangXmlChecked: xmlChecked,
        hreflangNamespacePresent: hasXhtmlNamespace,
        hreflangAlternateLinksPresent: hasAlternateLinks,
        hreflangPairedGroups,
        hreflangSingletonGroups,
      },
    };
  },
};
