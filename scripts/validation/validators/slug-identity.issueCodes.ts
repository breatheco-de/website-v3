/**
 * Title-only issue-code catalog for slug-identity.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const SLUG_IDENTITY_VALIDATOR_NAME = "slug-identity" as const;

export const SLUG_IDENTITY_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  COMMON_SLUG_DIFFERS_FROM_ID: {
    title: "Shared Address Differs From Page ID",
  },
  ENTRY_ID_NOT_SLUG: {
    title: "Page ID Not In Standard Slug Form",
  },
  SLUG_KEY_COLLISION: {
    title: "Two Pages Share An Address Key",
  },
};
