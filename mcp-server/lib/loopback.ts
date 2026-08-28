/**
 * Shared Authorization + MCP provenance headers for loopback calls to the main app.
 */

import { getTokenUsername, getTokenClientName } from "./oauth.js";

const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

export type LoopbackHeaderOpts = {
  agentSessionId?: string;
  omitJsonContentType?: boolean;
};

export function buildLoopbackHeaders(
  mcpToken?: string,
  opts?: LoopbackHeaderOpts,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!opts?.omitJsonContentType) {
    headers["Content-Type"] = "application/json";
  }
  if (MCP_SERVER_SECRET) {
    headers["Authorization"] = `Bearer ${MCP_SERVER_SECRET}`;
    const username = mcpToken ? getTokenUsername(mcpToken) : undefined;
    headers["x-mcp-author"] = username || "mcp";
    const clientName = mcpToken ? getTokenClientName(mcpToken) : undefined;
    if (clientName) headers["x-mcp-client"] = clientName;
  } else if (mcpToken) {
    const username = getTokenUsername(mcpToken);
    if (username) headers["x-mcp-author"] = username;
    const clientName = getTokenClientName(mcpToken);
    if (clientName) headers["x-mcp-client"] = clientName;
  }
  const session =
    typeof opts?.agentSessionId === "string" ? opts.agentSessionId.trim() : "";
  if (session) headers["x-mcp-agent-session"] = session;
  return headers;
}

export function missingSessionWarning(agentSessionId?: string): {
  code: string;
  message: string;
} | null {
  if (agentSessionId && agentSessionId.trim()) return null;
  return {
    code: "agent_session_unscoped",
    message:
      "No agent_session_id — staff will see this write under Unscoped. Call agent_session start and pass agent_session_id on mutates to group the run.",
  };
}
