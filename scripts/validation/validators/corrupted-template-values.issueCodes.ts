/**
 * Issue-code catalog for corrupted-template-values.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const CORRUPTED_TEMPLATE_VALUES_VALIDATOR_NAME = "corrupted-template-values" as const;

export const CORRUPTED_TEMPLATE_VALUES_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  CORRUPTED_TEMPLATE_VALUE: {
    title: "Broken Template Placeholder",
    suggestion:
      'A {{ … }} placeholder was saved as {"[object Object]": null}, so the field renders empty and every later save of this file is blocked. Restore the original placeholder from the file history (e.g. updated_at: \'{{ entry.updated_at }}\') and push the file.',
    coding_agent_only: true,
  },
};
