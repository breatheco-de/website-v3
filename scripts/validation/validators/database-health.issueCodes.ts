/**
 * Title-only issue-code catalog for database-health.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const DATABASE_HEALTH_VALIDATOR_NAME = "database-health" as const;

export const DATABASE_HEALTH_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  DATABASE_NOT_FOUND: {
    title: "Database Not Found",
  },
  MISSING_CONTENT_ROOT: {
    title: "Missing Content Root",
  },
};
