/**
 * Geeks vs Others Comparison Component Schemas - v1.0
 * Specialized comparison table for 4Geeks Academy vs competitors
 */
import { z } from "zod";

export const geeksVsOthersColumnSchema = z.object({
  name: z.string(),
  highlight: z.boolean().optional(),
});

export const geeksVsOthersRowSchema = z.object({
  feature: z.string(),
  values: z.array(z.string()),
  feature_description: z.string().optional(),
});

export const geeksVsOthersComparisonSectionSchema = z.object({
  type: z.literal("geeks_vs_others_comparison"),
  version: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  columns: z.array(geeksVsOthersColumnSchema),
  rows: z.array(geeksVsOthersRowSchema),
  background: z.string().optional(),
  footer_note: z.string().optional(),
});

export type GeeksVsOthersColumn = z.infer<typeof geeksVsOthersColumnSchema>;
export type GeeksVsOthersRow = z.infer<typeof geeksVsOthersRowSchema>;
export type GeeksVsOthersComparisonSection = z.infer<typeof geeksVsOthersComparisonSectionSchema>;
