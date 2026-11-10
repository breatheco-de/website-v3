/**
 * Issue codes written by the render review (review_page_render MCP tool /
 * server/design/render-review.ts). There is no validator run() for these:
 * findings come from screenshots + in-page measurements and stay in the
 * issue store until the next review of that page replaces them.
 */

import type { IssueCodeDefinition } from "../shared/types";

export const RENDER_REVIEW_VALIDATOR_NAME = "render-review" as const;

const reReview = { tool: "review_page_render", reason: "Fix the listed sections[i] path, then re-run the review", priority: "recommended" as const };

export const RENDER_REVIEW_ISSUE_CODES: Record<string, IssueCodeDefinition> = {
  RENDER_HORIZONTAL_OVERFLOW: {
    title: "Section Overflows The Screen",
    suggestion: "Shorten long words/URLs, reduce fixed widths, or pick a variant that wraps on mobile.",
    next_actions: [reReview],
  },
  RENDER_COLOR_EDGE_WITHOUT_PADDING: {
    title: "Content Touches A Background Edge",
    suggestion: "Add paddingY to the section with the background (or use a self-padded variant).",
    next_actions: [reReview],
  },
  RENDER_HEADING_ORDER: {
    title: "Heading Levels Skip",
    next_actions: [reReview],
  },
  RENDER_MULTIPLE_H1: {
    title: "More Than One H1",
    next_actions: [reReview],
  },
  RENDER_EMPTY_SECTION: {
    title: "Section Renders Empty",
    suggestion: "Fill the required content for this variant or remove the section.",
    next_actions: [reReview],
  },
  RENDER_SECTION_NOT_LOADED: {
    title: "Section Code Did Not Load",
    summary:
      "The section's code did not finish downloading during the review, so it could not be measured. Usually a slow or failed download, not missing content.",
    suggestion: "Re-run the review before editing the section.",
    next_actions: [{ tool: "review_page_render", reason: "Re-run the review; the section is usually fine", priority: "recommended" }],
  },
  RENDER_SECTION_UNKNOWN_TYPE: {
    title: "Unknown Section Type",
    summary: "No component exists for this section's type, so it renders nothing on the live page.",
    suggestion: "Fix the section `type` in the content (re-running the review will not help).",
    next_actions: [
      { tool: "list_components", reason: "Find the correct section type name", priority: "recommended" },
      { tool: "get_component_schema", reason: "Check the fields for the corrected type", priority: "optional" },
    ],
  },
  RENDER_BROKEN_IMAGE: {
    title: "Image Failed To Load",
    next_actions: [reReview],
  },
  RENDER_TIGHT_GAP: {
    title: "Sections Overlap",
    next_actions: [reReview],
  },
  RENDER_MEASUREMENTS_MISSING: {
    title: "Preview Did Not Finish Rendering",
    summary: "The page preview never published layout measurements — a section may crash or load forever.",
    next_actions: [reReview],
  },
  RENDER_LEARNED_RULE: {
    title: "Layout Differs From Approved Pages",
    summary: "Approved pages of this kind usually lay these sections out differently (learned rule).",
    next_actions: [{ tool: "get_page_recipe", reason: "See the learned rule and example pages", priority: "optional" }],
  },
};
