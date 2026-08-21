/**
 * Testimonials Slide Component Schemas - v1.0
 */
import { z } from "zod";

export const testimonialsSlideTestimonialSchema = z.object({
  name: z.string(),
  img: z.string(),
  status: z.string().optional(),
  country: z.object({
    name: z.string(),
    iso: z.string(),
  }),
  contributor: z.string(),
  description: z.string(),
  achievement: z.string().optional(),
});

export const testimonialsSlideSectionSchema = z.object({
  type: z.literal("testimonials_slide"),
  title: z.string(),
  description: z.string(),
  background: z.string().optional(),
  testimonials: z.array(testimonialsSlideTestimonialSchema).optional(),
  related_features: z.array(z.string()).optional(),
  limit: z.number().optional(),
});

export type TestimonialsSlideTestimonial = z.infer<typeof testimonialsSlideTestimonialSchema>;
export type TestimonialsSlideSection = z.infer<typeof testimonialsSlideSectionSchema>;
