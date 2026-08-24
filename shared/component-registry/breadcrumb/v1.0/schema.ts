import { z } from "zod";

export const breadcrumbItemSchema = z.object({
  label: z.string().min(1),
  url: z.string().optional(),
});

export const breadcrumbSectionSchema = z.object({
  type: z.literal("breadcrumb"),
  variant: z.enum(["default", "blogWithTags"]).optional(),
  items: z.array(breadcrumbItemSchema).min(1),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      "Tag chips for blogWithTags only. Map: tags: '{{ single.tags }}'. Visual metadata — not included in BreadcrumbList JSON-LD.",
    ),
});

export type BreadcrumbItem = z.infer<typeof breadcrumbItemSchema>;
export type BreadcrumbSection = z.infer<typeof breadcrumbSectionSchema>;
