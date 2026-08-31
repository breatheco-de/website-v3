/**
 * Common schemas shared across multiple components
 * These are imported by individual component schemas
 */
import { z } from "zod";

// CTA Button - used in many components
export const ctaTrackingSchema = z.enum(["none", "add_to_cart", "click_begin_checkout"]);

export const ctaButtonSchema = z.object({
  text: z.string(),
  url: z
    .string()
    .describe(
      "Link target: path (/en/…), https://…, #section_id (modal if type:modal else scroll), #top/#bottom, or inline#section_id. Agents: explain_site topic sections.",
    ),
  variant: z.enum(["primary", "secondary", "outline"]),
  /**
   * Ecommerce CTA intent. Required on field-editor `cta-tracking` paths (save-time).
   * Optional in Zod so legacy YAML still parses until migration; use `none` when unbound intent.
   */
  tracking: ctaTrackingSchema.optional(),
  button_variant: z.string().optional(),
  text_color: z.string().optional(),
  icon: z.string().optional(),
  us_only: z.boolean().optional(),
});

export type CtaButton = z.infer<typeof ctaButtonSchema>;

// Video configuration - used in hero, two_column, etc.
export const videoConfigSchema = z.object({
  url: z.string().optional(),
  ratio: z.string().optional(),
  mobile_ratio: z.string().optional(),
  width: z.string().optional(), // CSS width value e.g., "400px", "100%"
  muted: z.boolean().optional(),
  autoplay: z.boolean().optional(),
  loop: z.boolean().optional(),
  preview_image_url: z.string().optional(),
  with_shadow_border: z.boolean().optional(),
});

export type VideoConfig = z.infer<typeof videoConfigSchema>;

// Backward compatible video input - accepts string URL or full object
// Use normalizeVideoConfig() helper to convert to VideoConfig
export const videoInputSchema = z.union([z.string(), videoConfigSchema]);

export type VideoInput = z.infer<typeof videoInputSchema>;

// Image reference - used in hero, features_grid, etc.
export const imageSchema = z.object({
  src: z.string(),
  alt: z.string(),
});

export type ImageDef = z.infer<typeof imageSchema>;

// Image with CSS properties - for editable image positioning and styling
export const imageWithStyleSchema = z.object({
  src: z.string(),
  alt: z.string().optional(),
  object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
  object_position: z.string().optional(), // e.g., "center top", "50% 20%", "left center"
  width: z.string().optional(), // CSS width value
  height: z.string().optional(), // CSS height value
  max_width: z.string().optional(),
  max_height: z.string().optional(),
  border_radius: z.string().optional(), // e.g., "8px", "1rem", "50%"
  opacity: z.number().min(0).max(1).optional(),
  filter: z.string().optional(), // e.g., "grayscale(100%)", "brightness(1.2)"
});

export type ImageWithStyle = z.infer<typeof imageWithStyleSchema>;

export const leadFormComponentRendererSchema = z.enum([
  "text",
  "phone",
  "textarea",
  "select",
  "cards",
  "simple-list",
  "grouped-list",
]);

/** Optional marketing overlays / extra choices merged by `value` over form-options pools. */
export const leadFormFieldOptionSchema = z
  .object({
    value: z.string(),
  })
  .passthrough();

/** Catalog or this-entry-field options source for choice fields. Object only. */
export const leadFormFieldSourceSchema = z
  .object({
    content_type: z.string().optional(),
    database: z.string().optional(),
    related_field: z.string().optional(),
    query: z.string().optional(),
    value_path: z.string().min(1),
    label_path: z.string().min(1),
  })
  .strict()
  .superRefine((val, ctx) => {
    const kinds = [val.content_type, val.database, val.related_field].filter(
      (s) => typeof s === "string" && s.trim().length > 0,
    );
    if (kinds.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "source cannot set more than one of content_type, database, or related_field",
      });
    }
    if (kinds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "source must set content_type, database, or related_field",
      });
    }
  });

// Lead Form field config
export const leadFormFieldConfigSchema = z.object({
  visible: z.boolean().optional(),
  required: z.boolean().optional(),
  default: z.string().optional(),
  default_country: z.string().optional(), // ISO 3166-1 alpha-2 e.g. "ES", "US" – passed to PhoneInput defaultCountry
  helper_text: z.string().optional(),
  placeholder: z.string().optional(),
  show_label: z.boolean().optional(),
  label: z.string().optional(),
  slugs: z.array(z.string()).optional(), // Legacy: limits which programs appear when source is omitted
  /**
   * Options source: catalog content_type/database (/api/query-options) or
   * related_field (this entry’s CT field). Requires value_path and label_path.
   * When set, runtime cardinality overrides authored visible/default/required.
   */
  source: leadFormFieldSourceSchema.optional(),
  /** How the field is shown. Omitting uses LeadForm runtime defaults (email→text, program→select, …). */
  component_renderer: leadFormComponentRendererSchema.optional(),
  /** Merge by `value` over pool options (programs/locations/source). Passthrough for label/description/group/cta/icon. */
  options: z.array(leadFormFieldOptionSchema).optional(),
});

