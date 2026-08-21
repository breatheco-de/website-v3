/**
 * Sticky CTA Component Schemas - v1.0
 */
import { z } from "zod";
import { leadFormDataSchema } from "../../_common/schema";

export const stickyCtaSectionSchema = z.object({
  type: z.literal("sticky_cta"),
  version: z.string().optional(),
  heading: z.string().describe("Text displayed in the sticky bar"),
  button_label: z.string().optional().describe("Label for the expand button").default("Apply Now"),
  show_dismiss: z.boolean().optional().describe("Show dismiss button when collapsed (default: false)").default(false),
  form: leadFormDataSchema.optional().describe("LeadForm configuration shown when expanded"),
});

export type StickyCtaSection = z.infer<typeof stickyCtaSectionSchema>;
