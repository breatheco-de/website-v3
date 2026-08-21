/**
 * Pricing Component Schemas - v1.0
 */
import { z } from "zod";
import { ctaButtonSchema } from "../../_common/schema";

export const pricingFeatureSchema = z.object({
  icon: z.string().optional(),
  text: z.string(),
  use_rigobot_icon: z.boolean().optional(),
});

export const pricingPlanSchema = z.object({
  discount_badge: z.string(),
  price: z.string(),
  period: z.string(),
  original_price: z.string().optional(),
  savings_badge: z.string().optional(),
});

export const pricingFooterBadgeSchema = z.object({
  label: z.string(),
  tag: z.string().optional(),
});

// Default variant - monthly/yearly pricing toggle
export const pricingDefaultSchema = z.object({
  type: z.literal("pricing"),
  version: z.string().optional(),
  variant: z.literal("default").optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  monthly: pricingPlanSchema,
  yearly: pricingPlanSchema,
  tech_icons: z.array(z.string()).optional(),
  static_icons: z.boolean().optional(),
  features_title: z.string().optional(),
  features: z.array(pricingFeatureSchema),
  cta: ctaButtonSchema,
});

// Product variant - financing focused pricing
export const pricingProductSchema = z.object({
  type: z.literal("pricing"),
  version: z.string().optional(),
  variant: z.literal("product"),
  title: z.string(),
  subtitle: z.string().optional(),
  discount_text: z.string().optional(),
  financing_text: z.string().optional(),
  financing_amount: z.string().optional(),
  financing_period: z.string().optional(),
  tech_icons: z.array(z.string()).optional(),
  static_icons: z.boolean().optional(),
  features_title: z.string().optional(),
  features: z.array(pricingFeatureSchema),
  cta: ctaButtonSchema,
  footer: z.string().optional(),
  footer_badges: z.array(pricingFooterBadgeSchema).optional(),
});

// ─── plan_cards_comparison variant ───────────────────────────────────────────
// Shared feature list across all plans. Mobile shows a comparison table.

export const pricingPlanCardsPlanSchema = z.object({
  name: z.string(),
  tag: z.string(),
  for_label: z.string(),
  currency: z.string(),
  amount: z.string(),
  cents: z.string().optional(),
  period: z.string(),
  billing_note: z.string(),
  featured: z.boolean().optional(),
  top_badge: z.string().optional(),
  bottom_label: z.string().optional(),
  bottom_badges: z.array(z.string()).optional(),
  cta: z.object({
    label: z.string(),
    url: z.string(),
  }),
});

export const pricingPlanCardsFeatureSchema = z.object({
  text: z.string(),
  exclude_from_plans: z.array(z.string()).optional(),
});

export const pricingPlanCardsAddonSchema = z.object({
  label: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  currency: z.string(),
  amount: z.string(),
  period: z.string().optional(),
});

export const pricingPlanCardsSchema = z.object({
  type: z.literal("pricing"),
  version: z.string().optional(),
  variant: z.literal("plan_cards_comparison"),
  title: z.string(),
  subtitle: z.string().optional(),
  plans: z.array(pricingPlanCardsPlanSchema),
  features: z.array(pricingPlanCardsFeatureSchema),
  addon: pricingPlanCardsAddonSchema.optional(),
});

export type PricingPlanCardsPlan = z.infer<typeof pricingPlanCardsPlanSchema>;
export type PricingPlanCardsFeature = z.infer<typeof pricingPlanCardsFeatureSchema>;
export type PricingPlanCardsSection = z.infer<typeof pricingPlanCardsSchema>;

// ─── plan_cards variant ───────────────────────────────────────────────────────
// Independent per-plan feature lists. Mobile shows mini-cards with features inline.

export const pricingPlanCardsPlanFeatureSchema = z.object({
  text: z.string(),
  not_included: z.boolean().optional(),
});

export const pricingPlanCardsNewPlanSchema = pricingPlanCardsPlanSchema.extend({
  features: z.array(pricingPlanCardsPlanFeatureSchema).optional(),
});

export const pricingPlanCardsNewSchema = z.object({
  type: z.literal("pricing"),
  version: z.string().optional(),
  variant: z.literal("plan_cards"),
  title: z.string(),
  subtitle: z.string().optional(),
  plans: z.array(pricingPlanCardsNewPlanSchema),
  addon: pricingPlanCardsAddonSchema.optional(),
});

export type PricingPlanCardsPlanFeature = z.infer<typeof pricingPlanCardsPlanFeatureSchema>;
export type PricingPlanCardsNewPlan = z.infer<typeof pricingPlanCardsNewPlanSchema>;
export type PricingPlanCardsNewSection = z.infer<typeof pricingPlanCardsNewSchema>;

// ─── Union of all pricing variants ───────────────────────────────────────────

export const pricingSectionSchema = z.union([
  pricingDefaultSchema,
  pricingProductSchema,
  pricingPlanCardsNewSchema,
  pricingPlanCardsSchema,
]);

export type PricingFeature = z.infer<typeof pricingFeatureSchema>;
export type PricingPlan = z.infer<typeof pricingPlanSchema>;
export type PricingFooterBadge = z.infer<typeof pricingFooterBadgeSchema>;
export type PricingSection = z.infer<typeof pricingSectionSchema>;
