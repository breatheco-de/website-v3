/**
 * Title-only issue-code catalog for seo-cluster-links.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const SEO_CLUSTER_LINKS_VALIDATOR_NAME = "seo-cluster-links" as const;

export const SEO_CLUSTER_LINKS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  HUB_MISSING_MEMBER_LINKS: {
    title: "Hub missing member links",
  },
  MEMBER_MISSING_HUB_LINK: {
    title: "Member missing hub link",
  },
};
