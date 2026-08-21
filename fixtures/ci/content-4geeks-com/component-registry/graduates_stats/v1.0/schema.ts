/**
 * GraduatesStats Component Schemas - v1.0
 * Supports multiple layout variants via z.union
 */
import { z } from "zod";

// ============================================
// Shared Schemas
// ============================================

export const graduatesStatItemSchema = z.object({
  value: z.string(),
  unit: z.string().optional(),
  label: z.string(),
});

/**
 * Image entry used inside collage grids (standard and fullBleed variants).
 * Carries layout grid properties alongside image-position styling fields so
 * that the image-with-style-picker editor can read/write object_position,
 * object_scale, and transform_origin without a separate sibling field.
 */
export const graduatesCollageImageSchema = z.object({
  image_id: z.string(),
  col_span: z.number().optional(),
  row_span: z.number().optional(),
  col_start: z.number().optional(),
  row_start: z.number().optional(),
  object_position: z.string().optional().describe("CSS object-position property (e.g., 'center top', '20% 50%')"),
  object_scale: z.number().optional().describe("CSS transform scale factor (e.g., 1.2 for 20% zoom)"),
  transform_origin: z.string().optional().describe("CSS transform-origin (e.g., '50% 0%' for center top)"),
});

/**
 * Image entry used in the featured image slots (fullBleed variant only).
 * Same structure as graduatesCollageImageSchema so the editor picks it up
 * under the featured_images[].image_id → image-with-style-picker mapping.
 */
export const graduatesFeaturedImageSchema = z.object({
  image_id: z.string(),
  col_span: z.number().optional(),
  row_span: z.number().optional(),
  col_start: z.number().optional(),
  row_start: z.number().optional(),
  object_position: z.string().optional().describe("CSS object-position property (e.g., 'center top', '20% 50%')"),
  object_scale: z.number().optional().describe("CSS transform scale factor (e.g., 1.2 for 20% zoom)"),
  transform_origin: z.string().optional().describe("CSS transform-origin (e.g., '50% 0%' for center top)"),
});

// ============================================
// Variant Schemas
// ============================================

export const graduatesStatsStandardSchema = z.object({
  type: z.literal("graduates_stats"),
  version: z.string().optional(),
  variant: z.literal("standard").optional(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  stats: z.array(graduatesStatItemSchema),
  collage_images: z.array(graduatesCollageImageSchema),
  background: z.string().optional(),
  value_size: z.string().optional(),
});

export const graduatesStatsFullBleedSchema = z.object({
  type: z.literal("graduates_stats"),
  version: z.string().optional(),
  variant: z.literal("fullBleed"),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  stats: z.array(graduatesStatItemSchema),
  collage_images: z.array(graduatesCollageImageSchema),
  featured_images: z.array(graduatesFeaturedImageSchema),
  background: z.string().optional(),
  image_bordered: z.boolean().optional().default(true),
  value_size: z.string().optional(),
});

export const graduatesStatsAsymmetricSchema = z.object({
  type: z.literal("graduates_stats"),
  version: z.string().optional(),
  variant: z.literal("asymmetric"),
  heading: z.string().optional(),
  subheading: z.string().optional(),
  stats: z.array(graduatesStatItemSchema),
  tall_image: z.string().describe("Image ID for the tall portrait image on the left"),
  stacked_images: z.array(z.string()).describe("Array of 2 image IDs for the stacked landscape images"),
  background: z.string().optional(),
  value_size: z.string().optional(),
});

// ============================================
// Combined Schema (Union of all variants)
// ============================================

export const graduatesStatsSectionSchema = z.union([
  graduatesStatsStandardSchema,
  graduatesStatsFullBleedSchema,
  graduatesStatsAsymmetricSchema,
]);

// ============================================
// Types
// ============================================

export type GraduatesStatItem = z.infer<typeof graduatesStatItemSchema>;
export type GraduatesCollageImage = z.infer<typeof graduatesCollageImageSchema>;
export type GraduatesFeaturedImage = z.infer<typeof graduatesFeaturedImageSchema>;
export type GraduatesStatsStandard = z.infer<typeof graduatesStatsStandardSchema>;
export type GraduatesStatsFullBleed = z.infer<typeof graduatesStatsFullBleedSchema>;
export type GraduatesStatsAsymmetric = z.infer<typeof graduatesStatsAsymmetricSchema>;
export type GraduatesStatsSection = z.infer<typeof graduatesStatsSectionSchema>;
