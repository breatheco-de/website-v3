import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Boot-critical schemas.
 *
 * Shared platform components: import from shared/component-registry only.
 * Do NOT add new re-exports from site_ folders under component-registry — site-only Zod
 * must be resolved via the site-aware registry (shared union site) at runtime.
 * Existing site_ imports below are legacy until those types are promoted to shared
 * or callers stop needing them at boot.
 */

// ============================================
// Database Schemas
// ============================================
export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Managed by raw SQL in server/db.ts (CREATE TABLE IF NOT EXISTS); defined here
// so drizzle-kit push does not treat it as extraneous and attempt to drop it.
export const errorLog = sqliteTable(
  "error_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts").notNull(),
    level: text("level").notNull(),
    module: text("module").notNull(),
    message: text("message").notNull(),
    errName: text("err_name"),
    errStack: text("err_stack"),
  },
  (table) => [
    index("error_log_ts_idx").on(table.ts),
    index("error_log_level_idx").on(table.level),
  ],
);

export type ErrorLogRow = typeof errorLog.$inferSelect;

// ============================================
// Re-export Common Schemas from Component Registry
// ============================================
export {
  ctaButtonSchema,
  videoConfigSchema,
  imageSchema,
  leadFormFieldConfigSchema,
  leadFormDataSchema,
  webhookConfigSchema,
  cardItemSchema,
  statItemSchema,
  logoItemSchema,
  type CtaButton,
  type VideoConfig,
  type ImageDef,
  type LeadFormData,
  type WebhookConfig,
  type CardItem,
  type StatItem,
  type LogoItem,
} from "./component-registry/_common/schema";

// Alias for backward compatibility
export { leadFormDataSchema as productShowcaseFormSchema } from "./component-registry/_common/schema";

// Local binding for use within this file
import { ctaButtonSchema as commonCtaButtonSchema } from "./component-registry/_common/schema";

// ============================================
// Re-export Hero Schemas from Component Registry
// Only export unified schema and shared sub-schemas (not individual variants)
// ============================================
export {
  trustBarSchema,
  awardBadgeSchema,
  heroImageSchema,
  brandMarkSchema,
  reviewLogoSchema,
  productShowcaseTrustBarSchema,
  bulletItemSchema,
  heroCourseTutorSchema,
  heroCourseFeatureSchema,
  heroSectionSchema,
  heroCredibilityPillLogoSchema,
  heroCredibilityPillSchema,
  heroCredibilityMarqueeItemSchema,
  heroCredibilitySchema,
  heroOrbitBadgeSchema,
  heroOrbitDiagramSchema,
  heroOrbitSchema,
  type TrustBar,
  type AwardBadge,
  type HeroImage,
  type BrandMark,
  type ReviewLogo,
  type ProductShowcaseTrustBar,
  type BulletItem,
  type HeroCourseTutor,
  type HeroCourseFeature,
  type HeroSection,
  type HeroCredibilityPillLogo,
  type HeroCredibilityPill,
  type HeroCredibilityMarqueeItem,
  type HeroCredibility,
  type HeroOrbitBadge,
  type HeroOrbitDiagram,
  type HeroOrbit,
} from "./component-registry/hero/v1.0/schema";

// Variant types for type narrowing (schemas are internal to component registry)
export type {
  HeroSingleColumn,
  HeroBlogHero,
  HeroShowcase,
  HeroProductShowcase,
  HeroSimpleTwoColumn,
  HeroSimpleStacked,
  HeroTwoColumn,
  HeroCourse,
  HeroApplyFormProductShowcase,
  HeroExercise,
} from "./component-registry/hero/v1.0/schema";

// HeroCredibility is already exported via the re-export block above

// ============================================
// Re-export AiFlexSelector Schemas from Component Registry
// ============================================
export {
  aiFlexSelectorDefaultSchema,
  type AiFlexSelectorDefault,
} from "../site_4geeks-com/component-registry/ai_flex_selector/v1.0/schema";

// ============================================
// Re-export Survey Schemas from Component Registry
// ============================================
export {
  surveyDefaultSchema,
  type SurveyDefault,
} from "../site_4geeks-com/component-registry/survey/v1.0/schema";

// ============================================
// Re-export AiFlexPath Schemas from Component Registry
// ============================================
export {
  aiFlexPathDefaultSchema,
  aiFlexPathDragAndDropSchema,
  aiFlexPathCourseColorSelectorSchema,
  aiFlexPathSimplifiedSchema,
  aiFlexPathSectionSchema,
  type AiFlexPathDefault,
  type AiFlexPathDragAndDrop,
  type AiFlexPathCourseColorSelector,
  type AiFlexPathSimplified,
  type AiFlexPathSection,
} from "../site_4geeks-com/component-registry/ai_flex_path/v1.0/schema";

// ============================================
// Re-export AI Learning Schemas from Component Registry
// ============================================
export {
  chatExampleSchema,
  aiLearningBulletSchema,
  aiLearningFeatureSchema,
  aiLearningFeatureTabsSectionSchema,
  aiLearningHighlightSectionSchema,
  aiLearningSectionSchema,
  type ChatExample,
  type AiLearningFeatureTabsSection,
  type AiLearningHighlightSection,
  type AiLearningSection,
} from "../site_4geeks-com/component-registry/ai_learning/v1.0/schema";

// Type alias for backward compatibility
export type AILearningSection = import("../site_4geeks-com/component-registry/ai_learning/v1.0/schema").AiLearningSection;

// ============================================
// Re-export Mentorship Schemas from Component Registry
// ============================================
export {
  mentorshipSectionSchema,
  type MentorshipSection,
} from "../site_4geeks-com/component-registry/mentorship/v1.0/schema";

// ============================================
// Re-export Certificate Schemas from Component Registry
// ============================================
export {
  certificateSectionSchema,
  type CertificateSection,
} from "../site_4geeks-com/component-registry/certificate/v1.0/schema";

// ============================================
// Re-export TextBlock Schemas from Component Registry
// ============================================
export {
  textBlockSectionSchema,
  type TextBlockSection,
} from "../shared/component-registry/text_block/v1.0/schema";

// ============================================
// Re-export Why Learn AI Schemas from Component Registry
// ============================================
export {
  whyLearnAISectionSchema,
  type WhyLearnAISection,
} from "../site_4geeks-com/component-registry/why_learn_ai/v1.0/schema";

// ============================================
// Re-export Pricing Schemas from Component Registry
// ============================================
export {
  pricingFeatureSchema,
  pricingPlanSchema,
  pricingSectionSchema,
  pricingPlanCardsSchema,
  pricingPlanCardsNewSchema,
  pricingPlanCardsPlanSchema,
  pricingPlanCardsNewPlanSchema,
  pricingPlanCardsFeatureSchema,
  pricingPlanCardsPlanFeatureSchema,
  pricingPlanCardsAddonSchema,
  type PricingFeature,
  type PricingPlan,
  type PricingSection,
  type PricingPlanCardsPlan,
  type PricingPlanCardsFeature,
  type PricingPlanCardsSection,
  type PricingPlanCardsPlanFeature,
  type PricingPlanCardsNewPlan,
  type PricingPlanCardsNewSection,
} from "../site_4geeks-com/component-registry/pricing/v1.0/schema";

