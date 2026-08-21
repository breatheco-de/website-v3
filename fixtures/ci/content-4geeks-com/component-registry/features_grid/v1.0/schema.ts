/**
 * Features Grid Component Schemas - v1.0
 */
import { z } from "zod";

export const featuresGridHighlightItemSchema = z.object({
  id: z.string().optional(),
  icon: z.string(),
  icon_color: z.string().optional(),
  value: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
});

export const featuresGridTextOnlyItemSchema = z.object({
  id: z.string().optional(),
  headline: z.string(),
  subline: z.string().optional(),
  description: z.string().optional(),
});

export const featuresGridDetailedItemSchema = z.object({
  id: z.string().optional(),
  icon: z.string().optional(),
  icon_color: z.string().optional(),
  image: z.object({
    src: z.string(),
    alt: z.string(),
  }).optional(),
  category: z.string().optional(),
  title: z.string(),
  description: z.string(),
  link_url: z.string().optional(),
  link_text: z.string().optional(),
});

export const spotlightConfigSchema = z.object({
  initial_index: z.number().optional(),
  auto_rotate_ms: z.number().optional(),
  pause_on_hover: z.boolean().optional(),
}).strict();

export const footerLinkSchema = z.object({
  url: z.string(),
  text: z.string(),
});

export const featuresGridHighlightSectionSchema = z.object({
  type: z.literal("features_grid"),
  version: z.string().optional(),
  variant: z.literal("highlight").optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  items: z.array(featuresGridHighlightItemSchema),
  columns: z.number().optional(),
  icon_color: z.string().optional(),
  background: z.string().optional(),
  footer_link: footerLinkSchema.optional(),
  footer_note: z.string().optional(),
});

export const featuresGridDetailedSectionSchema = z.object({
  type: z.literal("features_grid"),
  version: z.string().optional(),
  variant: z.literal("detailed"),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  items: z.array(featuresGridDetailedItemSchema),
  columns: z.number().optional(),
  icon_color: z.string().optional(),
  collapsible_mobile: z.boolean().optional(),
  background: z.string().optional(),
  show_workflow_diagram: z.boolean().optional(),
  workflow_diagram_label: z.string().optional(),
});

export const featuresGridSpotlightSectionSchema = z.object({
  type: z.literal("features_grid"),
  version: z.string().optional(),
  variant: z.literal("spotlight"),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  items: z.array(featuresGridHighlightItemSchema),
  columns: z.number().optional(),
  icon_color: z.string().optional(),
  background: z.string().optional(),
  spotlight_config: spotlightConfigSchema.optional(),
});

export const featuresGridStatsCardsItemSchema = z.object({
  id: z.string().optional(),
  value: z.string(),
  title: z.string(),
  value_size: z.string().optional(),
});

export const featuresGridStatsCardsSectionSchema = z.object({
  type: z.literal("features_grid"),
  version: z.string().optional(),
  variant: z.literal("stats-cards"),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  card_color: z.string().optional(),
  use_card: z.boolean().optional(),
  background: z.string().optional(),
  items: z.array(featuresGridStatsCardsItemSchema),
});

export const featuresGridStatsTextCardSectionSchema = z.object({
  type: z.literal("features_grid"),
  version: z.string().optional(),
  variant: z.literal("stats-text-card"),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  card_color: z.string().optional(),
  background: z.string().optional(),
  items: z.array(featuresGridStatsCardsItemSchema),
});

export const featuresGridStatsTextSectionSchema = z.object({
  type: z.literal("features_grid"),
  version: z.string().optional(),
  variant: z.literal("stats-text"),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  background: z.string().optional(),
  items: z.array(featuresGridStatsCardsItemSchema),
});

export const featuresGridTextOnlySectionSchema = z.object({
  type: z.literal("features_grid"),
  version: z.string().optional(),
  variant: z.literal("textOnly"),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  items: z.array(featuresGridTextOnlyItemSchema),
  columns: z.number().optional(),
  background: z.string().optional(),
});

export const featuresGridCardHeaderCardSchema = z.object({
  icon: z.string(),
  text: z.string(),
});

export const featuresGridCardHeaderSectionSchema = z.object({
  type: z.literal("features_grid"),
  version: z.string().optional(),
  variant: z.literal("cardHeader"),
  heading: z.string(),
  description: z.string().optional(),
  cta: z.object({
    text: z.string(),
    url: z.string(),
  }).optional(),
  image: z.string().optional(),
  image_alt: z.string().optional(),
  background: z.string().optional(),
  collapsible_mobile: z.boolean().optional(),
  cards: z.array(featuresGridCardHeaderCardSchema),
});

