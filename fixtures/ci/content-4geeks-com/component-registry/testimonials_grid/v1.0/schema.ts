import { z } from "zod";

export const testimonialsGridItemSchema = z.object({
  name: z.string(),
  role: z.string(),
  company: z.string().optional(),
  comment: z.string(),
  rating: z.number().optional(),
  avatar: z.string().optional(),
  linkedin_url: z.string().optional(),
  box_color: z.string().optional(),
  name_color: z.string().optional(),
  role_color: z.string().optional(),
  comment_color: z.string().optional(),
  star_color: z.string().optional(),
  linkedin_color: z.string().optional(),
  media: z.object({
    url: z.string(),
    type: z.enum(["image", "video"]).optional(),
    ratio: z.string().optional(),
  }).optional(),
});

export const testimonialItemStyleSchema = z.object({
  box_color: z.string().optional(),
  name_color: z.string().optional(),
  comment_color: z.string().optional(),
});

export const testimonialsGridSectionSchema = z.object({
  type: z.literal("testimonials_grid"),
  version: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  title_color: z.string().optional(),
  subtitle_color: z.string().optional(),
  default_box_color: z.string().optional(),
  default_name_color: z.string().optional(),
  default_role_color: z.string().optional(),
  default_comment_color: z.string().optional(),
  default_star_color: z.string().optional(),
  default_linkedin_color: z.string().optional(),
  columns: z.number().optional(),
  related_features: z.array(z.string()).optional(),
  limit: z.number().optional(),
  item_styles: z.record(z.string(), testimonialItemStyleSchema).optional(),
  background: z.string().optional(),
});

export type TestimonialsGridItem = z.infer<typeof testimonialsGridItemSchema>;
export type TestimonialsGridSection = z.infer<typeof testimonialsGridSectionSchema>;
