import type { PageDiagnostics } from "./types";
import type { McpSetupTabId } from "@/components/mcp/mcpUrlHelpers";
import { getMcpServerUrl } from "@/components/mcp/mcpUrlHelpers";
import { renderAskAgentPrompt } from "@shared/ask-agent-prompts";
import "@/lib/askAgentPrompts";

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

  return renderAskAgentPrompt("page-diagnostics", {
    url: pageDiagnostics.url,
    content_type: pageDiagnostics.contentType,
    slug: pageDiagnostics.slug,
    locale: pageDiagnostics.locale,
    variant_line: variantLine,
    file_path: pageDiagnostics.filePath,
    mcp_url: mcpUrl,
    error_block: errorBlock,
    warning_block: warningBlock,
  });
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

  return renderAskAgentPrompt("draft-feedback", {
    share_url: opts.shareUrl,
    content_type: opts.contentType,
    slug: opts.slug,
    locale: opts.locale,
    variant: opts.variant,
    mcp_url: mcpUrl,
  });
}
