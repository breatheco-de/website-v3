import { z } from "zod";
import { ctaButtonSchema } from "../../_common/schema";

// ─── Shared sub-schemas ────────────────────────────────────────────────────────

const trustNoteSchema = z.object({
  image_id: z.string().optional(),
  initials: z.string(),
  message: z.string(),
});

const summaryRowSchema = z.object({
  label: z.string(),
  value: z.string().optional(),
  /** Alternative value shown when the program's optional add-on is toggled ON */
  value_with_addon: z.string().optional(),
  show_dynamic_program: z.boolean().optional(),
  show_dynamic_date: z.boolean().optional(),
  /** Shows addon.on.summary_value / addon.off.summary_value depending on the add-on toggle */
  show_dynamic_addon: z.boolean().optional(),
});

// ─── Optional add-on (e.g. Job Guarantee) ─────────────────────────────────────

export const enrollmentAddonStateSchema = z.object({
  /** Querystring link navigated when the toggle enters this state, like any page link (e.g. "?addon=job-guarantee" for ON, "?addon=" for OFF) */
  url: z.string().optional(),
  /** Green badge shown below the description while in this state (typically only for ON) */
  added_label: z.string().optional(),
  /** Value for summary rows with show_dynamic_addon while in this state */
  summary_value: z.string().optional(),
});

export const enrollmentAddonSchema = z.object({
  /** Add-on identifier. Used for default urls: ?addon=<id> (ON) and ?addon= (OFF) */
  id: z.string(),
  label: z.string(),
  /** Pill badge text next to the label (e.g. "Optional add-on"). Always rendered in primary color */
  badge: z.string().optional(),
  description: z.string().optional(),
  /** State config when the toggle is ON */
  on: enrollmentAddonStateSchema.optional(),
  /** State config when the toggle is OFF */
  off: enrollmentAddonStateSchema.optional(),
});

export const enrollmentSummarySchema = z.object({
  price_label: z.string(),
  price_amount: z.string(),
  price_period: z.string().optional(),
  price_sub: z.string().optional(),
  rows: z.array(summaryRowSchema).default([]),
  cta: ctaButtonSchema,
  trust_note: trustNoteSchema.optional(),
});

const benefitSchema = z.object({
  icon: z.string().optional(),
  title: z.string(),
  desc: z.string(),
});

const unlockSchema = z.object({
  icon: z.string().optional(),
  text: z.string(),
});

const selectionCardSchema = z.object({
  name: z.string(),
  duration: z.string(),
  badge: z.string().optional(),
  icon: z.string().optional(),
});

// ─── Date configuration ────────────────────────────────────────────────────────

const dateBadgeSchema = z.object({
  text: z.string(),
  color: z.string().optional(),
});

const dateTagSchema = z.object({
  text: z.string(),
  color: z.string().optional(),
});

const staticDateItemSchema = z.object({
  date_iso: z.string(),
  label: z.string().optional(),
  year: z.string().optional(),
  badges: z.array(dateBadgeSchema).optional(),
  tags: z.array(dateTagSchema).optional(),
  /** Querystring-only URL like "?cohort=sept-2026" merged into the current page URL on click */
  url: z.string().optional(),
});

const staticDatesSchema = z.object({
  mode: z.literal("static"),
  items: z.array(staticDateItemSchema),
});

const intervalDatesSchema = z.object({
  mode: z.literal("interval"),
  start_date_iso: z.string(),
  interval: z.number(),
  interval_unit: z.enum(["days", "weeks", "months"]),
  /** Querystring-only URL like "?cohort=rolling" merged into the current page URL on click */
  url: z.string().optional(),
});

export const enrollmentDatesSchema = z.discriminatedUnion("mode", [
  staticDatesSchema,
  intervalDatesSchema,
]);

// ─── Plan ─────────────────────────────────────────────────────────────────────