// ============================================
// Re-export FAQ Schemas from Component Registry
// ============================================
export {
  faqItemSchema,
  faqSectionSchema,
  type FaqItem,
  type FaqSection,
  type FAQ,
} from "./component-registry/faq/v1.0/schema";

export {
  breadcrumbItemSchema,
  breadcrumbSectionSchema,
  type BreadcrumbItem,
  type BreadcrumbSection,
} from "./component-registry/breadcrumb/v1.0/schema";

export {
  geekchartSectionSchema,
  type GeekchartSection,
} from "./component-registry/geekchart/v1.0/schema";

// Type alias for backward compatibility
export type FAQItem = import("./component-registry/faq/v1.0/schema").FaqItem;
export type FAQSection = import("./component-registry/faq/v1.0/schema").FaqSection;

// ============================================
// Re-export Testimonials Schemas from Component Registry
// ============================================
export {
  testimonialItemSchema,
  testimonialsSectionSchema,
  type TestimonialItem,
  type TestimonialsSection,
} from "../site_4geeks-com/component-registry/testimonials/v1.0/schema";

// ============================================
// Re-export Testimonials Grid Schemas from Component Registry
// ============================================
export {
  testimonialsGridItemSchema,
  testimonialsGridSectionSchema,
  type TestimonialsGridItem,
  type TestimonialsGridSection,
} from "../site_4geeks-com/component-registry/testimonials_grid/v1.0/schema";

// ============================================
// Re-export Who's Hiring Schemas from Component Registry
// ============================================
export {
  whosHiringSectionSchema,
  type WhosHiringSection,
} from "../site_4geeks-com/component-registry/whos_hiring/v1.0/schema";

// ============================================
// Re-export Footer Schemas from Component Registry
// ============================================
export {
  footerSectionSchema,
  type FooterSection,
} from "../site_4geeks-com/component-registry/footer/v1.0/schema";

// ============================================
// Re-export Two Column Schemas from Component Registry
// ============================================
export {
  twoColumnBulletSchema,
  bulletGroupSchema,
  benefitItemSchema,
  twoColumnColumnSchema,
  twoColumnSectionSchema,
  type TwoColumnBullet,
  type BulletGroup,
  type BenefitItem,
  type TwoColumnColumn,
  type TwoColumnSection,
} from "../site_4geeks-com/component-registry/two_column/v1.0/schema";

// ============================================
// Re-export Value Proof Panel Schemas from Component Registry
// ============================================
export {
  evidenceItemSchema,
  valueProofPanelMediaSchema,
  valueProofPanelSectionSchema,
  type EvidenceItem,
  type ValueProofPanelMedia,
  type ValueProofPanelSection,
} from "../site_4geeks-com/component-registry/value_proof_panel/v1.0/schema";

// ============================================
// Re-export Split Cards Schemas from Component Registry
// ============================================
export {
  toolIconSchema,
  splitCardsBenefitSchema,
  splitCardsSectionSchema,
  type ToolIcon,
  type SplitCardsBenefit,
  type SplitCardsSection,
} from "../site_4geeks-com/component-registry/split_cards/v1.0/schema";

// ============================================
// Re-export Numbered Steps Schemas from Component Registry
// ============================================
export {
  numberedStepsStepSchema,
  numberedStepsSectionSchema,
  type NumberedStepsStep,
  type NumberedStepsSection,
} from "../site_4geeks-com/component-registry/numbered_steps/v1.0/schema";

// Variant types for type narrowing
export type {
  NumberedStepsDefaultSection,
  NumberedStepsBubbleTextSection,
  NumberedStepsVerticalCardsSection,
} from "../site_4geeks-com/component-registry/numbered_steps/v1.0/schema";

// ============================================
// Re-export Syllabus Schemas from Component Registry
// ============================================
export {
  syllabusModuleSchema,
  focusAreaSchema,
  moduleCardSchema,
  techLogoSchema,
  syllabusDefaultSchema,
  syllabusLandingSchema,
  syllabusProgramModulesSchema,
  syllabusTimelineItemSchema,
  syllabusTimelineModuleSchema,
  syllabusTimelineSchema,
  syllabusSectionSchema,
  type SyllabusModule,
  type FocusArea,
  type ModuleCard,
  type TechLogo,
  type SyllabusDefault,
  type SyllabusLanding,
  type SyllabusProgramModules,
  type SyllabusTimelineItem,
  type SyllabusTimelineModule,
  type SyllabusTimeline,
  type SyllabusSection,
} from "../site_4geeks-com/component-registry/syllabus/v1.0/schema";

// ============================================
// Re-export Projects Schemas from Component Registry
// ============================================
export {
  projectItemSchema,
  projectsSectionSchema,
  type ProjectItem,
  type ProjectsSection,
} from "../site_4geeks-com/component-registry/projects/v1.0/schema";

// ============================================
// Re-export Features Grid Schemas from Component Registry
// Only export unified schema and item schemas (not individual variants)
// ============================================
export {
  featuresGridHighlightItemSchema,
  featuresGridDetailedItemSchema,
  featuresGridTextOnlyItemSchema,
  featuresGridSectionSchema,
  type FeaturesGridHighlightItem,
  type FeaturesGridDetailedItem,
  type FeaturesGridTextOnlyItem,
  type FeaturesGridSection,
} from "../site_4geeks-com/component-registry/features_grid/v1.0/schema";

// Variant types for type narrowing (schemas are internal to component registry)
export type {
  FeaturesGridHighlightSection,
  FeaturesGridDetailedSection,
  FeaturesGridSpotlightSection,
  FeaturesGridStatsCardsSection,
  FeaturesGridStatsTextCardSection,
  FeaturesGridStatsTextSection,
  FeaturesGridTextOnlySection,
  FeaturesGridCardHeaderSection,
  FeaturesGridStatsCardsItem,
  SpotlightConfig,
  FeaturesGridStatsChartsSection,
  FeaturesGridStatsChartsCardBars,
  FeaturesGridStatsChartsCardGauge,
  FeaturesGridStatsChartsCardTrend,
} from "../site_4geeks-com/component-registry/features_grid/v1.0/schema";

// ============================================
// Re-export Testimonials Slide Schemas from Component Registry
// ============================================
export {
  testimonialsSlideTestimonialSchema,
  testimonialsSlideSectionSchema,
  type TestimonialsSlideTestimonial,
  type TestimonialsSlideSection,
} from "../site_4geeks-com/component-registry/testimonials_slide/v1.0/schema";

// ============================================
// Re-export CTA Banner Schemas from Component Registry
// ============================================
export {
  ctaBannerSectionSchema,
  ctaBannerDefaultSchema,
  ctaBannerFormSchema,
  ctaBannerStripSchema,
  ctaBannerResourceShowcaseSchema,
  ctaBannerPromotionSchema,
  type CtaBannerSection,
  type CtaBannerDefault,
  type CtaBannerForm,
  type CtaBannerStrip,
  type CtaBannerResourceShowcase,
  type CtaBannerPromotion,
} from "../site_4geeks-com/component-registry/cta_banner/v1.0/schema";

