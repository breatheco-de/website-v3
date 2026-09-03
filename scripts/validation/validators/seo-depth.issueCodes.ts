/**
 * Title-only issue-code catalog for seo-depth.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const SEO_DEPTH_VALIDATOR_NAME = "seo-depth" as const;

export const SEO_DEPTH_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  DESCRIPTION_TOO_LONG: {
    title: "Description Too Long",
  },
  DESCRIPTION_TOO_SHORT: {
    title: "Description Too Short",
  },
  MISSING_CANONICAL: {
    title: "Missing Canonical",
  },
  MISSING_OG_IMAGE: {
    title: "Missing Og Image",
  },
  TITLE_TOO_LONG: {
    title: "Title Too Long",
  },
  TITLE_TOO_SHORT: {
    title: "Title Too Short",
  },
};
