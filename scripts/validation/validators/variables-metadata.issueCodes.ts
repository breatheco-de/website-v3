/**
 * Issue-code catalog for variables-metadata (site facts in variables.yml).
 */

import type { IssueCodeDefinition } from "../shared/types";

export const VARIABLES_METADATA_VALIDATOR_NAME = "variables-metadata" as const;

const HANDOFF_SUGGESTION =
  "MCP cannot fix variables (list_variables is read-only and this issue cannot be claimed). " +
  "First check list_proposals for an open handoff that names this issue id and join it. " +
  "Otherwise file one propose_change with kind: \"notes\" and related_issue_ids, listing the site and the affected variable names, " +
  "for a Cursor coding agent or staff to fill description + category at /private/variables.";

export const VARIABLES_METADATA_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  VARIABLE_MISSING_DESCRIPTION: {
    title: "Variable Missing Description",
    summary:
      "A site variable has no description, so writers and agents cannot tell when to use it. " +
      "MCP cannot fix variables — requires a coding agent or staff.",
    suggestion: HANDOFF_SUGGESTION,
    coding_agent_only: true,
    next_actions: [],
  },
  VARIABLE_MISSING_CATEGORY: {
    title: "Variable Missing Category",
    summary:
      "A site variable has no category, so reviewers cannot tell how carefully to check changes (prices, outcome claims and social proof get extra review). " +
      "MCP cannot fix variables — requires a coding agent or staff.",
    suggestion: HANDOFF_SUGGESTION,
    coding_agent_only: true,
    next_actions: [],
  },
  VARIABLE_INVALID_CATEGORY: {
    title: "Variable Invalid Category",
    summary: "The variable's category is not one of the known categories.",
    suggestion:
      "Pick one of price, outcome_claim, social_proof, product_fact, company_fact, contact, link, copy, system at /private/variables.",
  },
  VARIABLE_INVALID_UNIT: {
    title: "Variable Invalid Unit",
    summary: "The variable's unit is not one of the known units.",
    suggestion: "Pick one of percent, usd, eur, count, weeks, rating, url, text (or clear it) at /private/variables.",
  },
  VARIABLE_INVALID_SOURCE: {
    title: "Variable Invalid Source",
    summary: "The variable's source is not one of the known sources.",
    suggestion: "Pick internal or external (or clear it) at /private/variables.",
  },
  VARIABLE_INVALID_PRODUCTS: {
    title: "Variable Invalid Products",
    summary: "products must be a list of sellable product content slugs.",
    suggestion: 'Use a YAML list of slugs (e.g. products: [ai-flex, full-stack]) or clear it for site-wide.',
  },
  VARIABLE_UNKNOWN_PRODUCT: {
    title: "Variable Unknown Product Slug",
    summary: "A products entry does not match a purchasable product on this site.",
    suggestion:
      "Pick sellable product slugs from the Store / Funnel product list (same as ecommerce_products), or remove the bad slug.",
  },
  VARIABLE_UNIT_MISMATCH: {
    title: "Variable Value Does Not Match Unit",
    summary:
      "A value does not look like its unit (e.g. \"84%\" in a percent field — copy that adds its own % then shows 84%%).",
    suggestion: "Store the bare value (84, 16,999) and keep symbols in the surrounding copy.",
  },
  VARIABLE_DEPRECATED_IN_USE: {
    title: "Deprecated Variable Still In Use",
    summary: "Content still references a deprecated variable.",
    suggestion:
      "Replace the token with its replaced_by variable (update_fields or propose_change), then staff can delete the deprecated one.",
  },
  VARIABLE_REPLACED_BY_BROKEN: {
    title: "Deprecated Variable Replacement Missing",
    summary: "replaced_by points to a variable that does not exist or is itself deprecated.",
    suggestion: "Point replaced_by at a live variable at /private/variables.",
  },
  VARIABLE_NEAR_DUPLICATE: {
    title: "Near-Duplicate Variable Names",
    summary: "Two live variables differ only by punctuation (e.g. ai_fluency_price vs ai.fluency.price).",
    suggestion: "Deprecate one with replaced_by pointing at the other at /private/variables.",
  },
};
