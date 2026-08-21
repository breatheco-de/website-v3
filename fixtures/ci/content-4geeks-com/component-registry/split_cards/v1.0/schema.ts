/**
 * Split Cards Component Schemas - v1.0
 * 
 * A two-card layout with responsive sizing: 3/4 + 1/4 on desktop, 50/50 on tablet, stacked on mobile.
 * Primary card has dark background with heading, description, and floating tool icons.
 * Secondary card has accent background with a list of benefits.
 * 
 * Variants:
 * - primary-left (default): Primary card on left, secondary on right
 * - primary-right: Primary card on right, secondary on left
 */
import { z } from "zod";

export const toolIconSchema = z.object({
  icon: z.string().optional(),
  image_id: z.string().optional(),
  size: z.enum(["sm", "md", "lg"]).optional().default("md"),
  position: z.object({
    top: z.string().optional(),
    bottom: z.string().optional(),
    left: z.string().optional(),
    right: z.string().optional(),
  }).optional(),
});

export const splitCardsBenefitSchema = z.object({
  text: z.string(),
  icon: z.string().optional(),
});

export const splitCardsSectionSchema = z.object({
  type: z.literal("split_cards"),
  variant: z.enum(["primary-left", "primary-right"]).optional().default("primary-left"),
  primary_width: z.enum(["narrow", "default", "wide"]).optional(),
  primary: z.object({
    heading: z.string(),
    description: z.string().optional(),
    badge: z.string().optional(),
    tool_icons: z.array(toolIconSchema).nullable().optional(),
  }),
  secondary: z.object({
    benefits: z.array(splitCardsBenefitSchema).max(5).optional(),
    bullet_icon: z.string().optional(),
    image_id: z.string().optional(),
    image_object_fit: z.enum(["cover", "contain", "fill", "none"]).optional(),
    image_object_position: z.string().optional(),
  }),
  background: z.string().optional(),
});

export type ToolIcon = z.infer<typeof toolIconSchema>;
export type SplitCardsBenefit = z.infer<typeof splitCardsBenefitSchema>;
export type SplitCardsSection = z.infer<typeof splitCardsSectionSchema>;
