/**
 * Agent identity: ownership = username + role; observability = exact versioned model.
 */

export type AgentActorType = "ui" | "mcp" | "system";

export type AgentActorLike = {
  type: AgentActorType;
  client?: string;
  /** Exact versioned model (e.g. claude/sonnet-4.5). */
  model?: string;
  /** MCP role id (e.g. copy_editor). Absent on UI; legacy MCP may lack it. */
  role?: string;
  source?: string;
};

export const LEGACY_UNKNOWN_ROLE = "unknown";

/** OAuth client bucket when the connector did not register a display name. */
export const UNKNOWN_MCP_CLIENT = "unknown-client";

/** Idle window: no events of any type → session fully expired (not open; mutates fail). */
export const AGENT_SESSION_IDLE_MS = 24 * 60 * 60 * 1000;

/** Staff-facing path to pick a role connector. */
export const ROLE_CONNECTOR_UI_HINT =
  "Private → MCP Server → Connection → choose a role (e.g. Copy Editor) → Choose this Role. " +
  "Reconnect to a role URL such as /mcp/role/copy_editor (local example: http://localhost:3001/mcp/role/copy_editor). " +
  "Plain /mcp is read-only.";

/** Normalize OAuth client name for open-session scope (blank → unknown-client). */
export function normalizeMcpClientName(client: unknown): string {
  if (typeof client !== "string") return UNKNOWN_MCP_CLIENT;
  const trimmed = client.trim();
  return trimmed || UNKNOWN_MCP_CLIENT;
}

/**
 * Exact model must be provider/model (contains `/`), not a family label like `claude`.
 */
export function isExactAgentModel(model: unknown): model is string {
  if (typeof model !== "string") return false;
  const trimmed = model.trim();
  if (!trimmed || trimmed.length > 128) return false;
  if (!trimmed.includes("/")) return false;
  const [provider, ...rest] = trimmed.split("/");
  const name = rest.join("/");
  if (!provider?.trim() || !name?.trim()) return false;
  // Reject bare family tokens used as the whole string before slash check already failed;
  // also reject provider/family-only patterns that are just one short word with no version signal —
  // require at least provider + non-empty model path.
  const lower = trimmed.toLowerCase();
  if (lower === "claude" || lower === "gpt" || lower === "gemini" || lower === "grok") return false;
  return true;
}

export function sanitizeExactAgentModel(model: unknown): string | undefined {
  if (!isExactAgentModel(model)) return undefined;
  return model.trim();
}

export function normalizeAgentRole(role: unknown): string | undefined {
  if (typeof role !== "string") return undefined;
  const trimmed = role.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 64 ? trimmed.slice(0, 64) : trimmed;
}

/**
 * Four-eyes / claim ownership key.
 * UI → ui:{username}
 * MCP with role → mcp:{username}:{roleId}
 * Legacy MCP without role → mcp:{username}:unknown
 */
export function agentIdentityKey(
  username: string,
  actor?: AgentActorLike | null,
): string {
  const user = username.trim().toLowerCase() || "unknown";
  if (!actor || actor.type === "ui") return `ui:${user}`;
  if (actor.type === "system") {
    return `system:${actor.source?.trim() || "unknown"}`;
  }
  const role = normalizeAgentRole(actor.role) || LEGACY_UNKNOWN_ROLE;
  return `mcp:${user}:${role}`;
}

export function sameAgentIdentity(
  usernameA: string,
  actorA: AgentActorLike | null | undefined,
  usernameB: string,
  actorB: AgentActorLike | null | undefined,
): boolean {
  return agentIdentityKey(usernameA, actorA) === agentIdentityKey(usernameB, actorB);
}

/** Staff UI may override MCP issue claims. */
export function isStaffUiActor(actor?: AgentActorLike | null): boolean {
  return !actor || actor.type === "ui";
}

/**
 * MCP display subject: prefer exact model, then optional family label, then client.
 * Appends ` as {role}` only when role is known (not legacy unknown).
 */
export function formatMcpActorSubject(
  actor: AgentActorLike,
  opts?: { familyLabel?: string | null },
): string | null {
  if (actor.type !== "mcp") return null;
  const model = actor.model?.trim();
  const client = actor.client?.trim();
  const family = opts?.familyLabel?.trim();
  const role = normalizeAgentRole(actor.role);
  const roleBit = role && role !== LEGACY_UNKNOWN_ROLE ? ` as ${role}` : "";
  const via = model || family || client || "MCP";
  return `${via}${roleBit}`;
}