// Type alias for backward compatibility
export type CTABannerSection = import("../site_4geeks-com/component-registry/cta_banner/v1.0/schema").CtaBannerSection;
export type CTAButton = import("./component-registry/_common/schema").CtaButton;
export type LeadFormFieldConfig = z.infer<typeof import("./component-registry/_common/schema").leadFormFieldConfigSchema>;

// ============================================
// Re-export Project Showcase Schemas from Component Registry
// ============================================
export {
  projectShowcaseCreatorSchema,
  projectShowcaseMediaSchema,
  projectShowcaseItemSchema,
  projectShowcaseSectionSchema,
  projectsShowcaseSectionSchema,
  type ProjectShowcaseCreator,
  type ProjectShowcaseMedia,
  type ProjectShowcaseItem,
  type ProjectShowcaseSection,
  type ProjectsShowcaseSection,
} from "../site_4geeks-com/component-registry/project_showcase/v1.0/schema";

// ============================================
// Re-export Comparison Table Schemas from Component Registry
// ============================================
export {
  comparisonTableColumnSchema,
  comparisonTableCtaButtonSchema,
  comparisonTableCellSchema,
  comparisonTableCellValueSchema,
  comparisonTableRowSchema,
  comparisonTableSectionSchema,
  type ComparisonTableCtaButton,
  type ComparisonTableCell,
  type ComparisonTableCellValue,
  type ComparisonTableColumn,
  type ComparisonTableRow,
  type ComparisonTableSection,
} from "../site_4geeks-com/component-registry/comparison_table/v1.0/schema";

// ============================================
// Re-export Geeks vs Others Comparison Schemas from Component Registry
// ============================================
export {
  geeksVsOthersColumnSchema,
  geeksVsOthersRowSchema,
  geeksVsOthersComparisonSectionSchema,
  type GeeksVsOthersColumn,
  type GeeksVsOthersRow,
  type GeeksVsOthersComparisonSection,
} from "../site_4geeks-com/component-registry/geeks_vs_others_comparison/v1.0/schema";

// ============================================
// Re-export Bento Cards Schemas from Component Registry
// ============================================
export {
  bentoCardItemSchema,
  bentoCardsSectionSchema,
  type BentoCardItem,
  type BentoCardsSection,
} from "../site_4geeks-com/component-registry/bento_cards/v1.0/schema";

// ============================================
// Image Registry Schemas (not in component registry)
// ============================================
export const imageSrcsetEntrySchema = z.object({
  w: z.number(),
  url: z.string(),
});

export const imagePresetSchema = z.object({
  aspect_ratio: z.string().nullable(),
  widths: z.array(z.number()),
  quality: z.number(),
  description: z.string(),
  sizes: z.string().optional(),
});

export const imageEntrySchema = z.object({
  src: z.string(),
  alt: z.string(),
  focal_point: z.enum(["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
  tags: z.array(z.string()).optional(),
  protected: z.boolean().optional(),
  usage_count: z.number().optional(),
  hash: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  preset: z.array(z.string()).optional(),
  widths_generated: z.array(z.number()).optional(),
  format: z.enum(["webp", "avif", "jpeg", "png"]).optional(),
  srcset: z.array(imageSrcsetEntrySchema).optional(),
  source_url: z.string().optional(),
  failed_at: z.string().optional(),
  queued_at: z.string().optional(),
  source_item: z.string().optional(),
  parentId: z.string().optional(),
  quality_override: z.number().optional(),
  /** How the asset entered the registry. Missing = legacy non-AI. */
  origin: z.enum(["upload", "import", "ai"]).optional(),
  ai: z
    .object({
      generated: z.literal(true),
      /** @deprecated Prefer sidecar; kept optional for legacy rows */
      model: z.string().optional(),
      /** @deprecated Prefer sidecar; kept optional for legacy rows */
      prompt: z.string().optional(),
      generated_at: z.string().optional(),
      requested_by: z
        .object({
          kind: z.enum(["user", "agent", "system"]),
          id: z.string().optional(),
          name: z.string().optional(),
        })
        .optional(),
      /** Public URL or path of AI meta sidecar JSON (prompt/model). */
      meta_src: z.string().optional(),
    })
    .optional(),
  /** ISO timestamp of last public viewport impression (AI GC grace input). */
  last_impression_at: z.string().optional(),
  /** ISO timestamp when the asset was first registered (gallery Newest sort). */
  registered_at: z.string().optional(),
});

export const tagDefinitionSchema = z.object({
  label: z.string(),
  description: z.string(),
  presets: z.array(z.string()),
  srcset_widths: z.array(z.number()).optional(),
  detection: z.object({
    yaml_fields: z.array(z.string()).optional(),
    component_keys: z.array(z.string()).optional(),
    filename_patterns: z.array(z.string()).optional(),
    aspect_ratio_range: z.object({
      min: z.number(),
      max: z.number(),
    }).optional(),
  }).optional(),
});

export const imageRegistrySchema = z.object({
  presets: z.record(z.string(), imagePresetSchema),
  tagDefinitions: z.record(z.string(), tagDefinitionSchema).optional(),
  images: z.record(z.string(), imageEntrySchema),
});

export const imageRefSchema = z.object({
  id: z.string(),
  preset: z.enum(["hero-wide", "hero-tall", "card", "card-wide", "avatar", "logo", "icon", "full"]).optional(),
  alt: z.string().optional(),
  className: z.string().optional(),
});

export type ImagePreset = z.infer<typeof imagePresetSchema>;
export type ImageEntry = z.infer<typeof imageEntrySchema>;
export type TagDefinition = z.infer<typeof tagDefinitionSchema>;
export type ImageRegistry = z.infer<typeof imageRegistrySchema>;
export type ImageRef = z.infer<typeof imageRefSchema>;


// ============================================
// Programs List Section (not in component registry yet)
// ============================================

export const programsListSectionSchema = z.object({
  type: z.literal("programs_list"),
  version: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  filter_by_location: z.string().optional(),
});

// ============================================
// About Section (not in component registry yet)
// ============================================
export const aboutSectionSchema = z.object({
  type: z.literal("about"),
  version: z.string().optional(),
  height: z.string().optional(),
  title: z.string(),
  description: z.string(),
  link_text: z.string(),
  link_url: z.string(),
  image_src: z.string(),
  image_alt: z.string(),
});

export type AboutSection = z.infer<typeof aboutSectionSchema>;

// ============================================
// Stats Section (not in component registry yet)
// ============================================
export const statsSectionSchema = z.object({
  type: z.literal("stats"),
  version: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  subtitle: z.string().optional(),
  background: z.string().optional(),
  items: z.array(z.object({
    value: z.string(),
    label: z.string(),
    icon: z.string().optional(),
  })).optional(),
});

export type StatsSection = z.infer<typeof statsSectionSchema>;


// ============================================
// Horizontal Bars Section (chart component)
// ============================================
export const horizontalBarsSectionSchema = z.object({
  type: z.literal("horizontal_bars"),
  version: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  background: z.string().optional(),
  use_card: z.boolean().optional(),
  items: z.array(z.object({
    label: z.string(),
    value: z.number(),
    displayValue: z.string().optional(),
    color: z.string().optional(),
  })),
});

export type HorizontalBarsSection = z.infer<typeof horizontalBarsSectionSchema>;

// ============================================
// Vertical Bars Cards Section (chart component)
// ============================================
export const verticalBarsYearValueSchema = z.object({
  year: z.string(),
  value: z.number(),
  displayValue: z.string(),
});

export const verticalBarsMetricCardSchema = z.object({
  title: z.string(),
  unit: z.string().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  years: z.array(verticalBarsYearValueSchema),
});

export const verticalBarsCardsSectionSchema = z.object({
  type: z.literal("vertical_bars_cards"),
  version: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  background: z.string().optional(),
  footer_description: z.string().optional(),
  metrics: z.array(verticalBarsMetricCardSchema),
});

export type VerticalBarsYearValue = z.infer<typeof verticalBarsYearValueSchema>;
export type VerticalBarsMetricCard = z.infer<typeof verticalBarsMetricCardSchema>;
export type VerticalBarsCardsSection = z.infer<typeof verticalBarsCardsSectionSchema>;

// ============================================
// Pie Charts Section (chart component)
// ============================================
export const pieChartItemSchema = z.object({
  label: z.string(),
  value: z.number(),
  displayValue: z.string().optional(),
  color: z.string().optional(),
});

export const pieChartDataSchema = z.object({
  title: z.string(),
  items: z.array(pieChartItemSchema),
});

export const pieChartsSectionSchema = z.object({
  type: z.literal("pie_charts"),
  version: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  background: z.string().optional(),
  use_card: z.boolean().optional(),
  charts: z.array(pieChartDataSchema),
});

export type PieChartItem = z.infer<typeof pieChartItemSchema>;
export type PieChartData = z.infer<typeof pieChartDataSchema>;
export type PieChartsSection = z.infer<typeof pieChartsSectionSchema>;

// ============================================
// Human and AI Duo Section
// ============================================
export const humanAndAIDuoBulletSchema = z.object({
  text: z.string(),
  icon: z.string().optional(),
});

export const humanAndAIDuoBulletGroupSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  image: z.string().optional(),
  icon: z.string().optional(),
  bullets: z.array(humanAndAIDuoBulletSchema).optional(),
});

