/**
 * Title-only issue-code catalog for backgrounds.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const BACKGROUNDS_VALIDATOR_NAME = "backgrounds" as const;

export const BACKGROUNDS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  INVALID_BACKGROUND: {
    title: "Invalid Background",
  },
  NO_THEME_CONFIG: {
    title: "No Theme Config",
  },
};
