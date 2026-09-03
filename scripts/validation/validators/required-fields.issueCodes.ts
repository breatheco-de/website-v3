/**
 * Title-only issue-code catalog for required-fields.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const REQUIRED_FIELDS_VALIDATOR_NAME = "required-fields" as const;

export const REQUIRED_FIELDS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  FILL_INTENT_GOAL_NOT_PRESET: {
    title: "Fill Intent Goal Not Preset",
  },
  REQUIRED_FIELD_MISSING_FILL_INTENT: {
    title: "Required Field Missing Fill Intent",
  },
  REQUIRED_ATTACHED_FIELD_EMPTY: {
    title: "Required Attached Field Empty",
  },
  REQUIRED_FIELD_EMPTY: {
    title: "Required Field Empty",
  },
};
