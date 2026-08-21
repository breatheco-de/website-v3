import { z } from "zod";

export const doubleCTABulletSchema = z.object({
  icon: z.string().optional(),
  text: z.string().optional(),
});

export const doubleCTABoxSchema = z.object({
  heading: z.string().optional(),
  description: z.string().optional(),
  bullets: z.array(doubleCTABulletSchema).optional(),
  image_id: z.string().optional(),
  image_object_fit: z.enum(["cover", "contain", "fill", "none"]).optional(),
  image_object_position: z.string().optional(),
  image_beside_bullets: z.boolean().optional(),
  cta_text: z.string().optional(),
  cta_url: z.string().optional(),
  cta_variant: z.enum(["primary", "secondary", "outline"]).optional(),
  sub_text: z.string().optional(),
});

export const doubleCTASectionSchema = z.object({
  type: z.literal("double_cta"),
  variant: z.enum(["expandable"]).optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  background: z.string().optional(),
  left: doubleCTABoxSchema.optional(),
  right: doubleCTABoxSchema.optional(),
});

export type DoubleCTABullet = z.infer<typeof doubleCTABulletSchema>;
export type DoubleCTABox = z.infer<typeof doubleCTABoxSchema>;
export type DoubleCTASection = z.infer<typeof doubleCTASectionSchema>;
