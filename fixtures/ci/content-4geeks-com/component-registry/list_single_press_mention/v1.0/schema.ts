import { z } from "zod";

const permanentFilterSchema = z.object({
  item_property_slug: z.string(),
  value: z.unknown(),
});

export const listSinglePressMentionSectionSchema = z.object({
  type: z.literal("list_single_press_mention"),
  version: z.string().optional(),
  background: z.string().optional(),
  button_icon: z.string().optional(),
  image: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  excerpt: z.string().optional(),
  organization: z.string().optional(),
  link_text: z.string().optional(),
  link_url: z.string().optional(),
  items: z.array(
    z.object({
      image: z.string().optional(),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      excerpt: z.string().optional(),
      organization: z.string().optional(),
      link_text: z.string().optional(),
      link_url: z.string().optional(),
    }).passthrough()
  ).optional(),
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

export type ListSinglePressMentionSection = z.infer<typeof listSinglePressMentionSectionSchema>;
