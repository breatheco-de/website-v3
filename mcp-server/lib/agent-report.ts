/**
 * Shared MCP `report` / structured why+highlights guidance — staff read these on
 * Background Pipeline / issue history.
 */

import {
  AGENT_WHY_MIN_LENGTH,
  hasBigFieldUpdates,
  type FieldUpdateLike,
} from "@shared/agent-report-structured";

export const AGENT_WHY_DESC =
  `Required (min ${AGENT_WHY_MIN_LENGTH} chars). Plain English ticket/goal for staff ` +
  "(e.g. Join orphan to Coding Bootcamp hub for REFRESH #419). " +
  "Do not pad with process boilerplate (automatic bot / via MCP / tool names).";

export const AGENT_HIGHLIGHTS_DESC =
  "Short bullets of the biggest deltas on large edits (sections, link lists, long body). " +
  "Required when touching sections/arrays/long text, or on structural tools / issue complete. " +
  "Example: [\"Added internal links: /a, /b\", \"Replaced hero CTA label\"]. " +
  "Server fills simple field values (meta.title, seo.*) automatically — do not dump YAML.";

/** @deprecated Prefer why + highlights on field mutates / complete. */
export const AGENT_REPORT_MUTATE_DESC =
  "Deprecated for field mutates — use why + highlights. " +
  "Still used for some tools: staff-readable what/why (min 80). " +
  "When you set copy, list plain new values (Title: …).";

export const AGENT_REPORT_ISSUE_DESC =
  "Required for first claim and release of an active claim (min 80 chars). " +
  "claim: why + plan. release: what you tried and why stopping. " +
  "For complete: use why + highlights instead of report. " +
  "Optional when re-claiming to refresh TTL or releasing with no active claim.";

export const AGENT_REPORT_SESSION_DESC =
  "Required for note/summarize (min 80 chars). Mid-run progress or end-of-run summary for staff. " +
  "For copy you set, restate plain values (Title: …; Subtitle: …); avoid JSON/YAML dumps.";

export const AGENT_REPORT_ISSUE_COMPLETE_EXAMPLE =
  'Example complete: why: "Cleared required-fields on blog/foo/es by setting CTA." ' +
  'highlights: ["Title: Aprende a programar", "Conversion: student_application"]';

export function highlightsRequiredForUpdates(updates: FieldUpdateLike[]): boolean {
  return hasBigFieldUpdates(updates);
}
