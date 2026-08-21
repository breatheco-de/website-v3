/**
 * Footer Component Schemas - v1.0
 */
import { z } from "zod";

export const footerSectionSchema = z.object({
  type: z.literal("footer"),
  copyright_text: z.string(),
});

export type FooterSection = z.infer<typeof footerSectionSchema>;
