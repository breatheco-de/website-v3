import { z } from "zod";

const permanentFilterSchema = z.object({
  item_property_slug: z.string(),
  value: z.unknown(),
});

export const pressMentionItemSchema = z.object({
  logo: z.string().optional(),
  logo_height: z.number().optional(),
  title: z.string().optional(),
  excerpt: z.string().optional(),
  link_text: z.string().optional(),
  link_url: z.string().optional(),
  box_color: z.string().optional(),
  title_color: z.string().optional(),
  excerpt_color: z.string().optional(),
  link_color: z.string().optional(),
  category: z.string().optional(),
  organization: z.string().optional(),
  subtitle: z.string().optional(),
  stat_value: z.string().optional(),
  stat_label: z.string().optional(),
  tags: z.array(z.string()).optional(),
  badges: z.array(z.string()).optional(),
  year: z.string().optional(),
}).passthrough();

export const listPressMentionsSectionSchema = z.object({
  type: z.literal("list_press_mentions"),
  version: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  title_color: z.string().optional(),
  subtitle_color: z.string().optional(),
  default_box_color: z.string().optional(),
  default_title_color: z.string().optional(),
  default_excerpt_color: z.string().optional(),
  default_link_color: z.string().optional(),
  default_logo_height: z.number().optional(),
  badge_color: z.string().optional(),
  badge_text_color: z.string().optional(),
  clamp_excerpts: z.boolean().optional(),
  read_more_label: z.string().optional(),
  columns: z.number().optional(),
  items: z.array(pressMentionItemSchema).optional(),
  background: z.string().optional(),
  variant: z.enum(["cards", "featured_showcase"]).optional(),
  show_links: z.boolean().optional(),
  show_logos: z.boolean().optional(),
  featured_background: z.string().optional(),
  cards_background: z.string().optional(),
  footer_stats: z.array(z.object({
    value: z.string().optional(),
    label: z.string().optional(),
  })).optional(),
  footer_text: z.string().optional(),
  dynamic_entries: z.object({
    database: z.string().optional(),
    content_type: z.string().optional(),
    limit: z.number().optional(),
    sort: z.string().optional(),
    item_template: z.record(z.string(), z.unknown()).optional(),
    hardcoded_entries: z.array(z.unknown()).optional(),
    permanent_filters: z.array(permanentFilterSchema).optional(),
  }).optional(),
  _dynamic_meta: z.object({
    content_type: z.string().optional(),
    total: z.number().optional(),
    locale: z.string().optional(),
  }).optional(),
});

export type PressMentionItem = z.infer<typeof pressMentionItemSchema>;
export type ListPressMentionsSection = z.infer<typeof listPressMentionsSectionSchema>;

export { listPressMentionsSectionSchema as pressMentionsSectionSchema };
export type { ListPressMentionsSection as PressMentionsSection };
