import { z } from "zod";
import { videoConfigSchema } from "../../_common/schema";

export const componentMeta = {
  displayName: "Features Quad",
  description: "Display 4 feature cards in a grid layout with optional images and laptop edge variant",
};

export const featureQuadCardSchema = z.object({
  icon: z.string().describe("Tabler icon name (e.g., 'Trophy', 'Wallet', 'Clock')"),
  title: z.string().describe("Card title"),
  description: z.string().describe("Card description text"),
});

export const featureQuadImageSchema = z.object({
  image_id: z.string().describe("Image ID from the image registry"),
  alt: z.string().optional().describe("Alt text for the image"),
});

export const featureQuadLaptopImageSchema = z.object({
  image_id: z.string().describe("Image ID from the image registry"),
  alt: z.string().optional().describe("Alt text for the laptop image"),
});

export const featureQuadSectionSchema = z.object({
  type: z.literal("features_quad"),
  version: z.string().optional().default("1.0"),
  variant: z.enum(["default", "laptopEdge"]).optional().describe("Layout variant: default (images on right) or laptopEdge (laptop image on right)"),
  compact: z.boolean().optional().describe("If true, cards show only icon + title (no description)"),
  heading: z.string().describe("Section heading"),
  description: z.string().describe("Section description"),
  images: z.array(featureQuadImageSchema).optional().describe("Array of images (up to 4) displayed in the header"),
  cards: z.array(featureQuadCardSchema).min(4).max(4).describe("Array of exactly 4 feature cards"),
  footer_description: z.string().optional().describe("Optional footer text (italic)"),
  background: z.string().optional().describe("Background CSS class (e.g., 'bg-muted/30')"),
  text_align: z.enum(["left", "center"]).optional().describe("Alignment for heading + description: 'left' (default when both present) or 'center'"),
  video: videoConfigSchema.optional().describe("Video configuration - when provided, replaces images with video"),
  description_with_background: z.boolean().optional().describe("If true, the description and title will have a background color on carousel variant"),
  laptop_image: featureQuadLaptopImageSchema.optional().describe("Optional laptop image override for the laptopEdge variant"),
});

export type FeatureQuadCard = z.infer<typeof featureQuadCardSchema>;
export type FeatureQuadImage = z.infer<typeof featureQuadImageSchema>;
export type FeatureQuadLaptopImage = z.infer<typeof featureQuadLaptopImageSchema>;
export type FeatureQuadSection = z.infer<typeof featureQuadSectionSchema>;
