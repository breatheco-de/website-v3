import { markFileAsModified } from "../../server/sync-state.js";
import type { EventActor } from "../../server/events/types.js";

/** Notify sync state after MCP writes YAML to disk (pipeline events via listener). */
export function notifyMcpContentWrite(
  filePath: string,
  author?: string,
  opts?: { agent_session_id?: string; report?: string; actor?: EventActor },
): number | null {
  markFileAsModified(filePath, author ?? "mcp", undefined, undefined, opts?.actor ?? { type: "mcp" }, {
    agentSessionId: opts?.agent_session_id,
    report: opts?.report,
  });
  return null;
}
