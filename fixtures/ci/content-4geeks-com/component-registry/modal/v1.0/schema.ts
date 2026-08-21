/**
 * Modal Component Schemas - v1.0
 */
import { z } from "zod";
import { leadFormDataSchema } from "../../_common/schema";

export const modalSectionSchema = z.object({
  type: z.literal("modal"),
  version: z.string().optional(),
  section_id: z.string().optional().describe("Unique ID used as the URL hash trigger (e.g., 'apply-modal' opens via #apply-modal)"),
  heading: z.string().optional().describe("Modal title"),
  description: z.string().optional().describe("Short description shown below the heading"),
  show_close: z.boolean().optional().describe("Show close button (default: true)").default(true),
  size: z.enum(["sm", "md", "lg", "xl"]).optional().describe("Modal width: sm (384px), md (512px), lg (672px), xl (896px)").default("md"),
  form: leadFormDataSchema.optional().describe("LeadForm configuration shown inside the modal"),
});

export type ModalSection = z.infer<typeof modalSectionSchema>;