// Image with CSS styling properties - reuse from common schema
export { imageWithStyleSchema } from "./component-registry/_common/schema";
export type ImageWithStyle = import("./component-registry/_common/schema").ImageWithStyle;

export const humanAndAIDuoSectionSchema = z.object({
  type: z.literal("human_and_ai_duo"),
  version: z.string().optional(),
  heading: z.string(),
  description: z.string(),
  bullet_groups: z.array(humanAndAIDuoBulletGroupSchema).optional(),
  cta: commonCtaButtonSchema.optional(),
  footer_description: z.string().optional(),
  // New: array of images with CSS styling
  images: z.array(z.object({
    src: z.string(),
    alt: z.string().optional(),
    object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
    object_position: z.string().optional(),
    width: z.string().optional(),
    height: z.string().optional(),
    max_width: z.string().optional(),
    max_height: z.string().optional(),
    border_radius: z.string().optional(),
    opacity: z.number().min(0).max(1).optional(),
    filter: z.string().optional(),
  })).optional(),
  // Legacy: single image (backward compatible)
  image: z.string().optional(),
  image_alt: z.string().optional(),
  background: z.string().optional(),
  // Video option - when provided, replaces images with video
  // Accepts either string URL (legacy) or full config object
  video: z.union([
    z.string(),
    z.object({
      url: z.string(),
      ratio: z.string().optional(),
      mobile_ratio: z.string().optional(),
      width: z.string().optional(),
      muted: z.boolean().optional(),
      autoplay: z.boolean().optional(),
      loop: z.boolean().optional(),
      preview_image_url: z.string().optional(),
      with_shadow_border: z.boolean().optional(),
    }),
  ]).optional(),
  // Legacy fields for backward compatibility (used when video is a string)
  video_ratio: z.string().optional(),
  video_preview_image: z.string().optional(),
});

export type HumanAndAIDuoBullet = z.infer<typeof humanAndAIDuoBulletSchema>;
export type HumanAndAIDuoBulletGroup = z.infer<typeof humanAndAIDuoBulletGroupSchema>;
export type HumanAndAIDuoSection = z.infer<typeof humanAndAIDuoSectionSchema>;

// ============================================
// Community Support Section (split from support_duo grid variant)
// ============================================
export const communitySupportBulletSchema = z.object({
  text: z.string(),
  icon: z.string().optional(),
});

export const communitySupportGroupSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  image: z.string().optional(),
  icon: z.string().optional(),
  badge: z.string().optional(),
  accent_color: z.string().optional(),
  bullets: z.array(communitySupportBulletSchema).optional(),
  button: z.object({
    text: z.string(),
    url: z.string(),
    variant: z.string().optional(),
  }).optional(),
});

export const communitySupportSectionSchema = z.object({
  type: z.literal("community_support"),
  version: z.string().optional(),
  eyebrow: z.string().optional(),
  heading: z.string(),
  description: z.string(),
  bullet_groups: z.array(communitySupportGroupSchema),
  footer_description: z.string().optional(),
  image: z.string().optional(),
  image_alt: z.string().optional(),
  background: z.string().optional(),
});

export type CommunitySupportBullet = z.infer<typeof communitySupportBulletSchema>;
export type CommunitySupportGroup = z.infer<typeof communitySupportGroupSchema>;
export type CommunitySupportSection = z.infer<typeof communitySupportSectionSchema>;

// ============================================
// Two Column Accordion Card Section Schema
// ============================================
import { twoColumnAccordionCardSectionSchema, twoColumnAccordionCardBulletSchema, type TwoColumnAccordionCardSection, type TwoColumnAccordionCardBullet } from "../site_4geeks-com/component-registry/two_column_accordion_card/v1.0/schema";
export { twoColumnAccordionCardSectionSchema, twoColumnAccordionCardBulletSchema, type TwoColumnAccordionCardSection, type TwoColumnAccordionCardBullet };

