/**
 * Awards Marquee Component Schemas - v1.0
 */
import { z } from "zod";

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
  items: z.array(awardsMarqueeItemSchema),
});

export type AwardsMarqueeItem = z.infer<typeof awardsMarqueeItemSchema>;
export type AwardsMarqueeSection = z.infer<typeof awardsMarqueeSectionSchema>;
