/**
 * FAQ Validator — validates frequently_asked_questions DB rows
 * (last_updated freshness + related_features tag count).
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type {
  Validator,
  ValidatorResult,
  ValidationContext,
  ValidationIssue,
} from "../shared/types";
import { getDefaultContentRoot } from "../../../server/site-config";
import { FAQS_ISSUE_CODES } from "./faqs.issueCodes";

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

interface FAQEntry {
  question: string;
  answer: string;
  locale?: string;
  last_updated?: string;
  locations?: string[];
  related_features?: string[];
  priority?: number;
}

function validateFaqEntries(
  filePath: string,
  faqs: FAQEntry[],
  errors: ValidationIssue[],
): number {
  const now = Date.now();
  const sixMonthsAgo = now - SIX_MONTHS_MS;
  let entriesChecked = 0;

  faqs.forEach((faq, index) => {
    entriesChecked++;
    const questionPreview =
      faq.question?.substring(0, 50) || `Entry ${index + 1}`;

    if (!faq.last_updated) {
      errors.push({
        type: "error",
        code: "MISSING_LAST_UPDATED",
        message: `FAQ "${questionPreview}..." is missing last_updated date`,
        file: filePath,
        line: index + 1,
        suggestion: "Add 'last_updated: YYYY-MM-DD' to this FAQ entry",
      });
      return;
    }

    const updateDate = new Date(faq.last_updated);
    if (isNaN(updateDate.getTime())) {
      errors.push({
        type: "error",
        code: "INVALID_DATE_FORMAT",
        message: `FAQ "${questionPreview}..." has invalid date format: ${faq.last_updated}`,
        file: filePath,
        line: index + 1,
        suggestion: "Use YYYY-MM-DD format (e.g., 2025-01-15)",
      });
      return;
    }

    if (updateDate.getTime() < sixMonthsAgo) {
      const monthsAgo = Math.floor(
        (now - updateDate.getTime()) / (30 * 24 * 60 * 60 * 1000),
      );
      errors.push({
        type: "error",
        code: "STALE_FAQ_ANSWER",
        message: `FAQ "${questionPreview}..." was last updated ${monthsAgo} months ago (${faq.last_updated})`,
        file: filePath,
        line: index + 1,
        suggestion:
          "Review and update this FAQ answer, then set last_updated to today's date",
      });
    }

    const tagCount = faq.related_features?.length || 0;
    if (tagCount > 2) {
      errors.push({
        type: "error",
        code: "TOO_MANY_TAGS",
        message: `FAQ "${questionPreview}..." has ${tagCount} tags. Maximum allowed is 2 (1 tag preferred, 2 only in extraordinary cases).`,
        file: filePath,
        line: index + 1,
        suggestion: "Reduce to 1-2 tags. Keep only the most relevant tag(s).",
      });
    }
  });

  return entriesChecked;
}

export const faqsValidator: Validator = {
  name: "faqs",
  issueCodes: FAQS_ISSUE_CODES,
  description:
    "Validates FAQ database entries (frequently_asked_questions) have last_updated within 6 months and at most 2 tags",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "content",

  async run(_context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    let contentRoot: string;
    try {
      contentRoot = getDefaultContentRoot();
    } catch {
      contentRoot = path.resolve(process.cwd(), "site_4geeks-com");
    }

    const filePath = path.join(
      contentRoot,
      "db",
      "frequently_asked_questions",
      "faqs.yml",
    );

    let total = 0;
    if (!fs.existsSync(filePath)) {
      errors.push({
        type: "error",
        code: "FAQ_FILE_NOT_FOUND",
        message: `FAQ database file not found: ${filePath}`,
        file: filePath,
        suggestion: "Ensure db/frequently_asked_questions/faqs.yml exists in the content root",
      });
    } else {
      try {
        const parsed = yaml.load(fs.readFileSync(filePath, "utf-8")) as {
          faqs?: FAQEntry[];
        };
        if (!parsed?.faqs || !Array.isArray(parsed.faqs)) {
          errors.push({
            type: "error",
            code: "INVALID_FAQ_STRUCTURE",
            message: "FAQ database must contain a 'faqs' array",
            file: filePath,
            suggestion: "Add a 'faqs:' key with an array of FAQ entries",
          });
        } else {
          total = validateFaqEntries(filePath, parsed.faqs, errors);
        }
      } catch (error) {
        errors.push({
          type: "error",
          code: "FAQ_PARSE_ERROR",
          message: `Failed to parse FAQ database: ${error instanceof Error ? error.message : String(error)}`,
          file: filePath,
          suggestion: "Check the YAML syntax in this file",
        });
      }
    }

    const duration = Date.now() - startTime;
    const staleCount = errors.filter((e) => e.code === "STALE_FAQ_ANSWER").length;
    const missingDateCount = errors.filter(
      (e) => e.code === "MISSING_LAST_UPDATED",
    ).length;

    return {
      name: this.name,
      description: this.description,
      status:
        errors.length > 0
          ? "failed"
          : warnings.length > 0
            ? "warning"
            : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        filesChecked: 1,
        totalFAQs: total,
        staleFAQs: staleCount,
        missingDates: missingDateCount,
      },
    };
  },
};
