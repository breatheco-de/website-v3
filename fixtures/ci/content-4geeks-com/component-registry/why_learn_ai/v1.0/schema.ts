/**
 * Why Learn AI Component Schemas - v1.0
 */
import { z } from "zod";
import { ctaButtonSchema } from "../../_common/schema";

export const laptopImageSchema = z.object({
  image_id: z.string().describe("Image ID from the image registry"),
  alt: z.string().optional().describe("Alt text for the laptop image"),
});

export const whyLearnAISectionSchema = z.object({
  type: z.literal("why_learn_ai"),
  variant: z.enum(["default", "laptop-edge"]).optional(),
  title: z.string(),
  subtitle: z.string(),
  description: z.string(),
  cta: ctaButtonSchema.optional(),
  mobile_see_more: z.boolean().optional(),
  mobile_see_more_label: z.string().optional(),
  mobile_see_less_label: z.string().optional(),
  laptop_image: laptopImageSchema.optional().describe("Optional laptop/code-editor image override for the laptop-edge variant"),
});

export type WhyLearnAISection = z.infer<typeof whyLearnAISectionSchema>;
