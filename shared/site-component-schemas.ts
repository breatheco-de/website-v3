// Single coupling point for site registry Zod schemas.
// Monorepo/dev with site_4geeks-com present: this file re-exports real site Zod.
// Pack/CI without site content: Vite + esbuild alias this module to
// site-component-schemas.stub.ts (see shared/site-schema-stub-mode.ts,
// WEBLIFY_SITE_SCHEMAS_STUB=1). prepack also swaps stub into this path for the tarball.

// ai_flex_path
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

// ai_flex_selector
export {
  aiFlexSelectorDefaultSchema,
  type AiFlexSelectorDefault,
} from "../site_4geeks-com/component-registry/ai_flex_selector/v1.0/schema";

// ai_learning
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

// apply_form
export {
  applyFormSectionSchema,
} from "../site_4geeks-com/component-registry/apply_form/v1.0/schema";

// award_badges
export {
  awardBadgesSectionSchema,
} from "../site_4geeks-com/component-registry/award_badges/v1.0/schema";

// banner
export {
  bannerSchema,
  bannerSectionSchema,
  bannerMarqueeBadgesSchema,
  type BannerSection,
  type BannerMarqueeBadges,
} from "../site_4geeks-com/component-registry/banner/v1.0/schema";

// bento_cards
export {
  bentoCardItemSchema,
  bentoCardsSectionSchema,
  type BentoCardItem,
  type BentoCardsSection,
} from "../site_4geeks-com/component-registry/bento_cards/v1.0/schema";

// bullet_tabs_showcase
export {
  bulletTabsShowcaseSectionSchema,
  type BulletTabsShowcaseSection,
  type BulletTab,
} from "../site_4geeks-com/component-registry/bullet_tabs_showcase/v1.0/schema";

// career_support_explain
export {
  careerSupportExplainSectionSchema,
  type CareerSupportExplainSection,
  type CareerSupportTab,
  type CareerSupportBox,
  type CareerSupportBullet,
  type CareerSupportStat,
  type CareerSupportLogo,
  type CareerSupportTestimonial,
  type CareerSupportTestimonialLogo,
} from "../site_4geeks-com/component-registry/career_support_explain/v1.0/schema";

// certificate
export {
  certificateSectionSchema,
  type CertificateSection,
} from "../site_4geeks-com/component-registry/certificate/v1.0/schema";

// comparison_table
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

// contact_bubble
export {
  contactBubbleSectionSchema,
  type ContactBubbleSection,
  type ContactBubbleImage,
} from "../site_4geeks-com/component-registry/contact_bubble/v1.0/schema";

// contact_us_info
export {
  contactUsInfoSectionSchema,
  type ContactUsInfoSection,
  type ContactLocation,
} from "../site_4geeks-com/component-registry/contact_us_info/v1.0/schema";

// course_selector
export {
  courseSelectorSectionSchema,
  type CourseSelectorSection,
  type CourseItem,
  type CourseBadge,
  type CourseTag,
} from "../site_4geeks-com/component-registry/course_selector/v1.0/schema";

// credibility_strip
export {
  credibilityStripSectionSchema,
  type CredibilityStripSection,
  type CredibilityStripItem,
  type CredibilityStripLogo,
} from "../site_4geeks-com/component-registry/credibility_strip/v1.0/schema";

// cta_banner
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

// double_cta
export {
  doubleCTASectionSchema,
  type DoubleCTASection,
  type DoubleCTABox,
  type DoubleCTABullet,
} from "../site_4geeks-com/component-registry/double_cta/v1.0/schema";

// dynamic_table
export {
  dynamicTableSectionSchema,
  type DynamicTableSection,
  type DynamicTableColumn,
  type DynamicTableAction,
} from "../site_4geeks-com/component-registry/dynamic_table/v1.0/schema";

// enrollment_selector
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
} from "../site_4geeks-com/component-registry/enrollment_selector/v1.0/schema";

// features_grid
export {
  featuresGridHighlightItemSchema,
  featuresGridDetailedItemSchema,
  featuresGridTextOnlyItemSchema,
  featuresGridSectionSchema,
  type FeaturesGridHighlightItem,
  type FeaturesGridDetailedItem,
  type FeaturesGridTextOnlyItem,
  type FeaturesGridSection,
  type FeaturesGridHighlightSection,
  type FeaturesGridDetailedSection,
  type FeaturesGridSpotlightSection,
  type FeaturesGridStatsCardsSection,
  type FeaturesGridStatsTextCardSection,
  type FeaturesGridStatsTextSection,
  type FeaturesGridTextOnlySection,
  type FeaturesGridCardHeaderSection,
  type FeaturesGridStatsCardsItem,
  type SpotlightConfig,
  type FeaturesGridStatsChartsSection,
  type FeaturesGridStatsChartsCardBars,
  type FeaturesGridStatsChartsCardGauge,
  type FeaturesGridStatsChartsCardTrend,
} from "../site_4geeks-com/component-registry/features_grid/v1.0/schema";

// footer
export {
  footerSectionSchema,
  type FooterSection,
} from "../site_4geeks-com/component-registry/footer/v1.0/schema";

// geeks_vs_others_comparison
export {
  geeksVsOthersColumnSchema,
  geeksVsOthersRowSchema,
  geeksVsOthersComparisonSectionSchema,
  type GeeksVsOthersColumn,
  type GeeksVsOthersRow,
  type GeeksVsOthersComparisonSection,
} from "../site_4geeks-com/component-registry/geeks_vs_others_comparison/v1.0/schema";

