/**
 * Shared MCP `report` param guidance — staff read these on Background Pipeline /
 * issue history. Prefer plain values over JSON/YAML dumps or tool-name summaries.
 */

export const AGENT_REPORT_MUTATE_DESC =
  "Required (min 80 chars). Staff-readable: what you changed and why (paths/fields ok). " +
  "When you set copy or structured text (titles, subtitles, CTA, success messages, body blurbs), " +
  "list the plain new values inline (e.g. Title: …; Subtitle: …; Conversion: student_application). " +
  "Do not paste JSON/YAML or only say which tool/field names you touched. " +
  'Example: "Filled empty Spanish CTA on blog/foo/es (required-fields). Title: Aprende a programar. ' +
  "Subtitle: Cupos abiertos. Conversion: student_application. Success: Gracias, te contactaremos.\"";

export const AGENT_REPORT_ISSUE_DESC =
  "Required for first claim, complete, and release of an active claim (min 80 chars). " +
  "claim: why + plan. complete: what changed and how — include plain new values for any copy you set " +
  "(not JSON/YAML dumps). release: what you tried and why stopping. " +
  "Optional when re-claiming to refresh TTL or releasing with no active claim.";

export const AGENT_REPORT_SESSION_DESC =
  "Required for note/summarize (min 80 chars). Mid-run progress or end-of-run summary for staff. " +
  "For copy you set, restate plain values (Title: …; Subtitle: …); avoid JSON/YAML dumps.";

/** Short blurb for tool-level update_issue docs / examples. */
export const AGENT_REPORT_ISSUE_COMPLETE_EXAMPLE =
  'Example complete: "Set call_to_action on blog/foo/es. Title: Aprende a programar. ' +
  "Subtitle: Cupos abiertos. Conversion: student_application. Success: Gracias — required-fields cleared.\"";
