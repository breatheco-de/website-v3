/**
 * Title-only issue-code catalog for seo-duplicates.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const SEO_DUPLICATES_VALIDATOR_NAME = "seo-duplicates" as const;

export const SEO_DUPLICATES_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  DUPLICATE_DESCRIPTION: {
    title: "Duplicate Description",
  },
  DUPLICATE_TITLE: {
    title: "Duplicate Title",
  },
};
