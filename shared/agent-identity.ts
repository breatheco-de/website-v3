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

/** Staff-facing path to pick a role connector. */
export const ROLE_CONNECTOR_UI_HINT =
  "Private → MCP Server → Connection → choose a role (e.g. Copy Editor) → Choose this Role. " +
  "Reconnect to a role URL such as /mcp/role/copy_editor (local example: http://localhost:3001/mcp/role/copy_editor). " +
  "Plain /mcp is read-only.";

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

export function formatAgentActorSuffix(actor?: AgentActorLike | null): string {
  if (!actor) return "";
  if (actor.type === "mcp") {
    const via = actor.client?.trim() || "MCP";
    const role = actor.role?.trim() || LEGACY_UNKNOWN_ROLE;
    const model = actor.model?.trim();
    // Staff display: username · role · exact/model · via client
    return ` · ${role}${model ? ` · ${model}` : ""} · via ${via}`;
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
      `Mutating tool '${toolName}' requires an exact versioned model (provider/model), e.g. claude/sonnet-4.5. ` +
      `Set MCP_AGENT_MODEL or pass model on the tool / loopback. Family labels like "claude" are rejected.`,
  };
}
