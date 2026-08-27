import { useEffect, useState } from "react";
import {
  getAgentIconUrl,
  getDocumentTheme,
  type AgentId,
  type AgentTheme,
} from "./agentIcons";
import { cn } from "@/lib/utils";

function useAgentTheme(): AgentTheme {
  const [theme, setTheme] = useState<AgentTheme>(() => getDocumentTheme());
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getDocumentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/** Brand mark for a resolved MCP agent (Claude, ChatGPT, etc.). */
export function AgentIcon({
  agentId,
  className,
  size = "sm",
}: {
  agentId: AgentId;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const theme = useAgentTheme();
  const url = getAgentIconUrl(agentId, theme);
  if (!url) return null;

  const dim =
    size === "lg" ? "h-6 w-6" : size === "md" ? "h-5 w-5" : "h-3.5 w-3.5";

  return (
    <img
      src={url}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(dim, "shrink-0 rounded-sm object-contain", className)}
    />
  );
}
