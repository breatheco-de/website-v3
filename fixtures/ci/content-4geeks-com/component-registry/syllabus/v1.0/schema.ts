/**
 * Syllabus Component Schemas - v1.0
 */
import { z } from "zod";
import { ctaButtonSchema } from "../../_common/schema";

export const syllabusModuleSchema = z.object({
  title: z.string(),
  description: z.string(),
});

// Focus area for landing-syllabus variant
export const focusAreaSchema = z.object({
  title: z.string(),
  icon: z.string().optional(),
});

// Module card for program-modules variant
export const moduleCardSchema = z.object({
  title: z.string(),
  duration: z.string(),
  objectives: z.array(z.string()),
  projects: z.string().nullish(),
  orientation: z.enum(["vertical", "horizontal"]).optional(),
  icon: z.string().optional(),
});

// Technology logo for program info
export const techLogoSchema = z.object({
  name: z.string(),
  icon: z.string(),
});

// Default accordion variant
export const syllabusDefaultSchema = z.object({
  type: z.literal("syllabus"),
  variant: z.literal("default").optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  modules: z.array(syllabusModuleSchema),
  expand_label: z.string().default("Course details"),
  collapse_label: z.string().default("Hide course details"),
});

// Landing syllabus variant with focus areas grid
export const syllabusLandingSchema = z.object({
  type: z.literal("syllabus"),
  variant: z.literal("landing-syllabus"),
  title: z.string(),
  description: z.string().optional(),
  emphasis: z.string().optional(),
  focus_areas: z.array(focusAreaSchema),
});

// Program modules variant with left info card + right scrollable module cards
export const syllabusProgramModulesSchema = z.object({
  type: z.literal("syllabus"),
  variant: z.literal("program-modules"),
  program_title: z.string(),
  program_description: z.string().optional(),
  tech_logos: z.array(techLogoSchema).optional(),
  module_cards: z.array(moduleCardSchema),
  // Optional header block above the syllabus (centered)
  header: z.string().optional(),
  subheader: z.string().optional(),
  description: z.string().optional(), // HTML, use rich-text-editor
  cta_button: ctaButtonSchema.optional(),
});

// Timeline item (Lesson / Project / Quiz row inside an expanded module)
export const syllabusTimelineItemSchema = z.object({
  type: z.enum(["Lesson", "Project", "Quiz"]),
  label: z.string(),
});

// Module row for timeline variant
export const syllabusTimelineModuleSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  video: z.string().url().optional(), // YouTube embed URL or any video URL
  items: z.array(syllabusTimelineItemSchema),
});

// Timeline variant — numbered vertical cards with connector lines
export const syllabusTimelineSchema = z.object({
  type: z.literal("syllabus"),
  variant: z.literal("timeline"),
  title: z.string(),
  subtitle: z.string().optional(),
  modules: z.array(syllabusTimelineModuleSchema),
});

export const syllabusSectionSchema = z.union([
  syllabusDefaultSchema,
  syllabusLandingSchema,
  syllabusProgramModulesSchema,
  syllabusTimelineSchema,
]);

export type SyllabusModule = z.infer<typeof syllabusModuleSchema>;
export type FocusArea = z.infer<typeof focusAreaSchema>;
export type ModuleCard = z.infer<typeof moduleCardSchema>;
export type TechLogo = z.infer<typeof techLogoSchema>;
export type SyllabusDefault = z.infer<typeof syllabusDefaultSchema>;
export type SyllabusLanding = z.infer<typeof syllabusLandingSchema>;
export type SyllabusProgramModules = z.infer<typeof syllabusProgramModulesSchema>;
export type SyllabusTimelineItem = z.infer<typeof syllabusTimelineItemSchema>;
export type SyllabusTimelineModule = z.infer<typeof syllabusTimelineModuleSchema>;
export type SyllabusTimeline = z.infer<typeof syllabusTimelineSchema>;
export type SyllabusSection = z.infer<typeof syllabusSectionSchema>;
