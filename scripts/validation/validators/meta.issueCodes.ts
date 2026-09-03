/**
 * Title-only issue-code catalog for meta.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const META_VALIDATOR_NAME = "meta" as const;

export const META_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  INVALID_CHANGE_FREQUENCY: {
    title: "Invalid Change Frequency",
  },
  INVALID_PRIORITY: {
    title: "Invalid Priority",
  },
  META_USES_GLOBAL_VAR: {
    title: "Meta Uses Global Var",
  },
  UNKNOWN_ROBOTS_DIRECTIVE: {
    title: "Unknown Robots Directive",
  },
  UNRESOLVED_META_TEMPLATE: {
    title: "Unresolved Meta Template",
  },
  MISSING_PAGE_TITLE: {
    title: "Missing Page Title",
  },
  MISSING_DESCRIPTION: {
    title: "Missing Description",
  },
};
