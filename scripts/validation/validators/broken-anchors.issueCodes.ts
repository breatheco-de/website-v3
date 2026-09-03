/**
 * Title-only issue-code catalog for broken-anchors.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const BROKEN_ANCHORS_VALIDATOR_NAME = "broken-anchors" as const;

export const BROKEN_ANCHORS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  BROKEN_ANCHOR: {
    title: "Broken Anchor",
  },
};
