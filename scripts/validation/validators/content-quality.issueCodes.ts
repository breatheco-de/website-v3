/**
 * Title-only issue-code catalog for content-quality.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const CONTENT_QUALITY_VALIDATOR_NAME = "content-quality" as const;

export const CONTENT_QUALITY_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  BROKEN_INTERNAL_LINK: {
    title: "Broken Internal Link",
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
