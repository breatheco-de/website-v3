/**
 * OG Image Preview Component Schemas - v1.0
 *
 * Fixed 1200×630 canvas for EntryPreview screenshots (social / OG thumbs).
 */
import { z } from "zod";

export const ogImagePreviewSectionSchema = z.object({
  type: z.literal("og_image_preview"),
  version: z.string().optional(),
  variant: z.enum(["default"]).optional(),
  logo: z.string().optional(),
  /** Single label or list (e.g. mapped from lesson `tags`) — rendered as badges. */
  category: z.union([z.string(), z.array(z.string())]).optional(),
  title: z.string(),
  author: z.string().optional(),
  /** Article body (markdown/HTML); converted to reading_time before render. */
  content: z.string().optional(),
  /** Computed label (e.g. "7 min read") — set from `content`, not mapped directly. */
  reading_time: z.string().optional(),
});

export type OgImagePreviewSection = z.infer<typeof ogImagePreviewSectionSchema>;