export const enrollmentPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string().optional(),
  currency: z.string(),
  amount: z.string(),
  period: z.string(),
  billing_note: z.string().optional(),
  tag: z.string().optional(),
  featured: z.boolean().optional(),
  /** Preselected when ?plan= is absent. Querystring takes priority over this. */
  default: z.boolean().optional(),
  /** Sent as top-level CTA checkout params from the current selection (not written to the page URL). */
  callback_label_en: z.string().optional(),
  callback_label_es: z.string().optional(),
  summary: enrollmentSummarySchema,
  benefits: z.array(benefitSchema).optional(),
  unlocks: z.array(unlockSchema).optional(),
});

// ─── Query-driven summary card (e.g. learning path from ?cohort=) ─────────────

const queryComponentBulletSchema = z.object({
  text: z.string(),
  icon: z.string().optional(),
});

const queryComponentItemSchema = z.object({
  /** Scalar or list; any listed value matching ?{param} selects this card. First matching item wins. */
  value: z.union([z.string(), z.array(z.string()).min(1)]),
  name: z.string(),
  tagline: z.string().optional(),
  hrs: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  bullets: z.array(queryComponentBulletSchema).default([]),
  /** Badge chips (PathItem-style). Always shown as marquee when expanded if non-empty. */
  badges: z.array(z.string()).optional(),
  /**
   * When true, collapsed card uses PathItem layout with first badges under the tagline
   * (fade/scale into the expand marquee). When false (default), collapsed stays as-is;
   * badges still appear as marquee when expanded (option B).
   */
  show_badges_collapsed: z.boolean().optional().default(false),
});

export const enrollmentQueryComponentSchema = z.object({
  /** Querystring key to read (e.g. "cohort"). Matched against items[].value (string or string[]). */
  param: z.string(),
  /** Optional uppercase label above the card */
  label: z.string().optional(),
  /** Expand control copy (default "View details") */
  view_details_label: z.string().optional(),
  items: z.array(queryComponentItemSchema),
});

// ─── Program ──────────────────────────────────────────────────────────────────

export const enrollmentProgramSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  selection_card: selectionCardSchema,
  summary: enrollmentSummarySchema,
  benefits: z.array(benefitSchema).default([]),
  unlocks: z.array(unlockSchema).default([]),
  dates: enrollmentDatesSchema.optional(),
  plans: z.array(enrollmentPlanSchema).optional(),
  addon: enrollmentAddonSchema.optional(),
  /**
   * Optional card shown when the page URL has ?{param} matching any items[].value
   * (string or string[]). Independent of date-mode cohort matching on `dates`.
   */
  query_component: enrollmentQueryComponentSchema.optional(),
  /** Sent as top-level CTA checkout params (plan labels override when present). */
  callback_label_en: z.string().optional(),
  callback_label_es: z.string().optional(),
});

// ─── Root schema ──────────────────────────────────────────────────────────────

export const enrollmentSelectorDefaultSchema = z.object({
  eyebrow: z.string().optional(),
  title: z.string(),
  choose_program_label: z.string().optional(),
  choose_date_label: z.string().optional(),
  choose_plan_label: z.string().optional(),
  included_label: z.string().optional(),
  programs: z.array(enrollmentProgramSchema),
});

// ─── Section schema (adds type/version/variant for SectionRenderer union) ─────

export const enrollmentSelectorSectionSchema = enrollmentSelectorDefaultSchema.extend({
  type: z.literal("enrollment_selector"),
  version: z.string().optional().default("1.0"),
  variant: z.enum(["default"]).optional().default("default"),
});

export type EnrollmentSelectorDefault = z.infer<typeof enrollmentSelectorDefaultSchema>;
export type EnrollmentSelectorSection = z.infer<typeof enrollmentSelectorSectionSchema>;
export type EnrollmentSelectorProgram = z.infer<typeof enrollmentProgramSchema>;
export type EnrollmentSelectorPlan = z.infer<typeof enrollmentPlanSchema>;
export type EnrollmentSummary = z.infer<typeof enrollmentSummarySchema>;
export type EnrollmentAddon = z.infer<typeof enrollmentAddonSchema>;
export type EnrollmentQueryComponent = z.infer<typeof enrollmentQueryComponentSchema>;
export type EnrollmentQueryComponentItem = z.infer<typeof queryComponentItemSchema>;
