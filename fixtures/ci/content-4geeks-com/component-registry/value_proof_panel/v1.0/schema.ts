/**
 * Value Proof Panel Component Schemas - v1.0
 * 
 * A credibility-focused section that displays evidence items with optional media.
 * Designed to replace generic two-column layouts with purpose-built validation sections.
 */
import { z } from "zod";

export const evidenceItemSchema = z.object({
  icon: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  source: z.string().optional(),
  source_url: z.string().optional(),
});

export const valueProofPanelMediaSchema = z.object({
  type: z.enum(["image", "video"]).default("image"),
  src: z.string(),
  alt: z.string().optional(),
  aspect_ratio: z.enum(["1:1", "4:3", "16:9", "3:4"]).optional(),
  style: z.enum(["rounded", "organic", "circle"]).optional(),
  object_fit: z.enum(["cover", "contain", "fill", "none", "scale-down"]).optional(),
  object_position: z.string().optional(),
});

export const valueProofPanelSectionSchema = z.object({
  type: z.literal("value_proof_panel"),
  title: z.string(),
  subtitle: z.string().optional(),
  evidence_items: z.array(evidenceItemSchema).min(1).max(6),
  media: valueProofPanelMediaSchema.optional(),
  background: z.string().optional(),
  reverse_layout: z.boolean().optional(),
  stacked_header: z.boolean().optional(),
});

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type ValueProofPanelMedia = z.infer<typeof valueProofPanelMediaSchema>;
export type ValueProofPanelSection = z.infer<typeof valueProofPanelSectionSchema>;
