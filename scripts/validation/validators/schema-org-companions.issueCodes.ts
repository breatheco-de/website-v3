/**
 * Title-only issue-code catalog for schema-org-companions.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const SCHEMA_ORG_COMPANIONS_VALIDATOR_NAME = "schema-org-companions" as const;

export const SCHEMA_ORG_COMPANIONS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  SCHEMA_ORG_CONTENT_TYPE_REQUIREMENT: {
    title: "Schema Org Content Type Requirement",
  },
  SCHEMA_ORG_HERO_COURSE_COMPANION: {
    title: "Schema Org Hero Course Companion",
  },
};
