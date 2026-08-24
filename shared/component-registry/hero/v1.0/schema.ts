/**
 * Hero Component Schemas - v1.0
 * All hero variant Zod schemas for validation
 */
import { z } from "zod";
import { ctaButtonSchema, videoConfigSchema, leadFormDataSchema } from "../../_common/schema";
import { awardsMarqueeItemSchema } from "../../awards_marquee/v1.0/schema";

// Trust bar for singleColumn variant
export const trustBarSchema = z.object({
  rating: z.string().optional(),
  rating_count: z.string().optional(),
  trusted_text: z.string(),
  avatars: z.array(z.string()).optional(),
});

// Award badge
export const awardBadgeSchema = z.object({
  name: z.string(),
  source: z.string(),
  year: z.string().optional(),
});

// Hero image
export const heroImageSchema = z.object({
  src: z.string(),
  alt: z.string(),
});

// Brand mark for productShowcase
export const brandMarkSchema = z.object({
  prefix: z.string().optional(),
  highlight: z.string(),
  suffix: z.string().optional(),
  color: z.enum(["primary", "accent", "destructive", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5"]).optional(),
});

// Review logo for productShowcase trust bar
export const reviewLogoSchema = z.object({
  name: z.string(),
  logo: z.string().optional(),
});

// Trust bar for productShowcase
export const productShowcaseTrustBarSchema = z.object({
  rating: z.string().optional(),
  review_count: z.string().optional(),
  review_logos: z.array(reviewLogoSchema).optional(),
});

// Embedded marquee for productShowcase (renders below description)
export const embeddedMarqueeSchema = z.object({
  items: z.array(awardsMarqueeItemSchema),
  speed: z.number().optional(),
  gradient: z.boolean().optional(),
  gradientColor: z.string().optional(),
  gradientWidth: z.number().optional(),
});

// Bullet item for productShowcase (renders below description)
export const bulletItemSchema = z.object({
  text: z.string(),
});

// Course tutor
export const heroCourseTutorSchema = z.object({
  name: z.string(),
  role: z.string(),
  image: z.string(),
});

// Course feature
export const heroCourseFeatureSchema = z.object({
  icon: z.string(),
  text: z.string(),
  count: z.union([z.string(), z.number()]).optional(),
});

// ============================================
// Hero Variant Schemas
// ============================================

export const heroSingleColumnSchema = z.object({
  type: z.literal("hero"),
  version: z.string().optional(),
  variant: z.literal("singleColumn"),
  title: z.string(),
  subtitle: z.string().optional(),
  badge: z.string().optional(),
  cta_buttons: z.array(ctaButtonSchema).optional(),
  trust_bar: trustBarSchema.optional(),
  award_badges: z.array(awardBadgeSchema).optional(),
  image: z.object({ src: z.string(), alt: z.string().optional(), fallback: z.string().optional() }).optional(),
  image_full_width: z.boolean().optional(),
  image_width: z.string().optional(),
}).passthrough();

/** Author entry for blogHero byline (hydrated from `{{ single.authors }}`). */
export const heroBlogAuthorSchema = z.union([
  z.string(),
  z
    .object({
      name: z.string().optional(),
      slug: z.string().optional(),
      url: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      image: z.union([z.string(), z.record(z.unknown())]).optional(),
      _image: z.union([z.string(), z.record(z.unknown())]).optional(),
    })
    .passthrough(),
]);

/** Reading time for blogHero — independent of article sections on the page. */
export const heroBlogReadingTimeSchema = z.object({
  from_content: z
    .string()
    .optional()
    .describe(
      "Body markdown/HTML used only to estimate reading time (~200 wpm). Map: reading_time.from_content: '{{ single.content }}'. Not rendered in the hero.",
    ),
  value_in_minutes: z
    .number()
    .optional()
    .describe(
      "Fixed reading time in minutes. When set, overrides from_content.",
    ),
});

export const heroBlogHeroSchema = z.object({
  type: z.literal("hero"),
  version: z.string().optional(),
  variant: z.literal("blogHero"),
  title: z.string(),
  subtitle: z.string().optional(),
  updated_at: z
    .string()
    .optional()
    .describe(
      "Editorial last-modified. Map: updated_at: '{{ single.updated_at }}'. Shown in the meta row when parseable.",
    ),
  authors: z
    .array(heroBlogAuthorSchema)
    .optional()
    .describe(
      "Author byline with avatars. Map: authors: '{{ single.authors }}'. Pointers hydrate on page/SSR.",
    ),
  reading_time: heroBlogReadingTimeSchema.optional(),
}).passthrough();

export const heroShowcaseSchema = z.object({
  type: z.literal("hero"),
  version: z.string().optional(),
  variant: z.literal("showcase"),
  title: z.string(),
  subtitle: z.string().optional(),
  trust_bar: trustBarSchema.optional(),
  cta_button: ctaButtonSchema,
  left_images: z.array(heroImageSchema).optional(),
  right_images: z.array(heroImageSchema).optional(),
  show_arrow: z.boolean().optional(),
}).passthrough();

export const heroProductShowcaseSchema = z.object({
  type: z.literal("hero"),
  version: z.string().optional(),
  variant: z.literal("productShowcase"),
  title: z.string(),
  subtitle: z.string().optional(),
  welcome_text: z.string().optional(),
  brand_mark: brandMarkSchema.optional(),
  description: z.string().optional(),
  // Bullet points render below description (optional)
  bullets: z.array(bulletItemSchema).nullish(),
  footer: z.string().optional(),
  // Embedded marquee renders below description (optional)
  marquee: embeddedMarqueeSchema.nullish(),
  video: videoConfigSchema.optional(),
  video_id: z.string().optional(),
  video_ratio: z.string().optional(),
  image: z.union([
    z.object({ src: z.string(), alt: z.string() }),
    z.string(),
  ]).nullish(),
  image_alt: z.string().optional(),
  image_object_fit: z.string().optional(),
  image_object_position: z.string().optional(),
  // NOTE: Background image is only displayed on screens >= 1280px width.
  // On smaller screens, a gradient fallback is shown instead for better mobile experience.
  background_image: z.object({
    src: z.string(),
    alt: z.string().optional(),
  }).nullish(),
  // Decorative images displayed on left and right sides (optional)
  left_images: z.array(heroImageSchema).optional(),
  right_images: z.array(heroImageSchema).optional(),
  form: leadFormDataSchema.nullish(),
  form_vertical_align: z.enum(["top", "center", "bottom"]).optional(),
  form_card_background: z.string().optional(),
  form_card_text_color: z.string().optional(),
  form_card_title: z.string().optional(),
  form_card_subtitle: z.string().optional(),
  form_card_image: z.union([
    z.object({ src: z.string(), alt: z.string() }),
    z.string(),
  ]).optional(),
  form_card_image_alt: z.string().optional(),
  form_card_image_object_fit: z.string().optional(),
  form_card_image_object_position: z.string().optional(),
  form_card_image_width: z.string().optional(),
  form_card_image_height: z.string().optional(),
  form_card_image_opacity: z.number().optional(),
  form_card_image_border_radius: z.string().optional(),
  form_terms_color: z.string().optional(),
  cta_button: ctaButtonSchema.nullish(),
  trust_bar: productShowcaseTrustBarSchema.nullish(),
  show_awards_marquee: z.boolean().optional(),
  awards_marquee_at_left_column: z.boolean().optional(),
  awards_marquee: z.object({
    items: z.array(awardsMarqueeItemSchema),
    speed: z.number().optional(),
    gradient: z.boolean().optional(),
    gradientWidth: z.number().optional(),
  }).optional(),
}).passthrough();

export const heroSimpleTwoColumnSchema = z.object({
  type: z.literal("hero"),
  version: z.string().optional(),
  variant: z.literal("simpleTwoColumn"),
  title: z.string(),
  subtitle: z.string().optional(),
  badge: z.string().optional(),
  image: z.union([
    z.object({ src: z.string(), alt: z.string() }),
    z.string(),
  ]).optional(),
  image_alt: z.string().optional(),
  image_object_fit: z.string().optional(),
  image_object_position: z.string().optional(),
  video: videoConfigSchema.optional(),
  cta_buttons: z.array(ctaButtonSchema).optional(),
  background: z.string().optional(),
}).passthrough();

export const heroSimpleStackedSchema = z.object({
  type: z.literal("hero"),
  version: z.string().optional(),
  variant: z.literal("simpleStacked"),
  title: z.string(),
  subtitle: z.string().optional(),
  badge: z.string().optional(),
  image: z.object({
    src: z.string(),
    alt: z.string(),
  }).optional(),
  cta_buttons: z.array(ctaButtonSchema).optional(),
  background: z.string().optional(),
}).passthrough();

export const heroTwoColumnSchema = z.object({
  type: z.literal("hero"),
  version: z.string().optional(),
  variant: z.literal("twoColumn"),
  title: z.string(),
  subtitle: z.string().optional(),
  badge: z.string().optional(),
  image: z.string().optional(),
  image_alt: z.string().optional(),
  cta_buttons: z.array(ctaButtonSchema).optional(),
  background: z.string().optional(),
}).passthrough();

export const heroCourseSchema = z.object({
  type: z.literal("hero"),
  version: z.string().optional(),
  variant: z.literal("course"),
  badge: z.object({
    text: z.string(),
    color: z.enum(["primary", "secondary", "accent", "muted", "destructive"]).optional(), // defaults to primary
    background: z.string().optional(), // custom CSS background (overrides `color` preset)
    text_color: z.string().optional(), // custom CSS text color (overrides `color` preset)
  }).optional(),
  title: z.string(),
  title_highlight: z.string().optional(),
  subtitle: z.string().optional(),
  students_enrolled: z.object({
    avatars: z.array(z.string()).optional(),
    count: z.string(),
  }).optional(),
  bullet_points: z.array(z.string()).optional(),
  rating: z.object({
    value: z.number(), // e.g., 4.5
    count: z.string(), // e.g., "(1346 Ratings)"
    reviews_anchor: z.string().optional(), // e.g., "#reviews" - links to reviews section
  }).optional(),
  tutors: z.array(heroCourseTutorSchema).optional(),
  tutors_label: z.string().optional(),
  description: z.string().optional(),
  video: videoConfigSchema.optional(),
  media: z.object({
    type: z.enum(["video", "image"]),
    src: z.string(),
    thumbnail: z.string().optional(),
    alt: z.string().optional(),
  }).optional(),
  signup_card: z.object({
    title: z.string(),
    description: z.string().optional(),
    form: leadFormDataSchema.optional(),
    cta_button: ctaButtonSchema.optional(),
    login_link: z.object({
      text: z.string(),
      url: z.string().optional(),
    }).optional(),
    features: z.array(heroCourseFeatureSchema).optional(),
  }).optional(),
  layout_reversed: z.boolean().optional(),
}).passthrough();

// ApplyFormProductShowcase variant - hero with application form and product showcase
export const heroApplyFormProductShowcaseSchema = z.object({
  type: z.literal("hero"),
  version: z.string().optional(),
  variant: z.literal("ApplyFormProductShowcase"),
  title: z.string(),
  brand_mark: brandMarkSchema.optional(),
  description: z.string().optional(),
  footer: z.string().optional(),
  form: leadFormDataSchema,
  form_vertical_align: z.enum(["top", "center", "bottom"]).optional(),
  form_card_background: z.string().optional(),
  form_card_text_color: z.string().optional(),
  form_card_title: z.string().optional(),
  form_card_subtitle: z.string().optional(),
  form_card_image: z.union([
    z.object({ src: z.string(), alt: z.string() }),
    z.string(),
  ]).optional(),
  form_card_image_alt: z.string().optional(),
  form_card_image_object_fit: z.string().optional(),
  form_card_image_object_position: z.string().optional(),
  form_card_image_width: z.string().optional(),
  form_card_image_height: z.string().optional(),
  form_card_image_opacity: z.number().optional(),
  form_card_image_border_radius: z.string().optional(),
  form_terms_color: z.string().optional(),
  cta_button: ctaButtonSchema.optional(),
  trust_bar: productShowcaseTrustBarSchema.optional(),
  video: videoConfigSchema.optional(),
  image: z.union([
    z.object({ src: z.string(), alt: z.string() }),
    z.string(),
  ]).optional(),
  image_alt: z.string().optional(),
  image_object_fit: z.string().optional(),
  image_object_position: z.string().optional(),
  background_image: z.object({
    src: z.string(),
    alt: z.string().optional(),
  }).optional(),
  show_awards_marquee: z.boolean().optional(),
  awards_marquee: z.object({
    items: z.array(awardsMarqueeItemSchema),
    speed: z.number().optional(),
    gradient: z.boolean().optional(),
    gradientWidth: z.number().optional(),
  }).optional(),
}).passthrough();

// ─── HeroOrbit sub-schemas ────────────────────────────────────────────────────

export const heroOrbitBadgeSchema = z.object({
  label: z.string(),
  highlight: z.boolean().optional(),
});

export const heroOrbitDiagramSchema = z.object({
  center_label: z.string().optional(),
  legend_start: z.string().optional(),
  legend_highlight: z.string().optional(),
  badges: z.object({
    inner: z.array(heroOrbitBadgeSchema).optional(),
    middle: z.array(heroOrbitBadgeSchema).optional(),
    outer: z.array(heroOrbitBadgeSchema).optional(),
  }).optional(),
});

export const heroOrbitSchema = z.object({
  type: z.literal("hero"),
  version: z.string().optional(),
  variant: z.literal("orbit"),
  eyebrow: z.string().optional(),
  title: z.string(),
  body: z.string().optional(),
  stat: z.string().optional(),
  background: z.string().optional(),
  cta_buttons: z.array(ctaButtonSchema).optional(),
  orbit_diagram: heroOrbitDiagramSchema.optional(),
}).passthrough();

// ─── HeroCredibility sub-schemas ─────────────────────────────────────────────

export const heroCredibilityPillLogoSchema = z.object({
  image_id: z.string(),
});

export const heroCredibilityPillSchema = z.object({
  category: z.string(),
  logos: z.array(heroCredibilityPillLogoSchema).optional(),
  label: z.string(),
  background_color: z.string().optional(),
});

export const heroCredibilityMarqueeItemSchema = z.object({
  bold_text: z.string(),
  light_text: z.string(),
});

export const heroCredibilitySchema = z.object({
  type: z.literal("hero"),
  version: z.string().optional(),
  variant: z.literal("credibility"),
  title: z.string(),
  description: z.string().optional(),
  cta_buttons: z.array(ctaButtonSchema).optional(),
  pills: z.array(heroCredibilityPillSchema).optional(),
  pills_url: z.string().optional(),
  show_marquee: z.boolean().optional(),
  marquee_static: z.boolean().optional(),
  marquee_items: z.array(heroCredibilityMarqueeItemSchema).optional(),
  logo_rotation_ms_time: z.number().optional(),
  colored_logos: z.boolean().optional(),
}).passthrough();

// Exercise landing hero — form card on the right with optional corner badge image
export const heroExerciseSchema = z.object({
  type: z.literal("hero"),
  version: z.string().optional(),
  variant: z.literal("exercise"),
  badge: z.string().optional(),
  exercise_type: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  includes_title: z.string().optional(),
  category: z.string().optional(),
  technologies: z.union([z.array(z.string()), z.string()]).optional(),
  features: z.array(z.object({
    icon: z.string().optional(),
    text: z.string().optional(),
  })).optional(),
  stats: z.array(z.object({
    icon: z.string().optional(),
    label: z.string().optional(),
    value: z.union([z.string(), z.null()]).optional(),
    value_label: z.string().optional(),
  })).optional(),
  form_card_title: z.string().optional(),
  form_card_subtitle: z.string().optional(),
  form_card_disclaimer: z.string().optional(),
  form_card_image: z.union([
    z.object({ src: z.string(), alt: z.string().optional() }),
    z.string(),
  ]).optional(),
  form_card_image_alt: z.string().optional(),
  form_card_image_object_fit: z.string().optional(),
  form_card_image_object_position: z.string().optional(),
  form_card_image_width: z.string().optional(),
  form_card_image_height: z.string().optional(),
  form_card_image_opacity: z.number().optional(),
  form_card_image_border_radius: z.string().optional(),
  form: leadFormDataSchema.nullish(),
}).passthrough();

// Combined hero section schema
export const heroSectionSchema = z.union([
  heroSingleColumnSchema,
  heroBlogHeroSchema,
  heroShowcaseSchema,
  heroProductShowcaseSchema,
  heroSimpleTwoColumnSchema,
  heroSimpleStackedSchema,
  heroTwoColumnSchema,
  heroCourseSchema,
  heroApplyFormProductShowcaseSchema,
  heroCredibilitySchema,
  heroOrbitSchema,
  heroExerciseSchema,
]);

// Type exports
export type TrustBar = z.infer<typeof trustBarSchema>;
export type AwardBadge = z.infer<typeof awardBadgeSchema>;
export type HeroImage = z.infer<typeof heroImageSchema>;
export type BrandMark = z.infer<typeof brandMarkSchema>;
export type ReviewLogo = z.infer<typeof reviewLogoSchema>;
export type ProductShowcaseTrustBar = z.infer<typeof productShowcaseTrustBarSchema>;
export type EmbeddedMarquee = z.infer<typeof embeddedMarqueeSchema>;
export type BulletItem = z.infer<typeof bulletItemSchema>;
export type HeroCourseTutor = z.infer<typeof heroCourseTutorSchema>;
export type HeroCourseFeature = z.infer<typeof heroCourseFeatureSchema>;
export type HeroSingleColumn = z.infer<typeof heroSingleColumnSchema>;
export type HeroBlogHero = z.infer<typeof heroBlogHeroSchema>;
export type HeroShowcase = z.infer<typeof heroShowcaseSchema>;
export type HeroProductShowcase = z.infer<typeof heroProductShowcaseSchema>;
export type HeroSimpleTwoColumn = z.infer<typeof heroSimpleTwoColumnSchema>;
export type HeroSimpleStacked = z.infer<typeof heroSimpleStackedSchema>;
export type HeroTwoColumn = z.infer<typeof heroTwoColumnSchema>;
export type HeroCourse = z.infer<typeof heroCourseSchema>;
export type HeroApplyFormProductShowcase = z.infer<typeof heroApplyFormProductShowcaseSchema>;
export type HeroCredibilityPillLogo = z.infer<typeof heroCredibilityPillLogoSchema>;
export type HeroCredibilityPill = z.infer<typeof heroCredibilityPillSchema>;
export type HeroCredibilityMarqueeItem = z.infer<typeof heroCredibilityMarqueeItemSchema>;
export type HeroCredibility = z.infer<typeof heroCredibilitySchema>;
export type HeroOrbitBadge = z.infer<typeof heroOrbitBadgeSchema>;
export type HeroOrbitDiagram = z.infer<typeof heroOrbitDiagramSchema>;
export type HeroOrbit = z.infer<typeof heroOrbitSchema>;
export type HeroExercise = z.infer<typeof heroExerciseSchema>;
export type HeroSection = z.infer<typeof heroSectionSchema>;
