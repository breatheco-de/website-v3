/**
 * Title-only issue-code catalog for section-variants.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const SECTION_VARIANTS_VALIDATOR_NAME = "section-variants" as const;

export const SECTION_VARIANTS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  UNKNOWN_SECTION_VARIANT: {
    title: "Unknown Section Variant",
  },
};
