import type { PageDiagnostics } from "./types";
import type { McpSetupTabId } from "@/components/mcp/mcpUrlHelpers";
import { getMcpServerUrl } from "@/components/mcp/mcpUrlHelpers";

export type SolveWithAiAgentId =
  | "claude-ai"
  | "grok"
  | "chatgpt"
  | "perplexity"
  | "copilot"
  | "copy-prompt";

export interface SolveWithAiMenuItem {
  id: SolveWithAiAgentId;
  label: string;
  /** Prefill URL prefix ending with `q=` — omit for copy-only. */
  prefillUrlPrefix?: string;
  setupTab: McpSetupTabId;
}

/** Menu order: Claude.ai → Grok → ChatGPT → Perplexity → Copilot → Copy prompt. */
export const SOLVE_WITH_AI_MENU: SolveWithAiMenuItem[] = [
  {
    id: "claude-ai",
    label: "Claude.ai",
    prefillUrlPrefix: "https://claude.ai/new?q=",
    setupTab: "claude-ai",
  },
  {
    id: "grok",
    label: "Grok",
    prefillUrlPrefix: "https://grok.com/?q=",
    setupTab: "grok",
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    prefillUrlPrefix: "https://chatgpt.com/?q=",
    setupTab: "chatgpt",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    prefillUrlPrefix: "https://www.perplexity.ai/search/new?q=",
    setupTab: "perplexity",
  },
  {
    id: "copilot",
    label: "Copilot",
    prefillUrlPrefix: "https://copilot.microsoft.com/?q=",
    setupTab: "copilot",
  },
  {
    id: "copy-prompt",
    label: "Copy prompt",
    setupTab: "cursor",
  },
];

const MAX_WARNINGS_IN_PROMPT = 15;

function formatIssueLine(issue: {
  id?: string;
  code: string;
  message: string;
  suggestion?: string;
}): string {
  const idPart = issue.id ? ` [id=${issue.id}]` : "";
  const suggestion = issue.suggestion?.trim()
    ? ` (suggestion: ${issue.suggestion.trim()})`
    : "";
  return `- ${issue.code}${idPart}: ${issue.message}${suggestion}`;
}

export function buildSolveWithAiPrompt(pageDiagnostics: PageDiagnostics): string {
  const errors = (pageDiagnostics.issues ?? []).filter(
    (i) => i.type === "error" && !i.completed,
  );
  const warnings = (pageDiagnostics.issues ?? []).filter(
    (i) => i.type === "warning" && !i.completed,
  );
  const warningLines = warnings.slice(0, MAX_WARNINGS_IN_PROMPT).map(formatIssueLine);
  const extraWarnings = warnings.length - MAX_WARNINGS_IN_PROMPT;

  const errorBlock =
    errors.length > 0 ? errors.map(formatIssueLine).join("\n") : "- (none)";
  const warningBlock =
    warnings.length > 0
      ? [
          ...warningLines,
          ...(extraWarnings > 0
            ? [
                `- … and ${extraWarnings} more — load via get_entry_content.validation_issues`,
              ]
            : []),
        ].join("\n")
      : "- (none)";

  const variantLine =
    pageDiagnostics.variant != null && pageDiagnostics.variant !== ""
      ? `\n- variant: ${pageDiagnostics.variant}`
      : "";

  const mcpUrl = typeof window !== "undefined" ? getMcpServerUrl() : "/mcp";

  return `Fix validation issues for one page on this site using the 4Geeks CMS MCP server.

## Entry
- URL: ${pageDiagnostics.url}
- contentType: ${pageDiagnostics.contentType}
- slug: ${pageDiagnostics.slug}
- locale: ${pageDiagnostics.locale}${variantLine}
- filePath: ${pageDiagnostics.filePath}
- MCP server: ${mcpUrl}

## Known issues (from staff Page Diagnostics — open work queue only)
### Errors
${errorBlock}

### Warnings
${warningBlock}

## Rules
1. Use this site’s MCP tools. Authenticate/OAuth if needed.
2. Call agent_session with action "start", then pass the returned agent_session_id on every mutate. End with agent_session summarize (report min 80) when done.
3. Treat the Known issues list as authoritative for what to fix. Use get_entry_content / get_entry_fields to inspect YAML paths; use update_fields (and related write tools) to fix — every content mutate needs report (min 80 chars: what/why for this change). Honor next_actions / warnings / side_effects.
4. Before editing an issue, call update_issue with action "claim", that issue’s id (from validation_issues), and report (why you are claiming it + plan, min 80 chars). After fixing, call update_issue with action "complete" and report (what you changed and how, min 80 chars). Soft-complete only — does not push YAML or run diagnostics. Claims expire after 30 minutes; re-claim to refresh TTL may omit report.
5. Do NOT call run_entry_diagnostics with confirm:true. Do NOT start or poll a new diagnostics job.
6. Scope: this contentType + slug + locale only. No unrelated pages. No locale fan-out unless a tool next_action says so.`;
}

export function buildSolveWithAiPrefillUrl(
  prefillUrlPrefix: string,
  prompt: string,
): string {
  return `${prefillUrlPrefix}${encodeURIComponent(prompt)}`;
}

export function buildDraftFeedbackAiPrompt(opts: {
  shareUrl: string;
  contentType: string;
  slug: string;
  locale: string;
  variant: string;
}): string {
  const mcpUrl = typeof window !== "undefined" ? getMcpServerUrl() : "/mcp";

  return `Review this unpublished draft page and give actionable feedback using the 4Geeks CMS MCP server.

## Draft preview
- Share link (open in browser): ${opts.shareUrl}
- contentType: ${opts.contentType}
- slug: ${opts.slug}
- locale: ${opts.locale}
- variant: ${opts.variant}
- MCP server: ${mcpUrl}

## What I need
1. Read the draft via MCP (get_entry_content) and/or the share link above.
2. Comment on clarity, conversion, accuracy, and missing content — especially eligibility, how to apply, and sourced outcomes.
3. Do NOT publish, allocate traffic, or edit YAML unless I ask.
4. Scope: this entry only (${opts.contentType}/${opts.slug}, locale ${opts.locale}, variant ${opts.variant}).`;
}
