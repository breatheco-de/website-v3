/**
 * Certificate Component Schemas - v1.0
 */
import { z } from "zod";
import { statItemSchema } from "../../_common/schema";

export const certificateSectionSchema = z.object({
  type: z.literal("certificate"),
  title: z.string(),
  description: z.string(),
  benefits: z.array(z.object({ text: z.string() })),
  card: z.object({
    title: z.string(),
    subtitle: z.string(),
    program_name: z.string().optional(),
    certificate_label: z.string().optional(),
  }).optional(),
  stats: z.array(statItemSchema).optional(),
  certificate_position: z.enum(["left", "right"]).optional(),
  useSolidCard: z.boolean().optional(),
});

export type CertificateSection = z.infer<typeof certificateSectionSchema>;
