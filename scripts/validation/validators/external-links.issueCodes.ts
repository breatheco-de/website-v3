/**
 * Issue-code catalog for external-links.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const EXTERNAL_LINKS_VALIDATOR_NAME = "external-links" as const;

const fixNextActions: IssueCodeDefinition["next_actions"] = [
  {
    tool: "get_entry_fields",
    reason: "Read the field named in external_link.field_paths to find the link in context",
    priority: "recommended",
  },
  {
    tool: "update_fields",
    reason: "Replace the URL with a live source (or the archived copy in external_link.archive_lookup) or remove the link",
    priority: "recommended",
  },
  {
    tool: "update_issue",
    reason:
      "Only with evidence the link works for visitors: action mark_link_ok with a reason. Applies to every page using the URL.",
    priority: "optional",
  },
];

export const EXTERNAL_LINKS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  EXTERNAL_LINK_GONE: {
    title: "External Link Gone",
    summary:
      "This page links to an external page that no longer exists: the site answered \"not found\" (404/410) " +
      "or sent the link to its homepage, on two checks at least 3 days apart.",
    suggestion:
      "Replace the link with a live source or an archived copy, or remove it. If it works for visitors, mark it as working.",
    next_actions: fixNextActions,
  },
  OWN_MEDIA_GONE: {
    title: "Image Missing From Our Storage",
    summary: "This image no longer exists on our storage, so visitors see a broken image.",
    suggestion: "Upload the image again (or pick another from the Media Gallery) and update the field.",
    next_actions: [
      {
        tool: "get_or_set_media_to_gallery",
        reason: "Find or upload a replacement image",
        priority: "recommended",
      },
      {
        tool: "update_fields",
        reason: "Point the field named in external_link.field_paths at the replacement",
        priority: "recommended",
      },
    ],
  },
  EXTERNAL_LINK_UNREACHABLE: {
    title: "External Link Unreachable",
    summary:
      "This page links to a site that could not be reached on two checks at least 3 days apart: " +
      "its domain does not exist or its security certificate is invalid.",
    suggestion:
      "Check the link yourself. Replace or remove it if the site is gone; mark it as working if it opens normally.",
    next_actions: fixNextActions,
  },
};
