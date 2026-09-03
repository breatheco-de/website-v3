/**
 * Title-only issue-code catalog for static-field-overrides.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const STATIC_FIELD_OVERRIDES_VALIDATOR_NAME = "static-field-overrides" as const;

export const STATIC_FIELD_OVERRIDES_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  STATIC_FIELD_OVERRIDES_BAG: {
    title: "Static Field Overrides Bag",
  },
};
