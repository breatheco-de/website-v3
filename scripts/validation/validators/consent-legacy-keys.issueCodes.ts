/**
 * Title-only issue-code catalog for consent-legacy-keys.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const CONSENT_LEGACY_KEYS_VALIDATOR_NAME = "consent-legacy-keys" as const;

export const CONSENT_LEGACY_KEYS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  CONSENT_OBSOLETE_KEY: {
    title: "Consent Obsolete Key",
  },
};
