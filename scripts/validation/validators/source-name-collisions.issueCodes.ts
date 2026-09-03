/**
 * Title-only issue-code catalog for source-name-collisions.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const SOURCE_NAME_COLLISIONS_VALIDATOR_NAME = "source-name-collisions" as const;

export const SOURCE_NAME_COLLISIONS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  SOURCE_NAME_COLLISION: {
    title: "Source Name Collision",
  },
};
