/**
 * Title-only issue-code catalog for redirects.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const REDIRECTS_VALIDATOR_NAME = "redirects" as const;

export const REDIRECTS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  CUSTOM_REDIRECT_MISSING_DEST: {
    title: "Custom Redirect Missing Dest",
  },
  REDIRECT_CONFLICT: {
    title: "Redirect Conflict",
  },
  REDIRECT_LOOP: {
    title: "Redirect Loop",
  },
  REDIRECT_OVERLAP: {
    title: "Redirect Overlap",
  },
  REDIRECT_OVERWRITES_CONTENT: {
    title: "Redirect Overwrites Content",
  },
  REGEX_SHADOWED: {
    title: "Regex Shadowed",
  },
  SELF_REDIRECT: {
    title: "Self Redirect",
  },
};
