/**
 * Chart Component Schemas - v1.0
 *
 * A mermaid diagram drawn by geekchart as an animated, designed SVG — the
 * same renderer used for ```mermaid fences inside `article` bodies
 * (server/markdown-enhance.ts), available here as its own section so a
 * diagram can be placed on any page, not only inside an article.
 */
import { z } from "zod";

export const chartSectionSchema = z.object({
  type: z.literal("chart"),
  version: z.string().optional(),
  source: z.string().min(1).describe("Mermaid diagram source (e.g. 'flowchart LR\\n  A --> B')"),
  caption: z.string().optional().describe("Optional caption shown below the chart"),
  duration: z
    .number()
    .min(0.25)
    .max(4)
    .optional()
    .default(1)
    .describe("How long the build animation takes, in seconds (e.g. 6). Left empty, the chart plays at its designed pace."),
});

export type ChartSection = z.infer<typeof chartSectionSchema>;
