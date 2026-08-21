/**
 * Projects Component Schemas - v1.0
 */
import { z } from "zod";

export const projectItemSchema = z.object({
  title: z.string(),
  description: z.string(),
  image: z.string(),
  tags: z.array(z.string()).optional(),
  duration: z.string().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  date: z.string().optional(),
});

export const projectsSectionSchema = z.object({
  type: z.literal("projects"),
  title: z.string(),
  subtitle: z.string().optional(),
  items: z.array(projectItemSchema),
});

export type ProjectItem = z.infer<typeof projectItemSchema>;
export type ProjectsSection = z.infer<typeof projectsSectionSchema>;
