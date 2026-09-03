/**
 * Title-only issue-code catalog for binding-integrity.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const BINDING_INTEGRITY_VALIDATOR_NAME = "binding-integrity" as const;

export const BINDING_INTEGRITY_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  BINDING_CHECK_FAILED: {
    title: "Binding Check Failed",
  },
  STALE_BINDING_REFERENCES: {
    title: "Stale Binding References",
  },
};
