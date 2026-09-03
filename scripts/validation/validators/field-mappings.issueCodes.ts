/**
 * Title-only issue-code catalog for field-mappings.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const FIELD_MAPPINGS_VALIDATOR_NAME = "field-mappings" as const;

export const FIELD_MAPPINGS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  FIELD_MAPPING_MISSING: {
    title: "Field mapping missing",
  },
  FIELD_MAPPING_PARTIAL: {
    title: "Field mapping partial",
  },
};
