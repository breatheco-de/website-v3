/**
 * Title-only issue-code catalog for slug-conflicts.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const SLUG_CONFLICTS_VALIDATOR_NAME = "slug-conflicts" as const;

export const SLUG_CONFLICTS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  URL_CONFLICT: {
    title: "Url Conflict",
  },
};
