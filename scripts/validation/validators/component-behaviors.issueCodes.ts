/**
 * Title-only issue-code catalog for component-behaviors.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const COMPONENT_BEHAVIORS_VALIDATOR_NAME = "component-behaviors" as const;

export const COMPONENT_BEHAVIORS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  BEHAVIOR_MISSING_CONVERSION: {
    title: "Behavior Missing Conversion",
  },
  BEHAVIOR_MISSING_ECOMMERCE: {
    title: "Behavior Missing Ecommerce",
  },
  BEHAVIOR_MISSING_LISTING: {
    title: "Behavior Missing Listing",
  },
  BEHAVIOR_MISSING_SCHEMA_ORG: {
    title: "Behavior Missing Schema Org",
  },
};
