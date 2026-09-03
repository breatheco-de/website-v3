/**
 * Title-only issue-code catalog for sitemap.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const SITEMAP_VALIDATOR_NAME = "sitemap" as const;

export const SITEMAP_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  CONTENT_NOT_IN_SITEMAP: {
    title: "Content Not In Sitemap",
  },
  DUPLICATE_SITEMAP_ENTRY: {
    title: "Duplicate Sitemap Entry",
  },
  ORPHAN_SITEMAP_ENTRY: {
    title: "Orphan sitemap entry",
  },
  SITEMAP_MISSING_HREFLANG: {
    title: "Sitemap Missing Hreflang",
  },
  SITEMAP_MISSING_XHTML_NAMESPACE: {
    title: "Sitemap Missing Xhtml Namespace",
  },
};