export const featuresGridStatsChartsCardBarsSchema = z.object({
  badge: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  stat_value: z.string().optional(),
  stat_label: z.string().optional(),
  years: z.array(z.string()).optional(),
  displaced_label: z.string().optional(),
  created_label: z.string().optional(),
});

export const featuresGridStatsChartsCardGaugeSchema = z.object({
  badge: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  stat_value: z.string().optional(),
  stat_label: z.string().optional(),
  inner_stat_percentage: z.number().optional(),
  outer_stat_percentage: z.number().optional(),
  show_gauge: z.boolean().optional(),
  inner_stat_highlight: z.boolean().optional(),
  gauge_label: z.string().optional(),
  bar1_label: z.string().optional(),
  bar2_label: z.string().optional(),
});

export const featuresGridStatsChartsCardTrendSchema = z.object({
  badge: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  stat_value: z.string().optional(),
  stat_label: z.string().optional(),
  end_label: z.string().optional(),
});

export const featuresGridStatsChartsSectionSchema = z.object({
  type: z.literal("features_grid"),
  version: z.string().optional(),
  variant: z.literal("stats-charts"),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  background: z.string().optional(),
  card_bars_accent: z.string().optional(),
  card_gauge_accent: z.string().optional(),
  card_trend_accent: z.string().optional(),
  card_bars: featuresGridStatsChartsCardBarsSchema.optional(),
  card_gauge: featuresGridStatsChartsCardGaugeSchema.optional(),
  card_trend: featuresGridStatsChartsCardTrendSchema.optional(),
});

export const featuresGridSectionSchema = z.union([
  featuresGridHighlightSectionSchema,
  featuresGridDetailedSectionSchema,
  featuresGridSpotlightSectionSchema,
  featuresGridStatsChartsSectionSchema,
  featuresGridStatsCardsSectionSchema,
  featuresGridStatsTextCardSectionSchema,
  featuresGridStatsTextSectionSchema,
  featuresGridTextOnlySectionSchema,
  featuresGridCardHeaderSectionSchema,
]);

export type FeaturesGridHighlightItem = z.infer<typeof featuresGridHighlightItemSchema>;
export type FeaturesGridTextOnlyItem = z.infer<typeof featuresGridTextOnlyItemSchema>;
export type FeaturesGridDetailedItem = z.infer<typeof featuresGridDetailedItemSchema>;
export type FeaturesGridStatsCardsItem = z.infer<typeof featuresGridStatsCardsItemSchema>;
export type FeaturesGridCardHeaderCard = z.infer<typeof featuresGridCardHeaderCardSchema>;
export type FeaturesGridHighlightSection = z.infer<typeof featuresGridHighlightSectionSchema>;
export type FeaturesGridDetailedSection = z.infer<typeof featuresGridDetailedSectionSchema>;
export type FeaturesGridSpotlightSection = z.infer<typeof featuresGridSpotlightSectionSchema>;
export type FeaturesGridStatsChartsSection = z.infer<typeof featuresGridStatsChartsSectionSchema>;
export type FeaturesGridStatsChartsCardBars = z.infer<typeof featuresGridStatsChartsCardBarsSchema>;
export type FeaturesGridStatsChartsCardGauge = z.infer<typeof featuresGridStatsChartsCardGaugeSchema>;
export type FeaturesGridStatsChartsCardTrend = z.infer<typeof featuresGridStatsChartsCardTrendSchema>;
export type FeaturesGridStatsCardsSection = z.infer<typeof featuresGridStatsCardsSectionSchema>;
export type FeaturesGridStatsTextCardSection = z.infer<typeof featuresGridStatsTextCardSectionSchema>;
export type FeaturesGridStatsTextSection = z.infer<typeof featuresGridStatsTextSectionSchema>;
export type FeaturesGridTextOnlySection = z.infer<typeof featuresGridTextOnlySectionSchema>;
export type FeaturesGridCardHeaderSection = z.infer<typeof featuresGridCardHeaderSectionSchema>;
export type SpotlightConfig = z.infer<typeof spotlightConfigSchema>;
export type FeaturesGridSection = z.infer<typeof featuresGridSectionSchema>;
