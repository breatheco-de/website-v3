import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isMcpMutatingTool } from "../../shared/agent-identity.js";
import { assertMutatingAgentIdentity, extractToolArgs } from "./loopback.js";

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

type CatalogFilterOpts = {
  /** Unscoped /mcp: do not register mutating tools. */
  stripMutating?: boolean;
  /** Role connector: wrap mutates to require session + exact model. */
  requireIdentityOnMutate?: boolean;
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
    if (opts?.requireIdentityOnMutate && isMcpMutatingTool(name) && rest.length > 0) {
      const handlerIdx = rest.length - 1;
      const handler = rest[handlerIdx];
      if (typeof handler === "function") {
        const wrapped = async (...args: unknown[]) => {
          const toolArgs = extractToolArgs(args);
          const denied = await assertMutatingAgentIdentity(name, toolArgs);
          if (denied) return denied;
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
