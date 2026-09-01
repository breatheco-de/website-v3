/**
 * FAQ Component Schemas - v1.0
 *
 * Listing contract: authored source is `dynamic_entries` / `hardcoded_entries`.
 * `items` is runtime-resolved by resolveDynamicEntries (not authored).
 * Section-level `related_features` is rejected — use permanent_filters instead.
 */
import { z } from "zod";
import { listingSearchConfigSchema } from "@shared/listing-search-config";

export const relatedFeaturesEnum = z.enum([
  "online-platform",
  "mentors-and-teachers",
  "price",
  "career-support",
  "content-and-syllabus",
  "job-guarantee",
  "full-stack",
  "cybersecurity",
  "data-science",
  "applied-ai",
  "ai-engineering",
  "outcomes",
  "scholarships",
  "rigobot",
  "learnpack",
  "certification",
]);

export type RelatedFeature = z.infer<typeof relatedFeaturesEnum>;

export const faqItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
  locations: z.array(z.string()).optional().default(["all"]),
  related_features: z.array(relatedFeaturesEnum).optional().default([]),
  priority: z.number().int().optional().default(0),
}).refine(
  (data) => {
    const tagCount = data.related_features?.length || 0;
    return tagCount <= 2;
  },
  {
    message: "FAQs should have at most 2 tags (1 tag preferred, 2 only in extraordinary cases). 3+ tags are not allowed.",
    path: ["related_features"],
  }
);

export const faqItemOverrideSchema = z.object({
  hideOnLocations: z.array(z.string()).optional(),
});

/** Inline listing filters — keep in sync with shared/schema permanentFilterSchema / userFilterSchema (FAQ cannot import shared/schema: circular). */
const faqPermanentFilterSchema = z.object({
  item_property_slug: z.string(),
  value: z.unknown(),
});

const faqUserFilterSchema = z.object({
  item_property_slug: z.string(),
  component_renderer: z.enum(["text-input", "dropdown", "tags"]),
  default_value: z.unknown().optional(),
  all_label: z.string().optional(),
  /** Injected by resolveDynamicEntries from CT/DB field editor when true. */
  split_comma_values: z.boolean().optional(),
});

/** Resolved/simple Q&A rows (runtime or hardcoded). */
const faqSimpleItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
}).passthrough();

export const faqDynamicEntriesSchema = z.object({
  content_type: z.string().optional(),
  database: z.string().optional(),
  limit: z.number().optional(),
  sort: z.string().optional(),
  search: z.string().optional(),
  item_template: z.record(z.string(), z.unknown()).optional(),
  hardcoded_entries: z.array(faqSimpleItemSchema).optional(),
  permanent_filters: z.array(faqPermanentFilterSchema).optional(),
  user_filters: z.array(faqUserFilterSchema).optional(),
  ignored_entries: z.array(z.string()).optional(),
});

export const faqSectionSchema = z.object({
  type: z.literal("faq"),
  title: z.string(),
  /** Visitor live search (URL ?q=). Off by default — use dynamic_entries.search for SSR ranking. */
  search: listingSearchConfigSchema.optional(),
  /** Runtime-resolved by resolveDynamicEntries; not the primary authored source. */
  items: z.array(faqSimpleItemSchema).optional(),
  dynamic_entries: faqDynamicEntriesSchema.optional(),
  /** Accepted fallback when no dynamic_entries database/content_type (same as listing resolver). */
  hardcoded_entries: z.array(faqSimpleItemSchema).optional(),
  item_overrides: z.record(z.string(), faqItemOverrideSchema).optional(),
  cta: z
    .object({
      text: z.string().optional(),
      button: z
        .object({
          label: z.string(),
          url: z.string(),
        })
        .optional(),
    })
    .optional(),
});

/** @deprecated Legacy bank shape — prefer frequently_asked_questions DB. Kept for transitional validators. */
export const centralizedFaqsSchema = z.object({
  faqs: z.array(faqItemSchema),
});

export type FaqItem = z.infer<typeof faqItemSchema>;
export type FAQ = FaqItem;
export type FaqItemOverride = z.infer<typeof faqItemOverrideSchema>;
export type FaqSection = z.infer<typeof faqSectionSchema>;
export type CentralizedFaqs = z.infer<typeof centralizedFaqsSchema>;
