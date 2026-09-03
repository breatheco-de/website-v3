/**
 * Title-only issue-code catalog for orphaned-files.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const ORPHANED_FILES_VALIDATOR_NAME = "orphaned-files" as const;

export const ORPHANED_FILES_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  ORPHANED_FILE: {
    title: "Leftover file",
  },
};
