/**
 * Title-only issue-code catalog for seo-intent.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const SEO_INTENT_VALIDATOR_NAME = "seo-intent" as const;

export const SEO_INTENT_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  CONFIG_MISSING: {
    title: "Config Missing",
  },
  INVALID_FOCUS_FEATURE: {
    title: "Invalid Focus Feature",
  },
  INVALID_INTENT: {
    title: "Invalid Intent",
  },
};
