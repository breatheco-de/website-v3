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
  ORPHAN_OVERLAY_FOLDER: {
    title: "Orphan Overlay Folder",
    summary:
      "Slug folder on disk has no matching database row. Convert-to-static will not update it. " +
      "Requires a coding agent or staff to delete (content repo) or restore upstream — MCP cannot delete folders.",
    suggestion:
      "If unused, delete the folder via a Cursor coding agent / content sync. If still needed, restore the row in the upstream database. Do not claim this issue via MCP.",
    coding_agent_only: true,
    next_actions: [],
  },
  UNRESOLVED_SINGLE_VARS: {
    title: "Unresolved Single Vars",
  },
};
