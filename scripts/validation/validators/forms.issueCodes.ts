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
  FORM_UNKNOWN_TRACKING_PRODUCT: {
    title: "Form Sends An Unknown Product",
    summary:
      "The form's hidden product field names a product this site doesn't have. Leads still go through; analytics and the CRM get the value exactly as typed.",
    suggestion:
      "Fix the hidden product field (fields.product) to an existing product id, or remove it so the form uses the page's products.",
    next_actions: [
      { tool: "list_products", reason: "List valid product ids", priority: "recommended" },
      { tool: "update_fields", reason: "Fix fields.product on the form section", priority: "optional" },
    ],
  },
  FORM_UNKNOWN_TRACKING_PERSONA: {
    title: "Form Sends An Unknown Persona",
    summary:
      "The form's hidden persona field names a persona no product on this site has. It is sent as typed.",
    suggestion:
      "Fix the hidden persona field (fields.persona) to a persona id from the product's audience, or remove it.",
    next_actions: [
      { tool: "get_product", reason: "List the product's persona ids", priority: "recommended" },
      { tool: "update_fields", reason: "Fix fields.persona on the form section", priority: "optional" },
    ],
  },
  FORM_TRACKING_PERSONA_PRODUCT_MISMATCH: {
    title: "Form Persona Doesn't Belong To Its Product",
    summary:
      "The form overrides both product and persona, but the persona belongs to a different product, so leads get a product + persona pair the site never defined.",
    suggestion: "Pick a persona from the overridden product's audience, or change the product.",
    next_actions: [{ tool: "get_product", reason: "Check which personas the product has", priority: "recommended" }],
  },
  FORM_TRACKING_OVERRIDE_USES_CODE: {
    title: "Form Override Uses A Tracking Code",
    summary:
      "The hidden product or persona field uses a short tracking code instead of the full id. It works; reports and the CRM are unaffected.",
    suggestion: "Replace the code with the full id so the form reads the same as page funnels.",
    next_actions: [{ tool: "update_fields", reason: "Use the full id in fields.product / fields.persona", priority: "optional" }],
  },
};
