/**
 * Numbered Steps Component Schemas - v1.0
 */
import { z } from "zod";

export const numberedStepsStepSchema = z.object({
  icon: z.string(),
  text: z.string().optional(),
  title: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  bullet_icon: z.string().optional(),
  bullet_icon_color: z.string().optional(),
  bullet_char: z.string().optional(),
});

export const numberedStepsDefaultSectionSchema = z.object({
  type: z.literal("numbered_steps"),
  version: z.string().optional(),
  variant: z.literal("default").optional(),
  title: z.string(),
  description: z.string().optional(),
  description_link: z.object({
    text: z.string(),
    url: z.string(),
  }).optional(),
  steps: z.array(numberedStepsStepSchema),
  background: z.string().optional(),
  bullet_icon: z.string().optional(),
  bullet_icon_color: z.string().optional(),
  bullet_char: z.string().optional(),
  collapsible_mobile: z.boolean().optional(),
});

export const numberedStepsBubbleTextSectionSchema = z.object({
  type: z.literal("numbered_steps"),
  version: z.string().optional(),
  variant: z.literal("bubbleText"),
  title: z.string().optional(),
  description: z.string().optional(),
  description_link: z.object({
    text: z.string(),
    url: z.string(),
  }).optional(),
  steps: z.array(numberedStepsStepSchema),
  background: z.string().optional(),
});

export const numberedStepsVerticalCardsSectionSchema = z.object({
  type: z.literal("numbered_steps"),
  version: z.string().optional(),
  variant: z.literal("verticalCards"),
  title: z.string().optional(),
  description: z.string().optional(),
  description_link: z.object({
    text: z.string(),
    url: z.string(),
  }).optional(),
  steps: z.array(numberedStepsStepSchema),
  background: z.string().optional(),
  bullet_icon: z.string().optional(),
  bullet_icon_color: z.string().optional(),
  bullet_char: z.string().optional(),
});

export const numberedStepsSectionSchema = z.union([
  numberedStepsDefaultSectionSchema,
  numberedStepsBubbleTextSectionSchema,
  numberedStepsVerticalCardsSectionSchema,
]);

export type NumberedStepsStep = z.infer<typeof numberedStepsStepSchema>;
export type NumberedStepsDefaultSection = z.infer<typeof numberedStepsDefaultSectionSchema>;
export type NumberedStepsBubbleTextSection = z.infer<typeof numberedStepsBubbleTextSectionSchema>;
export type NumberedStepsVerticalCardsSection = z.infer<typeof numberedStepsVerticalCardsSectionSchema>;
export type NumberedStepsSection = z.infer<typeof numberedStepsSectionSchema>;
