/**
 * Apply Form Component Schemas - v1.0
 * The form field now uses the LeadForm format directly
 */
import { z } from "zod";

// Webhook configuration — matches the shared WebhookConfig shape
const webhookSchema = z.object({
  url: z.string().url(),
  method: z.enum(["POST", "GET"]).default("POST"),
}).optional();

export const applyFormHeroSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  note: z.string().optional(),
});

const fieldConfigSchema = z.object({
  visible: z.boolean().optional(),
  required: z.boolean().optional(),
  default: z.string().optional(),
  placeholder: z.string().optional(),
  helper_text: z.string().optional(),
  show_label: z.boolean().optional(),
  label: z.string().optional(),
}).optional();

const consentSchema = z.object({
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
  whatsapp: z.boolean().optional(),
  marketing: z.boolean().optional(),
  marketing_text: z.string().optional(),
  sms_text: z.string().optional(),
  sms_usa_only: z.boolean().optional(),
}).optional();

const turnstileSchema = z.object({
  enabled: z.boolean().optional(),
  theme: z.enum(["light", "dark", "auto"]).optional(),
  size: z.enum(["normal", "compact"]).optional(),
}).optional();

export const applyFormLeadFormSchema = z.object({
  variant: z.enum(["stacked", "inline"]).optional(),
  conversion_name: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  submit_label: z.string().optional(),
  tags: z.string().optional(),
  automations: z.string().optional(),
  // Form-level webhook — highest priority in the three-level chain
  webhook: webhookSchema,
  fields: z.object({
    email: fieldConfigSchema,
    first_name: fieldConfigSchema,
    last_name: fieldConfigSchema,
    phone: fieldConfigSchema,
    program: fieldConfigSchema,
    region: fieldConfigSchema,
    location: fieldConfigSchema,
    coupon: fieldConfigSchema,
    client_comments: fieldConfigSchema,
  }).optional(),
  success: z.object({
    url: z.string().optional(),
    message: z.string().optional(),
  }).optional(),
  terms_url: z.string().optional(),
  privacy_url: z.string().optional(),
  consent: consentSchema,
  show_terms: z.boolean().optional(),
  className: z.string().optional(),
  button_className: z.string().optional(),
  terms_className: z.string().optional(),
  turnstile: turnstileSchema,
});

export const applyFormNextStepItemSchema = z.object({
  title: z.string(),
  description: z.string(),
});

export const applyFormNextStepsSchema = z.object({
  title: z.string(),
  items: z.array(applyFormNextStepItemSchema),
  closing: z.string(),
});

export const applyFormSectionSchema = z.object({
  type: z.literal("apply_form"),
  version: z.string().optional(),
  hero: applyFormHeroSchema,
  // Section-level webhook — used as fallback if form.webhook is not set
  webhook: webhookSchema,
  form: applyFormLeadFormSchema,
  next_steps: applyFormNextStepsSchema,
});

export type ApplyFormHero = z.infer<typeof applyFormHeroSchema>;
export type ApplyFormLeadForm = z.infer<typeof applyFormLeadFormSchema>;
export type ApplyFormNextStepItem = z.infer<typeof applyFormNextStepItemSchema>;
export type ApplyFormNextSteps = z.infer<typeof applyFormNextStepsSchema>;
export type ApplyFormSection = z.infer<typeof applyFormSectionSchema>;
