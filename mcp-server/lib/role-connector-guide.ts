/**
 * Agent-facing guides for production plain /mcp and MCP-write-disabled overlays.
 */

import { isAgenticSwarmRoleId } from "../../shared/agentic-swarm-roles.js";
import {
  ROLE_CONNECTOR_UI_HINT,
  isMcpMutatingTool,
} from "../../shared/agent-identity.js";
import { fetchMcpAccess, fetchRoleInfo } from "./auth.js";
import { getTokenUsername } from "./oauth.js";
import { actionRequired, type McpTextResult } from "./respond.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

/** Mutates still allowed when MCP write is off (propose-only overlay). */
export const PROPOSE_ONLY_MUTATING_TOOLS = new Set([
  "agent_session",
  "propose_change",
  "update_proposal",
]);

export type RoleConnectorEntry = {
  role_id: string;
  label: string;
  description: string;
  url: string;
  agentic: boolean;
};

export type RoleConnectorGuide = {
  action_required: "role_connector_required";
  code: "role_connector_required";
  message: string;
  staff_path: string;
  production_unscoped: true;
  role_connectors: RoleConnectorEntry[];
  swarm_setup: string[];
};

export type McpWriteDisabledGuide = {
  action_required: "mcp_write_disabled";
  code: "mcp_write_disabled";
  message: string;
  mcp_write_enabled: false;
  staff_path: string;
  course_of_action: string[];
  non_effects: string[];
};

export type PrimaryBlocker = "role_connector_required" | "mcp_write_disabled" | null;

export function getMcpPublicBase(port = process.env.MCP_PORT || "3001"): string {
  return (
    process.env.MCP_PUBLIC_URL ||
    process.env.SITE_URL ||
    `http://127.0.0.1:${port}`
  ).replace(/\/$/, "");
}

export function shouldDenyUnscopedMutating(opts: {
  isRoleScoped: boolean;
  nodeEnv?: string;
}): boolean {
  return !opts.isRoleScoped && opts.nodeEnv === "production";
}

/** @deprecated Prefer shouldDenyUnscopedMutating — production no longer strips mutates. */
export function shouldStripUnscopedMutating(_opts: {
  isRoleScoped: boolean;
  nodeEnv?: string;
}): boolean {
  return false;
}

export function isProductionUnscoped(opts: {
  activeRoleId?: string | null;
  nodeEnv?: string;
}): boolean {
  return !opts.activeRoleId && (opts.nodeEnv ?? process.env.NODE_ENV) === "production";
}

export function pickPrimaryBlocker(opts: {
  productionUnscoped: boolean;
  mcpWriteEnabled: boolean;
}): PrimaryBlocker {
  if (opts.productionUnscoped) return "role_connector_required";
  if (!opts.mcpWriteEnabled) return "mcp_write_disabled";
  return null;
}

/** Consent-page card when sign-in carried no role (no `resource` / `mcp_role`). */
export function oauthPlainMcpNotice(nodeEnv = process.env.NODE_ENV): {
  title: string;
  body: string;
  advanced: string;
  isProduction: boolean;
} {
  const isProduction = nodeEnv === "production";
  const roleFraming =
    "If this connector's address ends in /mcp/role/<name>, it will still be limited to that role once connected.";
  const advanced =
    "Your MCP client did not send a resource address during sign-in (OAuth protected-resource metadata, RFC 9728). If you added this connector before role detection shipped, remove and re-add it so your client picks up the role. Role URLs: Private → MCP Server → Connection.";
  if (isProduction) {
    return {
      isProduction: true,
      title: "No agent role detected",
      body: `${roleFraming} A plain /mcp connector can read content but can't make edits in production.`,
      advanced,
    };
  }
  return {
    isProduction: false,
    title: "No agent role detected",
    body: `${roleFraming} In development, plain /mcp can edit when your MCP write setting is on; in production it can only read.`,
    advanced,
  };
}

export function mcpWriteDisabledGuide(): McpWriteDisabledGuide {
  return {
    action_required: "mcp_write_disabled",
    code: "mcp_write_disabled",
    message:
      "MCP write is disabled for this user (Security → Users → Allow using MCP to WRITE data is off). Direct draft/live mutate tools and proposal apply/reject are unavailable.",
    mcp_write_enabled: false,
    staff_path:
      "Private → Security → Users → select this user → enable Allow using MCP to WRITE data",
    course_of_action: [
      "Tell the human a user admin must turn on MCP write for this account (defaults off).",
      "Until then: use propose_change / author update_proposal only (propose-only mode), or have a write-enabled reviewer / staff Proposals UI apply.",
      "After the toggle is on, ask the human to refresh/reconnect MCP so tools/list updates.",
    ],
    non_effects: [
      "CMS roles and staff UI edit rights are unchanged by this toggle.",
      "MCP read can still be on; this only blocks freestyle/direct MCP writes and proposals_review.",
    ],
  };
}

const SWARM_SETUP = [
  "Do not use plain /mcp for writes in production.",
  "Add a separate MCP server/connection for each role URL below.",
  "Each agent should use exactly one /mcp/role/<id>.",
  "After reconnecting, refresh the host so tools/list updates.",
];

