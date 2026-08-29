import { AsyncLocalStorage } from "node:async_hooks";
import { getTokenUsername } from "./oauth.js";
import type { CatalogGrant } from "./tool-catalog.js";
import { hasCapAnyScope } from "./tool-catalog.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
// MCP_SERVER_SECRET is the internal credential used only for the MCP server's own
// loopback requests to the main app. It is NOT accepted as an inbound caller credential.
// MCP_API_KEY is supported as a backward-compatible alias.
const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

interface McpSessionStore {
  roleId?: string;
}

const mcpSession = new AsyncLocalStorage<McpSessionStore>();

/** Run MCP tool/catalog work with an optional active role (role-scoped connectors). */
export function runInMcpSession<T>(ctx: McpSessionStore, fn: () => Promise<T>): Promise<T> {
  return mcpSession.run(ctx, fn);
}

export function getActiveRoleId(): string | undefined {
  return mcpSession.getStore()?.roleId;
}

/**
 * Check whether the user associated with the given MCP bearer token holds the
 * required capability, optionally scoped to a content type.
 *
 * When the session has an active role (connector `/mcp/role/:id`), the check is
 * evaluated against that role's grants only.
 *
 * Fails closed (returns false) on any network error or when the token cannot
 * be resolved to a username.
 */
export async function checkCap(
  mcpToken: string,
  cap: string,
  contentType?: string,
): Promise<boolean> {
  const username = getTokenUsername(mcpToken);
  if (!username) return false;

  try {
    const params = new URLSearchParams({ cap, username });
    if (contentType) params.set("contentType", contentType);
    const roleId = getActiveRoleId();
    if (roleId) params.set("role", roleId);
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/auth/check-capability?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${MCP_SERVER_SECRET}` },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { allowed?: boolean };
    return data.allowed === true;
  } catch {
    return false;
  }
}

/** Load capability grants for the MCP caller. null = fetch failed. */
export async function fetchCallerGrants(mcpToken: string): Promise<CatalogGrant[] | null> {
  const username = getTokenUsername(mcpToken);
  if (!username) return null;
  try {
    const params = new URLSearchParams({ username });
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/auth/user-info?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${MCP_SERVER_SECRET}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { capabilities?: CatalogGrant[] };
    return Array.isArray(data.capabilities) ? data.capabilities : [];
  } catch {
    return null;
  }
}

export interface McpRoleContext {
  roleId: string;
  label: string;
  description: string;
  capabilities: CatalogGrant[];
  allowedTools: string[];
}

/** Membership + role caps for a role-scoped connector. */
export async function fetchRoleContext(
  username: string,
  roleId: string,
): Promise<{ ok: true; data: McpRoleContext } | { ok: false; status: number; error: string }> {
  try {
    const params = new URLSearchParams({ username, role: roleId });
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/auth/mcp-role-context?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${MCP_SERVER_SECRET}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      roleId?: string;
      label?: string;
      description?: string;
      capabilities?: CatalogGrant[];
      allowedTools?: string[];
    };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: body.error || `Role context failed (HTTP ${res.status})`,
      };
    }
    return {
      ok: true,
      data: {
        roleId: body.roleId || roleId,
        label: body.label || roleId,
        description: body.description || "",
        capabilities: Array.isArray(body.capabilities) ? body.capabilities : [],
        allowedTools: Array.isArray(body.allowedTools) ? body.allowedTools : [],
      },
    };
  } catch (err) {
    return { ok: false, status: 502, error: (err as Error).message };
  }
}

/** Role metadata for OAuth consent (no membership). */
export async function fetchRoleInfo(
  roleId: string,
): Promise<McpRoleContext | null> {
  try {
    const params = new URLSearchParams({ role: roleId });
    const url = `http://localhost:${MAIN_SERVER_PORT}/api/auth/mcp-role-info?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${MCP_SERVER_SECRET}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as McpRoleContext;
    return {
      roleId: body.roleId || roleId,
      label: body.label || roleId,
      description: body.description || "",
      capabilities: Array.isArray(body.capabilities) ? body.capabilities : [],
      allowedTools: Array.isArray(body.allowedTools) ? body.allowedTools : [],
    };
  } catch {
    return null;
  }
}

export async function denyUnlessContentView(
  mcpToken: string | undefined,
  contentType: string | undefined,
  grants: CatalogGrant[] | undefined,
) {
  if (!mcpToken) return null;
  if (contentType) {
    if (!(await checkCap(mcpToken, "content_view", contentType))) {
      return denyResponse("content_view", contentType);
    }
    return null;
  }
  if (grants && !hasCapAnyScope(grants, "content_view")) {
    return denyResponse("content_view");
  }
  return null;
}

export async function denyUnlessContentViewOrSeo(
  mcpToken: string | undefined,
  contentType: string | undefined,
  grants: CatalogGrant[] | undefined,
) {
  if (!mcpToken) return null;
  if (contentType) {
    if (await checkCap(mcpToken, "content_view", contentType)) return null;
    if (await checkCap(mcpToken, "seo_edit", contentType)) return null;
    return denyResponse("content_view|seo_edit", contentType);
  }
  if (grants) {
    if (hasCapAnyScope(grants, "content_view") || hasCapAnyScope(grants, "seo_edit")) return null;
    return denyResponse("content_view|seo_edit");
  }
  return null;
}

import type { McpTextResult } from "./respond.js";

/**
 * Return the standard MCP error shape for a capability denial.
 * Keeps individual tool handlers concise.
 */
export function denyResponse(cap: string, contentType?: string): McpTextResult {
  const scopeMsg = contentType ? ` for content type '${contentType}'` : "";
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: "forbidden",
          message: `Insufficient permissions: capability '${cap}' required${scopeMsg}.`,
        }),
      },
    ],
    isError: true,
  };
}
