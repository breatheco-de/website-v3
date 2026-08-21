/**
 * Mentorship Component Schemas - v1.0
 */
import { z } from "zod";
import { cardItemSchema } from "../../_common/schema";

export const mentorshipSectionSchema = z.object({
  type: z.literal("mentorship"),
  title: z.string(),
  subtitle: z.string().optional(),
  cards: z.array(cardItemSchema),
});

export type MentorshipSection = z.infer<typeof mentorshipSectionSchema>;
