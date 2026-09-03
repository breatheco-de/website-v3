/**
 * Title-only issue-code catalog for forms.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const FORMS_VALIDATOR_NAME = "forms" as const;

export const FORMS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  FORM_INVALID_CONVERSION_NAME: {
    title: "Form Invalid Conversion Name",
  },
  FORM_MISSING_CONVERSION_NAME: {
    title: "Form Missing Conversion Name",
  },
  FORM_SIGNUP_FIELD_MAP: {
    title: "Form Signup Field Map",
  },
};
