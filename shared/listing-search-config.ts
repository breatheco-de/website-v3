/**
 * Shared visitor search config for listing components (list_cards, faq, testimonials).
 * `dynamic_entries.search` is a separate section-ranking phrase (SSR); see component schema docs.
 */
import { z } from "zod";

export const listingSearchConfigSchema = z.object({
  enabled: z.boolean().optional(),
  placeholder: z.string().optional(),
  /** DB / keyword fields the visitor search input maps to. */
  fields: z.array(z.string()).optional(),
});

export type ListingSearchConfig = z.infer<typeof listingSearchConfigSchema>;

export const listingSearchMetaConfigSchema = z.object({
  enabled: z.boolean().optional(),
  placeholder: z.string().optional(),
  fields: z.array(z.string()).optional(),
  permanent_filters: z
    .array(
      z.object({
        item_property_slug: z.string(),
        value: z.unknown(),
      }),
    )
    .optional(),
  item_template: z.record(z.string(), z.unknown()).optional(),
  sort: z.string().optional(),
});

export type ListingSearchMetaConfig = z.infer<typeof listingSearchMetaConfigSchema>;

export const listingDynamicMetaSchema = z.object({
  content_type: z.string().optional(),
  database: z.string().nullable().optional(),
  locale: z.string().optional(),
  total: z.number().optional(),
  semantic_search_enabled: z.boolean().optional(),
  search_config: listingSearchMetaConfigSchema.optional(),
});

export type ListingDynamicMeta = z.infer<typeof listingDynamicMetaSchema>;

/** Normalize legacy list_cards flags into listing search config. */
export function normalizeListingSearchConfig(section: {
  search?: ListingSearchConfig | null;
  show_search?: boolean;
  search_placeholder?: string;
}): ListingSearchConfig {
  const search = section.search ?? {};
  const enabled =
    search.enabled ??
    (section.show_search === true ? true : undefined) ??
    false;
  return {
    enabled,
    placeholder: search.placeholder ?? section.search_placeholder,
    fields: search.fields,
  };
}

export const LISTING_SEARCH_MIN_CHARS = 3;

/** Default card field keys searched when no DB and no explicit fields (substring fallback). */
export const DEFAULT_LISTING_SEARCH_CARD_FIELDS = [
  "title",
  "description",
  "taxonomy",
  "badge",
] as const;
