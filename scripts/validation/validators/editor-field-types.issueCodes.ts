/**
 * Title-only issue-code catalog for editor-field-types.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const EDITOR_FIELD_TYPES_VALIDATOR_NAME = "editor-field-types" as const;

export const EDITOR_FIELD_TYPES_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  EDITOR_JSON_SCHEMA_MISSING: {
    title: "JSON schema missing",
  },
  EDITOR_ORPHAN_HINT: {
    title: "Orphan editor hint",
  },
  EDITOR_RELATION_SOURCE_MISSING: {
    title: "Relation source missing",
  },
  EDITOR_TYPE_MISSING: {
    title: "Editor type missing",
  },
  EDITOR_TYPE_UNKNOWN: {
    title: "Unknown editor type",
  },
  FIELD_JSON_INVALID: {
    title: "Invalid JSON field",
  },
  FIELD_JSON_STORED_AS_STRING: {
    title: "JSON stored as string",
  },
  FIELD_RELATION_INVALID: {
    title: "Invalid relation field",
  },
  FIELD_TYPE_MISMATCH: {
    title: "Field type mismatch",
  },
};
