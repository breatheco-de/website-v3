/**
 * Thin issue-code catalog for seo-cluster (no fs / server imports).
 * Staff site notes live under {contentRoot}/validation-issue-context/seo-cluster/{CODE}.md
 */

import type { IssueCodeDefinition } from "../shared/types";

export const SEO_CLUSTER_VALIDATOR_NAME = "seo-cluster" as const;

const CLUSTER_GAP_NEXT_ACTIONS: IssueCodeDefinition["next_actions"] = [
  {
    tool: "get_entry_seo",
    reason: "Inspect current seo (keyword, pillar_path, is_pillar, include_in_clustering).",
    priority: "recommended",
  },
  {
    tool: "list_seo_clusters",
    reason: "Find an existing hub before becoming a pillar or opting out.",
    priority: "recommended",
  },
  {
    tool: "list_seo_cluster_entries",
    reason: "Browse unclustered / partially set / clustered members if needed.",
    priority: "optional",
  },
  {
    tool: "update_fields",
    reason:
      "Apply seo.pillar_path (join hub), seo.is_pillar: true (become hub), or opt out. Risky pillar/opt-out needs confirm_cluster_resolution: true while this issue is open.",
    priority: "recommended",
  },
  {
    tool: "run_entry_diagnostics",
    reason: "Re-run SEO diagnostics to confirm the warning is gone (cache may lag).",
    priority: "optional",
  },
];

const CLUSTER_GAP_SUGGESTION =
  "Prefer joining an existing hub (seo.pillar_path). List hubs first. Become a hub (seo.is_pillar: true) or opt out (seo.pillar_path: null) only when that is the real intent — not just to clear this warning.";

export const SEO_CLUSTER_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  SEO_KEYWORD_RESEARCH_INCOMPLETE: {
    title: "Incomplete keyword research",
  },
  SEO_BLOCK_ON_COMMON_YML: {
    title: "SEO block on _common.yml",
  },
  INVALID_PILLAR: {
    title: "Invalid pillar path",
  },
  DUPLICATE_PILLAR: {
    title: "Duplicate hub path",
  },
  ORPHAN_PAGE: {
    title: "Unclustered page",
    summary:
      "This live page must belong to a topic cluster (or be opted out). Three resolutions: (1) join an existing hub with seo.pillar_path, (2) become a hub with seo.is_pillar: true only if this page is the topic overview and no hub exists, (3) opt out with seo.pillar_path: null only if it should not be clustered. Not a leftover file; not a broken hub link.",
    suggestion: CLUSTER_GAP_SUGGESTION,
    next_actions: CLUSTER_GAP_NEXT_ACTIONS,
  },
  PARTIALLY_SET_CLUSTER: {
    title: "Partially set cluster",
    summary:
      "Like an unclustered page, but seo.main_keyword is already set and there is still no hub. Three resolutions: (1) join an existing hub with seo.pillar_path, (2) become a hub with seo.is_pillar: true only if this page is the topic overview and no hub exists, (3) opt out with seo.pillar_path: null only if it should not be clustered.",
    suggestion: CLUSTER_GAP_SUGGESTION,
    next_actions: CLUSTER_GAP_NEXT_ACTIONS,
  },
};
