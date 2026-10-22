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
  FORM_NO_REQUIRED_CONSENT: {
    title: "Form Has No Mandatory Consent Checkbox",
  },
  FORM_TWO_REQUIRED_CONSENTS: {
    title: "Form Has Two Mandatory Consent Checkboxes",
  },
  SITE_NO_DEFAULT_CONSENT: {
    title: "Site Has No Default Consent",
  },
};
