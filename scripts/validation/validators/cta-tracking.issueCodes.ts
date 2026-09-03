/**
 * Title-only issue-code catalog for cta-tracking.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const CTA_TRACKING_VALIDATOR_NAME = "cta-tracking" as const;

export const CTA_TRACKING_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  CTA_PURCHASABLE_MISSING: {
    title: "Cta Purchasable Missing",
  },
  CTA_TRACKING_INVALID: {
    title: "Cta Tracking Invalid",
  },
};
