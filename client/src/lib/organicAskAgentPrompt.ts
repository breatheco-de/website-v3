import { renderAskAgentPrompt, type AskAgentPromptId } from "@shared/ask-agent-prompts";
import { getMcpServerUrl } from "@/components/mcp/mcpUrlHelpers";
import "@/lib/askAgentPrompts";

export function buildOrganicAskAgentPrompt(
  id: Extract<
    AskAgentPromptId,
    "organic-page2" | "organic-low-ctr" | "organic-missing-serp" | "organic-link-gaps"
  >,
  vars: Record<string, string>,
): string {
  return renderAskAgentPrompt(id, {
    mcp_url: typeof window !== "undefined" ? getMcpServerUrl() : "/mcp",
    ...vars,
  });
}

export function formatOrganicSerpStatus(r: {
  visible_in_serp: boolean | null;
  featured_snippet_url: string | null;
  has_paa: boolean;
  serp_fetched: boolean;
}): string {
  if (!r.serp_fetched) return "no snapshot";
  const parts: string[] = [];
  if (r.visible_in_serp === false) parts.push("not in live SERP");
  else if (r.visible_in_serp === true) parts.push("visible in live SERP");
  if (r.featured_snippet_url) parts.push("featured snippet present (not ours or competing)");
  if (r.has_paa) parts.push("PAA present");
  return parts.length ? parts.join(" · ") : "fetched";
}
