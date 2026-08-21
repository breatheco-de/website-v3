/**
 * CTA Banner Component Schemas - v1.0
 */
import { z } from "zod";
import { ctaButtonSchema, leadFormDataSchema, imageSchema } from "../../_common/schema";

// Base schema with common fields
const ctaBannerBaseSchema = z.object({
  type: z.literal("cta_banner"),
  version: z.string().optional(),
  eyebrow: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  background: z.string().optional(),
});

// Default variant: shows message + buttons on all screen sizes
export const ctaBannerDefaultSchema = ctaBannerBaseSchema.extend({
  variant: z.literal("default").optional(),
  cta_text: z.string().optional(),
  cta_url: z.string().optional(),
  buttons: z.array(ctaButtonSchema).optional(),
}).refine(
  (data) => (data.cta_text && data.cta_url) || (data.buttons && data.buttons.length > 0),
  { message: "Either cta_text/cta_url or buttons array must be provided for default variant" }
);

// Form variant: shows form on all screen sizes
// Desktop: message on left, form on right
// Mobile: stacked layout (message above, form below)
export const ctaBannerFormSchema = ctaBannerBaseSchema.extend({
  variant: z.literal("form"),
  form: leadFormDataSchema,
  form_background: z.string().optional(),
  terms_color: z.string().optional(),
});

// Strip variant: compact horizontal resource/download bar
// Layout: icon | rich text | link CTA
export const ctaBannerStripSchema = ctaBannerBaseSchema.extend({
  variant: z.literal("strip"),
  text: z.string().optional(),        // rich text (HTML), e.g. "<b>Guía gratis (PDF):</b> descripción"
  icon: z.string().optional(),        // tabler/lucide icon name; defaults to download icon
  cta_buttons: z.array(ctaButtonSchema).optional(),
});

// Preview box schema for resourceShowcase
const resourcePreviewSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  image: imageSchema.optional(),      // priority over icon
  icon: z.string().optional(),        // fallback when no image
});

// Benefit item with optional icon
const resourceBenefitSchema = z.object({
  label: z.string(),
  icon: z.string().optional(),        // tabler/lucide icon; defaults to check icon
});

// ResourceShowcase variant: two-column with resource preview + benefits + optional LeadForm
// Left: eyebrow badge + rich title + subtitle + preview box + benefits list
// Right: optional LeadForm panel (hidden when form is absent)
export const ctaBannerResourceShowcaseSchema = ctaBannerBaseSchema.extend({
  variant: z.literal("resourceShowcase"),
  preview: resourcePreviewSchema.optional(),
  benefits: z.array(resourceBenefitSchema).optional(),
  form: leadFormDataSchema.optional(),
  form_card_title: z.string().optional(),
  form_card_subtitle: z.string().optional(),
});

// Promotion variant: horizontal eyebrow pill + rich title + subtitle | CTA buttons
// Layout: content (left) | buttons (right), stacks on mobile
export const ctaBannerPromotionSchema = ctaBannerBaseSchema.extend({
  variant: z.literal("promotion"),
  cta_buttons: z.array(ctaButtonSchema).optional(),
});

// Unified schema supporting all variants
export const ctaBannerSectionSchema = z.discriminatedUnion("variant", [
  ctaBannerDefaultSchema.innerType().extend({ variant: z.literal("default") }),
  ctaBannerFormSchema,
  ctaBannerStripSchema,
  ctaBannerResourceShowcaseSchema,
  ctaBannerPromotionSchema,
]).or(
  // Backward compatibility: treat sections without variant as "default"
  ctaBannerDefaultSchema
);

export type CtaBannerDefault = z.infer<typeof ctaBannerDefaultSchema>;
export type CtaBannerForm = z.infer<typeof ctaBannerFormSchema>;
export type CtaBannerStrip = z.infer<typeof ctaBannerStripSchema>;
export type CtaBannerResourceShowcase = z.infer<typeof ctaBannerResourceShowcaseSchema>;
export type CtaBannerPromotion = z.infer<typeof ctaBannerPromotionSchema>;
export type CtaBannerSection = z.infer<typeof ctaBannerSectionSchema>;