// Webhook configuration — used at form-level, per-event, and global tracking level
export const webhookConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(["POST", "GET"]).default("POST"),
});

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

// Lead Form data schema
export const leadFormDataSchema = z.object({
  variant: z.enum(["stacked", "inline"]).optional(),
  conversion_name: z.string().optional(), // Tracking event name for conversions
  /**
   * Submit field name used to resolve ecommerce product identity for analytics (item_id).
   * Default "program". Funnel.products scopes allowed values when set on the page.
   */
  ecommerce_product_field: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  submit_label: z.string().optional(),
  tags: z.string().optional(),
  automations: z.string().optional(),
  // Form-level webhook — highest priority in the three-level chain
  webhook: webhookConfigSchema.optional(),
  fields: z.object({
    email: leadFormFieldConfigSchema.optional(),
    first_name: leadFormFieldConfigSchema.optional(),
    last_name: leadFormFieldConfigSchema.optional(),
    phone: leadFormFieldConfigSchema.optional(),
    program: leadFormFieldConfigSchema.optional(),
    region: leadFormFieldConfigSchema.optional(),
    location: leadFormFieldConfigSchema.optional(),
    coupon: leadFormFieldConfigSchema.optional(),
    referral_key: leadFormFieldConfigSchema.optional(),
    client_comments: leadFormFieldConfigSchema.optional(),
  }).optional(),
  success: z.object({
    url: z.string().optional(),
    message: z.string().optional(),
  }).optional(),
  terms_url: z.string().optional(),
  privacy_url: z.string().optional(),
  consent: z.object({
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
    whatsapp: z.boolean().optional(),
    marketing: z.boolean().optional(),
    marketing_text: z.string().optional(),
    sms_text: z.string().optional(),
    sms_usa_only: z.boolean().optional(),
  }).catchall(z.boolean()).optional(),
  show_terms: z.boolean().optional(),
  className: z.string().optional(),
  button_className: z.string().optional(),
  terms_className: z.string().optional(),
});

export type LeadFormData = z.infer<typeof leadFormDataSchema>;

// Card item - used in ai_learning, mentorship
export const cardItemSchema = z.object({
  icon: z.string(),
  title: z.string(),
  description: z.string(),
});

export type CardItem = z.infer<typeof cardItemSchema>;

// Stat item - used in certificate, etc.
export const statItemSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
  benefits: z.array(z.object({ text: z.string() })).optional(),
});

export type StatItem = z.infer<typeof statItemSchema>;

// Logo item - used in whos_hiring
export const logoItemSchema = z.object({
  src: z.string(),
  alt: z.string(),
});

export type LogoItem = z.infer<typeof logoItemSchema>;

/**
 * Testimonial bank row — shared by the three testimonials listings.
 *
 * Same shape whether the row came from the `testimonials` database or from a
 * section's `hardcoded_entries`. Passthrough so layout-only extras (slide
 * country/status/achievement, carousel outcome) validate without adding DB
 * columns for them.
 */
export const testimonialBankRowSchema = z
  .object({
    student_name: z.string(),
    student_thumb: z.string().optional(),
    student_video: z.string().optional(),
    excerpt: z.string().optional(),
    full_text: z.string().optional(),
    content: z.string().optional(),
    related_features: z.array(z.string()).optional(),
    priority: z.number().optional(),
    rating: z.number().optional(),
    linkedin_url: z.string().optional(),
    role: z.string().optional(),
    company: z.string().optional(),
    featured: z.boolean().optional(),
  })
  .passthrough();

export type TestimonialBankRow = z.infer<typeof testimonialBankRowSchema>;

/** Keep in sync with shared/schema permanentFilterSchema / userFilterSchema. */
const listingPermanentFilterSchema = z.object({
  item_property_slug: z.string(),
  value: z.unknown(),
});

const listingUserFilterSchema = z.object({
  item_property_slug: z.string(),
  component_renderer: z.enum(["text-input", "dropdown", "tags"]),
  default_value: z.unknown().optional(),
  all_label: z.string().optional(),
  split_comma_values: z.boolean().optional(),
});

/** Listing query for testimonials sections — resolved server-side into `items`. */
export const testimonialsDynamicEntriesSchema = z.object({
  content_type: z.string().optional(),
  database: z.string().optional(),
  limit: z.number().optional(),
  sort: z.string().optional(),
  search: z.string().optional(),
  item_template: z.record(z.string(), z.unknown()).optional(),
  hardcoded_entries: z.array(testimonialBankRowSchema).optional(),
  permanent_filters: z.array(listingPermanentFilterSchema).optional(),
  user_filters: z.array(listingUserFilterSchema).optional(),
  ignored_entries: z.array(z.string()).optional(),
});

export type TestimonialsDynamicEntries = z.infer<typeof testimonialsDynamicEntriesSchema>;