// ============================================
// Section Schema Union
// Import unified section schemas for use in union
// ============================================
import { heroSectionSchema as heroSchema } from "./component-registry/hero/v1.0/schema";
import { aiLearningSectionSchema } from "../site_4geeks-com/component-registry/ai_learning/v1.0/schema";
import { mentorshipSectionSchema } from "../site_4geeks-com/component-registry/mentorship/v1.0/schema";
import { certificateSectionSchema } from "../site_4geeks-com/component-registry/certificate/v1.0/schema";
import { whyLearnAISectionSchema } from "../site_4geeks-com/component-registry/why_learn_ai/v1.0/schema";
import { pricingSectionSchema } from "../site_4geeks-com/component-registry/pricing/v1.0/schema";
import { faqSectionSchema } from "./component-registry/faq/v1.0/schema";
import { breadcrumbSectionSchema } from "./component-registry/breadcrumb/v1.0/schema";
import { geekchartSectionSchema } from "./component-registry/geekchart/v1.0/schema";
import { schemaOrgSectionSchema } from "./component-registry/schema_org/v1.0/schema";
export { schemaOrgSectionSchema, type SchemaOrgSection } from "./component-registry/schema_org/v1.0/schema";
import { testimonialsSectionSchema } from "../site_4geeks-com/component-registry/testimonials/v1.0/schema";
import { whosHiringSectionSchema } from "../site_4geeks-com/component-registry/whos_hiring/v1.0/schema";
import { footerSectionSchema } from "../site_4geeks-com/component-registry/footer/v1.0/schema";
import { twoColumnSectionSchema } from "../site_4geeks-com/component-registry/two_column/v1.0/schema";
import { numberedStepsSectionSchema } from "../site_4geeks-com/component-registry/numbered_steps/v1.0/schema";
import { syllabusSectionSchema } from "../site_4geeks-com/component-registry/syllabus/v1.0/schema";
import { projectsSectionSchema } from "../site_4geeks-com/component-registry/projects/v1.0/schema";
import { featuresGridSectionSchema as featuresGridSchema } from "../site_4geeks-com/component-registry/features_grid/v1.0/schema";
import { testimonialsSlideSectionSchema } from "../site_4geeks-com/component-registry/testimonials_slide/v1.0/schema";
import { testimonialsGridSectionSchema } from "../site_4geeks-com/component-registry/testimonials_grid/v1.0/schema";
import { ctaBannerSectionSchema } from "../site_4geeks-com/component-registry/cta_banner/v1.0/schema";
import { projectShowcaseSectionSchema, projectsShowcaseSectionSchema } from "../site_4geeks-com/component-registry/project_showcase/v1.0/schema";
import { comparisonTableSectionSchema } from "../site_4geeks-com/component-registry/comparison_table/v1.0/schema";
import { geeksVsOthersComparisonSectionSchema } from "../site_4geeks-com/component-registry/geeks_vs_others_comparison/v1.0/schema";
import { bulletTabsShowcaseSectionSchema, type BulletTabsShowcaseSection, type BulletTab } from "../site_4geeks-com/component-registry/bullet_tabs_showcase/v1.0/schema";
export { bulletTabsShowcaseSectionSchema, type BulletTabsShowcaseSection, type BulletTab };
import { graduatesStatsSectionSchema, graduatesFeaturedImageSchema, type GraduatesStatsSection, type GraduatesStatItem, type GraduatesCollageImage, type GraduatesFeaturedImage, type GraduatesStatsAsymmetric } from "../site_4geeks-com/component-registry/graduates_stats/v1.0/schema";
import { splitCardsSectionSchema } from "../site_4geeks-com/component-registry/split_cards/v1.0/schema";
export { graduatesStatsSectionSchema, graduatesFeaturedImageSchema, type GraduatesStatsSection, type GraduatesStatItem, type GraduatesCollageImage, type GraduatesFeaturedImage, type GraduatesStatsAsymmetric };
import { applyFormSectionSchema } from "../site_4geeks-com/component-registry/apply_form/v1.0/schema";
import { awardBadgesSectionSchema } from "../site_4geeks-com/component-registry/award_badges/v1.0/schema";
import { awardsMarqueeSectionSchema, type AwardsMarqueeSection, type AwardsMarqueeItem } from "./component-registry/awards_marquee/v1.0/schema";
export { awardsMarqueeSectionSchema, type AwardsMarqueeSection, type AwardsMarqueeItem };
import { listPressMentionsSectionSchema, type ListPressMentionsSection, type PressMentionItem, pressMentionsSectionSchema, type PressMentionsSection } from "../site_4geeks-com/component-registry/list_press_mentions/v1.0/schema";
export { listPressMentionsSectionSchema, type ListPressMentionsSection, type PressMentionItem };
export { pressMentionsSectionSchema, type PressMentionsSection };
export { listSinglePressMentionSectionSchema, type ListSinglePressMentionSection } from "../site_4geeks-com/component-registry/list_single_press_mention/v1.0/schema";
import { valueProofPanelSectionSchema } from "../site_4geeks-com/component-registry/value_proof_panel/v1.0/schema";
import { stickyCtaSectionSchema } from "../site_4geeks-com/component-registry/sticky_cta/v1.0/schema";
export { stickyCtaSectionSchema, type StickyCtaSection } from "../site_4geeks-com/component-registry/sticky_cta/v1.0/schema";
import { modalSectionSchema } from "../site_4geeks-com/component-registry/modal/v1.0/schema";
export { modalSectionSchema, type ModalSection } from "../site_4geeks-com/component-registry/modal/v1.0/schema";
import { bentoCardsSectionSchema } from "../site_4geeks-com/component-registry/bento_cards/v1.0/schema";
import { bannerSchema, bannerSectionSchema, bannerMarqueeBadgesSchema, type BannerSection, type BannerMarqueeBadges } from "../site_4geeks-com/component-registry/banner/v1.0/schema";
export { bannerSectionSchema, bannerMarqueeBadgesSchema, type BannerSection, type BannerMarqueeBadges };
import { imageRowSectionSchema, type ImageRowSection } from "../site_4geeks-com/component-registry/image_row/v1.0/schema";
export { imageRowSectionSchema, type ImageRowSection };
import { courseSelectorSectionSchema, type CourseSelectorSection, type CourseItem, type CourseBadge, type CourseTag } from "../site_4geeks-com/component-registry/course_selector/v1.0/schema";
export { courseSelectorSectionSchema, type CourseSelectorSection, type CourseItem, type CourseBadge, type CourseTag };
import {
  enrollmentSelectorDefaultSchema,
  enrollmentProgramSchema,
  enrollmentPlanSchema,
  enrollmentSummarySchema,
  enrollmentSelectorSectionSchema,
  type EnrollmentSelectorDefault,
  type EnrollmentSelectorSection,
  type EnrollmentSelectorProgram,
  type EnrollmentSelectorPlan,
  type EnrollmentSummary,
  type EnrollmentQueryComponentItem,
} from "../site_4geeks-com/component-registry/enrollment_selector/v1.0/schema";
export {
  enrollmentSelectorDefaultSchema,
  enrollmentProgramSchema,
  enrollmentPlanSchema,
  enrollmentSummarySchema,
  enrollmentSelectorSectionSchema,
  type EnrollmentSelectorDefault,
  type EnrollmentSelectorSection,
  type EnrollmentSelectorProgram,
  type EnrollmentSelectorPlan,
  type EnrollmentSummary,
  type EnrollmentQueryComponentItem,
};
import { articleSectionSchema, type ArticleSection } from "../shared/component-registry/article/v1.0/schema";
export { articleSectionSchema, type ArticleSection };
import { partnershipCarouselSectionSchema, type PartnershipCarouselSection, type PartnershipSlide } from "../site_4geeks-com/component-registry/partnership_carousel/v1.0/schema";
export { partnershipCarouselSectionSchema, type PartnershipCarouselSection, type PartnershipSlide };
import { careerSupportExplainSectionSchema, type CareerSupportExplainSection, type CareerSupportTab, type CareerSupportBox, type CareerSupportBullet, type CareerSupportStat, type CareerSupportLogo, type CareerSupportTestimonial, type CareerSupportTestimonialLogo } from "../site_4geeks-com/component-registry/career_support_explain/v1.0/schema";
export { careerSupportExplainSectionSchema, type CareerSupportExplainSection, type CareerSupportTab, type CareerSupportBox, type CareerSupportBullet, type CareerSupportStat, type CareerSupportLogo, type CareerSupportTestimonial, type CareerSupportTestimonialLogo };

