/**
 * List Workshops Carousel — horizontal drag carousel of upcoming workshop cards.
 * Listing-first: author via dynamic_entries (+ optional hardcoded_entries).
 * `items` is filled at resolve time — do not author top-level items in YAML.
 */
import { z } from "zod";

const permanentFilterSchema = z.object({
  item_property_slug: z.string(),
  value: z.unknown(),
});

export const workshopCarouselItemSchema = z
  .object({
    title: z.string(),
    description: z.string().optional(),
    /** Pre-formatted duration, e.g. "2h" */
    duration_label: z.string().optional(),
    /** Pre-formatted relative start, e.g. "Starts in 3 days" */
    starts_in_label: z.string().optional(),
    /** ISO datetime — used with ending_at to mark the card as live */
    starting_at: z.string().optional(),
    ending_at: z.string().optional(),
    /** Explicit live state (overrides datetime check when set) */
    is_live: z.boolean().optional(),
    host_name: z.string().optional(),
    /** Host avatar — Media Gallery id or direct URL (UniversalImage) */
    host_avatar_url: z.string().optional(),
    /**
     * Workshop language code: en | us | es.
     * Renders as EN/ES + LocaleFlag (not a text-only badge).
     */
    lang: z.string().optional(),
    /** Optional label override; if omitted, derived from lang (EN / ES) */
    language_label: z.string().optional(),
    cta_label: z.string().optional(),
    cta_url: z.string().optional(),
    /** Used to build /workshops/:slug when cta_url is missing (Learn parity) */
    slug: z.string().optional(),
    /** Technology icon image ids shown top-left */
    technology_image_ids: z.array(z.string()).optional(),
  })
  .passthrough();

export const listWorkshopsCarouselSectionSchema = z.object({
  type: z.literal("list_workshops_carousel"),
  version: z.string().optional(),
  variant: z.enum(["default"]).optional(),
  title: z.string().optional(),
  /** Decorative arrow next to the section title (Learn-style) */
  show_title_arrow: z.boolean().optional(),
  /** Fallback CTA when an item omits cta_label */
  cta_label: z.string().optional(),
  /** Prefix before host_name, e.g. "By " */
  host_prefix: z.string().optional(),
  /** Badge when a workshop is currently live */
  live_now_label: z.string().optional(),
  background: z.string().optional(),
  /** Runtime only — filled by resolveDynamicEntries from database / hardcoded_entries */
  items: z.array(workshopCarouselItemSchema).optional(),
  dynamic_entries: z
    .object({
      database: z.string().optional(),
      content_type: z.string().optional(),
      limit: z.number().optional(),
      sort: z.string().optional(),
      item_template: z.record(z.string(), z.unknown()).optional(),
      hardcoded_entries: z.array(z.unknown()).optional(),
      permanent_filters: z.array(permanentFilterSchema).optional(),
    })
    .optional(),
  _dynamic_meta: z
    .object({
      content_type: z.string().optional(),
      total: z.number().optional(),
      locale: z.string().optional(),
    })
    .optional(),
});

export type WorkshopCarouselItem = z.infer<typeof workshopCarouselItemSchema>;
export type ListWorkshopsCarouselSection = z.infer<
  typeof listWorkshopsCarouselSectionSchema
>;
