/**
 * Profiles Carousel Component Schemas - v1.0
 * Horizontal carousel for displaying people profiles (staff, partners, mentors, etc.)
 */
import { z } from "zod";

export const profileCardSchema = z.object({
  image_id: z.string().optional(),
  object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
  object_position: z.string().optional(),
  name: z.string(),
  role: z.string().optional(),
  description: z.string().optional(),
  linkedin_url: z.string().optional(),

});

export const profilesCarouselSectionSchema = z.object({
  type: z.literal("profiles_carousel"),
  version: z.string().optional(),
  heading: z.string().optional(),
  description: z.string().optional(),
  background: z.string().optional(),
  image_round: z.boolean().optional(),
  profiles: z.array(profileCardSchema).min(1),
});

export type ProfileCard = z.infer<typeof profileCardSchema>;
export type ProfilesCarouselSection = z.infer<typeof profilesCarouselSectionSchema>;
