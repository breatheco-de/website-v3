/**
 * Updated-at Validator
 *
 * Warns when a non-empty editorial `updated_at` (entry-level or article section
 * prop) cannot be parsed by parseFlexibleDate. Empty/missing is fine (UI hides).
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { parseFlexibleDate } from "../../../shared/normalizeFlexibleDate";
import { resolveSingleVars } from "../../../server/single-resolver";
import { skipCrossEntryVariantRow } from "../shared/draftFiles";
import { resolvePageSections } from "./schema-completeness";
import { UPDATED_AT_ISSUE_CODES } from "./updated-at.issueCodes";

const TEMPLATE_RE = /\{\{[\s\S]*?\}\}/;

function isNonEmpty(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === "string") return raw.trim().length > 0;
  if (typeof raw === "number" || typeof raw === "bigint") return true;
  if (raw instanceof Date) return !isNaN(raw.getTime());
  return false;
}

function isInvalidUpdatedAt(raw: unknown): boolean {
  if (!isNonEmpty(raw)) return false;
  if (typeof raw === "string" && TEMPLATE_RE.test(raw)) return true;
  return parseFlexibleDate(raw) === null;
}

export const updatedAtValidator: Validator = {
  name: "updated-at",
  issueCodes: UPDATED_AT_ISSUE_CODES,
  description:
    "Warns when non-empty updated_at values (entry or article section) are unparseable",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "seo",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const warnings: ValidationIssue[] = [];
    const errors: ValidationIssue[] = [];

    for (const file of context.contentFiles) {
      if (skipCrossEntryVariantRow(file)) continue;

      const bag: Record<string, unknown> = {
        ...(file.entryFields || {}),
        title: file.title,
        description: file.description,
        slug: file.slug,
      };

      const entryRaw = file.entryFields?.updated_at ?? file.entryFields?._updated_at;
      const hasEntryKey =
        file.entryFields != null &&
        (Object.prototype.hasOwnProperty.call(file.entryFields, "updated_at") ||
          Object.prototype.hasOwnProperty.call(file.entryFields, "_updated_at"));

      if (hasEntryKey) {
        const entryResolved = resolveSingleVars(
          { updated_at: entryRaw },
          bag,
        ) as { updated_at?: unknown };
        // Prefer resolved value (null means empty after {{ single.* }} resolve) — do not
        // fall back to the raw template string via ??.
        const entryVal = entryResolved.updated_at;

        if (isInvalidUpdatedAt(entryVal)) {
          warnings.push({
            type: "warning",
            code: "INVALID_UPDATED_AT",
            message: `Entry updated_at is non-empty but unparseable: ${JSON.stringify(entryVal ?? entryRaw)}`,
            file: file.filePath,
            suggestion:
              "Use an ISO date (YYYY-MM-DD) or ISO datetime (e.g. 2026-03-15T12:00:00Z). Leave empty to hide Last updated.",
          });
        }
      }

      const sections = resolvePageSections(file);
      sections.forEach((section, index) => {
        if (!section || typeof section !== "object") return;
        if (String(section.type ?? "") !== "article") return;
        if (!Object.prototype.hasOwnProperty.call(section, "updated_at")) return;

        const resolvedSection = resolveSingleVars(section, bag) as Record<string, unknown>;
        const propVal = resolvedSection.updated_at;
        if (!isInvalidUpdatedAt(propVal)) return;

        const sectionId =
          typeof section.section_id === "string" && section.section_id.trim()
            ? section.section_id.trim()
            : `sections[${index}]`;

        warnings.push({
          type: "warning",
          code: "INVALID_UPDATED_AT",
          message: `Article section "${sectionId}" updated_at is non-empty but unparseable: ${JSON.stringify(propVal ?? section.updated_at)}`,
          file: file.filePath,
          suggestion:
            "Map updated_at: '{{ single.updated_at }}' and ensure the entry has a valid ISO date, or clear the value.",
        });
      });
    }

    return {
      name: this.name,
      description: this.description,
      status: warnings.length > 0 ? "warning" : "passed",
      errors,
      warnings,
      duration: Date.now() - startTime,
      category: this.category,
    };
  },
};
