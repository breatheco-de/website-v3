/**
 * Testimonials Component Schemas - v1.0
 */
import { z } from "zod";

export const testimonialItemSchema = z.object({
  name: z.string(),
  role: z.string(),
  company: z.string().optional(),
  rating: z.number(),
  comment: z.string(),
  outcome: z.string().optional(),
  avatar: z.string().optional(),
});

export const testimonialsSectionSchema = z.object({
  type: z.literal("testimonials"),
  version: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  rating_summary: z.object({
    average: z.string(),
    count: z.string(),
  }).optional(),
  items: z.array(testimonialItemSchema).optional(),
  related_features: z.array(z.string()).optional(),
  limit: z.number().optional(),
  filter_by_location: z.string().optional(),
});

export type TestimonialItem = z.infer<typeof testimonialItemSchema>;
export type TestimonialsSection = z.infer<typeof testimonialsSectionSchema>;
