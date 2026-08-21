/**
 * AI Learning Component Schemas - v1.0
 * 
 * Variants:
 * - feature-tabs: Shows 3 hover cards with expandable content (default)
 * - highlight: Shows text + video side-by-side layout
 */
import { z } from "zod";
import { ctaButtonSchema, videoConfigSchema } from "../../_common/schema";

export const chatExampleSchema = z.object({
  bot_name: z.string(),
  bot_status: z.string(),
  user_message: z.string(),
  bot_response: z.string(),
});

// Bullet item schema for reuse
export const aiLearningBulletSchema = z.object({
  text: z.string(),
  icon: z.string().optional(),
});

// Extended card item for AI learning features with optional bullets, video, image, or CTA
export const aiLearningFeatureSchema = z.object({
  icon: z.string(),
  title: z.string(),
  description: z.string(),
  show_rigobot_logo: z.boolean().optional(),
  bullets: z.array(aiLearningBulletSchema).optional(),
  /** @deprecated Use video.url instead */
  video_url: z.string().optional(),
  video: videoConfigSchema.optional(),
  image_id: z.string().optional(),
  cta: ctaButtonSchema.nullable().optional(),
});

// Variant: feature-tabs - Shows 3 hover cards with expandable content
export const aiLearningFeatureTabsSectionSchema = z.object({
  type: z.literal("ai_learning"),
  variant: z.literal("feature-tabs").optional(), // optional for backward compatibility (default)
  badge: z.string().optional(),
  title: z.string(),
  description: z.string(),
  features: z.array(aiLearningFeatureSchema),
  chat_example: chatExampleSchema.optional(),
  /** @deprecated Use video.url instead */
  video_url: z.string().optional(),
  video: videoConfigSchema.optional(),
});

// Variant: highlight - Shows text + video side-by-side layout
export const aiLearningHighlightSectionSchema = z.object({
  type: z.literal("ai_learning"),
  variant: z.literal("highlight"),
  badge: z.string().optional(),
  title: z.string(),
  description: z.string(),
  bullets: z.array(aiLearningBulletSchema).optional(),
  /** @deprecated Use video.url instead */
  video_url: z.string().optional(),
  video: videoConfigSchema.optional(),
  video_position: z.enum(["left", "right"]).optional(),
  cta: ctaButtonSchema.optional(),
});

// Union schema for all variants
export const aiLearningSectionSchema = z.union([
  aiLearningFeatureTabsSectionSchema,
  aiLearningHighlightSectionSchema,
]);

export type ChatExample = z.infer<typeof chatExampleSchema>;
export type AiLearningFeatureTabsSection = z.infer<typeof aiLearningFeatureTabsSectionSchema>;
export type AiLearningHighlightSection = z.infer<typeof aiLearningHighlightSectionSchema>;
export type AiLearningSection = z.infer<typeof aiLearningSectionSchema>;
