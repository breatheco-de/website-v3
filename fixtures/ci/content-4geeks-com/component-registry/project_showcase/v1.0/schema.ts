/**
 * Project Showcase Component Schemas - v1.0
 */
import { z } from "zod";

export const projectShowcaseCreatorSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  github_url: z.string().optional(),
  linkedin_url: z.string().optional(),
});

export const projectShowcaseMediaSchema = z.object({
  type: z.enum(["video", "image"]),
  src: z.string(),
  alt: z.string().optional(),
});

export const projectShowcaseItemSchema = z.object({
  project_title: z.string(),
  project_url: z.string().optional(),
  description: z.string(),
  creators: z.array(projectShowcaseCreatorSchema),
  media: z.array(projectShowcaseMediaSchema).optional(),
  image: z.string().optional(),
  video_id: z.string().optional(),
});

export const projectShowcaseSectionSchema = z.object({
  type: z.literal("project_showcase"),
  version: z.string().optional(),
  project_title: z.string(),
  description: z.string(),
  creators: z.array(projectShowcaseCreatorSchema),
  media: z.array(projectShowcaseMediaSchema).optional(),
  image: z.string().optional(),
  video_id: z.string().optional(),
  background: z.string().optional(),
  media_position: z.enum(["left", "right"]).optional(),
});

export const projectsShowcaseSectionSchema = z.object({
  type: z.literal("projects_showcase"),
  version: z.string().optional(),
  items: z.array(projectShowcaseItemSchema),
});

export type ProjectShowcaseCreator = z.infer<typeof projectShowcaseCreatorSchema>;
export type ProjectShowcaseMedia = z.infer<typeof projectShowcaseMediaSchema>;
export type ProjectShowcaseItem = z.infer<typeof projectShowcaseItemSchema>;
export type ProjectShowcaseSection = z.infer<typeof projectShowcaseSectionSchema>;
export type ProjectsShowcaseSection = z.infer<typeof projectsShowcaseSectionSchema>;
