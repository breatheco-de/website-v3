/**
 * Title-only issue-code catalog for schema.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const SCHEMA_VALIDATOR_NAME = "schema" as const;

export const SCHEMA_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  EMPTY_SCHEMA_INCLUDE: {
    title: "Empty Schema Include",
  },
  INVALID_SCHEMA_OVERRIDE: {
    title: "Invalid Schema Override",
  },
  INVALID_SCHEMA_REF: {
    title: "Invalid Schema Ref",
  },
};