// graduates_stats
export {
  graduatesStatsSectionSchema,
  graduatesFeaturedImageSchema,
  type GraduatesStatsSection,
  type GraduatesStatItem,
  type GraduatesCollageImage,
  type GraduatesFeaturedImage,
  type GraduatesStatsAsymmetric,
} from "../site_4geeks-com/component-registry/graduates_stats/v1.0/schema";

// image_row
export {
  imageRowSectionSchema,
  type ImageRowSection,
  type ImageRowSlide,
  type ImageRowImage,
  type ImageRowHighlight,
} from "../site_4geeks-com/component-registry/image_row/v1.0/schema";

// list_press_mentions
export {
  listPressMentionsSectionSchema,
  pressMentionsSectionSchema,
  type ListPressMentionsSection,
  type PressMentionItem,
  type PressMentionsSection,
} from "../site_4geeks-com/component-registry/list_press_mentions/v1.0/schema";

// list_single_press_mention
export {
  listSinglePressMentionSectionSchema,
  type ListSinglePressMentionSection,
} from "../site_4geeks-com/component-registry/list_single_press_mention/v1.0/schema";

// mentorship
export {
  mentorshipSectionSchema,
  type MentorshipSection,
} from "../site_4geeks-com/component-registry/mentorship/v1.0/schema";

// modal
export {
  modalSectionSchema,
  type ModalSection,
} from "../site_4geeks-com/component-registry/modal/v1.0/schema";

// numbered_steps
export {
  numberedStepsStepSchema,
  numberedStepsSectionSchema,
  type NumberedStepsStep,
  type NumberedStepsSection,
  type NumberedStepsDefaultSection,
  type NumberedStepsBubbleTextSection,
  type NumberedStepsVerticalCardsSection,
} from "../site_4geeks-com/component-registry/numbered_steps/v1.0/schema";

// og_image_preview
export {
  ogImagePreviewSectionSchema,
  type OgImagePreviewSection,
} from "../site_4geeks-com/component-registry/og_image_preview/v1.0/schema";

// partnership_carousel
export {
  partnershipCarouselSectionSchema,
  type PartnershipCarouselSection,
  type PartnershipSlide,
} from "../site_4geeks-com/component-registry/partnership_carousel/v1.0/schema";

// pricing
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

// profiles_carousel
export {
  profilesCarouselSectionSchema,
  type ProfilesCarouselSection,
  type ProfileCard,
} from "../site_4geeks-com/component-registry/profiles_carousel/v1.0/schema";

// programs_showcase
export {
  programsShowcaseSectionSchema,
  type ProgramsShowcaseSection,
  type ProgramItem,
} from "../site_4geeks-com/component-registry/programs_showcase/v1.0/schema";

// project_showcase
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

// projects
export {
  projectItemSchema,
  projectsSectionSchema,
  type ProjectItem,
  type ProjectsSection,
} from "../site_4geeks-com/component-registry/projects/v1.0/schema";

// split_cards
export {
  toolIconSchema,
  splitCardsBenefitSchema,
  splitCardsSectionSchema,
  type ToolIcon,
  type SplitCardsBenefit,
  type SplitCardsSection,
} from "../site_4geeks-com/component-registry/split_cards/v1.0/schema";

// sticky_cta
export {
  stickyCtaSectionSchema,
  type StickyCtaSection,
} from "../site_4geeks-com/component-registry/sticky_cta/v1.0/schema";

// survey
export {
  surveyDefaultSchema,
  type SurveyDefault,
} from "../site_4geeks-com/component-registry/survey/v1.0/schema";

// syllabus
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

// testimonials_grid
export {
  testimonialsGridItemSchema,
  testimonialsGridSectionSchema,
  type TestimonialsGridItem,
  type TestimonialsGridSection,
} from "../site_4geeks-com/component-registry/testimonials_grid/v1.0/schema";

// testimonials_slide
export {
  testimonialsSlideTestimonialSchema,
  testimonialsSlideSectionSchema,
  type TestimonialsSlideTestimonial,
  type TestimonialsSlideSection,
} from "../site_4geeks-com/component-registry/testimonials_slide/v1.0/schema";

// testimonials
export {
  testimonialItemSchema,
  testimonialsSectionSchema,
  type TestimonialItem,
  type TestimonialsSection,
} from "../site_4geeks-com/component-registry/testimonials/v1.0/schema";

// trust_cards
export {
  trustCardsSectionSchema,
  type TrustCardsSection,
  type TrustCardItem,
} from "../site_4geeks-com/component-registry/trust_cards/v1.0/schema";

// two_column_accordion_card
export {
  twoColumnAccordionCardSectionSchema,
  twoColumnAccordionCardBulletSchema,
  type TwoColumnAccordionCardSection,
  type TwoColumnAccordionCardBullet,
} from "../site_4geeks-com/component-registry/two_column_accordion_card/v1.0/schema";

// two_column
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

// value_proof_panel
export {
  evidenceItemSchema,
  valueProofPanelMediaSchema,
  valueProofPanelSectionSchema,
  type EvidenceItem,
  type ValueProofPanelMedia,
  type ValueProofPanelSection,
} from "../site_4geeks-com/component-registry/value_proof_panel/v1.0/schema";

// whos_hiring
export {
  whosHiringSectionSchema,
  type WhosHiringSection,
} from "../site_4geeks-com/component-registry/whos_hiring/v1.0/schema";

// why_learn_ai
export {
  whyLearnAISectionSchema,
  type WhyLearnAISection,
} from "../site_4geeks-com/component-registry/why_learn_ai/v1.0/schema";

