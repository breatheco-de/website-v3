/**
 * BulletTabsShowcase Component Schemas - v1.0
 */
import { z } from "zod";

export const bulletTabSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  image_id: z.string(),
  image_object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
  image_object_position: z.string().optional(),
});

export const bulletTabsShowcaseSectionSchema = z.object({
  type: z.literal("bullet_tabs_showcase"),
  version: z.string().optional(),
  variant: z.enum(["withBigBorder", "withoutBorder"]).optional(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  subheading_centered: z.boolean().optional(),
  tabs: z.array(bulletTabSchema),
  image_position: z.enum(["left", "right"]).optional(),
});

export type BulletTab = z.infer<typeof bulletTabSchema>;
export type BulletTabsShowcaseSection = z.infer<typeof bulletTabsShowcaseSectionSchema>;
