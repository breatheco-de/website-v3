import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isMcpMutatingTool } from "../../shared/agent-identity.js";
import { getActiveMcpToken } from "./auth.js";
import { assertMutatingAgentIdentity, extractToolArgs } from "./loopback.js";
import { ENTRY_REF_TOOLS, wrapEntryRefTool } from "./entry-ref-mcp.js";
import {
  denyMcpWriteDisabledMutate,
  denyUnscopedProductionMutate,
  shouldDenyUnscopedMutating,
  shouldStripUnscopedMutating,
} from "./role-connector-guide.js";

export {
  IDENTITY_TOOLS,
  TOOL_GATES,
  allowedToolNames,
  grantsCanMutateMetrics,
  hasCapAnyScope,
  visibleContentTypes,
  type CatalogGrant,
  type ToolGate,
} from "../../shared/mcp-tool-catalog.js";

export {
  shouldDenyUnscopedMutating,
  shouldStripUnscopedMutating,
} from "./role-connector-guide.js";

type CatalogFilterOpts = {
  /** Unscoped /mcp: do not register mutating tools (legacy; prefer denyUnscopedMutating). */
  stripMutating?: boolean;
  /** Role connector: wrap mutates to require session + exact model. */
  requireIdentityOnMutate?: boolean;
  /** Production plain /mcp: register mutates but always deny with role_connector guide. */
  denyUnscopedMutating?: boolean;
  /** Fallback when ALS has no token (plain /mcp before runInMcpSession). */
  mcpToken?: string;
};

const DISABLED_TOOL = {
  enabled: false,
  enable() {},
  disable() {},
  update() {},
  remove() {},
};

/** null allowed = register every (non-stripped) tool. */
export function applyToolCatalogFilter(
  mcp: McpServer,
  allowed: Set<string> | null,
  opts?: CatalogFilterOpts,
): void {
  const original = mcp.tool.bind(mcp);
  mcp.tool = ((name: string, ...rest: unknown[]) => {
    if (opts?.stripMutating && isMcpMutatingTool(name)) {
      return DISABLED_TOOL;
    }
    if (allowed && !allowed.has(name)) {
      return DISABLED_TOOL;
    }
    if (ENTRY_REF_TOOLS.has(name) && rest.length > 0) {
      rest = wrapEntryRefTool(rest);
    }
    if (isMcpMutatingTool(name) && rest.length > 0) {
      const handlerIdx = rest.length - 1;
      const handler = rest[handlerIdx];
      if (typeof handler === "function") {
        const wrapped = async (...args: unknown[]) => {
          const toolArgs = extractToolArgs(args);
          const token = getActiveMcpToken() || opts?.mcpToken;
          if (opts?.denyUnscopedMutating) {
            return denyUnscopedProductionMutate(name, token);
          }
          if (opts?.requireIdentityOnMutate) {
            const denied = await assertMutatingAgentIdentity(name, toolArgs);
            if (denied) return denied;
          }
          const writeDenied = await denyMcpWriteDisabledMutate(name, token);
          if (writeDenied) return writeDenied;
          return (handler as (...a: unknown[]) => unknown)(...args);
        };
        const next = [...rest];
        next[handlerIdx] = wrapped;
        return (original as (...args: unknown[]) => unknown)(name, ...next);
      }
    }
    return (original as (...args: unknown[]) => unknown)(name, ...rest);
  }) as typeof mcp.tool;
}
