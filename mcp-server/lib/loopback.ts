/**
 * Shared Authorization + MCP provenance headers for loopback calls to the main app.
 */

import { getTokenUsername, getTokenClientName } from "./oauth.js";
import { getActiveRoleId } from "./auth.js";
import {
  isExactAgentModel,
  missingExactModelPayload,
  unscopedMutateDeniedPayload,
  isMcpMutatingTool,
  ROLE_CONNECTOR_UI_HINT,
} from "../../shared/agent-identity.js";
import { actionRequired, type McpTextResult } from "./respond.js";

const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

export type LoopbackHeaderOpts = {
  agentSessionId?: string;
  omitJsonContentType?: boolean;
  /** Exact versioned model (provider/model), e.g. claude/sonnet-4.5. */
  model?: string;
};

export function resolveLoopbackModel(opts?: LoopbackHeaderOpts): string {
  const fromOpt =
    typeof opts?.model === "string" && opts.model.trim() ? opts.model.trim() : "";
  if (fromOpt) return fromOpt;
  return (process.env.MCP_AGENT_MODEL || "").trim();
}

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
  const model = resolveLoopbackModel(opts);
  if (model) headers["x-mcp-model"] = model;
  const roleId = getActiveRoleId()?.trim();
  if (roleId) headers["x-mcp-role"] = roleId;
  return headers;
}

/**
 * Gate mutating MCP tools: require role connector + exact versioned model.
 * Returns an actionRequired result to return from the tool, or null if OK.
 */
export function assertMutatingAgentIdentity(toolName: string): McpTextResult | null {
  if (!isMcpMutatingTool(toolName)) return null;
  const roleId = getActiveRoleId()?.trim();
  if (!roleId) {
    const payload = unscopedMutateDeniedPayload(toolName);
    return actionRequired(payload, [
      {
        tool: "get_current_user",
        priority: "recommended",
        reason: "Confirm active_role is set (role connector).",
      },
      {
        tool: "bootstrap_agent",
        priority: "recommended",
        reason: ROLE_CONNECTOR_UI_HINT,
      },
    ]);
  }
  const model = resolveLoopbackModel();
  if (!isExactAgentModel(model)) {
    const payload = missingExactModelPayload(toolName);
    return actionRequired(payload, [
      {
        tool: "bootstrap_agent",
        priority: "required",
        reason:
          "Set MCP_AGENT_MODEL to an exact provider/model (e.g. claude/sonnet-4.5), then retry.",
      },
    ]);
  }
  return null;
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
