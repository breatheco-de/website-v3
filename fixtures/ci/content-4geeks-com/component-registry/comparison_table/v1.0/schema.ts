/**
 * Comparison Table Component Schemas - v1.0
 */
import { z } from "zod";

export const comparisonTableColumnSchema = z.object({
  name: z.string(),
  highlight: z.boolean().optional(),
});

export const comparisonTableCtaButtonSchema = z.object({
  text: z.string(),
  url: z.string(),
  variant: z.enum(["primary", "outline", "ghost", "secondary"]).optional(),
});

export const comparisonTableCellSchema = z.object({
  text: z.string().optional(),
  cta: z.array(comparisonTableCtaButtonSchema).optional(),
});

export const comparisonTableCellValueSchema = z.union([
  z.string(),
  comparisonTableCellSchema,
]);

export const comparisonTableRowSchema = z.object({
  feature: z.string(),
  values: z.array(comparisonTableCellValueSchema),
  feature_description: z.string().optional(),
});

export const comparisonTableSectionSchema = z.object({
  type: z.literal("comparison_table"),
  version: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  columns: z.array(comparisonTableColumnSchema),
  rows: z.array(comparisonTableRowSchema),
  background: z.string().optional(),
  footer_note: z.string().optional(),
  first_column_muted: z.boolean().optional(),
  bordered: z.boolean().optional(),
  odd_row_color: z.string().optional(),
});

export type ComparisonTableCtaButton = z.infer<typeof comparisonTableCtaButtonSchema>;
export type ComparisonTableCell = z.infer<typeof comparisonTableCellSchema>;
export type ComparisonTableCellValue = z.infer<typeof comparisonTableCellValueSchema>;
export type ComparisonTableColumn = z.infer<typeof comparisonTableColumnSchema>;
export type ComparisonTableRow = z.infer<typeof comparisonTableRowSchema>;
export type ComparisonTableSection = z.infer<typeof comparisonTableSectionSchema>;
