/**
 * Pricing Plans Section Schema — v1.0
 */
import { z } from "zod";

export const pricingPlanFeatureSchema = z.string();

export const pricingPlanSchema = z.object({
  plan_id: z.string(),
  name: z.string(),
  price: z.number(),
  currency: z.string().default("USD"),
  billing_period: z.enum(["monthly", "annual", "one_time"]),
  highlighted: z.boolean().default(false),
  badge: z.string().optional(),
  trial_days: z.number().optional(),
  features: z.array(pricingPlanFeatureSchema).default([]),
});

export const pricingPlansSectionSchema = z.object({
  type: z.literal("pricing_plans"),
  id: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  cta_label: z.string().optional(),
  cta_url: z.string().optional(),
  plan_ids: z.array(z.string()).optional(),
  _resolved_plans: z.array(pricingPlanSchema).optional(),
  _ecommerce_settings: z
    .object({
      currency: z.string(),
      locale: z.string(),
      tax_inclusive: z.boolean(),
    })
    .optional(),
});

export type PricingPlansSection = z.infer<typeof pricingPlansSectionSchema>;
export type PricingPlanItem = z.infer<typeof pricingPlanSchema>;
