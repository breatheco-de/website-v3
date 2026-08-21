/**
 * ImageRow Component Schemas - v1.0
 * 
 * A flexible row of images with an optional highlight content box.
 * Useful for showcasing students, team members, or any visual gallery with messaging.
 */
import { z } from "zod";

export const imageRowImageSchema = z.object({
  src: z.string().describe("Image URL or path"),
  alt: z.string().describe("Alt text for accessibility"),
  object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional().describe("CSS object-fit property"),
  object_position: z.string().optional().describe("CSS object-position property (e.g., 'center top', '20% 50%')"),
  height: z.string().optional().describe("Individual image height (e.g., '400px', '20rem'). Overrides global height."),
});

export const imageRowSlideSchema = z.object({
  text_1: z.string().describe("First text block (styled via rich text editor)"),
  text_2: z.string().describe("Second text block (styled via rich text editor)"),
  heading: z.string().optional().describe("Deprecated: use text_1 instead"),
  text: z.string().optional().describe("Deprecated: use text_2 instead"),
});

export const imageRowHighlightSchema = z.object({
  // Support both single heading/text (backward compat) and slides array
  text_1: z.string().optional().describe("First text block (for single slide mode)"),
  text_2: z.string().optional().describe("Second text block (for single slide mode)"),
  heading: z.string().optional().describe("Deprecated: use text_1 instead"),
  text: z.string().optional().describe("Deprecated: use text_2 instead"),
  reverse_text_order: z.boolean().optional().describe("Show text above the heading"),
  slides: z.array(imageRowSlideSchema).optional().describe("Array of slides for multi-slide mode"),
  background: z.enum(["primary", "accent", "muted", "card"]).optional().describe("Background color theme"),
  width: z.number().optional().describe("Relative width compared to images (default: 2)"),
  autoplay_interval: z.number().optional().describe("Auto-rotation interval in milliseconds (default: 5000)"),
  show_indicators: z.boolean().optional().describe("Show slide indicator dots (default: true for multi-slide)"),
});

export const imageRowSectionSchema = z.object({
  type: z.literal("image_row"),
  images: z.array(imageRowImageSchema).min(1).describe("Array of images to display"),
  highlight: imageRowHighlightSchema.optional().describe("Optional highlight content box"),
  height: z.string().optional().describe("Row height (e.g., '31rem', 'auto')"),
  mobile_height: z.string().optional().describe("Height on mobile devices"),
  gap: z.enum(["sm", "md", "lg"]).optional().describe("Gap between images"),
  rounded: z.boolean().optional().describe("Apply rounded corners to images"),
  background: z.string().optional().describe("Section background color"),
});

export type ImageRowImage = z.infer<typeof imageRowImageSchema>;
export type ImageRowSlide = z.infer<typeof imageRowSlideSchema>;
export type ImageRowHighlight = z.infer<typeof imageRowHighlightSchema>;
export type ImageRowSection = z.infer<typeof imageRowSectionSchema>;
