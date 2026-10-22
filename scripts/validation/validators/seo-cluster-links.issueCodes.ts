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
  HUB_THIN_LINK_DENSE: {
    title: "Hub reads like a link list",
    summary:
      "This hub has many links for how little text it has, and not many pages under it. Readers and search engines get a list instead of an explanation.",
    suggestion:
      "Write more of the hub: a sentence or short paragraph per linked page saying what it answers, grouped under subtopic headings. Do not split a hub this small.",
    next_actions: [
      {
        tool: "get_entry_content",
        reason: "Read the hub body, then file an edits proposal that expands it (keep every existing link).",
        priority: "recommended",
      },
    ],
  },
  HUB_OVERLOADED: {
    title: "Hub has enough pages to split",
    summary:
      "This hub has many pages under it. If a group of them shares its own subtopic, that group can get its own hub, and this hub points to it instead of linking every page.",
    suggestion:
      "Group the pages by subtopic. For a group of about 5 or more with its own identity, file an idea that makes a new hub from those pages. Check the warning for split ideas already open on this hub first.",
    next_actions: [
      {
        tool: "list_seo_cluster_entries",
        reason: "See the hub's member pages and their keywords to find a subtopic group.",
        priority: "recommended",
      },
      {
        tool: "explain_site",
        reason: "Read topic proposals, subtopic hub-split, before filing the split idea.",
        priority: "recommended",
      },
    ],
  },
};
