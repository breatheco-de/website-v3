/**
 * Career Support Explain Component Schemas - v1.0
 * Tabbed section explaining career support features with multiple layout options per tab
 */
import { z } from "zod";

export const careerSupportBoxSchema = z.object({
  icon: z.string().optional(),
  text: z.string(),
});

export const careerSupportBulletSchema = z.object({
  icon: z.string().optional(),
  text: z.string(),
});

export const careerSupportStatSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const careerSupportLogoSchema = z.object({
  image_id: z.string(),
  alt: z.string().optional(),
  logoHeight: z.string().optional(),
});

export const careerSupportTestimonialLogoSchema = z.object({
  image_id: z.string(),
  alt: z.string().optional(),
});

export const careerSupportTestimonialSchema = z.object({
  image_id: z.string(),
  image_object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
  image_object_position: z.string().optional(),
  contributor_logos: z.array(careerSupportTestimonialLogoSchema).optional(),
  description: z.string(),
  achievement: z.string().optional(),
});

export const careerSupportTabSchema = z.object({
  tab_label: z.string(),
  layout: z.string().optional(),

  col1_subtitle: z.string().optional(),
  col1_description: z.string().optional(),
  col1_tagline: z.string().optional(),
  col1_boxes: z.array(careerSupportBoxSchema).optional(),

  col2_heading: z.string().optional(),
  col2_description: z.string().optional(),
  col2_bullets: z.array(careerSupportBulletSchema).optional(),

  col3_image_id: z.string().optional(),
  col3_object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
  col3_object_position: z.string().optional(),

  title: z.string().optional(),
  left_text: z.string().optional(),
  left_image_id: z.string().optional(),
  left_image_object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
  left_image_object_position: z.string().optional(),
  left_stat: careerSupportStatSchema.optional(),
  right_bullets: z.array(careerSupportBulletSchema).optional(),
  right_logos: z.array(careerSupportLogoSchema).optional(),

  left_description: z.string().optional(),
  left_bullets: z.array(careerSupportBulletSchema).optional(),
  right_image_id: z.string().optional(),
  right_image_object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
  right_image_object_position: z.string().optional(),
  right_panel_background: z.string().optional(),

  testimonials: z.array(careerSupportTestimonialSchema).optional(),
});

export const careerSupportExplainSectionSchema = z.object({
  type: z.literal("career_support_explain"),
  version: z.string().optional(),
  heading: z.string().optional(),
  description: z.string().optional(),
  background: z.string().optional(),
  tabs: z.array(careerSupportTabSchema).min(1),
});

export type CareerSupportBox = z.infer<typeof careerSupportBoxSchema>;
export type CareerSupportBullet = z.infer<typeof careerSupportBulletSchema>;
export type CareerSupportStat = z.infer<typeof careerSupportStatSchema>;
export type CareerSupportLogo = z.infer<typeof careerSupportLogoSchema>;
export type CareerSupportTestimonialLogo = z.infer<typeof careerSupportTestimonialLogoSchema>;
export type CareerSupportTestimonial = z.infer<typeof careerSupportTestimonialSchema>;
export type CareerSupportTab = z.infer<typeof careerSupportTabSchema>;
export type CareerSupportExplainSection = z.infer<typeof careerSupportExplainSectionSchema>;