export function roleConnectorGuideFromEntries(
  roleConnectors: RoleConnectorEntry[],
  opts?: { tool?: string },
): RoleConnectorGuide {
  const empty = roleConnectors.length === 0;
  const message = empty
    ? `Mutating tools are not allowed on production plain /mcp. ${ROLE_CONNECTOR_UI_HINT} No roles are assigned to this user — ask a user admin to assign agent roles first.`
    : opts?.tool
      ? `Mutating tool '${opts.tool}' is not allowed on production plain /mcp. Reconnect with a role connector (/mcp/role/…). ${ROLE_CONNECTOR_UI_HINT}`
      : `This connector is production plain /mcp — writes are disabled. Reconnect with one role URL per agent. ${ROLE_CONNECTOR_UI_HINT}`;

  return {
    action_required: "role_connector_required",
    code: "role_connector_required",
    message,
    staff_path: "Private → MCP Server → Connection",
    production_unscoped: true,
    role_connectors: roleConnectors,
    swarm_setup: empty
      ? [
          "Ask a user admin to assign agent roles (Security → Users).",
          ...SWARM_SETUP,
        ]
      : SWARM_SETUP,
  };
}

async function fetchAssignedRoleIds(username: string): Promise<string[]> {
  try {
    const params = new URLSearchParams({ username });
    const url = `http://127.0.0.1:${MAIN_SERVER_PORT}/api/auth/user-info?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${MCP_SERVER_SECRET}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { roles?: string[] };
    return Array.isArray(data.roles) ? data.roles.map(String) : [];
  } catch {
    return [];
  }
}

export async function buildRoleConnectorEntries(
  username: string,
  publicBase = getMcpPublicBase(),
): Promise<RoleConnectorEntry[]> {
  const roleIds = await fetchAssignedRoleIds(username);
  const base = publicBase.replace(/\/$/, "");
  const out: RoleConnectorEntry[] = [];
  for (const roleId of roleIds) {
    const info = await fetchRoleInfo(roleId);
    out.push({
      role_id: info?.roleId || roleId,
      label: info?.label || roleId,
      description: info?.description || "",
      url: `${base}/mcp/role/${roleId}`,
      agentic: isAgenticSwarmRoleId(roleId),
    });
  }
  return out;
}

export async function buildRoleConnectorGuide(
  username: string | null | undefined,
  opts?: { tool?: string; publicBase?: string },
): Promise<RoleConnectorGuide> {
  const entries =
    username && username !== "weblify-local"
      ? await buildRoleConnectorEntries(username, opts?.publicBase)
      : [];
  return roleConnectorGuideFromEntries(entries, { tool: opts?.tool });
}

export async function buildConnectorTeachFields(opts: {
  mcpToken?: string;
  activeRoleId?: string | null;
  nodeEnv?: string;
}): Promise<{
  primary_blocker: PrimaryBlocker;
  production_unscoped: boolean;
  mcp_write_enabled: boolean;
  connector_guide?: RoleConnectorGuide;
  mcp_write_guide?: McpWriteDisabledGuide;
  session_guidance_extra: string[];
}> {
  const productionUnscoped = isProductionUnscoped({
    activeRoleId: opts.activeRoleId,
    nodeEnv: opts.nodeEnv,
  });
  const username = opts.mcpToken ? getTokenUsername(opts.mcpToken) : null;
  let mcpWriteEnabled = true;
  if (username && username !== "weblify-local") {
    const access = await fetchMcpAccess(username);
    mcpWriteEnabled = access.mcpWriteEnabled;
  }
  const primary = pickPrimaryBlocker({
    productionUnscoped,
    mcpWriteEnabled,
  });
  const session_guidance_extra: string[] = [];
  let connector_guide: RoleConnectorGuide | undefined;
  let mcp_write_guide: McpWriteDisabledGuide | undefined;

  if (productionUnscoped) {
    connector_guide = await buildRoleConnectorGuide(username);
    session_guidance_extra.push(
      "Production plain /mcp cannot write — reconnect with role URLs from connector_guide.role_connectors (one connection per agent role) before mutates.",
    );
  }
  if (!mcpWriteEnabled) {
    mcp_write_guide = mcpWriteDisabledGuide();
    session_guidance_extra.push(
      "MCP write is off for this user (Security → Users → Allow using MCP to WRITE data). Ask a user admin to enable it, or stay in propose-only mode — see mcp_write_guide.course_of_action.",
    );
  }

  return {
    primary_blocker: primary,
    production_unscoped: productionUnscoped,
    mcp_write_enabled: mcpWriteEnabled,
    connector_guide,
    mcp_write_guide,
    session_guidance_extra,
  };
}

export async function denyUnscopedProductionMutate(
  toolName: string,
  mcpToken?: string,
): Promise<McpTextResult> {
  const username = mcpToken ? getTokenUsername(mcpToken) : null;
  const guide = await buildRoleConnectorGuide(username, { tool: toolName });
  return actionRequired(
    { success: false, tool: toolName, ...guide },
    [
      {
        tool: "get_current_user",
        priority: "recommended",
        reason: "See connector_guide.role_connectors and primary_blocker.",
      },
      {
        tool: "bootstrap_agent",
        priority: "recommended",
        reason: ROLE_CONNECTOR_UI_HINT,
      },
    ],
  );
}

export async function denyMcpWriteDisabledMutate(
  toolName: string,
  mcpToken?: string,
): Promise<McpTextResult | null> {
  if (!isMcpMutatingTool(toolName)) return null;
  if (PROPOSE_ONLY_MUTATING_TOOLS.has(toolName)) return null;
  if (!mcpToken) return null;
  const username = getTokenUsername(mcpToken);
  if (!username || username === "weblify-local") return null;
  const access = await fetchMcpAccess(username);
  if (access.mcpWriteEnabled) return null;
  const guide = mcpWriteDisabledGuide();
  return actionRequired(
    { success: false, tool: toolName, ...guide },
    [
      {
        tool: "get_current_user",
        priority: "recommended",
        reason: "Confirm mcp_write_enabled and mcp_write_guide.course_of_action.",
      },
      {
        tool: "propose_change",
        priority: "recommended",
        reason: "Propose-only mode: file an edits proposal instead of direct writes.",
      },
    ],
  );
}
