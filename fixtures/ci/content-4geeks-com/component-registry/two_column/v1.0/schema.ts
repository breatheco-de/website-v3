/**
 * TwoColumn Component Schemas - v1.0
 */
import { z } from "zod";
import { ctaButtonSchema } from "../../_common/schema";

export const twoColumnBulletSchema = z.object({
  text: z.string(),
  icon: z.string().optional(),
  heading: z.string().optional(),
});

export const bulletGroupSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  bullets: z.array(z.object({ text: z.string() })).optional(),
});

export const benefitItemSchema = z.object({
  icon: z.string(),
  title: z.string(),
  description: z.string(),
});

export const twoColumnColumnSchema = z.object({
  video: z.string().optional(),
  video_ratio: z.string().optional(),
  video_preview_image: z.string().optional(),
  video_width: z.string().optional(),
  image: z.string().optional(),
  image_alt: z.string().optional(),
  image_object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
  image_object_position: z.string().optional(),
  image_max_width: z.string().optional(),
  image_max_height: z.string().optional(),
  image_mobile_max_width: z.string().optional(),
  image_mobile_max_height: z.string().optional(),
  heading: z.string().optional(),
  sub_heading: z.string().optional(),
  description: z.string().optional(),
  description_extended: z.string().optional(),
  description_extended_md: z.string().optional(),
  html_content: z.string().optional(),
  html_content_extended: z.string().optional(),
  button: ctaButtonSchema.optional(),
  bullets: z.array(twoColumnBulletSchema).optional(),
  bullets_visible: z.number().optional(),
  bullets_collapsible: z.boolean().optional(),
  bullet_icon: z.string().optional(),
  bullet_char: z.string().optional(),
  bullet_icon_color: z.string().optional(),
  bullet_groups: z.array(bulletGroupSchema).optional(),
  bullet_groups_collapsible: z.boolean().optional(),
  footer_description: z.string().optional(),
  gap: z.string().optional(),
  justify: z.enum(["start", "center", "end"]).optional(),
  text_align: z.enum(["left", "center", "right"]).optional(),
  font_size: z.enum(["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl"]).optional(),
});

export const twoColumnSectionSchema = z.object({
  type: z.literal("two_column"),
  variant: z.enum(["default", "benefitCards"]).optional(),
  stacked_header: z.boolean().optional(),
  proportions: z.tuple([z.number(), z.number()]).optional(),
  background: z.string().optional(),
  alignment: z.enum(["start", "center", "end"]).optional(),
  container_style: z.record(z.string(), z.string()).optional(),
  left: twoColumnColumnSchema.optional(),
  right: twoColumnColumnSchema.optional(),
  reverse_on_mobile: z.boolean().optional(),
  heading_above_on_md: z.boolean().optional(),
  gap: z.string().optional(),
  padding_left: z.string().optional(),
  padding_right: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  benefit_items: z.array(benefitItemSchema).optional(),
  cta_button: ctaButtonSchema.optional(),
});

export type TwoColumnBullet = z.infer<typeof twoColumnBulletSchema>;
export type BulletGroup = z.infer<typeof bulletGroupSchema>;
export type BenefitItem = z.infer<typeof benefitItemSchema>;
export type TwoColumnColumn = z.infer<typeof twoColumnColumnSchema>;
export type TwoColumnSection = z.infer<typeof twoColumnSectionSchema>;
