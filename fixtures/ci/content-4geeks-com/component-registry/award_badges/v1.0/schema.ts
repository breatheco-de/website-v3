/**
 * Award Badges Component Schemas - v1.0
 */
import { z } from "zod";

export const awardBadgeItemSchema = z.object({
  id: z.string(),
  alt: z.string(),
  logo: z.string().optional(),
  logoHeight: z.string().optional(),
  description: z.string().optional(),
  link: z.string().optional(),
  linkText: z.string().optional(),
  source: z.string().optional(),
  name: z.string().optional(),
  year: z.string().optional(),
});

export const awardBadgesSectionSchema = z.object({
  type: z.literal("award_badges"),
  version: z.string().optional(),
  title: z.string().optional(),
  variant: z.enum(["simple", "detailed"]).optional(),
  showBorder: z.boolean().optional(),
  items: z.array(awardBadgeItemSchema),
});

export type AwardBadgeItem = z.infer<typeof awardBadgeItemSchema>;
export type AwardBadgesSection = z.infer<typeof awardBadgesSectionSchema>;