export function formatAgentActorSuffix(actor?: AgentActorLike | null): string {
  if (!actor) return "";
  if (actor.type === "mcp") {
    const subject = formatMcpActorSubject(actor);
    return subject ? ` · via ${subject}` : "";
  }
  if (actor.type === "system") {
    return ` · via ${actor.source?.trim() || "system"}`;
  }
  return "";
}

export function formatAgentActorLine(by: string, actor?: AgentActorLike | null): string {
  return `${by}${formatAgentActorSuffix(actor)}`;
}

/**
 * Tools that write or change state — blocked on unscoped /mcp.
 * Reads, explain, bootstrap, list_*, get_* (non-mutating) stay allowed.
 */
export const MCP_MUTATING_TOOLS = new Set<string>([
  "agent_session",
  "update_product",
  "refresh_keyword_metrics",
  "update_fields",
  "update_entry_field",
  "update_entry_attributes",
  "ensure_content_type_schema_org",
  "update_content_type",
  "update_redirect",
  "add_section",
  "remove_section",
  "reorder_sections",
  "replace_entry_sections",
  "set_entry_attachment",
  "create_entry",
  "delete_entries",
  "translate_entry",
  "regenerate_entry_previews",
  "get_or_set_media_to_gallery",
  "create_variant",
  "delete_variant",
  "publish_draft",
  "promote_variant",
  "convert_to_draft",
  "add_database_item",
  "add_database_items",
  "update_database_item",
  "update_database_items",
  "delete_database_item",
  "create_or_update_database",
  "reindex_database",
  "update_issue",
  "propose_change",
  "update_proposal",
  "run_entry_diagnostics",
]);

export function isMcpMutatingTool(toolName: string): boolean {
  return MCP_MUTATING_TOOLS.has(toolName);
}

export function unscopedMutateDeniedPayload(toolName: string): {
  success: false;
  action_required: "role_connector_required";
  code: "role_connector_required";
  message: string;
  tool: string;
} {
  return {
    success: false,
    action_required: "role_connector_required",
    code: "role_connector_required",
    tool: toolName,
    message:
      `Mutating tool '${toolName}' is not allowed on unscoped /mcp. ` +
      ROLE_CONNECTOR_UI_HINT,
  };
}

export function missingExactModelPayload(toolName: string): {
  success: false;
  action_required: "exact_model_required";
  code: "exact_model_required";
  message: string;
  tool: string;
} {
  return {
    success: false,
    action_required: "exact_model_required",
    code: "exact_model_required",
    tool: toolName,
    message:
      `Tool '${toolName}' requires an exact versioned model (provider/model), e.g. claude/sonnet-4.5 or xai/grok-4. ` +
      `Pass model on agent_session start. Family labels like "claude" or "grok" are rejected.`,
  };
}

export function sessionRequiredPayload(toolName: string): {
  success: false;
  action_required: "session_required";
  code: "session_required";
  message: string;
  tool: string;
} {
  return {
    success: false,
    action_required: "session_required",
    code: "session_required",
    tool: toolName,
    message:
      `Mutating tool '${toolName}' requires agent_session_id. ` +
      `Call agent_session with action "start" and an exact model (provider/model), then pass the returned agent_session_id on every mutate.`,
  };
}

export function sessionUnknownPayload(
  toolName: string,
  detail?: string,
): {
  success: false;
  action_required: "session_unknown";
  code: "session_unknown";
  message: string;
  tool: string;
} {
  return {
    success: false,
    action_required: "session_unknown",
    code: "session_unknown",
    tool: toolName,
    message:
      detail?.trim() ||
      `agent_session_id is unknown, closed, idle-expired (24h), or does not match this username/role/client/site. ` +
        `Call agent_session start again.`,
  };
}

export function sessionConflictPayload(open: {
  agent_session_id: string;
  model?: string;
  label?: string;
  last_activity_at?: number;
}): {
  success: false;
  action_required: "session_conflict";
  code: "session_conflict";
  message: string;
  agent_session_id: string;
  model?: string;
  label?: string;
  last_activity_at?: number;
} {
  const modelBit = open.model ? ` (model ${open.model})` : "";
  const labelBit = open.label ? ` — "${open.label}"` : "";
  return {
    success: false,
    action_required: "session_conflict",
    code: "session_conflict",
    agent_session_id: open.agent_session_id,
    ...(open.model ? { model: open.model } : {}),
    ...(open.label ? { label: open.label } : {}),
    ...(typeof open.last_activity_at === "number"
      ? { last_activity_at: open.last_activity_at }
      : {}),
    message:
      `An open agent session already exists for this username + role + client + site: ${open.agent_session_id}${modelBit}${labelBit}. ` +
      `Retry agent_session start with resume:true to continue (same model), or force_new:true plus report (min 80 chars) to abandon and start fresh.`,
  };
}
