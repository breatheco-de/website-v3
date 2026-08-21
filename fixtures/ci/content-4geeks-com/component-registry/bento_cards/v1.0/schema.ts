/**
 * Bento Cards Component Schemas - v1.0
 * A bento-box style card grid that bleeds to the right edge of the viewport
 */
import { z } from "zod";

export const bentoCardItemSchema = z.object({
  id: z.string().optional(),
  icon: z.string().optional(),
  icon_color: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
});

export const bentoCardsSectionSchema = z.object({
  type: z.literal("bento_cards"),
  version: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  items: z.array(bentoCardItemSchema),
  background: z.string().optional(),
});

export type BentoCardItem = z.infer<typeof bentoCardItemSchema>;
export type BentoCardsSection = z.infer<typeof bentoCardsSectionSchema>;
