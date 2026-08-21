/**
 * Who's Hiring Component Schemas - v1.0
 */
import { z } from "zod";
import { logoItemSchema } from "../../_common/schema";

export const whosHiringSectionSchema = z.object({
  type: z.literal("whos_hiring"),
  variant: z.enum(["grid", "carousel"]).optional().default("grid"),
  pretitle: z.string().nullish(),
  title: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  logos: z.array(logoItemSchema),
});

export type WhosHiringSection = z.infer<typeof whosHiringSectionSchema>;
