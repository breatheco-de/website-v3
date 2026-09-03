/**
 * Title-only issue-code catalog for schema-completeness.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const SCHEMA_COMPLETENESS_VALIDATOR_NAME = "schema-completeness" as const;

export const SCHEMA_COMPLETENESS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  FAQ_SECTION_NO_SCHEMA: {
    title: "FAQ section missing schema",
  },
  PAGE_NO_SCHEMA: {
    title: "Page No Schema",
  },
  SCHEMA_INVALID_INCLUDE: {
    title: "Schema Invalid Include",
  },
  SCHEMA_INVALID_JSON: {
    title: "Schema Invalid Json",
  },
  SCHEMA_PLACEHOLDER_VALUE: {
    title: "Schema Placeholder Value",
  },
  SCHEMA_RENDER_ERROR: {
    title: "Schema Render Error",
  },
};
