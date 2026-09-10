/**
 * Awards Marquee Component Schemas - v1.0
 *
 * Static authoring: root `items[]` (legacy; still supported).
 * Optional listing: `dynamic_entries` fills `items` at resolve time.
 */
import { z } from "zod";

const permanentFilterSchema = z.object({
  item_property_slug: z.string(),
  value: z.unknown(),
});

export const awardsMarqueeItemSchema = z.object({
  id: z.string(),
  alt: z.string(),
  logo: z.string().optional(),
  logoHeight: z.string().optional(),
  source: z.string().optional(),
  name: z.string().optional(),
  year: z.string().optional(),
});

export const awardsMarqueeSectionSchema = z.object({
  type: z.literal("awards_marquee"),
  version: z.string().optional(),
  speed: z.number().optional(),
  gradient: z.boolean().optional(),
  gradientColor: z.string().optional(),
  gradientWidth: z.number().optional(),
  title: z.string().optional(),
  title_above_carousel: z.boolean().optional(),
  /** Authored logos, or filled by resolveDynamicEntries when using dynamic_entries */
  items: z.array(awardsMarqueeItemSchema).optional(),
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

export type AwardsMarqueeItem = z.infer<typeof awardsMarqueeItemSchema>;
export type AwardsMarqueeSection = z.infer<typeof awardsMarqueeSectionSchema>;