import { profilesCarouselSectionSchema, type ProfilesCarouselSection, type ProfileCard } from "../site_4geeks-com/component-registry/profiles_carousel/v1.0/schema";
export { profilesCarouselSectionSchema, type ProfilesCarouselSection, type ProfileCard };

import { dynamicTableSectionSchema, type DynamicTableSection, type DynamicTableColumn, type DynamicTableAction } from "../site_4geeks-com/component-registry/dynamic_table/v1.0/schema";
export { dynamicTableSectionSchema, type DynamicTableSection, type DynamicTableColumn, type DynamicTableAction };

import { doubleCTASectionSchema, type DoubleCTASection, type DoubleCTABox, type DoubleCTABullet } from "../site_4geeks-com/component-registry/double_cta/v1.0/schema";
export { doubleCTASectionSchema, type DoubleCTASection, type DoubleCTABox, type DoubleCTABullet };

import { contactUsInfoSectionSchema, type ContactUsInfoSection, type ContactLocation } from "../site_4geeks-com/component-registry/contact_us_info/v1.0/schema";
export { contactUsInfoSectionSchema, type ContactUsInfoSection, type ContactLocation };

import { trustCardsSectionSchema, type TrustCardsSection, type TrustCardItem } from "../site_4geeks-com/component-registry/trust_cards/v1.0/schema";
export { trustCardsSectionSchema, type TrustCardsSection, type TrustCardItem };

import { programsShowcaseSectionSchema, type ProgramsShowcaseSection, type ProgramItem } from "../site_4geeks-com/component-registry/programs_showcase/v1.0/schema";
export { programsShowcaseSectionSchema, type ProgramsShowcaseSection, type ProgramItem };

import { credibilityStripSectionSchema, type CredibilityStripSection, type CredibilityStripItem, type CredibilityStripLogo } from "../site_4geeks-com/component-registry/credibility_strip/v1.0/schema";
export { credibilityStripSectionSchema, type CredibilityStripSection, type CredibilityStripItem, type CredibilityStripLogo };

import { contactBubbleSectionSchema, type ContactBubbleSection, type ContactBubbleImage } from "../site_4geeks-com/component-registry/contact_bubble/v1.0/schema";
export { contactBubbleSectionSchema, type ContactBubbleSection, type ContactBubbleImage };

import { ogImagePreviewSectionSchema, type OgImagePreviewSection } from "../site_4geeks-com/component-registry/og_image_preview/v1.0/schema";
export { ogImagePreviewSectionSchema, type OgImagePreviewSection };

// Responsive spacing schema - separate values for mobile and desktop
// When only one breakpoint is specified, the other inherits its value
export const responsiveSpacingSchema = z.object({
  mobile: z.string().optional(),
  desktop: z.string().optional(),
});

export type ResponsiveSpacing = z.infer<typeof responsiveSpacingSchema>;

// Breakpoint visibility for sections - controls which breakpoint(s) a section is visible on
// mobile: only visible on screens < 768px
// desktop: only visible on screens >= 768px  
// all (default): visible on all breakpoints
export const showOnSchema = z.enum(['mobile', 'desktop', 'all']);
export type ShowOn = z.infer<typeof showOnSchema>;

// Layout fields that can be applied to any section
// marginY/paddingY: Responsive object with mobile/desktop values
// Each value supports presets (none, sm, md, lg, xl) or custom CSS values (e.g., "20px 32px")
// background: semantic token (muted, card, etc.) or custom CSS value
// showOn: controls breakpoint visibility (mobile, desktop, or all)
// showOnLocations: array of location slugs - section only visible when user's location matches one
// showOnRegions: array of region slugs - section only visible when user's region matches one
export const sectionLoadSchema = z.enum(["eager", "lazy"]);
export type SectionLoad = z.infer<typeof sectionLoadSchema>;

export const sectionLayoutSchema = z.object({
  section_id: z.string().optional(),
  load: sectionLoadSchema.optional(),
  marginY: responsiveSpacingSchema.optional(),
  paddingY: responsiveSpacingSchema.optional(),
  marginX: responsiveSpacingSchema.optional(),
  paddingX: responsiveSpacingSchema.optional(),
  maxWidth: responsiveSpacingSchema.optional(),
  background: z.string().optional(),
  showOn: showOnSchema.optional(),
  showOnLocations: z.array(z.string()).optional(),
  showOnRegions: z.array(z.string()).optional(),
  hidden_until_redirection: z.boolean().optional(),
});

export type SectionLayout = z.infer<typeof sectionLayoutSchema>;

// ============================================
// Feature Quad Section
// ============================================
export const featureQuadCardSchema = z.object({
  icon: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
});

export const featureQuadImageSchema = z.object({
  image_id: z.string(),
  alt: z.string().optional(),
  object_position: z.string().optional(),
  object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
});

// CTA uses the same shared button schema as the hero component
export const featureQuadCtaSchema = commonCtaButtonSchema;

export const featureQuadSectionSchema = z.object({
  type: z.literal("features_quad"),
  version: z.string().optional(),
  variant: z.enum(["default", "laptopEdge"]).optional(),
  compact: z.boolean().optional(),
  heading: z.string().optional(),
  description: z.string().optional(),
  cta: featureQuadCtaSchema.optional(),
  images: z.array(featureQuadImageSchema).optional(),
  cards: z.array(featureQuadCardSchema),
  footer_description: z.string().optional(),
  background: z.string().optional(),
  text_align: z.enum(["left", "center"]).optional(),
  description_with_background: z.boolean().optional(),
  // Video option - when provided, replaces images with video
  // Accepts either string URL (legacy) or full config object
  video: z.union([
    z.string(),
    z.object({
      url: z.string(),
      ratio: z.string().optional(),
      mobile_ratio: z.string().optional(),
      width: z.string().optional(),
      muted: z.boolean().optional(),
      autoplay: z.boolean().optional(),
      loop: z.boolean().optional(),
      preview_image_url: z.string().optional(),
      with_shadow_border: z.boolean().optional(),
    }),
  ]).optional(),
  // Legacy fields for backward compatibility (used when video is a string)
  video_ratio: z.string().optional(),
  video_preview_image: z.string().optional(),
  // Laptop image override for the laptopEdge variant
  laptop_image: z.object({
    image_id: z.string(),
    alt: z.string().optional(),
  }).optional(),
});

export type FeatureQuadCard = z.infer<typeof featureQuadCardSchema>;
export type FeatureQuadImage = z.infer<typeof featureQuadImageSchema>;
export type FeatureQuadSection = z.infer<typeof featureQuadSectionSchema>;

// ============================================
// FAQ Editor Section (specialized for FAQ page template only)
// ============================================
export const faqEditorSectionSchema = z.object({
  type: z.literal("faq_editor"),
  version: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
});

export type FaqEditorSection = z.infer<typeof faqEditorSectionSchema>;

// ============================================
// Listing Cards Section
// ============================================
export const permanentFilterSchema = z.object({
  item_property_slug: z.string(),
  value: z.unknown(),
});

