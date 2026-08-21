import { z } from "zod";

export const dynamicTableColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["text", "number", "date", "image", "link", "boolean"]),
  function: z.string().optional(),
  template: z.string().optional(),
});

export const dynamicTableActionSchema = z.object({
  label: z.string(),
  href: z.string(),
});

export const dynamicTableSectionSchema = z.object({
  type: z.literal("dynamic_table"),
  version: z.string().optional(),
  variant: z.enum(["default", "striped", "cards", "comparison"]).optional(),
  endpoint: z.string(),
  data_path: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  background: z.string().optional(),
  columns: z.array(dynamicTableColumnSchema),
  action: dynamicTableActionSchema.optional(),
  global_filter: z.string().optional(),
  max_rows: z.number().int().positive().optional(),
});

export type DynamicTableColumn = z.infer<typeof dynamicTableColumnSchema>;
export type DynamicTableAction = z.infer<typeof dynamicTableActionSchema>;
export type DynamicTableSection = z.infer<typeof dynamicTableSectionSchema>;
