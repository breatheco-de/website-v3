/**
 * TwoColumnAccordionCard Component Schemas - v1.0
 */
import { z } from "zod";
import { videoConfigSchema } from "../../_common/schema";

export const twoColumnAccordionCardBulletSchema = z.object({
  heading: z.string(),
  text: z.string(),
});

export const twoColumnAccordionCardSectionSchema = z.object({
  type: z.literal("two_column_accordion_card"),
  variant: z.enum(["default", "image_background"]).optional(),
  version: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  bullets: z.array(twoColumnAccordionCardBulletSchema).optional(),
  footer: z.string().optional(),
  image: z.string().optional(),
  image_alt: z.string().optional(),
  image_object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
  image_object_position: z.string().optional(),
  video: videoConfigSchema.optional(),
  reverse: z.boolean().optional(),
});

export type TwoColumnAccordionCardBullet = z.infer<typeof twoColumnAccordionCardBulletSchema>;
export type TwoColumnAccordionCardSection = z.infer<typeof twoColumnAccordionCardSectionSchema>;
