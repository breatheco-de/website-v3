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
2. Treat the Known issues list as authoritative for what to fix. Use get_entry_content / get_entry_fields to inspect YAML paths; use update_fields (and related write tools) to fix. Honor next_actions / warnings / side_effects.
3. Before editing an issue, call update_issue with action "claim", that issue’s id (from validation_issues), and report (why you are claiming it, min 20 chars). After fixing, call update_issue with action "complete" and report (what you changed and how, min 20 chars). Soft-complete only — does not push YAML or run diagnostics. Claims expire after 30 minutes; re-claim to refresh TTL may omit report.
4. Do NOT call run_entry_diagnostics with confirm:true. Do NOT start or poll a new diagnostics job.
5. Scope: this contentType + slug + locale only. No unrelated pages. No locale fan-out unless a tool next_action says so.`;
}

export function buildSolveWithAiPrefillUrl(
  prefillUrlPrefix: string,
  prompt: string,
): string {
  return `${prefillUrlPrefix}${encodeURIComponent(prompt)}`;
}
