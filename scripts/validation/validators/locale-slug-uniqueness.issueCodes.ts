/**
 * Title-only issue-code catalog for locale-slug-uniqueness.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const LOCALE_SLUG_UNIQUENESS_VALIDATOR_NAME = "locale-slug-uniqueness" as const;

export const LOCALE_SLUG_UNIQUENESS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  SLUG_SHARED_ACROSS_LOCALES: {
    title: "Slug Shared Across Locales",
  },
};
