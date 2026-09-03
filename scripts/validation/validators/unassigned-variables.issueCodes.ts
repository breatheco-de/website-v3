/**
 * Title-only issue-code catalog for unassigned-variables.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const UNASSIGNED_VARIABLES_VALIDATOR_NAME = "unassigned-variables" as const;

export const UNASSIGNED_VARIABLES_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  UNASSIGNED_VARIABLE: {
    title: "Unassigned Variable",
  },
};