export const userFilterSchema = z.object({
  item_property_slug: z.string(),
  component_renderer: z.enum(["text-input", "dropdown", "tags"]),
  default_value: z.unknown().optional(),
  all_label: z.string().optional(),
  /**
   * Injected by resolveDynamicEntries from the CT/DB field editor when true.
   * Staff set the source of truth via "Treat comma-separated strings as multiple values"
   * on the field — not by authoring this on the filter YAML.
   */
  split_comma_values: z.boolean().optional(),
});

export type PermanentFilter = z.infer<typeof permanentFilterSchema>;
export type UserFilter = z.infer<typeof userFilterSchema>;

const listingCardItemSchema = z.object({
  image: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  /** Preferred: category/tag/technology term for the card chip + user_filters */
  taxonomy: z.union([z.string(), z.object({ slug: z.string() })]).optional(),
  /** @deprecated Prefer taxonomy */
  badge: z.union([z.string(), z.object({ slug: z.string() })]).optional(),
  url: z.string().optional(),
  meta_left: z.unknown().optional(),
  meta_right: z.unknown().optional(),
  cta_text: z.string().optional(),
}).passthrough();

export const listCardsSectionSchema = z.object({
  type: z.literal("list_cards"),
  version: z.string().optional(),
  title: z.string().optional(),
  sub_heading: z.string().optional(),
  layout: z.object({
    columns: z.number().optional(),
  }).optional(),
  search: z.object({
    enabled: z.boolean().optional(),
    placeholder: z.string().optional(),
  }).optional(),
  pagination: z.object({
    page_size: z.number().optional(),
    page_label: z.string().optional(),
    of_label: z.string().optional(),
    items_label: z.string().optional(),
    empty_text: z.string().optional(),
  }).optional(),
  columns: z.number().optional(),
  show_search: z.boolean().optional(),
  page_size: z.number().optional(),
  search_placeholder: z.string().optional(),
  all_label: z.string().optional(),
  empty_text: z.string().optional(),
  page_label: z.string().optional(),
  of_label: z.string().optional(),
  items_label: z.string().optional(),
  items: z.array(listingCardItemSchema).optional(),
  dynamic_entries: z.object({
    content_type: z.string().optional(),
    database: z.string().optional(),
    limit: z.number().optional(),
    sort: z.string().optional(),
    search: z.string().optional(),
    item_template: z.record(z.string(), z.unknown()).optional(),
    hardcoded_entries: z.array(z.unknown()).optional(),
    permanent_filters: z.array(permanentFilterSchema).optional(),
    user_filters: z.array(userFilterSchema).optional(),
  }).optional(),
  item_template: z.record(z.string(), z.unknown()).optional(),
  hardcoded_entries: z.array(z.unknown()).optional(),
  _dynamic_meta: z.object({
    content_type: z.string().optional(),
    total: z.number().optional(),
    locale: z.string().optional(),
  }).optional(),
});

export type ListCardsSection = z.infer<typeof listCardsSectionSchema>;
export { listCardsSectionSchema as listingCardsSectionSchema };
export type { ListCardsSection as ListingCardsSection };

// ============================================
// Cards Deck Section
// ============================================
const cardDeckItemSchema = z.object({
  video: z.object({
    url: z.string(),
    preview_image_url: z.string().optional(),
  }).optional(),
  image: z.string().optional(),
  brand_image: z.string().optional(),
  author_name: z.string().optional(),
  title: z.string(),
  description: z.string(),
}).passthrough();

export const cardsDeckSectionSchema = z.object({
  type: z.literal("cards_deck"),
  version: z.string().optional(),
  variant: z.string().optional(),
  heading: z.string().optional(),
  subtitle: z.string().optional(),
  cards: z.array(cardDeckItemSchema),
}).passthrough();

export type CardsDeckSection = z.infer<typeof cardsDeckSectionSchema>;

// Base section schema union (component-specific fields)
const baseSectionSchema = z.union([
  listCardsSectionSchema,
  faqEditorSectionSchema,
  heroSchema,
  featuresGridSchema,
  syllabusSectionSchema,
  projectsSectionSchema,
  aiLearningSectionSchema,
  mentorshipSectionSchema,
  certificateSectionSchema,
  whyLearnAISectionSchema,
  pricingSectionSchema,
  faqSectionSchema,
  breadcrumbSectionSchema,
  geekchartSectionSchema,
  schemaOrgSectionSchema,
  testimonialsSectionSchema,
  whosHiringSectionSchema,
  footerSectionSchema,
  twoColumnSectionSchema,
  numberedStepsSectionSchema,
  testimonialsSlideSectionSchema,
  testimonialsGridSectionSchema,
  programsListSectionSchema,
  ctaBannerSectionSchema,
  projectShowcaseSectionSchema,
  projectsShowcaseSectionSchema,
  aboutSectionSchema,
  comparisonTableSectionSchema,
  geeksVsOthersComparisonSectionSchema,
  statsSectionSchema,

  horizontalBarsSectionSchema,
  verticalBarsCardsSectionSchema,
  pieChartsSectionSchema,
  applyFormSectionSchema,
  awardBadgesSectionSchema,
  awardsMarqueeSectionSchema,
  listPressMentionsSectionSchema,
  humanAndAIDuoSectionSchema,
  communitySupportSectionSchema,
  twoColumnAccordionCardSectionSchema,
  bulletTabsShowcaseSectionSchema,
  graduatesStatsSectionSchema,
  valueProofPanelSectionSchema,
  splitCardsSectionSchema,
  stickyCtaSectionSchema,
  bentoCardsSectionSchema,
  bannerSchema,
  imageRowSectionSchema,
  featureQuadSectionSchema,
  courseSelectorSectionSchema,
  enrollmentSelectorSectionSchema,
  articleSectionSchema,
  partnershipCarouselSectionSchema,
  careerSupportExplainSectionSchema,
  profilesCarouselSectionSchema,
  dynamicTableSectionSchema,
  doubleCTASectionSchema,
  modalSectionSchema,
  contactUsInfoSectionSchema,
  cardsDeckSectionSchema,
  trustCardsSectionSchema,
  programsShowcaseSectionSchema,
  credibilityStripSectionSchema,
  contactBubbleSectionSchema,
  ogImagePreviewSectionSchema,
]);

// Combined section schema with layout fields
export const sectionSchema = baseSectionSchema.and(sectionLayoutSchema);

export type Section = z.infer<typeof sectionSchema>;

