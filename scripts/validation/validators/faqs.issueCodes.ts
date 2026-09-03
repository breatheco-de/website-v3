/**
 * Title-only issue-code catalog for faqs.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const FAQS_VALIDATOR_NAME = "faqs" as const;

export const FAQS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  FAQ_FILE_NOT_FOUND: {
    title: "Faq File Not Found",
  },
  FAQ_PARSE_ERROR: {
    title: "Faq Parse Error",
  },
  INVALID_DATE_FORMAT: {
    title: "Invalid Date Format",
  },
  INVALID_FAQ_STRUCTURE: {
    title: "Invalid Faq Structure",
  },
  MISSING_LAST_UPDATED: {
    title: "Missing Last Updated",
  },
  STALE_FAQ_ANSWER: {
    title: "Stale Faq Answer",
  },
  TOO_MANY_TAGS: {
    title: "Too Many Tags",
  },
};
