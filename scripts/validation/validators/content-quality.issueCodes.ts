/**
 * Title-only issue-code catalog for content-quality.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const CONTENT_QUALITY_VALIDATOR_NAME = "content-quality" as const;

export const CONTENT_QUALITY_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  BROKEN_INTERNAL_LINK: {
    title: "Broken Internal Link",
  },
  EMPTY_ENTRY_CONTENT: {
    title: "Empty Entry Content",
    summary:
      "Attached shared-layout locale has an empty body content field. " +
      "Often happens when DB→static convert skipped a failed remote markdown fetch (see convert skipped content_fetch_failed).",
    suggestion:
      "Set content via update_fields, or re-fetch the source markdown and paste it. Check convert skipped list for content_fetch_failed on this slug/locale.",
    next_actions: [
      {
        tool: "get_entry_fields",
        reason: "Inspect current content / title fields on this locale",
        priority: "recommended",
      },
      {
        tool: "update_fields",
        reason: "Write a non-empty content field for this locale",
        priority: "recommended",
      },
    ],
  },
  EMPTY_FIELD_VALUE: {
    title: "Empty Field Value",
  },
  EMPTY_LOCALE: {
    title: "Empty Locale",
  },
  EMPTY_SECTIONS: {
    title: "Empty Sections",
  },
  MISSING_TRANSLATION: {
    title: "Missing Translation",
  },
  SECTION_MISSING_TYPE: {
    title: "Section Missing Type",
  },
};