// ============================================
// Schema Reference
// ============================================
export const schemaRefSchema = z.object({
  include: z.array(z.string()).optional(),
  overrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

export type SchemaRef = z.infer<typeof schemaRefSchema>;

// ============================================
// Content Page Types (plain interfaces — no Zod validation)
// ============================================
export interface ContentPageMeta {
  page_title?: string;
  description?: string;
  robots?: string;
  og_image?: string;
  canonical_url?: string;
  expiry_date?: string;
  priority?: number;
  change_frequency?: string;
  redirects?: string[];
}

export interface PageSettings {
  loading?: {
    eager_count?: number;
  };
}

export type CareerProgramMeta = ContentPageMeta;
export interface CareerProgram {
  slug: string;
  title: string;
  meta?: ContentPageMeta;
  schema?: SchemaRef;
  settings?: PageSettings;
  sections: Section[];
  [key: string]: unknown;
}

export type LandingPageMeta = ContentPageMeta;
export interface LandingPage {
  slug?: string;
  title?: string;
  meta?: ContentPageMeta;
  schema?: SchemaRef;
  settings?: PageSettings;
  sections: Section[];
  landing_locations?: string[];
  [key: string]: unknown;
}

// ============================================
// Editing Capabilities
// ============================================
export const editingCapabilities = [
  "content_read",
  "content_edit_text",
  "content_edit_structure",
  "content_edit_media",
  "content_publish",
] as const;

export type EditingCapability = typeof editingCapabilities[number];

export const capabilitiesSchema = z.object({
  webmaster: z.boolean().default(false),
  content_read: z.boolean().default(false),
  content_edit_text: z.boolean().default(false),
  content_edit_structure: z.boolean().default(false),
  content_edit_media: z.boolean().default(false),
  content_publish: z.boolean().default(false),
});

export type Capabilities = z.infer<typeof capabilitiesSchema>;

// ============================================
// Edit Operations
// ============================================
export const editOperationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_field"),
    path: z.string(),
    value: z.unknown(),
  }),
  z.object({
    action: z.literal("reorder_sections"),
    from: z.number(),
    to: z.number(),
  }),
  z.object({
    action: z.literal("add_item"),
    path: z.string(),
    item: z.record(z.unknown()),
    index: z.number().optional(),
  }),
  z.object({
    action: z.literal("remove_item"),
    path: z.string(),
    index: z.number(),
  }),
  z.object({
    action: z.literal("update_section"),
    index: z.number(),
    section: z.record(z.unknown()),
    structural: z.boolean().optional(),
    /** Bound `{{ single.* }}` paths staff confirmed clearing from the shared template. */
    clearedTemplatePaths: z.array(z.string()).optional(),
    /** Bound paths replaced with static literals (key kept; no template restore on save). */
    unboundTemplatePaths: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("replace_all_sections"),
    sections: z.array(z.record(z.unknown())),
  }),
]);

export type EditOperation = z.infer<typeof editOperationSchema>;

export type LocationMeta = ContentPageMeta;
export interface LocationPage {
  slug: string;
  name: string;
  city: string;
  country: string;
  country_code: string;
  latitude: number;
  longitude: number;
  region: string;
  default_language: string;
  timezone: string;
  visibility?: string;
  phone?: string;
  address?: string;
  available_programs?: string[];
  catalog?: {
    admission_advisors?: Array<{
      name: string;
      email: string;
      calendar_url?: string;
      photo?: string;
      languages?: string[];
    }>;
  };
  meta?: ContentPageMeta;
  schema?: SchemaRef;
  settings?: PageSettings;
  sections: Section[];
  [key: string]: unknown;
}

export type TemplatePageMeta = ContentPageMeta;
export interface TemplatePage {
  slug: string;
  title: string;
  meta?: ContentPageMeta;
  schema?: SchemaRef;
  settings?: PageSettings;
  sections: Section[];
  singleEntry?: Record<string, unknown>;
  perEntryRemovedSections?: Array<{ section: Record<string, unknown>; originalIndex: number }>;
  [key: string]: unknown;
}

// ============================================
// Versioning System
// ============================================
export const versioningVariantSchema = z.object({
  slug: z.string(),
  allocation: z.number().min(0).max(100),
});

export const versioningLocaleSchema = z.object({
  variants: z.array(versioningVariantSchema),
});

export const versioningFileSchema = z.record(z.string(), versioningLocaleSchema);

export type VersioningVariant = z.infer<typeof versioningVariantSchema>;
export type VersioningLocale = z.infer<typeof versioningLocaleSchema>;
export type VersioningFile = z.infer<typeof versioningFileSchema>;

export const versioningUpdateSchema = z.object({
  variants: z.array(versioningVariantSchema).min(1),
  /** Required when any variant transitions from 0% → >0% traffic (publishes). */
  confirm_publish_variants: z.boolean().optional(),
}).strict();

export type VersioningUpdate = z.infer<typeof versioningUpdateSchema>;

// ============================================
// AI Chat Conversations
// ============================================
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  page_url: text("page_url"),
  content_type: text("content_type"),
  content_slug: text("content_slug"),
  locale: text("locale").default("en"),
  feature_tags: text("feature_tags", { mode: "json" }).$type<string[]>().default([]),
  user_id: text("user_id"),
  started_at: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  started_at: true,
});

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

export const conversationMessages = sqliteTable("conversation_messages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversation_id: text("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  question_tag: text("question_tag"),
  rating: text("rating"),
  rated_by: text("rated_by"),
  rated_at: integer("rated_at", { mode: "timestamp" }),
  override_content: text("override_content"),
  override_by: text("override_by"),
  override_at: integer("override_at", { mode: "timestamp" }),
  created_at: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const insertConversationMessageSchema = createInsertSchema(conversationMessages).omit({
  id: true,
  created_at: true,
  rating: true,
  rated_by: true,
  rated_at: true,
  override_content: true,
  override_by: true,
  override_at: true,
});

export type InsertConversationMessage = z.infer<typeof insertConversationMessageSchema>;
export type ConversationMessage = typeof conversationMessages.$inferSelect;

// ============================================
// AI Knowledge (admin-managed)
// ============================================
export const aiKnowledge = sqliteTable("ai_knowledge", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: text("key").notNull().unique(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updated_at: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updated_by: text("updated_by"),
});

export const insertAiKnowledgeSchema = createInsertSchema(aiKnowledge).omit({
  id: true,
  updated_at: true,
});

export type InsertAiKnowledge = z.infer<typeof insertAiKnowledgeSchema>;
export type AiKnowledge = typeof aiKnowledge.$inferSelect;

// ============================================
// Component Co-occurrence & Ordering Insights
// ============================================

export interface PageIntent {
  id: string;
  what_for: string;
}

export interface ComponentPairing {
  from: string;
  to: string;
  count: number;
  frequency: number;
  pmi: number;
  distance: number;
}

export interface ComponentSequence {
  sequence: string[];
  count: number;
}

export interface InsightSection {
  type: string;
  variant: string;
}

export interface InsightPageRecord {
  key: string;
  contentType: string;
  kind: "page" | "shared_template" | "overlay";
  slug?: string;
  slugs?: string[];
  intent: string;
  weight: number;
  instanceCount: number;
  sections: InsightSection[];
}

export interface VariantUsageStat {
  variant: string;
  count: number;
  pageCount: number;
}

export interface ContentTypeUsageStat {
  contentType: string;
  count: number;
  pageCount: number;
}

export interface ComponentUsageStat {
  totalUses: number;
  pageCount: number;
  variants: VariantUsageStat[];
  byContentType: ContentTypeUsageStat[];
}

export interface IntentCluster {
  pairings: ComponentPairing[];
  topSequences: ComponentSequence[];
  pageCount: number;
  usageByType: Record<string, ComponentUsageStat>;
}

export interface ComponentInsightsMeta {
  totalPagesScanned: number;
  totalWeight: number;
  weightedPagesCount: number;
  intents: string[];
  pageIntents: PageIntent[];
}

export interface ComponentInsightsData {
  generatedAt: string;
  meta: ComponentInsightsMeta;
  pages: InsightPageRecord[];
  global: IntentCluster;
  byIntent: Record<string, IntentCluster>;
}
