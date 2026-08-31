import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTokenUsername } from "../lib/oauth.js";
import { checkCap } from "../lib/auth.js";
import { allowedToolNames, type CatalogGrant } from "../lib/tool-catalog.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const MCP_SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

/**
 * Build internal auth headers for loopback calls to the main server,
 * forwarding the resolved username so the endpoint can look up the user record.
 */
function internalHeaders(username: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (MCP_SERVER_SECRET) {
    headers["Authorization"] = `Bearer ${MCP_SERVER_SECRET}`;
  }
  return headers;
}

export function registerUserTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
  opts?: { activeRoleId?: string; roleDescription?: string; roleLabel?: string },
): void {
  mcp.tool(
    "get_current_user",
    "Return the identity, roles, effective capabilities, and allowed_tools of the authenticated MCP caller. " +
      "Useful for agents that need to understand who they are acting as and what operations they are permitted to perform. " +
      "Returns: username, firstName, lastName, email, roles, capabilities, allowed_tools, " +
      "mcp_read_enabled, mcp_write_enabled (MCP-only overlay; CMS roles unchanged), " +
      "active_role (null on /mcp; role id on /mcp/role/:id), role_description. " +
      "When mcp_write_enabled is false, capabilities are view-only and mutate tools are absent from allowed_tools. " +
      "When mcp_read_enabled is false, the connection is rejected before tools run. " +
      "Note: metrics_view is read-only (diagnostics/insights/error log/conversions/tracking); it does not authorize content edits or job runs. " +
      "content_view authorizes YAML/component/explain reads only. Cursor's tool list updates on MCP reconnect/refresh after a role or MCP-access change.",
    {},
    async () => {
      const username = mcpToken ? getTokenUsername(mcpToken) : null;

      try {
        const params = new URLSearchParams();
        if (username) params.set("username", username);
        const url = `http://localhost:${MAIN_SERVER_PORT}/api/auth/user-info?${params}`;
        const res = await fetch(url, {
          headers: internalHeaders(username ?? ""),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "failed_to_fetch_user",
                  status: res.status,
                  detail: body,
                }),
              },
            ],
            isError: true,
          };
        }

        const profile = (await res.json()) as {
          capabilities?: CatalogGrant[];
          mcp_read_enabled?: boolean;
          mcp_write_enabled?: boolean;
        } & Record<string, unknown>;
        const capGrants = Array.isArray(grants)
          ? grants
          : Array.isArray(profile.capabilities)
            ? profile.capabilities
            : [];
        const mcpReadEnabled = profile.mcp_read_enabled !== false;
        const mcpWriteEnabled = mcpReadEnabled && profile.mcp_write_enabled !== false;
        const payload = {
          ...profile,
          // Session grants win when role-scoped (do not re-expand to all user roles).
          capabilities: capGrants,
          allowed_tools: allowedToolNames(capGrants),
          mcp_read_enabled: mcpReadEnabled,
          mcp_write_enabled: mcpWriteEnabled,
          active_role: opts?.activeRoleId ?? null,
          role_label: opts?.roleLabel ?? null,
          role_description: opts?.roleDescription ?? null,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "network_error",
                message: (err as Error).message,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  mcp.tool(
    "check_capability",
    "Check whether the authenticated MCP caller holds a specific capability, optionally scoped to a content type. " +
      "Use this before attempting privileged operations so agents can handle permission denials gracefully. " +
      "Parameters: cap (required) — the capability name to check; contentType (optional) — restrict the check to a specific content type. " +
      "Returns: { allowed: boolean }. In development mode always returns { allowed: true }.",
    {
      cap: z.string().describe("The capability name to check (e.g. 'edit_content', 'manage_users')."),
      contentType: z.string().optional().describe("Optional content type to scope the capability check (e.g. 'career_program')."),
    },
    async ({ cap, contentType }) => {
      try {
        const allowed = mcpToken
          ? await checkCap(mcpToken, cap, contentType)
          : process.env.NODE_ENV !== "production";

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ allowed }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "network_error",
                message: (err as Error).message,
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
