import { z } from "zod";
import { ctaButtonSchema } from "../../_common/schema";

const skillSchema = z.object({
  name: z.string(),
  skill_percentage: z.number(),
});

export const aiFlexPathCourseSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  hrs: z.string(),
  tools: z.array(z.string()),
  skills: z.array(skillSchema),
});

const aiFlexPathDragAndDropCourseSchema = aiFlexPathCourseSchema.extend({
  color: z.string().optional(),
  icon: z.string().optional(),
});

const ctaBlockSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  banner: z.boolean().optional(),
  buttons: z.array(ctaButtonSchema),
});

export const aiFlexPathDefaultSchema = z.object({
  ready_label: z.string().optional().default("Your path is ready"),
  path_name: z.string(),
  tagline: z.string().optional(),
  results_subtitle: z.string().optional(),
  counter_label: z.string().optional().default("selected"),
  max_selections: z.number().optional().default(4),
  skills_breakdown_label: z.string().optional().default("Skills breakdown"),
  tools_label: z.string().optional().default("Tools in this path"),
  tools_marquee: z.boolean().optional(),
  icon: z.string().optional(),
  default_courses: z.array(z.string()),
  courses: z.array(aiFlexPathCourseSchema),
  cta: ctaBlockSchema,
});

export const aiFlexPathDragAndDropSchema = z.object({
  ready_label: z.string().optional(),
  path_name: z.string(),
  tagline: z.string().optional(),
  results_subtitle: z.string().optional(),
  max_selections: z.number().optional(),
  view_details_label: z.string().optional(),
  drag_instruction_label: z.string().optional(),
  replace_label: z.string().optional(),
  swap_label: z.string().optional(),
  swap_icon: z.string().optional(),
  swap_prompt_label: z.string().optional(),
  swap_cancel_label: z.string().optional(),
  tools_label: z.string().optional(),
  tools_marquee: z.boolean().optional(),
  icon: z.string().optional(),
  image_id: z.string().optional(),
  default_courses: z.array(z.string()),
  courses: z.array(aiFlexPathDragAndDropCourseSchema),
  cta: ctaBlockSchema,
});

export const aiFlexPathCourseColorSelectorSchema = aiFlexPathDragAndDropSchema.extend({
  slot_colors: z.array(z.object({ color: z.string() })).optional(),
  draggable: z.boolean().optional(),
});

export type AiFlexPathDefault = z.infer<typeof aiFlexPathDefaultSchema>;
export type AiFlexPathDragAndDrop = z.infer<typeof aiFlexPathDragAndDropSchema>;
export type AiFlexPathCourseColorSelector = z.infer<typeof aiFlexPathCourseColorSelectorSchema>;

const aiFlexPathSimplifiedCourseSchema = z.object({
  name: z.string(),
  tagline: z.string().optional(),
  hrs: z.string().optional(),
  tools: z.array(z.string()).default([]),
  skills: z.array(skillSchema).optional().default([]),
  icon: z.string().optional(),
  marker: z.object({
    text: z.string().optional(),
    icon: z.string().optional(),
  }).optional(),
  cta_buttons: z.array(ctaButtonSchema).optional(),
});

export const aiFlexPathSimplifiedSchema = z.object({
  ready_label: z.string().optional(),
  path_name: z.string(),
  tagline: z.string().optional(),
  results_subtitle: z.string().optional(),
  view_details_label: z.string().optional(),
  show_details: z.boolean().optional().default(false),
  show_markers: z.boolean().optional().default(true),
  icon: z.string().optional(),
  image_id: z.string().optional(),
  slot_colors: z.array(z.object({ color: z.string() })).optional(),
  courses: z.array(aiFlexPathSimplifiedCourseSchema),
  cta: ctaBlockSchema.optional(),
});

export type AiFlexPathSimplified = z.infer<typeof aiFlexPathSimplifiedSchema>;
