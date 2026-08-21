import { z } from "zod";
import { leadFormDataSchema } from "../../_common/schema";

export const contactLocationSchema = z.object({
  code: z.string(),
  name: z.string(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string(),
});

export type ContactLocation = z.infer<typeof contactLocationSchema>;

export const contactUsInfoSectionSchema = z.object({
  type: z.literal("contact_us_info"),
  version: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  background: z.string().optional(),
  form: leadFormDataSchema,
  locations_title: z.string().optional(),
  locations: z.array(contactLocationSchema),
});

export type ContactUsInfoSection = z.infer<typeof contactUsInfoSectionSchema>;
