/**
 * Title-only issue-code catalog for updated-at.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const UPDATED_AT_VALIDATOR_NAME = "updated-at" as const;

export const UPDATED_AT_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  INVALID_UPDATED_AT: {
    title: "Invalid Updated At",
  },
};
