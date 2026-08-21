/**
 * Banner Component Schemas - v1.0
 *
 * bannerSectionSchema   — centered card with optional avatars, title, description, CTA
 * bannerMarqueeBadgesSchema — full-bleed section with scrolling badge marquees + split statement
 */
import { z } from "zod";
import { ctaButtonSchema } from "../../_common/schema";

export const bannerSectionSchema = z.object({
  type: z.literal("banner"),
  version: z.string().optional(),
  logo: z.string().optional(),
  avatars: z.array(z.string()).optional(),
  title: z.string(),
  description: z.string().optional(),
  cta: ctaButtonSchema.optional(),
  background: z.enum(["gradient", "muted", "card", "background"]).optional().default("gradient"),
});

export type BannerSection = z.infer<typeof bannerSectionSchema>;

export const bannerMarqueeBadgesSchema = z.object({
  type: z.literal("banner"),
  variant: z.literal("marqueeBadges"),
  subtitle: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  cta_buttons: z.array(ctaButtonSchema).optional(),
  top_badges: z.array(z.string()).optional(),
  bottom_badges: z.array(z.string()).optional(),
  marquee_speed: z.number().optional(),
});

export type BannerMarqueeBadges = z.infer<typeof bannerMarqueeBadgesSchema>;

export const bannerSchema = z.union([bannerMarqueeBadgesSchema, bannerSectionSchema]);
