/**
 * Modal Component Schemas - v1.0
 */
import { z } from "zod";
import { leadFormDataSchema } from "../../_common/schema";

const modalSharedFields = {
  type: z.literal("modal"),
  version: z.string().optional(),
  section_id: z
    .string()
    .optional()
    .describe(
      "URL hash trigger. Required for CTAs/links to open this modal (url: \"#this-id\"). Without it the modal cannot open. Agents: explain_site topic sections.",
    ),
  show_close: z
    .boolean()
    .optional()
    .describe("Show close button (default: true)")
    .default(true),
  size: z
    .enum(["sm", "md", "lg", "xl"])
    .optional()
    .describe("Modal width: sm (384px), md (512px), lg (672px), xl (896px)")
    .default("md"),
};

export const modalDefaultSectionSchema = z.object({
  ...modalSharedFields,
  variant: z.literal("default").optional(),
  heading: z.string().optional().describe("Modal title"),
  description: z
    .string()
    .optional()
    .describe("Short description shown below the heading"),
  form: leadFormDataSchema
    .optional()
    .describe("LeadForm configuration shown inside the modal"),
});

/**
 * Generic CTA: plain link when `url` is set; dropdown when `items` has entries
 * (same idea as hero workshop calendar providers, but not calendar-specific).
 */
export const modalCtaSchema = z.object({
  text: z.string(),
  url: z
    .string()
    .optional()
    .describe("Link target for a plain CTA. Omit when using items dropdown."),
  variant: z.enum(["primary", "secondary", "outline", "accent"]).optional(),
  icon: z.string().optional(),
  items: z
    .array(
      z.object({
        name: z.string(),
        url: z.string(),
      }),
    )
    .optional()
    .describe("When present, render as a dropdown of links instead of a single url."),
});

/** Column shape aligned with two_column (subset used inside the overlay). */
export const modalTwoColumnColumnSchema = z.object({
  image: z.string().optional(),
  image_alt: z.string().optional(),
  image_object_fit: z
    .enum(["cover", "contain", "fill", "none", "scale-down"])
    .optional(),
  image_object_position: z.string().optional(),
  image_max_width: z.string().optional(),
  image_max_height: z.string().optional(),
  image_mobile_max_width: z.string().optional(),
  image_mobile_max_height: z.string().optional(),
  justify: z.enum(["start", "center", "end"]).optional(),
  heading: z.string().optional().describe("Rich-text heading"),
  description: z.string().optional().describe("Rich-text body under the heading"),
  bullets: z
    .array(
      z.object({
        text: z.string(),
        icon: z.string().optional(),
      }),
    )
    .optional(),
  bullet_icon: z.string().optional(),
  bullet_icon_color: z.string().optional(),
  /** CTAs: link and/or dropdown via optional items[]. */
  buttons: z.array(modalCtaSchema).optional(),
});

export const modalTwoColumnSectionSchema = z.object({
  ...modalSharedFields,
  variant: z.literal("twoColumn"),
  size: z
    .enum(["sm", "md", "lg", "xl"])
    .optional()
    .describe("Modal width; twoColumn defaults to xl (896px)")
    .default("xl"),
  /** Grid proportions [left, right] summing to 12 (default 6/6). */
  proportions: z.tuple([z.number(), z.number()]).optional(),
  left: modalTwoColumnColumnSchema.optional(),
  right: modalTwoColumnColumnSchema.optional(),
});

export const modalSectionSchema = z.union([
  modalTwoColumnSectionSchema,
  modalDefaultSectionSchema,
]);

export type ModalDefaultSection = z.infer<typeof modalDefaultSectionSchema>;
export type ModalCta = z.infer<typeof modalCtaSchema>;
export type ModalTwoColumnColumn = z.infer<typeof modalTwoColumnColumnSchema>;
export type ModalTwoColumnSection = z.infer<typeof modalTwoColumnSectionSchema>;
export type ModalSection = z.infer<typeof modalSectionSchema>;
