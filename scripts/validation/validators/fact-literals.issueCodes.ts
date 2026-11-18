/**
 * Issue-code catalog for fact-literals (paid / cue-invited).
 */

import type { IssueCodeDefinition } from "../shared/types";

export const FACT_LITERALS_VALIDATOR_NAME = "fact-literals" as const;

export const FACT_LITERALS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  FACT_LITERAL_TOKEN_RECOMMENDED: {
    title: "Hardcoded Site Fact — Prefer Variable",
    summary:
      "Copy types a number that matches an approved site fact. Prefer the variable token so visitors see the right region.",
    suggestion: "Replace the literal with the suggested {{ global.* }} token (keep a fallback after | if useful).",
    next_actions: [
      {
        tool: "list_variables",
        reason: "Confirm the suggested variable is the right fact for this claim",
        priority: "recommended",
      },
      {
        tool: "update_fields",
        reason: "Write the field with the {{ global.* }} token instead of the hardcoded number",
        priority: "recommended",
      },
    ],
  },
  FACT_LITERAL_WRONG_AUDIENCE: {
    title: "Hardcoded Fact From Another Region",
    summary:
      "The number matches a site fact, but not the value this page's audience should see. Prefer the variable token.",
    suggestion: "Replace with the variable token so the page audience (and each visitor) get the correct value.",
    next_actions: [
      {
        tool: "list_variables",
        reason: "Check audience / literal_ok for this entry with context.entry",
        priority: "recommended",
      },
      {
        tool: "update_fields",
        reason: "Swap the literal for the variable token",
        priority: "recommended",
      },
    ],
  },
  FACT_LITERAL_VARIES: {
    title: "Region-Varying Fact Typed as a Fixed Number",
    summary: "This fact differs by region and the page has no single audience value — use the token.",
    suggestion: "Paste the {{ global.* }} token instead of freezing one region's number.",
    next_actions: [
      {
        tool: "list_variables",
        reason: "Inspect varies_by / conditions for the matched variable",
        priority: "recommended",
      },
      {
        tool: "update_fields",
        reason: "Replace the literal with the variable token",
        priority: "recommended",
      },
    ],
  },
  FACT_LITERAL_SUSPECTED: {
    title: "Possible Site Fact Without a Variable Token",
    summary:
      "Changed copy looks like a price, outcome, or company figure but did not exactly match the catalog. Check list_variables before leaving a hardcoded number.",
    suggestion: "If this is a site fact, paste the matching variable token; if it is a one-off cohort/chart figure, leave the literal.",
    next_actions: [
      {
        tool: "list_variables",
        reason: "Search the site facts catalog (facts_only or figures_only) for the right token",
        priority: "recommended",
      },
    ],
  },
};
