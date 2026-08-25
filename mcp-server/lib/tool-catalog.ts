import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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

/** null allowed = register every tool (dev and GET /tools). */
export function applyToolCatalogFilter(mcp: McpServer, allowed: Set<string> | null): void {
  if (!allowed) return;
  const original = mcp.tool.bind(mcp);
  mcp.tool = ((name: string, ...rest: unknown[]) => {
    if (!allowed.has(name)) {
      return {
        enabled: false,
        enable() {},
        disable() {},
        update() {},
        remove() {},
      };
    }
    return (original as (...args: unknown[]) => unknown)(name, ...rest);
  }) as typeof mcp.tool;
}
