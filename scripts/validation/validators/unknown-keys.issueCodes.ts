/**
 * Title-only issue-code catalog for unknown-keys.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const UNKNOWN_KEYS_VALIDATOR_NAME = "unknown-keys" as const;

export const UNKNOWN_KEYS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  UNKNOWN_FIELD_KEY: {
    title: "Unknown Field Key",
  },
};
