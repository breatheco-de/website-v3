/**
 * Title-only issue-code catalog for database-singles.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const DATABASE_SINGLES_VALIDATOR_NAME = "database-singles" as const;

export const DATABASE_SINGLES_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  DATABASE_UNREACHABLE: {
    title: "Database Unreachable",
  },
  DISK_OVERRIDES_DATABASE: {
    title: "Disk Overrides Database",
  },
  DUPLICATE_DATABASE_SLUG: {
    title: "Duplicate Database Slug",
  },
  DUPLICATE_TEMPLATE_SHELL_NAMING: {
    title: "Duplicate Template Shell Naming",
  },
  MISSING_LOCALE_FIELD: {
    title: "Missing Locale Field",
  },
  MISSING_SINGLE_TEMPLATE: {
    title: "Missing Single Template",
  },
  UNRESOLVED_SINGLE_VARS: {
    title: "Unresolved Single Vars",
  },
};
