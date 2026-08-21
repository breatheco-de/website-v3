import { z } from "zod";

export const contactBubbleImageSchema = z.object({
  url: z.string(),
  alt: z.string().optional(),
});

export const contactBubbleSectionSchema = z.object({
  type: z.literal("contact_bubble"),
  version: z.string().optional(),
  url: z.string(),
  size: z.union([z.enum(["sm", "md", "lg"]), z.number()]).optional(),
  icon: z.string().optional(),
  img: contactBubbleImageSchema.optional(),
  hover_text: z.string().optional(),
});

export type ContactBubbleImage = z.infer<typeof contactBubbleImageSchema>;
export type ContactBubbleSection = z.infer<typeof contactBubbleSectionSchema>;
