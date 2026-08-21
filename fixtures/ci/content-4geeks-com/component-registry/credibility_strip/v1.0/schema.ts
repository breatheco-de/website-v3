import { z } from "zod";

export const credibilityStripLogoSchema = z.object({
  image_id: z.string(),
});

export const credibilityStripItemSchema = z.object({
  label: z.string().optional(),
  logos: z.array(credibilityStripLogoSchema).optional(),
});

export const credibilityStripSectionSchema = z.object({
  type: z.literal("credibility_strip"),
  version: z.string().optional(),
  cta: z.string().optional(),
  link_url: z.string().optional(),
  item_badge_shape: z.boolean().optional(),
  item_background_color: z.string().optional(),
  logo_rotation_ms_time: z.number().optional(),
  logo_swap_speed_milisec: z.number().optional(),
  colored_logos: z.boolean().optional(),
  items: z.array(credibilityStripItemSchema).optional(),
});

export type CredibilityStripLogo = z.infer<typeof credibilityStripLogoSchema>;
export type CredibilityStripItem = z.infer<typeof credibilityStripItemSchema>;
export type CredibilityStripSection = z.infer<typeof credibilityStripSectionSchema>;
