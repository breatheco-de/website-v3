/**
 * Partnership Carousel Component Schemas - v1.0
 * Dual-column carousel: left side full image, right side content (title, subtitle, description, stats, institution logos, press references, CTA)
 */
import { z } from "zod";
import { ctaButtonSchema } from "../../_common/schema";

export const partnershipStatSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const partnershipLogoSchema = z.object({
  image_id: z.string(),
  alt: z.string().optional(),
  text: z.string().optional(),
  logo_height: z.string().optional(),
});

export const partnershipPressRefSchema = z.object({
  text: z.string().optional(),
  url: z.string().optional(),
  source: z.string().optional(),
});

export const partnershipSlideSchema = z.object({
  image_id: z.string(),
  object_fit: z.enum(["cover", "contain", "fill", "none"]).optional(),
  object_position: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  stats: z.array(partnershipStatSchema).optional(),
  institution_logos: z.array(partnershipLogoSchema).optional(),
  press_references: z.array(partnershipPressRefSchema).optional(),
  cta: ctaButtonSchema.optional(),
});

export const partnershipCarouselSectionSchema = z.object({
  type: z.literal("partnership_carousel"),
  variant: z.enum(["default", "split-card"]).optional(),
  vertical_cards: z.boolean().optional(),
  institutions_heading: z.string().optional(),
  references_heading: z.string().optional(),
  version: z.string().optional(),
  heading: z.string().optional(),
  subtitle: z.string().optional(),
  background: z.string().optional(),
  slides: z.array(partnershipSlideSchema).min(1),
  autoplay: z.boolean().optional(),
  autoplay_interval: z.number().optional(),
});

export type PartnershipStat = z.infer<typeof partnershipStatSchema>;
export type PartnershipLogo = z.infer<typeof partnershipLogoSchema>;
export type PartnershipPressRef = z.infer<typeof partnershipPressRefSchema>;
export type PartnershipSlide = z.infer<typeof partnershipSlideSchema>;
export type PartnershipCarouselSection = z.infer<typeof partnershipCarouselSectionSchema>;
