/**
 * Title-only issue-code catalog for relation-targets.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const RELATION_TARGETS_VALIDATOR_NAME = "relation-targets" as const;

export const RELATION_TARGETS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  FIELD_RELATION_TARGET_MISSING: {
    title: "Relation target missing",
  },
  RELATION_SOURCE_COLLISION: {
    title: "Relation Source Collision",
  },
  RELATION_SOURCE_NOT_FOUND: {
    title: "Relation Source Not Found",
  },
};
