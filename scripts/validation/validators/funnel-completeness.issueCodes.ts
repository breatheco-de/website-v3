/**
 * Title-only issue-code catalog for funnel-completeness.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const FUNNEL_COMPLETENESS_VALIDATOR_NAME = "funnel-completeness" as const;

export const FUNNEL_COMPLETENESS_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  MISSING_FUNNEL_STAGE: {
    title: "Missing Funnel Stage",
    summary: "Page lacks funnel.stage while funnel enforcement is on for this content type.",
    suggestion: "Set funnel.stage on _common.yml (Funnel tab): awareness, consideration, decision, or post-enrollment.",
    next_actions: [
      {
        tool: "update_fields",
        reason: "Set funnel.stage on the page",
        priority: "recommended",
      },
    ],
  },
  MISSING_FUNNEL_PRODUCTS: {
    title: "Missing Funnel Products",
    summary: "Page lacks funnel.products while the site has purchasable products and enforcement is on.",
    suggestion: 'Set funnel.products to "all" or product+persona bindings on _common.yml (Funnel tab).',
    next_actions: [
      {
        tool: "update_fields",
        reason: "Set funnel.products on the page",
        priority: "recommended",
      },
    ],
  },
  MISSING_PRODUCT_AUDIENCE: {
    title: "Missing Product Audience",
    summary: "Funnel binding targets a product without a minimal audience.",
    suggestion: "Add offer + persona on the product (_product.yml), then retry the binding.",
    next_actions: [
      { tool: "get_product", reason: "Inspect product audience", priority: "recommended" },
      { tool: "create_or_update_product", reason: "Set minimal audience", priority: "optional" },
    ],
  },
  MISSING_FUNNEL_PERSONA: {
    title: "Missing Funnel Persona",
    summary: "Product binding requires a persona because the product has an audience.",
    suggestion: "Add persona to the binding (program self-page may omit for itself only).",
    next_actions: [
      { tool: "update_fields", reason: "Set persona on funnel.products binding", priority: "recommended" },
    ],
  },
  UNKNOWN_PERSONA: {
    title: "Unknown Funnel Persona",
    summary: "Binding persona id is not defined on the product audience.",
    suggestion: "Use a persona id from the product audience, or add that persona on the product.",
    next_actions: [
      { tool: "get_product", reason: "List valid persona ids", priority: "recommended" },
    ],
  },
  INACTIVE_FUNNEL_PRODUCT: {
    title: "Inactive Funnel Product",
    summary: "Funnel binding references an unknown or non-purchasable product.",
    suggestion: "Point the binding at an active purchasable product, or remove it.",
  },
  MISSING_TRACKING_SHORT_KEY: {
    title: "Missing Tracking Key",
    summary:
      "A product or persona has no tracking key, so analytics events carry its full id instead of a short code. Tracking keeps working.",
    suggestion:
      "Press Fix to assign suggested keys, or set one in the Store (Tracking key) first if you want to pick it yourself.",
    next_actions: [
      {
        tool: "create_or_update_product",
        reason: "Any write to the product fills its missing short_key values (confirm: true)",
        priority: "recommended",
      },
    ],
  },
  TRACKING_NOT_READY: {
    title: "Product Tracking Not Switched On",
    summary:
      "Events don't carry product / persona codes on this site yet: tracking switches on once every product and persona has a tracking key.",
    suggestion:
      "Run migration 009_assign_tracking_short_keys (Settings → General → Migrations; dry run first), or press Fix here.",
    next_actions: [
      {
        tool: "create_or_update_product",
        reason: "Writes fill missing short_key values for that product",
        priority: "optional",
      },
    ],
  },
  DUPLICATE_TRACKING_SHORT_KEY: {
    title: "Duplicate Tracking Key",
    summary:
      "Two products (or two personas) share a tracking key, or a key reuses a retired one, so reports merge them.",
    suggestion:
      "Rename one of them in the Store (Rename key). The old key is retired; earlier reports keep it.",
    next_actions: [
      { tool: "get_product", reason: "Read the product's keys and tracking_keys.taken_*", priority: "recommended" },
      {
        tool: "create_or_update_product",
        reason: "Set a free short_key with rename_short_key: true",
        priority: "recommended",
      },
    ],
  },
  TRACKING_VALUES_TOO_LONG: {
    title: "Funnel Too Long For Analytics",
    summary:
      "This page's products and personas add up to more than the 100 characters Google Analytics keeps per value. Reports drop the rest (events say tracking_truncated); leads and the CRM still get the full list.",
    suggestion: "Bind fewer products / personas on this page, or give them shorter tracking keys.",
    next_actions: [
      { tool: "get_product_funnel", reason: "Review which products this page binds", priority: "optional" },
    ],
  },
};
