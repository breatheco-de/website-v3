import { z } from "zod";
import { ctaButtonSchema } from "../../_common/schema";

export const programItemSchema = z.object({
  name: z.string().describe("Program name (e.g., 'Full Stack Development with AI')"),
  icon: z.string().optional().describe("Tabler icon name (e.g., 'IconCode')"),
  description: z.string().describe("Short program description / tagline"),
  duration: z.string().optional().describe("Duration text (e.g., '16 weeks')"),
  avg_salary: z.string().optional().describe("Average salary range (e.g., '$85,000 – $120,000')"),
  cta_text: z.string().optional().describe("CTA button text — legacy flat field (e.g., 'Explore Program')"),
  cta_url: z.string().optional().describe("CTA link URL — legacy flat field"),
  cta: ctaButtonSchema.optional().describe("CTA button config — preferred nested form"),
  color: z.string().optional().describe("Course color token (e.g., 'primary', 'accent', 'destructive')"),
  role: z.string().optional().describe("Job role title for grid variant (e.g., 'Full Stack Developer')"),
  role_label: z.string().optional().describe("Label above role title for grid variant (e.g., 'Become a')"),
  badge: z.string().optional().describe("Badge text shown on cards (e.g., 'High demand')"),
  badge_icon: z.string().optional().describe("Tabler icon name for the badge (e.g., 'IconTrendingUp')"),
});

export const programsShowcaseSectionSchema = z.object({
  type: z.literal("programs_showcase"),
  version: z.string().optional(),
  layout: z.enum(["grid", "stacked_list", "spotlight_with_list"]).optional().describe("Layout variant"),
  heading: z.string().optional().describe("Section heading"),
  subheading: z.string().optional().describe("Section subheading"),
  background: z.string().optional().describe("Section background color token"),
  show_salary: z.boolean().optional().describe("Show avg salary instead of duration in card footers"),
  salary_label: z.string().optional().describe("Label above salary value (e.g., 'Avg. salary')"),
  featured_label: z.string().optional().describe("Label on featured card in spotlight_with_list variant"),
  programs: z.array(programItemSchema).min(1).describe("Array of program items"),
});

export type ProgramItem = z.infer<typeof programItemSchema>;
export type ProgramsShowcaseSection = z.infer<typeof programsShowcaseSectionSchema>;
