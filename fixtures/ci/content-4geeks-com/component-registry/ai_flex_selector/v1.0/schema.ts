import { z } from "zod";
import { ctaButtonSchema } from "../../_common/schema";

const skillSchema = z.object({
  name: z.string(),
  skill_percentage: z.number(),
});

const courseSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  hrs: z.string(),
  tools: z.array(z.string()),
  skills: z.array(skillSchema),
});

const questionOptionSchema = z.object({
  label: z.string(),
});

const questionSchema = z.object({
  subtitle: z.string(),
  text: z.string(),
  options: z.array(questionOptionSchema),
});

const pathSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  courses: z.array(z.string()),
});

const resultsSchema = z.object({
  ready_label: z.string(),
  subtitle: z.string(),
  counter_label: z.string(),
  tools_label: z.string(),
});

const ctaBlockSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  banner: z.boolean().optional(),
  buttons: z.array(ctaButtonSchema),
});

export const aiFlexSelectorDefaultSchema = z.object({
  badge_text: z.string(),
  title: z.string(),
  title_highlight: z.string(),
  subtitle: z.string(),
  icon: z.string().optional(),
  back_label: z.string(),
  restart_label: z.string(),
  skills_breakdown_label: z.string(),
  max_selections: z.number(),
  tools_marquee: z.boolean().optional(),
  results: resultsSchema,
  cta: ctaBlockSchema,
  questions: z.array(questionSchema),
  courses: z.array(courseSchema),
  paths: z.array(pathSchema),
});

export type AiFlexSelectorDefault = z.infer<typeof aiFlexSelectorDefaultSchema>;
