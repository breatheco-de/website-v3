/**
 * Lead Form Component Schemas - v1.0
 */
import { z } from "zod";
import { leadFormDataSchema } from "../../_common/schema";

export const leadFormSectionSchema = z.object({
  type: z.literal("lead_form"),
  version: z.string().optional(),
}).merge(leadFormDataSchema);

export type LeadFormSection = z.infer<typeof leadFormSectionSchema>;
