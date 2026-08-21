import { z } from "zod";
import { videoConfigSchema } from "../../_common/schema";

export const componentMeta = {
  displayName: "Cards Deck",
  description: "A row of 3 cards, each with optional video or image, brand image, author name, title, and description",
};

export const cardDeckItemSchema = z.object({
  video: videoConfigSchema.optional().describe("Video configuration for the card"),
  image: z.string().optional().describe("Image URL — if provided, replaces the video with a static image"),
  brand_image: z.string().optional().describe("Brand/logo image URL shown above the author name"),
  author_name: z.string().optional().describe("Author or attribution name"),
  title: z.string().describe("Card title"),
  description: z.string().describe("Card description text"),
});

export const cardsDeckSectionSchema = z.object({
  type: z.literal("cards_deck"),
  version: z.string().optional().default("1.0"),
  variant: z.enum(["default"]).optional().describe("Layout variant"),
  heading: z.string().optional().describe("Section heading displayed above the cards"),
  subtitle: z.string().optional().describe("Section subtitle with rich text support, displayed below the heading"),
  cards: z.array(cardDeckItemSchema).min(1).max(6).describe("Array of cards (typically 3)"),
});

export type CardDeckItem = z.infer<typeof cardDeckItemSchema>;
export type CardsDeckSection = z.infer<typeof cardsDeckSectionSchema>;
