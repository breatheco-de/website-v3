/**
 * Attach catalog help / suggestion / next_actions / staff_context to MCP issue rows.
 */

import {
  getIssueCodeDefinition,
  isIssueCodeAgentGuidanceComplete,
  resolveIssueSuggestion,
} from "../../scripts/validation/shared/issueCodeRegistry.js";
import { readStaffContextForAgent } from "../../server/validation-issue-context.js";

export type IssueCatalogEnrichment = {
  suggestion?: string;
  help?: { title: string; summary?: string; incomplete?: boolean };
  next_actions?: Array<{ tool: string; reason: string; priority?: string }>;
  staff_context?: string;
};

export function enrichIssueCatalogFields(opts: {
  validator?: string | null;
  code: string;
  instanceSuggestion?: string | null;
  contentRoot?: string;
}): IssueCatalogEnrichment {
  const def = getIssueCodeDefinition(opts.validator, opts.code);
  const suggestion = resolveIssueSuggestion(opts.validator, opts.code, opts.instanceSuggestion);
  const out: IssueCatalogEnrichment = {};
  if (suggestion) out.suggestion = suggestion;
  if (def) {
    const help: { title: string; summary?: string; incomplete?: boolean } = {
      title: def.title,
    };
    if (def.summary?.trim()) help.summary = def.summary.trim();
    if (!isIssueCodeAgentGuidanceComplete(def)) help.incomplete = true;
    out.help = help;
    if (def.next_actions?.length) {
      out.next_actions = def.next_actions.map((a) => ({
        tool: a.tool,
        reason: a.reason,
        ...(a.priority ? { priority: a.priority } : {}),
      }));
    }
  }
  if (opts.contentRoot) {
    const staff = readStaffContextForAgent(opts.contentRoot, opts.validator, opts.code);
    if (staff) out.staff_context = staff;
  }
  return out;
}
