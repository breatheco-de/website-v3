/**
 * Shared Authorization + MCP provenance headers for loopback calls to the main app.
 */

import { getTokenUsername, getTokenClientName } from "./oauth.js";
import { getActiveRoleId, getActiveMcpToken } from "./auth.js";
import {
  isExactAgentModel,
  missingExactModelPayload,
  unscopedMutateDeniedPayload,
  sessionRequiredPayload,
  sessionUnknownPayload,
  isMcpMutatingTool,
  normalizeMcpClientName,
  ROLE_CONNECTOR_UI_HINT,
} from "../../shared/agent-identity.js";
import { actionRequired, type McpTextResult } from "./respond.js";
import {
  getAgentSession,
  registerAgentSession,
  sessionScopeMatches,
  type AgentSessionRecord,
} from "./agent-session-store.js";
import { resolveSiteContext } from "./content.js";

const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";
const MAIN_SERVER_PORT = process.env.PORT || "5000";

export type LoopbackHeaderOpts = {
  agentSessionId?: string;
  omitJsonContentType?: boolean;
  /** Exact versioned model (provider/model), e.g. claude/sonnet-4.5. */
  model?: string;
};

/** Model for headers: explicit opts, else RAM session registry. Env MCP_AGENT_MODEL is not used. */
export function resolveLoopbackModel(opts?: LoopbackHeaderOpts): string {
  const fromOpt =
    typeof opts?.model === "string" && opts.model.trim() ? opts.model.trim() : "";
  if (fromOpt) return fromOpt;
  const sid =
    typeof opts?.agentSessionId === "string" ? opts.agentSessionId.trim() : "";
  if (sid) {
    const rec = getAgentSession(sid);
    if (rec?.model) return rec.model;
  }
  return "";
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
    headers["x-mcp-client"] = normalizeMcpClientName(clientName);
  } else if (mcpToken) {
    const username = getTokenUsername(mcpToken);
    if (username) headers["x-mcp-author"] = username;
    headers["x-mcp-client"] = normalizeMcpClientName(getTokenClientName(mcpToken));
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

function extractToolArgs(args: unknown[]): Record<string, unknown> | undefined {
  const first = args[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    return first as Record<string, unknown>;
  }
  return undefined;
}

function resolveSiteFolderFromArgs(args?: Record<string, unknown>): string | null {
  const siteArg =
    typeof args?.site === "string"
      ? args.site
      : typeof args?.domain === "string"
        ? args.domain
        : undefined;
  const siteResult = resolveSiteContext(siteArg);
  if (!siteResult.ok) return null;
  return siteResult.contentFolder;
}

export type MutateIdentityArgs = {
  toolName: string;
  /** First tool argument object (Zod-parsed). */
  args?: Record<string, unknown>;
};

/**
 * Gate mutating MCP tools: role connector + usable agent session with exact model.
 * `agent_session` action "start" skips session id (creates/resumes one).
 */
export async function assertMutatingAgentIdentity(
  toolName: string,
  args?: Record<string, unknown>,
): Promise<McpTextResult | null> {
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

  const action = typeof args?.action === "string" ? args.action : undefined;
  if (toolName === "agent_session" && action === "start") {
    // Model + conflict handled by checkpoint / tool body.
    return null;
  }

  const sid =
    typeof args?.agent_session_id === "string" ? args.agent_session_id.trim() : "";
  if (!sid) {
    return actionRequired(sessionRequiredPayload(toolName), [
      {
        tool: "agent_session",
        priority: "required",
        reason:
          "Start a session with an exact model (provider/model), then pass agent_session_id.",
        args_hint: { action: "start", model: "provider/model" },
      },
    ]);
  }

  const mcpToken = getActiveMcpToken();
  const username = (mcpToken ? getTokenUsername(mcpToken) : "") || "mcp";
  const client = normalizeMcpClientName(mcpToken ? getTokenClientName(mcpToken) : undefined);
  const site = resolveSiteFolderFromArgs(args);
  if (!site) {
    return actionRequired(sessionUnknownPayload(toolName, "Could not resolve site for session scope."), [
      {
        tool: "list_sites",
        priority: "recommended",
        reason: "Pass a valid site domain, then retry with agent_session_id.",
      },
    ]);
  }

  const scope = { username, role: roleId, client, site };
  let record = getAgentSession(sid);
  if (record && !sessionScopeMatches(record, scope)) {
    return actionRequired(
      sessionUnknownPayload(
        toolName,
        "agent_session_id does not match this username/role/client/site.",
      ),
      [
        {
          tool: "agent_session",
          priority: "required",
          reason: "Start or resume a session for this connector.",
          args_hint: { action: "start" },
        },
      ],
    );
  }

  if (!record || !isExactAgentModel(record.model)) {
    const rehydrated = await rehydrateAgentSession(sid, site, mcpToken);
    if (!rehydrated.ok) {
      return actionRequired(sessionUnknownPayload(toolName, rehydrated.message), [
        {
          tool: "agent_session",
          priority: "required",
          reason: "Start a new session (idle/closed/unknown ids cannot mutate).",
          args_hint: { action: "start" },
        },
      ]);
    }
    if (!sessionScopeMatches(rehydrated.record, scope)) {
      return actionRequired(
        sessionUnknownPayload(
          toolName,
          "agent_session_id does not match this username/role/client/site.",
        ),
        [
          {
            tool: "agent_session",
            priority: "required",
            reason: "Start or resume a session for this connector.",
            args_hint: { action: "start" },
          },
        ],
      );
    }
    registerAgentSession(rehydrated.record);
    record = rehydrated.record;
  }

  if (!isExactAgentModel(record.model)) {
    return actionRequired(missingExactModelPayload("agent_session"), [
      {
        tool: "agent_session",
        priority: "required",
        reason: "Start a session with an exact provider/model.",
        args_hint: { action: "start", model: "provider/model" },
      },
    ]);
  }

  return null;
}

async function rehydrateAgentSession(
  agentSessionId: string,
  site: string,
  mcpToken?: string,
): Promise<{ ok: true; record: AgentSessionRecord } | { ok: false; message: string }> {
  try {
    const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/admin/agent-sessions/checkpoint`;
    const res = await fetch(url, {
      method: "POST",
      headers: buildLoopbackHeaders(mcpToken, { agentSessionId }),
      body: JSON.stringify({
        action: "resolve",
        site,
        agent_session_id: agentSessionId,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.usable !== true) {
      return {
        ok: false,
        message: String(data.error ?? data.message ?? "Session not usable"),
      };
    }
    const model = typeof data.model === "string" ? data.model.trim() : "";
    if (!isExactAgentModel(model)) {
      return { ok: false, message: "Session has no exact model on start attribution" };
    }
    return {
      ok: true,
      record: {
        agentSessionId,
        model,
        username:
          (typeof data.author === "string" && data.author.trim()) ||
          getTokenUsername(mcpToken || "") ||
          "mcp",
        role:
          (typeof data.role === "string" && data.role.trim()) ||
          getActiveRoleId()?.trim() ||
          "",
        client: normalizeMcpClientName(data.client),
        site,
      },
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** @deprecated Soft unscoped warning removed — mutates require a session. */
export function missingSessionWarning(_agentSessionId?: string): null {
  return null;
}

export { extractToolArgs };
