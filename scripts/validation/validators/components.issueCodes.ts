/**
 * Title-only issue-code catalog for components.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const COMPONENTS_VALIDATOR_NAME = "components" as const;

export const COMPONENTS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  EMPTY_EXAMPLES: {
    title: "Empty Examples",
  },
  INVALID_EXAMPLE_VARIANT: {
    title: "Invalid Example Variant",
  },
  INVALID_EXAMPLE_YAML: {
    title: "Invalid Example Yaml",
  },
  INVALID_SCHEMA_YAML: {
    title: "Invalid Schema Yaml",
  },
  INVALID_SECTION_DEFAULT: {
    title: "Invalid Section Default",
  },
  INVALID_SECTION_DEFAULTS: {
    title: "Invalid Section Defaults",
  },
  MISSING_EXAMPLE_NAME: {
    title: "Missing Example Name",
  },
  MISSING_SCHEMA: {
    title: "Missing Schema",
  },
  MISSING_SCHEMA_NAME: {
    title: "Missing Schema Name",
  },
  NO_COMPONENT_REGISTRY: {
    title: "No Component Registry",
  },
  NO_EXAMPLES: {
    title: "No Examples",
  },
  NO_VERSIONS: {
    title: "No Versions",
  },
};
