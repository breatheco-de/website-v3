import type { SVGProps } from "react";
import { AgentIcon } from "@/components/pipeline/AgentIcon";
import type { AgentId } from "@/components/pipeline/agentIcons";
import type { McpSetupTabId } from "@/components/mcp/mcpUrlHelpers";
import { cn } from "@/lib/utils";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

/** Cursor-style triangular mark (no asset in agents/). */
function CursorMark({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
      {...props}
    >
      <path d="M5.5 3.2 19.2 11.4c.7.4.5 1.4-.3 1.5l-6.1.7-2.4 5.7c-.3.8-1.5.7-1.7-.2L5.1 4.1c-.2-.7.5-1.2 1.1-.9z" />
    </svg>
  );
}

/** Generic MCP client mark — plug-in square for any other agent. */
function GenericMcpMark({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      {...props}
    >
      <rect x="4" y="6" width="12" height="12" rx="2.5" />
      <path d="M16 10h3.5a1.5 1.5 0 0 1 0 3H16" />
      <path d="M8 10v4M11 10v4" />
    </svg>
  );
}

const SETUP_TO_AGENT_ID: Partial<Record<McpSetupTabId, AgentId>> = {
  "claude-code": "claude",
  "claude-desktop": "claude",
  "claude-ai": "claude",
  chatgpt: "chatgpt",
  grok: "grok",
  perplexity: "perplexity",
  copilot: "copilot",
};

const markClass = "h-4 w-4 shrink-0 text-muted-foreground";

export function McpSetupAgentIcon({
  agentId,
  className,
}: {
  agentId: McpSetupTabId;
  className?: string;
}) {
  if (agentId === "cursor") {
    return <CursorMark className={cn(markClass, className)} />;
  }
  if (agentId === "generic") {
    return <GenericMcpMark className={cn(markClass, className)} />;
  }
  const brandId = SETUP_TO_AGENT_ID[agentId];
  if (brandId) {
    return <AgentIcon agentId={brandId} size="md" className={className} />;
  }
  return <GenericMcpMark className={cn(markClass, className)} />;
}
