/**
 * Article Component Schemas - v1.0
 *
 * Variants:
 * - default: Full-width article with optional top or side table of contents
 *
 * Split pages: 2+ article sections always continue one piece. TOC on/off =
 * first article's show_toc; reading time + meta only on the first (combined
 * bodies); mobile/top TOC only on the first; desktop side TOC may still appear
 * on later parts. toc_group is legacy/internal, not a share choice.
 */
import { z } from "zod";

export const articleSectionSchema = z.object({
  type: z.literal("article"),
  variant: z.enum(["default"]).optional(),
  content: z.string().describe("Markdown content for the article body"),
  show_toc: z
    .boolean()
    .optional()
    .describe(
      "Show the auto-generated table of contents. On pages with 2+ articles, only the first article's show_toc controls the shared TOC; later values are non-effects.",
    ),
  toc_position: z
    .enum(["top", "side"])
    .optional()
    .describe(
      "Position of the table of contents: top (above content) or side (sticky sidebar). On split pages, mobile/top TOC renders only on the first article; desktop side TOC may still appear on later parts.",
    ),
  toc_group: z
    .string()
    .optional()
    .describe(
      "Legacy/internal id for heading stability. Not a share decision — 2+ articles on a page always continue one piece regardless.",
    ),
  show_reading_time: z
    .boolean()
    .optional()
    .describe(
      "Show estimated reading time on the first article (default true). On split pages, minutes combine all article bodies; later articles never show meta/reading time.",
    ),
  tags: z.array(z.string()).optional().describe("Optional tag chips in the article meta row"),
  category: z.string().optional().describe("Optional category chip in the article meta row"),
  category_url: z.string().optional().describe("Optional link for the category chip"),
  /**
   * Hydrated author objects (from `{{ single.authors }}`) or legacy strings.
   * Byline joins names in array order (index 0 = primary).
   */
  authors: z
    .array(
      z.union([
        z.string(),
        z
          .object({
            name: z.string().optional(),
            slug: z.string().optional(),
            url: z.string().optional(),
            first_name: z.string().optional(),
            last_name: z.string().optional(),
          })
          .passthrough(),
      ]),
    )
    .optional()
    .describe(
      "Author byline entries. Map explicitly: authors: '{{ single.authors }}'. Pointers hydrate on page/SSR.",
    ),
  updated_at: z
    .string()
    .optional()
    .describe(
      "Editorial last-modified (same clock as manage Updated / sitemap lastmod / dateModified). Map: updated_at: '{{ single.updated_at }}'. Hidden when empty or unparseable.",
    ),
  section_id: z.string().optional().describe("Stable section id (also used as heading-id prefix on split pages)"),
});

export type ArticleSection = z.infer<typeof articleSectionSchema>;
