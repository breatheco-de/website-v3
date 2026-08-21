import { z } from "zod";

export const trustCardItemSchema = z.object({
  image: z.string(),
  rating: z.number(),
  review_count: z.string().optional(),
  trusted_text: z.string().optional(),
});

export const trustCardsSectionSchema = z.object({
  type: z.literal("trust_cards"),
  version: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  items: z.array(trustCardItemSchema),
}).passthrough();

export type TrustCardItem = z.infer<typeof trustCardItemSchema>;
export type TrustCardsSection = z.infer<typeof trustCardsSectionSchema>;
